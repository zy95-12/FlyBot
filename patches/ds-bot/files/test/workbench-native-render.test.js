import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createScopedConversation } from '../src/client/workbench/native-source.js'
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS, 'package.json'))('jsdom')

test('actual original reply component renders scoped Markdown and unmounts on disposal', async () => {
  const bundle = await readFile(join(import.meta.dirname, '../workbench-native.js'), 'utf8')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  let unmount
  const source = createScopedConversation({ async call() { return { sessions: [{ role: 'developer', live: { text: '**Developer streaming**', tool: 'read_file' } }, { role: 'reviewer', live: { text: '**Reviewer streaming**' } }], messages: [{ speaker: 'chief', text: '**Original reply**\n\n`safe`\n\n<script>bad()</script>\n\n[bad](javascript:alert)' }] } } })
  try {
    dom.window.eval(bundle)
    await source.open({ projectId: 'a', visibility: 'public' })
    const node = dom.window.document.getElementById('root')
    unmount = dom.window.FlyBotNativeConversation.mountNativeConversation(node, { source, bots: [{ id: 'chief-a', name: 'Chief', role: 'chief' }] })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(node.querySelector('.bt-bubble strong')?.textContent, 'Original reply')
    assert.ok(node.querySelector('.bt-mark svg'))
    assert.match(node.textContent, /Developer streaming/)
    assert.ok(node.querySelector('[data-native-tool]'), 'real scoped tool progress is visible')
    assert.match(node.textContent, /Reviewer streaming/)
    assert.equal(node.querySelector('script'), null)
    assert.equal(node.querySelector('[href^="javascript:"]'), null)
    assert.ok(node.querySelector('[aria-label="More message actions"]'))
    source.dispose()
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(node.querySelector('.bt-bubble'), null)
  } finally { unmount?.(); source.dispose(); dom.window.close() }
})


