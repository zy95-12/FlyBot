import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createProjectEffects } from '../src/host/project-effects.js'
import { createProjectCredentials } from '../src/host/project-credentials.js'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'flybot-outbox-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const comments = [], stats = { posts: 0, reads: 0 }, actor = { memberId: 'alice', sessionId: 'transient-browser-session' }
  let lostReply = false, oversizedHistory = false, revoked = false, disk, clock = 100, failReceipt = false
  const config = { personalGithub: { alice: { p: { credential: 'gh-cli', configDir: '/explicit/alice', login: 'alice-gh' } } } }
  const rt = { home, state: { members: { alice: { id: 'alice' } } }, config, readOnly: () => undefined,
    requireProjectAccess(given, projectId) { if (given?.memberId !== 'alice' || projectId !== 'p' || revoked) throw Error('Access denied'); return { id: 'p', repository: 'example/repo' } },
    projectDelegations: { background: async () => true, validateGrant() { if (revoked) throw Error('Revoked') }, validateActor: async () => { if (revoked) throw Error('Revoked') } } }
  function start(state = rt.state) {
    rt.state = state
    const effects = createProjectEffects(rt, { now: () => clock })
    rt.projectEffects = effects
    rt.save = async () => {
      const proof = effects.capture()
      if (failReceipt && Object.values(rt.state.projectEffects ?? {}).some(row => row.status === 'done')) throw Error('Receipt store unavailable')
      writeFileSync(join(home, 'state.tmp'), JSON.stringify(rt.state), { mode: 0o600 })
      renameSync(join(home, 'state.tmp'), join(home, 'state.json'))
      disk = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')); effects.saved(proof)
    }
    const credentials = createProjectCredentials(rt, { identity: async settings => ({ login: settings.login, token: 'selected-private-token' }), request: async (url, options) => {
      if (options.method === 'GET') { stats.reads++; return Response.json(comments, { headers: oversizedHistory ? { link: '<https://api.github.com/next>; rel="next"' } : {} }) }
      stats.posts++
      assert.equal(Object.values(disk.projectEffects).at(-1).status, 'running', 'durable outbox precedes external write')
      const comment = { id: 100 + stats.posts, user: { login: 'alice-gh' }, body: JSON.parse(options.body).body, html_url: 'https://github.com/example/repo/issues/1#issuecomment-100' }
      comments.push(comment)
      if (lostReply) { lostReply = false; throw Error('Response lost after remote accepted') }
      return Response.json(comment)
    } })
    return { effects, credentials }
  }
  return { rt, actor, stats, comments, home, start, disk: () => disk,
    loseReply: () => { lostReply = true }, historyIncomplete: () => { oversizedHistory = true }, revoke: () => { revoked = true },
    advance: n => { clock += n }, failReceipt: value => { failReceipt = value },
    body: { projectId: 'p', issueNumber: 1, text: 'Explicit public feedback', requestId: 'stable-comment' } }
}

test('comment response loss/restart reconciles the original remote receipt without a second POST', async t => {
  const f = fixture(t), first = f.start()
  f.loseReply()
  await assert.rejects(first.credentials.endpoint('project-github-comment', f.body, f.actor), /Response lost/)
  assert.equal(f.stats.posts, 1)
  const pending = Object.values(f.disk().projectEffects)[0]
  assert.equal(pending.status, 'pending')
  assert.equal(JSON.stringify(f.disk()).includes(f.body.text), false)
  assert.equal(JSON.stringify(f.disk()).includes('selected-private-token'), false)
  assert.equal(JSON.stringify(f.disk()).includes(f.actor.sessionId), false)
  assert.equal(statSync(pending.payload.bodyRef).mode & 0o777, 0o600)
  const second = f.start(structuredClone(f.disk()))
  second.effects.recover()
  const result = await second.credentials.endpoint('project-github-comment', f.body, { ...f.actor, sessionId: 'fresh-browser-session' })
  assert.equal(f.stats.posts, 1)
  assert.equal(result.audit.identityVerified, true)
  assert.equal(result.audit.selectedLogin, 'alice-gh')
  assert.equal(Object.values(f.disk().projectEffects)[0].status, 'done')
  assert.equal(Object.keys(f.disk().projectGithubWrites).length, 1)
  await assert.rejects(second.credentials.endpoint('project-github-comment', { ...f.body, text: 'Changed intent' }, f.actor), /different content/)
  assert.equal(f.stats.posts, 1)
})

test('incomplete reconciliation never posts and private payloads are absent from public effect queries', async t => {
  const f = fixture(t), s = f.start(); f.historyIncomplete()
  await assert.rejects(s.credentials.endpoint('project-github-comment', f.body, f.actor), /not fully reconciled/)
  assert.equal(f.stats.reads, 10)
  assert.equal(f.stats.posts, 0)
  const rows = s.effects.list('p', f.actor)
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].failures, 0)
  assert.equal(JSON.stringify(rows).includes('bodyRef'), false)
  assert.equal(JSON.stringify(rows).includes(f.body.text), false)
})

test('revoked watch authority and tampered immutable body cannot replay a queued personal write', async t => {
  for (const mode of ['revoked', 'tampered']) {
    const f = fixture(t), s = f.start(); f.loseReply()
    const actor = { ...f.actor, watchGrantId: 'grant', watchGeneration: 1 }
    await assert.rejects(s.credentials.endpoint('project-github-comment', f.body, actor))
    const row = Object.values(f.rt.state.projectEffects)[0]
    if (mode === 'revoked') f.revoke()
    else writeFileSync(row.payload.bodyRef, 'Changed private disk content')
    f.advance(3000); await s.effects.drain()
    assert.equal(row.status, 'cancelled')
    assert.equal(f.stats.posts, 1, 'never repeat an unverified or revoked write')
  }
})

test('remote success with a failed local receipt resumes after restart without another comment', async t => {
  const f = fixture(t), first = f.start(); f.failReceipt(true)
  await assert.rejects(first.credentials.endpoint('project-github-comment', f.body, f.actor), /Receipt store/)
  assert.equal(f.stats.posts, 1)
  assert.equal(Object.values(f.disk().projectEffects)[0].status, 'running')
  f.failReceipt(false)
  const second = f.start(structuredClone(f.disk()))
  assert.equal(second.effects.recover(), true)
  await f.rt.save(); await second.effects.drain()
  assert.equal(Object.values(f.disk().projectEffects)[0].status, 'done')
  assert.equal(f.stats.posts, 1)
})
