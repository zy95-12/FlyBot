import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mountWorkbench } from '../src/client/workbench/app.js'
import { createApi } from '../src/client/workbench/api.js'
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS, 'package.json'))('jsdom')
const tick = () => new Promise(resolve => setTimeout(resolve, 20))
function fixture(t, override = () => undefined) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/#/projects/a/board' })
  const calls = []
  const api = { setToken() {}, async call(endpoint, payload = {}) {
    calls.push({ endpoint, payload })
    const special = override(endpoint, payload)
    if (special !== undefined) return special
    const id = payload.projectId
    if (endpoint === 'auth-mode') return { mode: 'platform', panelUrl: 'http://127.0.0.1:18088' }
    if (endpoint === 'workbench-state') return { self: { memberId: 'bob', displayName: 'Bob' }, repositories: [], projects: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] }
    if (endpoint === 'project-detail') return { project: { id, name: id === 'a' ? 'Alpha' : 'Beta', role: 'member' }, permissions: { create: true }, tasks: [{ id: `task-${id}`, title: id === 'a' ? '<img src=x onerror=alert(1)>' : 'Beta task', requesterId: 'bob', status: 'open' }] }
    if (endpoint === 'project-resources') return { metrics: { acceptedTasks: 0, duration: { medianMs: null } }, activeSlots: 0, quota: { maxConcurrent: 1 }, repository: { configured: false }, queue: [] }
    if (endpoint === 'project-agents') return { public: { botId: `chief-${id}` }, definitions: { roles: [] }, privateMemory: [], proposals: [], knowledge: [] }
    if (endpoint === 'project-members') return { members: [{ memberId: 'alice', displayName: 'Alice', role: 'owner' }] }
    return {}
  } }
  const root = dom.window.document.getElementById('root')
  const app = mountWorkbench(root, api, { pollMs: 100000 })
  t.after(() => { app.dispose(); dom.window.close() })
  return { dom, root, calls, app }
}
test('Project board renders untrusted titles as text and Member cannot manage others', async t => {
  const { dom, root, calls } = fixture(t)
  await tick()
  assert.equal(root.querySelector('a').href, 'http://127.0.0.1:18088/')
  assert.equal(root.querySelector('[name=title]').getAttribute('aria-label'), 'Requirement')
  assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/)
  assert.equal(root.querySelector('img'), null)
  assert.match(root.textContent, /No samples/)
  const form = root.querySelector('form')
  form.querySelector('[name=title]').value = 'Add parser'
  form.querySelector('[name=criteria]').value = 'Reject bad input'
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  await tick()
  assert.deepEqual(calls.find(row => row.endpoint === 'task-create').payload, { projectId: 'a', title: 'Add parser', criteria: 'Reject bad input', note: '', priority: 'normal', target: '', botId: 'chief-a' })
  dom.window.location.hash = '/projects/a/members'; await tick()
  assert.ok(![...root.querySelectorAll('button')].some(node => ['Remove', 'Make Maintainer'].includes(node.textContent)))
})
test('Project switch fences late responses and clears revoked Project content', async t => {
  let release, revoked = false
  const delayed = new Promise(resolve => { release = resolve })
  const { dom, root, app } = fixture(t, (endpoint, payload) => {
    if (endpoint === 'project-detail' && payload.projectId === 'a') return delayed
    if (endpoint === 'project-detail' && payload.projectId === 'b' && revoked) return Promise.reject(new Error('Membership revoked'))
  })
  await tick(); dom.window.location.hash = '/projects/b/board'; await tick()
  assert.match(root.textContent, /Beta task/)
  release({ project: { name: 'Private old Alpha' }, permissions: {}, tasks: [] }); await tick()
  assert.doesNotMatch(root.textContent, /Private old Alpha/)
  revoked = true; await app.refresh()
  assert.doesNotMatch(root.textContent, /Beta task/)
  assert.match(root.textContent, /Membership revoked/)
})
test('Deep-linked Task cannot render another Project task even for a common member', async t => {
  const { dom, root } = fixture(t, endpoint => endpoint === 'project-task-detail' ? { task: { projectId: 'b', title: 'Other Project secret' }, attempts: [] } : undefined)
  await tick(); dom.window.location.hash = '/projects/a/tasks/task-b'; await tick()
  assert.match(root.textContent, /Task belongs to another Project/)
  assert.doesNotMatch(root.textContent, /Other Project secret/)
})
test('API uses member session header only and clears it on logout', async () => {
  const storage = new Map([['flybot.member', 'member-credential']]), requests = []
  const api = createApi({ storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, request: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => ({ ok: true, value: {} }) } } })
  await api.call('workbench-state'); api.setToken(''); await api.call('auth-mode')
  assert.equal(requests[0].init.headers['x-flybot-member-session'], 'member-credential')
  assert.equal(requests[1].init.headers['x-flybot-member-session'], undefined)
  assert.equal(requests[0].init.headers.cookie, undefined)
})

