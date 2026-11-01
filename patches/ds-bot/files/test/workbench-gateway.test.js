import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { createWorkbenchGateway } from '../src/host/workbench-gateway.js'

async function fixture(t) {
  const seen = []
  const upstream = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    seen.push({ cookie: req.headers.cookie, actor: req.headers['x-flybot-member-session'], body: JSON.parse(raw) })
    res.setHeader('set-cookie', 'dsh=must-not-reach-members; HttpOnly')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, value: { actor: req.headers['x-flybot-member-session'] ?? null } }))
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const gateway = createWorkbenchGateway({ upstreamOrigin: `http://127.0.0.1:${upstream.address().port}`, upstreamCookie: 'dsh=private-owner-credential', readAsset: async () => 'built asset' })
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening')
  t.after(async () => { upstream.closeAllConnections(); gateway.closeAllConnections(); await Promise.all([new Promise(done => upstream.close(done)), new Promise(done => gateway.close(done))]) })
  const base = `http://127.0.0.1:${gateway.address().port}`
  return { seen, base, post: (endpoint, headers = {}) => fetch(`${base}/api/bot`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ endpoint, payload: { memberId: 'body-is-not-authority' } }) }) }
}

test('shared entry never exposes the DSH cookie and forwards only the member credential', async t => {
  const { seen, base, post } = await fixture(t)
  const response = await post('workbench-state', { 'x-flybot-member-session': 'member-only-token', cookie: 'attacker=ignored' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal((await response.json()).value.actor, 'member-only-token')
  assert.equal(seen[0].cookie, 'dsh=private-owner-credential')
  assert.equal(seen[0].body.payload.memberId, 'body-is-not-authority')
  const html = await fetch(base).then(row => row.text())
  assert.equal(html.includes('private-owner-credential'), false)
  assert.ok(html.includes('workbench.js'))
})

test('raw DSH routes, legacy plugin APIs, wrong origins and DNS-rebinding hosts are refused before proxying', async t => {
  const { base, post, seen } = await fixture(t)
  assert.equal((await fetch(`${base}/api/sessions`)).status, 404)
  assert.equal((await post('diagnostics-log')).status, 403)
  assert.equal((await post('flybot/workflow/state')).status, 403)
  assert.equal((await post('project-detail', { origin: 'https://untrusted.example' })).status, 403)
  assert.equal((await post('project-detail', { host: 'untrusted.example', origin: 'http://untrusted.example' })).status, 403)
  assert.equal(seen.length, 0)
})

test('gateway cannot be configured as an arbitrary upstream proxy', () => {
  assert.throws(() => createWorkbenchGateway({ upstreamOrigin: 'https://remote.example', upstreamCookie: 'owner=secret' }), /loopback/)
  assert.throws(() => createWorkbenchGateway({ upstreamOrigin: 'http://127.0.0.1:1234/path', upstreamCookie: 'owner=secret' }), /loopback/)
  assert.throws(() => createWorkbenchGateway({ upstreamOrigin: 'http://127.0.0.1:1234', upstreamCookie: 'owner=secret\ninvalid' }), /valid private/)
})


test('shared gateway cannot bootstrap an unauthenticated owner invitation', async t => {
  const { post, seen } = await fixture(t)
  assert.equal((await post('auth-invite')).status, 403)
  assert.equal(seen.length, 0)
})


test('terminal gateway rejects cross-origin HTTP and every WebSocket upgrade without proxying owner credentials', async t => {
  const { base, post, seen } = await fixture(t)
  assert.equal((await post('project-terminal-open', { origin: 'https://attacker.invalid' })).status, 403)
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(base + '/terminal?token=must-not-be-used', { headers: { connection: 'Upgrade', upgrade: 'websocket', origin: 'https://attacker.invalid' } }, response => { response.resume(); resolve(response.statusCode) })
    request.on('error', reject); request.end()
  })
  assert.equal(status, 403)
  assert.equal(seen.length, 0)
})

test('repair collaboration endpoints cross the actual shared HTTP entry while raw APIs remain refused', async t => {
  const { post, seen } = await fixture(t)
  const endpoints = ['project-development', 'project-queue-retry', 'project-task-pools', 'project-chief-question', 'project-github-read', 'project-agent-mode', 'project-chief-state', 'project-chief-configure', 'project-chief-inspect', 'project-scheduled-task', 'project-attempt-publication-retry']
  for (const endpoint of endpoints) {
    const response = await post(endpoint, { 'x-flybot-member-session': 'current-human-session' })
    assert.equal(response.status, 200, endpoint + ' must reach the Project authorization boundary')
    assert.equal(response.headers.get('set-cookie'), null)
  }
  assert.equal(seen.length, endpoints.length)
  assert.ok(seen.every(row => row.actor === 'current-human-session'))
  assert.equal((await post('schedule-create')).status, 403)
  assert.equal((await post('state')).status, 403)
})
