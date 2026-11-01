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