test('Task detail exposes failure evidence and answers only the current requester question', async t => {
  const { dom, root, calls } = fixture(t, endpoint => endpoint === 'project-task-detail' ? {
    task: { id: 'task-a', projectId: 'a', title: 'Blocked parser', criteria: 'Handle invalid tokens', requesterId: 'bob', priority: 'high', status: 'blocked', waitingFor: 'input', inputRequest: { id: 'question-2', question: 'Choose error format' }, createdAt: Date.now() - 120000, target: { href: 'https://github.com/example/repo/issues/2' } },
    attempts: [{ id: 'old', status: 'failed', createdAt: Date.now() - 1000, failure: { at: Date.now(), message: 'Configured tests failed' }, evidence: { implementation: { diffStat: 'parser.js | 3 ++-' } } }],
  } : undefined)
  await tick(); dom.window.location.hash = '/projects/a/tasks/task-a'; await tick()
  assert.match(root.textContent, /Priority: high/)
  assert.match(root.textContent, /Choose error format/)
  assert.match(root.textContent, /Configured tests failed/)
  assert.equal(root.querySelector('a[href="https://github.com/example/repo/issues/2"]').textContent, 'Source Issue / PR')
  assert.equal([...root.querySelectorAll('button')].find(node => node.textContent === 'Run / retry').disabled, true, 'unprovisioned repository cannot execute')
  const form = root.querySelector('#answer-answer').form
  form.querySelector('[name=answer]').value = 'Use structured errors'
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await tick()
  assert.deepEqual(calls.find(row => row.endpoint === 'task-answer-input').payload, { projectId: 'a', id: 'task-a', questionId: 'question-2', answer: 'Use structured errors' })
})

test('Owner role form preserves persona, supports checked resource pools and probes the saved Harness', async t => {
  const { dom, root, calls } = fixture(t, endpoint => {
    if (endpoint === 'project-detail') return { project: { id: 'a', name: 'Alpha', role: 'owner' }, permissions: { configure: true, create: true }, tasks: [] }
    if (endpoint === 'project-resources') return { metrics: { acceptedTasks: 0, duration: { medianMs: null } }, activeSlots: 0, quota: { maxConcurrent: 2 }, repository: { configured: true }, queue: [], executionResources: [{ id: 'local' }, { id: 'isolated' }] }
    if (endpoint === 'project-agents') return { public: { botId: 'chief' }, definitions: { revision: 3, roles: [{ role: 'developer', instructions: 'Preserve this persona', skills: ['code-change'], memoryRefs: ['published-memory'], execution: { harness: 'flybot', resourceIds: ['local'] } }] }, privateMemory: [], proposals: [], knowledge: [] }
    return undefined
  })
  await tick(); dom.window.location.hash = '/projects/a/bots'; await tick(); await tick()
  assert.equal(root.querySelector('#role-developer-instructions'), null, 'role editor stays out of the public conversation')
  assert.match(root.querySelector('.role-strip').textContent, /developer/)
  dom.window.location.hash = '/projects/a/settings'; await tick(); await tick()
  const form = root.querySelector('#role-developer-instructions').form
  assert.equal(form.elements.instructions.value, 'Preserve this persona')
  assert.equal(form.querySelector('input[value="local"]').checked, true)
  form.querySelector('input[value="isolated"]').checked = true
  form.elements.harness.value = 'codex'; form.elements.sdkModel.value = 'explicit-model'
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  await tick(); await tick()
  const saved = calls.find(row => row.endpoint === 'project-agent-definition').payload
  assert.equal(saved.instructions, 'Preserve this persona')
  assert.deepEqual(saved.execution.resourceIds, ['local', 'isolated'])
  assert.equal(saved.execution.harness, 'codex')
  assert.equal(saved.execution.model, 'explicit-model')
  assert.deepEqual(saved.memoryRefs, ['published-memory'])
  assert.deepEqual(calls.filter(row => row.endpoint === 'project-runtime-check').map(row => row.payload.resourceId), ['local', 'isolated'])
})

