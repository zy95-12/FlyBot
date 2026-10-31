import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const alice = { memberId: 'owner-1' }
const bob = { memberId: 'bob' }
async function setup(t) {
  const home = mkdtempSync(join(tmpdir(), 'flybot-project-agents-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({ version: 2, members: { 'owner-1': { id: 'owner-1' }, bob: { id: 'bob' } },
    bots: { legacy: { id: 'legacy', name: 'Old private Chief', ownerId: 'owner-1', sessionId: 'legacy', projectId: 'p1', instructions: 'Old private owner context' } }, mainBotIds: ['legacy'], rooms: {}, tasks: {},
    projects: { p1: { id: 'p1', name: 'One', status: 'active', ownerUserId: 'owner-1', createdAt: 1, updatedAt: 1, chief: { botId: 'legacy', sessionId: 'legacy' }, roles: { maintainers: [], members: ['bob'] } },
      p2: { id: 'p2', name: 'Two', status: 'active', ownerUserId: 'owner-1', createdAt: 1, updatedAt: 1, roles: { maintainers: [], members: ['bob'] } } } }))
  const ctx = fakeContext()
  Object.assign(ctx, { llm: { listProviders: () => [], listModels: async () => [] }, workspaceRegistry: { get: () => undefined, archiveSession: async () => {} },
    sessionController: { resolveAgent: async () => ({ agent: undefined }) }, sessions: { flush: async () => {} } })
  const rt = createRuntime(ctx, { home, projectWorkbench: true })
  await rt.load()
  let count = 0
  rt.createBot = async spec => {
    const id = `agent-${++count}`
    const bot = { ...spec, id, sessionId: id, createdAt: Date.now() }
    rt.state.bots[id] = bot
    rt.indexSessions?.()
    return bot
  }
  rt.deliver = async ({ sessionId, exchangeId }) => { rt.projectAgents.onEvent({ id: sessionId }, { type: 'user/message', data: { source: { exchangeId } } }); rt.projectAgents.onEvent({ id: sessionId }, { type: 'turn/start', data: { turn: 1 } }); return 'sent' }
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  return { rt, ctx }
}

const get = (rt, actor, projectId = 'p1') => rt.projectEndpoint('project-agents', { projectId }, actor)
const message = (rt, actor, visibility = 'private', text = 'Read my Project context') => rt.projectEndpoint('project-agent-message', { projectId: 'p1', visibility, text }, actor)

test('private agents have stable per-user/project identities and only shared public facts overlap', async t => {
  const { rt } = await setup(t)
  const a = await get(rt, alice)
  const b = await get(rt, bob)
  const other = await get(rt, alice, 'p2')
  assert.notEqual(a.mine.botId, b.mine.botId)
  assert.notEqual(a.mine.botId, other.mine.botId)
  assert.equal((await get(rt, alice)).mine.botId, a.mine.botId)
  assert.equal(a.public.botId, b.public.botId)
  assert.notEqual(a.public.botId, 'legacy')
  assert.equal(rt.state.bots.legacy.instructions, 'Old private owner context')
  await rt.projectEndpoint('project-agent-memory-write', { projectId: 'p1', memberId: 'bob', text: 'Alice private note' }, alice)
  await rt.projectEndpoint('project-knowledge-write', { projectId: 'p1', kind: 'decision', text: 'Shared architecture decision' }, alice)
  await message(rt, alice)
  await message(rt, bob)
  const aContext = await rt.projectAgents.context(rt.botOf(a.mine.botId))
  const bContext = await rt.projectAgents.context(rt.botOf(b.mine.botId))
  assert.equal(aContext.privateMemory[0].text, 'Alice private note')
  assert.deepEqual(bContext.privateMemory, [])
  assert.deepEqual(aContext.knowledge, bContext.knowledge)
  assert.equal(JSON.stringify(await get(rt, bob)).includes('Alice private note'), false)
})

