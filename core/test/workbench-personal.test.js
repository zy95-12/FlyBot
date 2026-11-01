import assert from 'node:assert/strict'
import { test } from 'node:test'
import { personalRoster, requirePersonalSession } from '../src/host/workbench-personal.js'

test('personal space retains original identities and excludes Project carriers and foreign histories', () => {
  const state = { mainBotIds: ['chief'], bots: { chief: { id: 'chief', ownerId: 'alice', instructions: 'Original persona', workDir: '/private/path' }, foreign: { id: 'foreign', ownerId: 'bob' }, public: { id: 'public', ownerId: 'alice', projectAgent: { visibility: 'public' } } }, rooms: { own: { id: 'own', members: ['chief'] }, foreign: { id: 'foreign', members: ['foreign'] }, mixed: { id: 'mixed', members: ['public'] } } }
  const rt = { state, botOwnedBy: (actor, id) => state.bots[id]?.ownerId === actor.memberId, roomMemberOf: (_, id) => ['own', 'mixed'].includes(id), roomOwnedBy: () => false, botOf: id => state.bots[id], roomOf: id => state.rooms[id] }
  const actor = { memberId: 'alice' }
  const roster = personalRoster(rt, actor)
  assert.deepEqual(roster.bots.map(row => row.id), ['chief'])
  assert.deepEqual(roster.rooms.map(row => row.id), ['own'])
  assert.deepEqual(roster.mainBotIds, ['chief'])
  assert.equal(roster.bots[0].instructions, 'Original persona')
  assert.equal(roster.bots[0].workDir, undefined)
  assert.equal(requirePersonalSession(rt, actor, 'chief'), 'chief')
  for (const id of ['foreign', 'public', 'mixed', '__proto__']) assert.throws(() => requirePersonalSession(rt, actor, id), /personal conversation/)
})

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

test('personal HTTP projection reuses original history and fences logout during paging', async t => {
  const home = mkdtempSync(join(tmpdir(), 'personal-channel-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({ version: 2, revision: 1, mainBotIds: ['chief'], members: { 'owner-1': { id: 'owner-1' }, bob: { id: 'bob' } }, bots: { chief: { id: 'chief', name: 'Original Chief', ownerId: 'owner-1', sessionId: 'chief', createdAt: 1 }, other: { id: 'other', name: 'Bob', ownerId: 'bob', sessionId: 'other', createdAt: 1 } }, rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, grants: {} }))
  const ctx = fakeContext()
  let route, release, revoked = false, delayed = false
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = options => { if (options.path.endsWith('bot')) route = options; return register(options) }
  ctx.sessionController = { page: async () => {
    if (delayed) await new Promise(resolve => { release = resolve })
    return { records: [{ event: { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: 'Original history' }] } } } }], hasMore: false }
  }
  }
  const rt = createRuntime(ctx, { home, projectWorkbench: true })
  await rt.load()
  rt.authenticate = async token => revoked ? null : token === 'alice' ? { memberId: 'owner-1' } : { memberId: 'bob' }
  rt.resolveAgent = async id => ({ session: { id, seq: 2 } })
  t.after(async () => { release?.(); await ctx.dispose(); rmSync(home, { recursive: true, force: true }) })
  const call = async (operation, id, token = 'alice') => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', headers: { 'x-flybot-member-session': token }, body: JSON.stringify({ endpoint: 'personal-space', payload: { operation, id } }) }))).json()
  assert.equal((await call('list')).value.bots[0].id, 'chief')
  assert.equal((await call('read', 'chief')).value.messages[0].text, 'Original history')
  assert.equal((await call('read', 'chief', 'bob')).ok, false)
  rt.memoryEndpoint = async () => ({ entries: [{ scope: 'own', text: 'My memory' }, { scope: 'team', text: 'Other members' }] })
  assert.deepEqual((await call('memory', 'chief')).value.entries, [{ scope: 'own', text: 'My memory' }])
  delayed = true
  const pending = call('read', 'chief')
  for (let i = 0; i < 50 && !release; i++) await new Promise(resolve => setTimeout(resolve, 2))
  assert.ok(release)
  revoked = true; release()
  assert.equal((await pending).ok, false)
})