test('rooms click through scoped routing, safe Markdown and registered artifacts without owner APIs', async t => {
  const { dom, root, calls, app } = fixture(t, (endpoint, payload) => {
    if (endpoint === 'project-rooms') return { rooms: [{ id: 'room-a', name: 'Engineering' }] }
    if (endpoint === 'project-room-read') return { id: 'room-a', name: 'Engineering', memberIds: [], messages: [{ speaker: 'developer', text: '# Plan\n**Review** `parser`\n[unsafe](javascript:alert)\n<img src=x onerror=alert(1)>' }], attachments: [{ id: 'doc-a', name: 'Scope.md' }], sessions: [{ role: 'tester', phase: 'running', harness: 'flybot', live: { text: 'Streaming **answer**' } }] }
    if (endpoint === 'project-room-attachment') return { name: 'Scope.md', text: 'Only this room' }
    if (endpoint === 'project-room-message') { assert.equal(payload.roomId, 'room-a'); return { deliveries: [] } }
  })
  await tick()
  ;[...root.querySelectorAll('button')].find(node => node.textContent === 'Rooms & mentions').click(); await tick()
  ;[...root.querySelectorAll('button')].find(node => node.textContent === 'Engineering').click(); await tick()
  assert.equal(root.querySelector('.conversation strong').textContent, 'Review')
  assert.equal(root.querySelector('img'), null)
  assert.equal(root.querySelector('a[href^="javascript:"]'), null)
  assert.match(root.textContent, /Streaming answer/)
  const input = root.querySelector('[name=text]'); input.value = '@tester check parser'; input.dispatchEvent(new dom.window.Event('input'))
  input.form.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await tick()
  assert.equal(calls.find(row => row.endpoint === 'project-room-message').payload.text, '@tester check parser')
  await app.refresh()
  ;[...root.querySelectorAll('button')].find(node => node.textContent === 'Scope.md').click(); await tick()
  assert.match(root.textContent, /Only this room/)
  assert.ok(calls.every(row => !['state', 'earlier', 'room-history', 'send'].includes(row.endpoint)))
})

test('conversation workspace separates settings and preserves Project navigation', async t => {
  const { dom, root } = fixture(t)
  await tick(); dom.window.location.hash = '/projects/a/bots'; await tick()
  assert.ok(root.querySelector('.project-nav button[aria-current="page"]'))
  assert.ok(root.querySelector('.chat-panel .conversation[role="log"]'))
  assert.ok(root.querySelector('.chat-panel .composer textarea'))
  assert.equal(root.querySelector('#chief-policy-enabled'), null)
  const settings = [...root.querySelectorAll('.project-nav button')].find(row => row.textContent === 'Settings')
  assert.ok(settings); settings.click(); await tick()
  assert.match(dom.window.location.hash, /\/settings$/)
  assert.equal(root.querySelector('.composer'), null)
})


test('board keeps failures actionable and polling preserves Project-scoped Task folds', async t => {
  const { dom, root, app } = fixture(t, endpoint => endpoint === 'project-detail' ? {
    project: { id: 'a', name: 'Alpha', role: 'member' }, permissions: {},
    tasks: [{ id: 'failed', title: 'Repair parser', status: 'failed' }, { id: 'done', title: 'Accepted parser', status: 'accepted' }],
  } : undefined)
  await tick()
  const groups = () => [...root.querySelectorAll('.task-group')]
  const attention = groups().find(group => group.querySelector('summary').textContent.startsWith('Needs attention'))
  assert.match(attention.textContent, /Repair parser/)
  assert.doesNotMatch(groups().find(group => group.querySelector('summary').textContent.startsWith('Completed')).textContent, /Repair parser/)
  attention.open = false; attention.dispatchEvent(new dom.window.Event('toggle'))
  await app.refresh()
  assert.equal(groups().find(group => group.querySelector('summary').textContent.startsWith('Needs attention')).open, false)
})