test('original sidebar rows navigate only the supplied personal Bots and groups', async () => {
  const bundle = await readFile(join(import.meta.dirname, '../workbench-native.js'), 'utf8')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  const opened = [], details = []
  let unmount
  try {
    dom.window.eval(bundle)
    const node = dom.window.document.getElementById('root')
    unmount = dom.window.FlyBotNativeConversation.mountNativeChatList(node, {
      bots: [{ id: 'chief', sessionId: 'chief', name: 'Original Chief', role: 'Chief' }],
      rooms: [{ id: 'group', name: 'Original group', members: ['chief'], participants: [] }],
      mainBotIds: ['chief'], selectedId: 'chief', openSession: id => opened.push(id), openDetails: id => details.push(id),
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(node.querySelector('button[data-bot-id="chief"]').getAttribute('aria-current'), 'page')
    node.querySelector('button[data-bot-id="chief"]').click()
    node.querySelector('button[data-room-id="group"]').click()
    assert.deepEqual(opened, ['chief', 'group'])
    node.querySelector('.bt-row-settings').click()
    assert.deepEqual(details, ['chief'])
    assert.ok(node.querySelector('.bt-mark svg'))
    assert.equal(node.querySelector('[data-bot-id="other-member"]'), null)
    unmount(); unmount = null
    assert.equal(node.textContent, '')
  } finally { unmount?.(); dom.window.close() }
})

test('scoped native sidebar preserves original parent relationships and collapse controls', async () => {
  const bundle = await readFile(join(import.meta.dirname, '../workbench-native.js'), 'utf8')
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  let unmount
  try {
    dom.window.eval(bundle)
    const node = dom.window.document.getElementById('root')
    unmount = dom.window.FlyBotNativeConversation.mountNativeChatList(node, {
      bots: [{ id: 'chief', name: 'Original Chief' }, { id: 'child', name: 'Original child', parentId: 'chief' }],
      rooms: [], mainBotIds: ['chief'], selectedId: 'child', openSession() {},
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    const toggle = node.querySelector('button[aria-label="Collapse Original Chief"]')
    assert.ok(toggle, 'native tree control must reflect the original relationship')
    assert.equal(node.querySelector('[data-depth="1"] button[data-bot-id="child"]').getAttribute('aria-current'), 'page')
    toggle.click()
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(node.querySelector('[data-bot-id="child"]'), null)
    node.querySelector('button[aria-label="Expand Original Chief"]').click()
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.ok(node.querySelector('[data-bot-id="child"]'))
  } finally { unmount?.(); dom.window.close() }
})

test('same-origin native stylesheet includes the original mark and conversation rules under CSP', async () => {
  const css = await readFile(join(import.meta.dirname, '../workbench-native.css'), 'utf8')
  assert.ok(/\.bt-mark svg\{width:100%;height:100%/.test(css), 'same-origin CSS must contain native mark dimensions')
  assert.match(css, /\.bt-bubble/)
  const app = await readFile(join(import.meta.dirname, '../src/client/workbench/app.js'), 'utf8')
  assert.doesNotMatch(app, /el\('style', native\.nativeConversationCss\)/)
})


test('native conversation asset uses a production build within the initial script budget', async () => {
  const bundle = await readFile(join(import.meta.dirname, '../workbench-native.js'))
  assert.ok(bundle.byteLength < 4600000, `Native script exceeds 4.6 MB: ${bundle.byteLength}`)
  assert.equal(bundle.includes(Buffer.from('react.development.js')), false)
})


test('native math fonts are lazy same-origin assets rather than CSP-blocked data URLs', async () => {
  const css = await readFile(join(import.meta.dirname, '../workbench-native.css'), 'utf8')
  assert.equal(css.includes('data:font/'), false, 'embedded fonts violate the shared CSP')
  assert.ok(css.length < 250000, `Native stylesheet exceeds 250 KB: ${css.length}`)
  const fonts = [...css.matchAll(/url\((?:["'])?(\/workbench-fonts\/[^)"']+)/g)]
  assert.ok(fonts.length > 0, 'math fonts must retain same-origin sources')
  for (const [, path] of fonts) assert.ok((await readFile(join(import.meta.dirname, '..', path))).length > 0)
})

test('native scoped composer selects a visible mention, submits once and retains failed drafts', async () => {
  const bundle = await readFile(process.env.NATIVE_COMPOSER_BUNDLE ?? join(import.meta.dirname, '../workbench-native.js'), 'utf8')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  let unmount, rejectSend
  const sent = [], pause = () => new Promise(resolve => setTimeout(resolve, 40))
  try {
    dom.window.eval(bundle)
    const node = dom.window.document.getElementById('root')
    unmount = dom.window.FlyBotNativeConversation.mountNativeComposer(node, {
      initialText: 'Hello @Ch', mentions: [{ id: 'chief', name: 'Chief' }],
      chat: { send(text) { sent.push(text); return new Promise((resolve, reject) => { rejectSend = reject }) } },
    })
    await pause()
    assert.equal(node.querySelectorAll('[role=option]').length, 1)
    node.querySelector('[role=option]').click(); await pause()
    assert.equal(node.querySelector('textarea').value, 'Hello @Chief ')
    node.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    node.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause()
    assert.deepEqual(sent, ['Hello @Chief '])
    assert.equal(node.querySelector('button[type=submit]').disabled, true)
    rejectSend(new Error('Conversation handle is retired')); await pause()
    assert.equal(node.querySelector('textarea').value, 'Hello @Chief ')
    assert.match(node.querySelector('[role=alert]').textContent, /retired/)
    unmount(); unmount = null
    assert.equal(node.textContent, '')
  } finally { unmount?.(); dom.window.close() }
})

test('original question and approval cards answer only the bound personal conversation and expose stop/continue', async () => {
  const bundle = await readFile(join(import.meta.dirname, '../workbench-native.js'), 'utf8')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  const calls = [], pause = () => new Promise(resolve => setTimeout(resolve, 70))
  let question = { id: 'q-own', question: 'Which branch?', options: [{ label: 'main' }] }, approvals = [{ id: 'a-own', tool: 'read_file', reason: 'Read this file', answerable: true }], busy = true, unmount
  const source = createScopedConversation({ async call(endpoint, payload) {
    calls.push({ endpoint, payload })
    if (payload.operation === 'answer') question = null
    if (payload.operation === 'approval') approvals = []
    if (payload.operation === 'stop') busy = false
    return { messages: [], question, approvals, busy }
  } })
  try {
    dom.window.eval(bundle)
    await source.open({ personalId: 'chief' })
    const node = dom.window.document.getElementById('root')
    unmount = dom.window.FlyBotNativeConversation.mountNativeConversation(node, { source, bots: [{ id: 'chief', name: 'Original Chief' }] })
    await pause()
    assert.match(node.querySelector('.bt-q-inline').textContent, /Which branch/)
    assert.ok(node.querySelector('.bt-mw-card'), 'original approval component must render')
    assert.equal(node.querySelector('[data-choice^="always"]'), null, 'this scoped entry grants no standing authority')
    const button = label => [...node.querySelectorAll('button')].find(row => row.textContent.trim() === label)
    button('Allow once').click(); await pause()
    assert.deepEqual(calls.find(row => row.payload.operation === 'approval').payload, { operation: 'approval', id: 'chief', approvalId: 'a-own', choice: 'allow' })
    node.querySelector('.bt-q-opt').click(); await pause()
    assert.equal(calls.find(row => row.payload.operation === 'answer').payload.questionId, 'q-own')
    button('Stop reply').click(); await pause()
    assert.equal(calls.find(row => row.payload.operation === 'stop').payload.id, 'chief')
    button('Continue').click(); await pause()
    assert.equal(calls.find(row => row.payload.operation === 'send').payload.text, 'Continue.')
    source.dispose(); await pause()
    assert.equal(node.querySelector('.bt-q-inline'), null)
    assert.equal(node.querySelector('.bt-mw-card'), null)
  } finally { unmount?.(); source.dispose(); dom.window.close() }
})

test('SDK permission input reuses the original approval card without standing grants', async () => {
  const bundle = await readFile(join(import.meta.dirname, '../workbench-native.js'), 'utf8')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  let unmount
  const answers = []
  try {
    dom.window.eval(bundle)
    const node = dom.window.document.getElementById('root')
    unmount = dom.window.FlyBotNativeConversation.mountNativeRuntimeInput(node, {
      worker: { id: 'worker', role: 'developer', pending: { kind: 'permission', id: 'request', request: { name: 'bash', description: 'Run the selected tests' } } },
      answer: async args => { answers.push(args) },
    })
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.match(node.querySelector('.bt-mw-card').textContent, /Run the selected tests/)
    assert.equal(node.querySelector('[data-choice^="always"]'), null)
    ;[...node.querySelectorAll('button')].find(button => button.textContent === 'Reject').click()
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.deepEqual(JSON.parse(JSON.stringify(answers)), [{ requestId: 'request', allow: false }])
  } finally { unmount?.(); dom.window.close() }
})

test('original person bubbles render Markdown and scoped image cards survive attachment-only messages', async () => {
  const bundle = await readFile(process.env.NATIVE_ATTACHMENTS_BUNDLE ?? join(import.meta.dirname, '../workbench-native.js'), 'utf8')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  const source = createScopedConversation({ async call(_endpoint, payload) {
    if (payload.operation === 'attachment-read') return { kind: 'image', name: 'photo.png', mediaType: 'image/png', data: 'AA==' }
    return { messages: [{ id: 'human', kind: 'human', speaker: 'Alice', text: '**Hello** @Chief <script>bad()</script>' }, { id: 'photo', kind: 'human', speaker: 'Alice', text: '', attachments: [{ id: 'image', seq: 1, name: 'photo.png', kind: 'image', bytes: 1 }] }] }
  } })
  let unmount
  try {
    dom.window.eval(bundle)
    await source.open({ personalId: 'chief' })
    const node = dom.window.document.getElementById('root')
    unmount = dom.window.FlyBotNativeConversation.mountNativeConversation(node, { source, bots: [{ id: 'chief', name: 'Chief' }] })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(node.querySelector('.bt-person-msg strong')?.textContent, 'Hello')
    assert.equal(node.querySelector('script'), null)
    assert.ok(node.querySelector('.bt-scoped-attachments button'))
    node.querySelector('.bt-scoped-attachments button').click()
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(node.querySelector('.bt-scoped-attachments img')?.getAttribute('src'), 'data:image/png;base64,AA==')
    source.dispose(); await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(node.querySelector('.bt-scoped-attachments img'), null)
  } finally { unmount?.(); source.dispose(); dom.window.close() }
})

test('native composer selects image bytes and sends attachment-only input through its captured chat', async () => {
  const bundle = await readFile(join(import.meta.dirname, '../workbench-native.js'), 'utf8')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  const sends = []; let unmount
  try {
    dom.window.eval(bundle)
    const node = dom.window.document.getElementById('root')
    unmount = dom.window.FlyBotNativeConversation.mountNativeComposer(node, { allowImages: true, chat: { send: async (text, options) => { sends.push({ text, options }) } } })
    await new Promise(resolve => setTimeout(resolve, 80))
    const input = node.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { value: [new dom.window.File([new Uint8Array([0])], 'photo.png', { type: 'image/png' })] })
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.match(node.textContent, /photo.png/)
    node.querySelector('button[type=submit]').click()
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(sends[0].text, '')
    assert.equal(sends[0].options.images[0].data, 'AA==')
    assert.equal(sends[0].options.images[0].mediaType, 'image/png')
  } finally { unmount?.(); dom.window.close() }
})

test('registered document selection survives native updates and clears only after successful send', async () => {
  const bundle = await readFile(join(import.meta.dirname, '../workbench-native.js'), 'utf8')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  const pause = () => new Promise(resolve => setTimeout(resolve, 50))
  const sent = []
  let unmount, fail = true
  try {
    dom.window.eval(bundle)
    const node = dom.window.document.getElementById('root')
    const options = { initialText: '@chief read', attachments: [{ id: 'doc', name: 'Document' }, { id: 'other', name: 'Other document' }], chat: { async send(text, options) { sent.push({ text, options }); if (fail) throw new Error('Try again') } } }
    unmount = dom.window.FlyBotNativeConversation.mountNativeComposer(node, options)
    await pause()
    node.querySelector('input[type=checkbox]').click(); await pause()
    assert.equal(node.querySelector('input[type=checkbox]').checked, true, 'selection must survive the controlled React render')
    node.querySelectorAll('input[type=checkbox]')[1].click(); await pause()
    assert.equal(node.querySelectorAll('input[type=checkbox]')[1].checked, true, 'subsequent selections survive deferred state updates')
    for (let i = 0; i < 3; i++) {
      unmount.update({ ...options, attachments: [{ id: 'doc', name: 'Document' }, { id: 'other', name: 'Other document' }] }); await pause()
      assert.equal(node.querySelector('input[type=checkbox]').checked, true, 'refresh must retain selected document')
    }
    node.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause()
    assert.equal(node.querySelector('input[type=checkbox]').checked, true, 'failed send retains selection')
    fail = false
    node.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause()
    assert.equal(JSON.stringify(sent.map(row => row.options)), JSON.stringify([{ attachmentIds: ['doc', 'other'] }, { attachmentIds: ['doc', 'other'] }]))
    assert.equal(node.querySelector('input[type=checkbox]').checked, false)
    unmount(); unmount = null
    unmount = dom.window.FlyBotNativeConversation.mountNativeComposer(node, options); await pause()
    assert.equal(node.querySelector('input[type=checkbox]').checked, false, 'a new conversation does not inherit selection')
  } finally { unmount?.(); dom.window.close() }
})