test('private proposals need explicit human publication; public Chief acts only for its current requester', async t => {
  const { rt } = await setup(t)
  const a = await get(rt, alice)
  const b = await get(rt, bob)
  await message(rt, alice)
  const proposal = await rt.projectAgents.task(rt.botOf(a.mine.botId), { title: 'A private proposal', criteria: 'Check behavior', memberId: 'bob' })
  assert.equal(Object.keys(rt.state.tasks).length, 0)
  await assert.rejects(rt.projectEndpoint('project-agent-proposal-apply', { proposalId: proposal.proposalId }, bob), /not yours/)
  const published = await rt.projectEndpoint('project-agent-proposal-apply', { proposalId: proposal.proposalId }, alice)
  assert.equal(published.task.requesterId, alice.memberId)
  assert.equal((await rt.projectEndpoint('project-agent-proposal-apply', { proposalId: proposal.proposalId }, alice)).already, true)
  await message(rt, bob, 'public', 'Create a public task')
  const task = await rt.projectAgents.task(rt.botOf(b.public.botId), { title: 'Bob public request', requesterId: 'owner-1' })
  assert.equal(task.requesterId, bob.memberId)
  await assert.rejects(message(rt, alice, 'public', 'Overwrite current actor'), /current turn/)
  assert.equal(rt.authorize(alice, 'send', { sessionId: b.public.botId, text: 'Private bypass' }).ok, false)
})

test('membership removal revokes private/public tools and direct legacy Session access immediately', async t => {
  const { rt, ctx } = await setup(t)
  const b = await get(rt, bob)
  await message(rt, bob)
  await message(rt, bob, 'public')
  assert.equal(rt.authorize(bob, 'earlier', { sessionId: b.mine.botId }).ok, true)
  await rt.projectEndpoint('project-member-remove', { id: 'p1', memberId: 'bob' }, alice)
  await assert.rejects(rt.projectAgents.context(rt.botOf(b.mine.botId)), /authority|delegation|denied/)
  await assert.rejects(rt.projectAgents.context(rt.botOf(b.public.botId)), /authority|delegation|denied/)
  assert.equal(rt.authorize(bob, 'earlier', { sessionId: b.mine.botId }).ok, false)
  assert.equal(rt.authorize(bob, 'send', { sessionId: b.mine.botId }).ok, false)
  const refusals = await Promise.all(ctx.guards.map(fn => fn({ name: 'project_agent_context', agent: { id: b.mine.botId } })))
  assert.ok(refusals.some(value => typeof value === 'string' && /revoked/.test(value)))
})

test('Project agents cannot use generic tools or another Project through caller arguments', async t => {
  const { rt, ctx } = await setup(t)
  const a = await get(rt, alice)
  await message(rt, alice)
  const generic = await Promise.all(ctx.guards.map(fn => fn({ name: 'bash', agent: { id: a.mine.botId } })))
  assert.ok(generic.some(value => typeof value === 'string' && /scoped/.test(value)))
  const context = await rt.projectAgents.context(rt.botOf(a.mine.botId))
  assert.equal(context.project.id, 'p1')
  const outsiderTask = await rt.taskEndpoint('task-create', { botId: 'legacy', title: 'P1 Task', projectId: 'p1' }, alice)
  const other = await get(rt, alice, 'p2')
  await rt.projectEndpoint('project-agent-message', { projectId: 'p2', text: 'Run p1 Task' }, alice)
  await assert.rejects(rt.projectAgents.run(rt.botOf(other.mine.botId), { taskId: outsiderTask.id, requestId: 'cross' }), /another Project/)
})

test('private agent capabilities cannot be reused in a group Session or after a session revoke', async t => {
  const { rt, ctx } = await setup(t)
  const actor = { ...alice, sessionId: 'local-session' }
  rt.state.authSessions['local-session'] = { id: 'local-session', memberId: alice.memberId, revokedAt: null }
  const a = await get(rt, actor)
  await message(rt, actor)
  rt.groupOwners.set('group-session', { botId: a.mine.botId, roomId: 'group' })
  const denied = await Promise.all(ctx.guards.map(fn => fn({ name: 'project_agent_context', agent: { id: 'group-session' } })))
  assert.ok(denied.some(value => typeof value === 'string' && /group/.test(value)))
  await assert.rejects(rt.createRoom({ members: [a.mine.botId, 'legacy'] }), /cannot join group/)
  rt.state.authSessions['local-session'].revokedAt = Date.now()
  await assert.rejects(rt.projectAgents.context(rt.botOf(a.mine.botId)), /session was revoked/)
})

