import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { install } from '../src/host/platform-identity.js'
import { install as installStore } from '../src/host/store.js'
import { install as installMemberAuth } from '../src/host/member-auth.js'
import { fakeContext } from './fake-ctx.js'

async function setup(t) {
  const home = mkdtempSync(join(tmpdir(), 'flybot-platform-'))
  const ctx = fakeContext()
  const users = { alice: { id: 'alice-platform', display_name: 'Alice', status: 'active', role: 'user' }, bob: { id: 'bob-platform', display_name: 'Bob', status: 'active', role: 'admin' } }
  const sessions = new Map()
  const calls = []
  const fetch = async (url, options) => {
    const path = new URL(url).pathname
    calls.push({ path, redirect: options.redirect })
    let user
    if (path === '/api/auth/login') {
      const body = JSON.parse(options.body)
      user = users[body.email]
      if (!user || body.password !== 'temporary-password') return new Response('{}', { status: 401 })
      const secret = `${body.email}-private-platform-cookie`
      sessions.set(secret, user)
      const headers = new Headers()
      headers.append('set-cookie', `flybot_session=${secret}; HttpOnly; Path=/`)
      headers.append('set-cookie', 'flybot_csrf=private-csrf; Path=/')
      return Response.json({ user, csrf_token: 'private-csrf' }, { headers })
    }
    const secret = options.headers.cookie.match(/flybot_session=([^;]+)/)?.[1]
    user = sessions.get(secret)
    if (!user || user.status !== 'active') return new Response('{}', { status: 401 })
    if (path === '/api/auth/logout') { sessions.delete(secret); return Response.json({ ok: true }) }
    return Response.json({ user, csrf_token: 'private-csrf' })
  }
  const rt = { ctx, home, statePath: join(home, 'state.json'), config: { controlPlane: { origin: 'http://127.0.0.1:1234', ownerSubject: 'alice-platform', fetch } } }
  installStore(rt)
  installMemberAuth(rt)
  install(rt)
  await rt.load()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  return { rt, users, sessions, calls, home }
}

test('platform subjects map durably; upstream admin role/body identity confer no Project authority', async t => {
  const { rt, home, calls } = await setup(t)
  const alice = await rt.platformLogin({ email: 'alice', password: 'temporary-password', memberId: 'forged' })
  const bob = await rt.platformLogin({ email: 'bob', password: 'temporary-password', memberId: 'owner-1', role: 'owner' })
  assert.equal(alice.memberId, 'owner-1')
  assert.notEqual(bob.memberId, 'owner-1')
  assert.equal((await rt.authenticate(alice.sessionToken)).memberId, 'owner-1')
  assert.equal((await rt.authenticate(bob.sessionToken)).memberId, bob.memberId)
  const again = await rt.platformLogin({ email: 'bob', password: 'temporary-password' })
  assert.equal(again.memberId, bob.memberId)
  const disk = readFileSync(join(home, 'state.json'), 'utf8')
  for (const secret of ['temporary-password', 'private-platform-cookie', 'private-csrf', alice.sessionToken, bob.sessionToken]) assert.equal(disk.includes(secret), false)
  assert.ok(calls.every(call => call.redirect === 'error'))
})

test('upstream suspension/logout immediately invalidates an existing FlyBot session', async t => {
  const { rt, users } = await setup(t)
  const session = await rt.platformLogin({ email: 'bob', password: 'temporary-password' })
  assert.ok(await rt.authenticate(session.sessionToken))
  users.bob.status = 'disabled'
  assert.equal(await rt.authenticate(session.sessionToken), null)
  users.bob.status = 'active'
  await rt.revokeSession(session.sessionToken)
  assert.equal(await rt.authenticate(session.sessionToken), null)
})

test('platform identity refuses a missing owner binding or untrusted origin', async t => {
  const { rt } = await setup(t)
  for (const origin of ['http://remote.invalid', 'https://user:pass@example.com', 'https://example.com/path']) {
    assert.throws(() => install({ ...rt, config: { controlPlane: { origin, ownerSubject: 'alice' } } }), /origin/)
  }
  assert.throws(() => install({ ...rt, config: { controlPlane: { origin: 'https://example.com' } } }), /ownerSubject/)
  await assert.rejects(rt.platformLogin({ email: 'alice', password: 'wrong' }), /unavailable/)
})

test('changed platform subjects and a restarted BFF cannot reuse a stale local session', async t => {
  const { rt, users, home } = await setup(t)
  const session = await rt.platformLogin({ email: 'bob', password: 'temporary-password' })
  users.bob.id = 'substituted-subject'
  assert.equal(await rt.authenticate(session.sessionToken), null)
  users.bob.id = 'bob-platform'
  await rt.ctx.dispose()
  const ctx = fakeContext()
  const restarted = { ctx, home, statePath: join(home, 'state.json'), config: rt.config }
  installStore(restarted)
  installMemberAuth(restarted)
  install(restarted)
  await restarted.load()
  t.after(() => ctx.dispose())
  assert.equal(await restarted.authenticate(session.sessionToken), null)
  const login = await restarted.platformLogin({ email: 'bob', password: 'temporary-password' })
  assert.equal(login.memberId, session.memberId)
  assert.ok(await restarted.authenticate(login.sessionToken))
})
