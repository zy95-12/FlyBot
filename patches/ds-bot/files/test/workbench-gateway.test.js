import assert from 'node:assert/strict'
import { createServer } from 'node:http'
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