test('new carrier Bots preserve logical private identity/notes, and role skill changes are scoped and atomic', async t => {
  const { rt } = await setup(t)
  const a = await get(rt, alice)
  await rt.projectEndpoint('project-agent-memory-write', { projectId: 'p1', text: 'Keep this private note' }, alice)
  delete rt.state.bots[a.mine.botId]
  const replaced = await get(rt, alice)
  assert.equal(replaced.mine.id, a.mine.id)
  assert.notEqual(replaced.mine.botId, a.mine.botId)
  assert.equal(replaced.privateMemory[0].text, 'Keep this private note')
  await assert.rejects(rt.projectEndpoint('project-agent-definition', { projectId: 'p1', role: 'developer', instructions: 'Changed', skills: ['private-unapproved-skill'] }, alice), /not explicitly available/)
  assert.notEqual((await get(rt, alice)).definitions.roles.find(row => row.role === 'developer').instructions, 'Changed')
  rt.resolveModel = async model => model
  const changed = await rt.projectEndpoint('project-agent-definition', { projectId: 'p1', role: 'developer', model: 'provider/model', skills: ['code-change'] }, alice)
  assert.equal(changed.definitions.revision, 2)
  await assert.rejects(rt.projectEndpoint('project-agent-definition', { projectId: 'p1', role: 'developer', model: 'other/model' }, bob), /access denied/)
  const resolved = rt.projectAgents.deliveryDefinitions('p1')
  assert.equal(resolved.roles.find(row => row.role === 'developer').resolvedSkills[0].source, 'builtin')
})

test('Project deletion retires scoped agents, clears private notes and retains shared history', async t => {
  const { rt } = await setup(t)
  const a = await get(rt, alice)
  await rt.projectEndpoint('project-agent-memory-write', { projectId: 'p1', text: 'Delete this private note with Project' }, alice)
  await message(rt, alice, 'public', 'A public historical discussion')
  rt.projectAgents.onEvent({ id: a.public.botId }, { type: 'turn/end' })
  // A test carrier has no DSH Session resources; exercise the host-owned retirement contract.
  rt.deleteBot = async id => { delete rt.state.bots[id] }
  rt.projectChief.remove = async () => { delete rt.state.bots[a.public.botId] }
  await rt.projectEndpoint('project-delete', { id: 'p1' }, alice)
  assert.equal(rt.state.projectAgents[a.mine.id].status, 'retired')
  assert.equal(rt.state.projectAgentMemory[a.mine.id], undefined)
  const publicHistory = await rt.projectEndpoint('project-agent-history', { projectId: 'p1', visibility: 'public' }, bob)
  assert.ok(publicHistory.messages.some(row => row.text === 'A public historical discussion'))
  await assert.rejects(message(rt, alice), /retired/)
})

test('a queued or foreign exchange cannot activate another human’s agent delegation', async t => {
  const { rt } = await setup(t)
  const a = await get(rt, alice)
  let queued
  rt.deliver = async input => { queued = input; return 'queued' }
  await message(rt, alice)
  await assert.rejects(rt.projectAgents.context(rt.botOf(a.mine.botId)), /delegation/)
  rt.projectAgents.onEvent({ id: a.mine.sessionId }, { type: 'user/message', data: { source: { exchangeId: 'foreign-message' } } })
  rt.projectAgents.onEvent({ id: a.mine.sessionId }, { type: 'turn/start', data: { turn: 1 } })
  await assert.rejects(rt.projectAgents.context(rt.botOf(a.mine.botId)), /delegation/)
  rt.projectAgents.onEvent({ id: a.mine.sessionId }, { type: 'user/message', data: { source: { exchangeId: queued.exchangeId } } })
  assert.equal((await rt.projectAgents.context(rt.botOf(a.mine.botId))).identity.memberId, alice.memberId)
  const scope = queued.projectDelegation
  assert.equal(rt.projectAgents.isDelegationActive(scope.agentId, scope.delegationId), true)
  rt.projectAgents.revoke('p1', alice.memberId)
  assert.equal(rt.projectAgents.isDelegationActive(scope.agentId, scope.delegationId), false)
})
