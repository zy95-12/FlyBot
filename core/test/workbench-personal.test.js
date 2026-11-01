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
  let stopped = 0
  rt.resolveAgent = async id => ({ session: { id, seq: 2 }, cancel() { stopped++ } })
  rt.state.questions.chief = { id: 'question-own', question: 'Which branch?', options: [{ label: 'main' }], allowCustom: true }
  rt.state.questions.other = { id: 'question-other', question: 'Private Bob question' }
  rt.approvalsView = () => [{ id: 'approve-own', sessionId: 'chief', botId: 'chief', tool: 'read_file', reason: 'Read scope', answerable: true }, { id: 'approve-other', sessionId: 'other', botId: 'other', tool: 'private' }]
  const decisions = []
  rt.answerApproval = async (id, choice) => { decisions.push({ id, choice }) }
  t.after(async () => { release?.(); await ctx.dispose(); rmSync(home, { recursive: true, force: true }) })
  const call = async (operation, id, token = 'alice', extra = {}) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', headers: { 'x-flybot-member-session': token }, body: JSON.stringify({ endpoint: 'personal-space', payload: { operation, id, ...extra } }) }))).json()
  assert.equal((await call('list')).value.bots[0].id, 'chief')
  assert.equal((await call('read', 'chief')).value.messages[0].text, 'Original history')
  assert.equal((await call('read', 'chief', 'bob')).ok, false)
  const controls = (await call('read', 'chief')).value
  assert.equal(controls.question.id, 'question-own')
  assert.equal((await call('dismiss', 'chief', 'alice', { questionId: 'stale-question' })).ok, false)
  assert.equal(rt.state.questions.chief.id, 'question-own')
  assert.deepEqual(controls.approvals.map(row => row.id), ['approve-own'])
  assert.equal((await call('stop', 'chief', 'bob')).ok, false)
  assert.equal(stopped, 0)
  assert.equal((await call('stop', 'chief')).ok, true)
  assert.equal(stopped, 1)
  assert.equal((await call('approval', 'chief', 'alice', { approvalId: 'approve-other', choice: 'allow' })).ok, false)
  assert.equal(decisions.length, 0)
  assert.equal((await call('approval', 'chief', 'alice', { approvalId: 'approve-own', choice: 'allow' })).ok, true)
  assert.deepEqual(decisions, [{ id: 'approve-own', choice: 'allow' }])
  rt.state.rooms.group = { id: 'group', name: 'Original group', members: ['chief', 'other'], participants: [{ kind: 'human', id: 'owner-1', joinedSeq: 0 }] }
  await rt.save()
  rt.roomWorkView = () => ({ group: [{ botId: 'chief', tool: 'read_file' }, { botId: 'other', tool: 'bash' }] })
  const memberStops = []
  rt.stopMemberWork = async (room, bot) => { memberStops.push({ room, bot }); return true }
  const groupRead = await call('read', 'group')
  assert.equal(groupRead.ok, true, JSON.stringify(groupRead))
  const groupWork = groupRead.value.groupWork
  assert.deepEqual(groupWork.map(row => row.canStop), [true, false])
  assert.equal((await call('member-stop', 'group', 'alice', { botId: 'other' })).ok, false)
  assert.equal(memberStops.length, 0)
  assert.equal((await call('member-stop', 'group', 'alice', { botId: 'chief' })).ok, true)
  assert.deepEqual(memberStops, [{ room: 'group', bot: 'chief' }])

  rt.memoryEndpoint = async () => ({ entries: [{ scope: 'own', text: 'My memory' }, { scope: 'team', text: 'Other members' }] })
  assert.deepEqual((await call('memory', 'chief')).value.entries, [{ scope: 'own', text: 'My memory' }])
  delayed = true
  const pending = call('read', 'chief')
  for (let i = 0; i < 50 && !release; i++) await new Promise(resolve => setTimeout(resolve, 2))
  assert.ok(release)
  revoked = true; release()
  assert.equal((await pending).ok, false)
})

import { personalToolRows } from '../src/host/workbench-personal.js'
test('personal tool projection excludes hidden turns, arguments and non-text content and bounds redacted output', () => {
  const event = (type, data) => ({ event: { type, data } })
  const rows = personalToolRows([
    event('tool/call', { turn: 1, callId: 'hidden', name: 'bash' }),
    event('tool/result', { message: { toolCallId: 'hidden', content: [{ type: 'text', text: 'Private exchange' }] } }),
    event('tool/call', { turn: 2, callId: 'own', name: 'read_file', arguments: { secret: 'No arguments' } }),
    event('tool/result', { message: { toolCallId: 'own', content: [{ type: 'text', text: 'sk-abcdefghijklmnop ' + 'x'.repeat(5000) }, { type: 'image', url: 'file:///private/image' }] } }),
  ], new Set([1]), text => text)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'own')
  assert.equal(rows[0].status, 'completed')
  assert.equal(rows[0].text.includes('sk-abcdefghijklmnop'), false)
  assert.ok(rows[0].text.length <= 2000)
  assert.equal(JSON.stringify(rows).includes('No arguments'), false)
  assert.equal(JSON.stringify(rows).includes('file:///'), false)
})

import { createPersonalStreams } from '../src/host/workbench-personal.js'
test('native personal streams use only current own Session, hide exchange turns and clean up on exit', async () => {
  const bot = { id: 'own', name: 'Original Chief' }
  const rt = { state: { exchangeTurns: {} }, botOf: id => id === 'own' ? bot : undefined, selfOf: id => id === 'session' ? 'own' : undefined, chatOf: () => 'session', live: new Map([['session', { turn: 4 }]]), redactSecrets: text => text.replaceAll('saved-secret', '[hidden]') }
  const streams = createPersonalStreams(rt)
  async function* chunks() { yield { type: 'text-delta', text: '**Hello** saved-secret' }; yield { type: 'text-delta', text: ' world' } }
  const running = streams.stream('session', chunks)
  await running.next()
  assert.equal(streams.read('session').text, '**Hello** [hidden]')
  assert.equal(streams.read('other'), null)
  rt.state.exchangeTurns.session = [4]
  assert.equal(streams.read('session'), null)
  rt.state.exchangeTurns.session = []
  rt.live.set('session', { turn: 5 })
  assert.equal(streams.read('session'), null)
  await running.return()
  assert.equal(streams.read('session'), null)
})

import { personalQuestion } from '../src/host/workbench-personal.js'
test('personal group questions expose only answerable public card fields, never native routing authority', () => {
  const rt = { state: { questions: { group: { id: 'q', botId: 'own', question: 'Choose', options: [{ label: 'A' }], replyTo: { botId: 'private-source' }, origin: 'owner', secret: 'private' } } }, botOf: () => undefined, botOwnedBy: (actor, id) => actor.memberId === 'alice' && id === 'own', roomOwnedBy: () => false }
  const card = personalQuestion(rt, 'group', { memberId: 'alice' })
  assert.equal(card.id, 'q')
  for (const field of ['botId', 'replyTo', 'origin', 'secret']) assert.equal(card[field], undefined)
  assert.equal(personalQuestion(rt, 'group', { memberId: 'bob' }), null)
})
