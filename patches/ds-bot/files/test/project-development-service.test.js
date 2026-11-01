import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDevelopmentService, taskView, DEVELOPMENT_PROTOCOL } from '../src/host/project-development-service.js'

function fixture() {
  const state = { members: { alice: {}, bob: {} }, tasks: { t: { id: 't', projectId: 'p', requesterId: 'alice', status: 'open', createdAt: 1 } },
    projectAttempts: {}, projectQueue: {}, projectHarnessWorkers: {}, bots: {}, projectExecutions: {} }
  const calls = []
  const rt = { state, config: {}, sharedProjectMode: () => true, readProject: id => ({ id, status: 'active' }),
    requireProjectAccess(actor, projectId, action = 'read') { if (!state.members[actor?.memberId] || projectId !== 'p' || action !== 'read' && actor.memberId !== 'alice') throw Object.assign(new Error('Project access denied'), { code: 'bot/forbidden' }); return { id: projectId } },
    projectCan: (actor, projectId, action) => projectId === 'p' && Boolean(state.members[actor?.memberId]) && (action === 'read' || actor.memberId === 'alice'),
    projectScheduler: { request: async (body, actor) => { calls.push({ body, actor }); return { started: true } } },
    projectAgents: { deliveryDefinitions: () => ({ roles: [] }) } }
  return { rt, state, calls, service: createDevelopmentService(rt), actor: { memberId: 'alice' } }
}

test('v1 and legacy commands use the same scoped handler and never trust body actors', async () => {
  const { service, calls, actor } = fixture()
  await service.endpoint('project-task-run', { taskId: 't', requestId: 'r' }, actor)
  const result = await service.endpoint('project-development', { version: DEVELOPMENT_PROTOCOL, kind: 'command', name: 'task.run', projectId: 'p', requestId: 'r', payload: { taskId: 't', memberId: 'bob', actor: { memberId: 'bob' } } }, actor)
  assert.equal(result.version, DEVELOPMENT_PROTOCOL)
  assert.deepEqual(result.result, { started: true })
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.actor === actor && call.body.taskId === 't' && call.body.requestId === 'r'))
})

test('version, shape, target scope and stale generation fail before command effects', async () => {
  const { service, state, calls, actor } = fixture()
  const body = { version: DEVELOPMENT_PROTOCOL, kind: 'command', name: 'task.run', projectId: 'p', requestId: 'r', payload: { taskId: 't' } }
  state.tasks.t.collaboration = { generation: 4, history: [] }
  for (const change of [{ version: 'unknown' }, { kind: 'event' }, { name: '__proto__' }, { requestId: '' }, { payload: [] }, { projectId: 'other' }, { expectedGeneration: 3 }, { expectedGeneration: '4' }, { expectedCandidateSha: 'old' }, { payload: { taskId: 'missing' } }]) {
    await assert.rejects(service.endpoint('project-development', { ...body, ...change }, actor))
  }
  assert.equal(calls.length, 0)
  await service.endpoint('project-development', { ...body, expectedGeneration: 4 }, actor)
  assert.equal(calls.length, 1)
})

test('paged task views are stable, project scoped, read-only and reflect revocation', async () => {
  const { service, state, actor } = fixture()
  state.tasks.a = { id: 'a', projectId: 'p', status: 'open', createdAt: 1 }
  state.tasks.z = { id: 'z', projectId: 'foreign', status: 'open', createdAt: 0, note: 'private' }
  const before = JSON.stringify(state)
  const body = { version: DEVELOPMENT_PROTOCOL, kind: 'query', name: 'tasks', projectId: 'p', payload: { limit: 1 } }
  const first = (await service.endpoint('project-development', body, actor)).result
  assert.deepEqual(first.tasks.map(row => row.taskId), ['a'])
  const second = (await service.endpoint('project-development', { ...body, payload: { limit: 1, after: first.next } }, actor)).result
  assert.deepEqual(second.tasks.map(row => row.taskId), ['t'])
  assert.equal(second.next, null)
  assert.equal(JSON.stringify(state), before)
  for (const payload of [{ limit: 0 }, { limit: 201 }, { after: 'not-a-cursor' }, { taskId: 'z' }]) await assert.rejects(service.endpoint('project-development', { ...body, name: payload.taskId ? 'task' : 'tasks', payload }, actor))
  delete state.members.alice
  await assert.rejects(service.endpoint('project-development', body, actor), /Sign in|denied/)
})

test('TaskView distinguishes publication, queue, resource wait and confirmed execution', () => {
  const { state } = fixture(), task = state.tasks.t
  assert.equal(taskView(state, task).phase, 'published')
  state.projectQueue.q = { id: 'q', projectId: 'p', taskId: 't', status: 'waiting', reason: 'No resource' }
  assert.equal(taskView(state, task).waitingFor, 'resource')
  delete state.projectQueue.q
  task.collaboration = { status: 'queued', botId: 'p:developer', generation: 1, history: [] }
  assert.equal(taskView(state, task).waitingFor, 'role')
  task.collaboration.status = 'claimed'
  task.collaboration.claim = { id: 'claim', status: 'active', workerId: 'w', botId: 'p:developer', generation: 2 }
  state.bots.w = { id: 'w' }
  assert.equal(taskView(state, task).phase, 'starting', 'a stored Bot is not proof of a running turn')
  state.bots.w.projectId = 'foreign'
  assert.equal(taskView(state, task, { activity: { w: 'thinking' } }).phase, 'starting')
  state.bots.w.projectId = 'p'
  assert.equal(taskView(state, task, { activity: { w: 'thinking' } }).phase, 'running')
  state.projectHarnessWorkers.w = { id: 'w', projectId: 'p', taskId: 't', status: 'running' }
  assert.equal(taskView(state, task).phase, 'running')
  state.projectHarnessWorkers.w.status = 'waiting-input'
  assert.equal(taskView(state, task).waitingFor, 'owner')
  state.projectHarnessWorkers.w.status = 'released'
  assert.notEqual(taskView(state, task).phase, 'running')
})

test('TaskView gives human/Chief/terminal states precedence and rejects stale candidate evidence', () => {
  const { state } = fixture(), task = state.tasks.t
  task.deliveryAttemptId = 'a'
  state.projectAttempts.a = { id: 'a', taskId: 't', projectId: 'p', status: 'waiting-acceptance', candidateSha: 'new', evidence: { tests: { sha: 'old', passed: true, sha256: 'hash' }, review: { sha: 'old', verdict: 'approve' } } }
  task.collaboration = { status: 'arbitration', botId: 'p:chief', generation: 4, history: [] }
  assert.equal(taskView(state, task).waitingFor, 'chief')
  task.chiefQuestion = { reason: 'Choose the scope', at: 2 }
  assert.equal(taskView(state, task).waitingFor, 'owner')
  assert.equal(taskView(state, task).reason, 'Choose the scope')
  assert.equal(taskView(state, task).evidence.tests.current, false)
  assert.equal(taskView(state, task).evidence.review.current, false)
  assert.equal(taskView(state, task).lastMeaningfulProgress, null)
  task.status = 'accepted'
  assert.equal(taskView(state, task).phase, 'accepted')
  task.status = 'cancelled'
  assert.equal(taskView(state, task).phase, 'cancelled')
  state.projectAttempts.a.projectId = 'foreign'
  assert.equal(taskView(state, task).candidateSha, null)
})

test('task views project only evidence references and permission-filtered next actions', async () => {
  const { service, state, actor } = fixture()
  const body = { version: DEVELOPMENT_PROTOCOL, kind: 'query', name: 'task', projectId: 'p', payload: { taskId: 't' } }
  state.tasks.t.note = 'private prompt must not be projected'
  const owner = (await service.endpoint('project-development', body, actor)).result.task
  const member = (await service.endpoint('project-development', body, { memberId: 'bob' })).result.task
  assert.ok(owner.nextActions.includes('task.run'))
  assert.deepEqual(member.nextActions, [])
  assert.equal(JSON.stringify(owner).includes('private prompt'), false)
})

test('trusted role and schedule ports retain original claims, authority and event identities', async () => {
  const { service, rt } = fixture(), seen = []
  rt.projectPools = { claim: async (...args) => { seen.push(args); return 'claim' }, decide: async (...args) => { seen.push(args); return 'decision' }, result: async row => { seen.push(row); return true } }
  rt.projectChiefControl = { scheduled: async work => { seen.push(work); return 'scheduled' } }
  const claim = { id: 'c', generation: 2, botId: 'p:developer' }
  assert.equal(await service.roleCommand({ version: DEVELOPMENT_PROTOCOL, name: 'claim', requestId: 'claim-request', taskId: 't', botId: claim.botId }), 'claim')
  for (const name of ['handoff', 'return', 'transfer', 'complete', 'arbitrate']) {
    assert.equal(await service.roleCommand({ version: DEVELOPMENT_PROTOCOL, name, requestId: name, taskId: 't', claim, payload: { action: 'forged', requestId: 'forged', to: 'p:tester', reason: 'verified work' } }), 'decision')
    const call = seen.at(-1)
    assert.equal(call[1], claim)
    assert.equal(call[2].action, name)
    assert.equal(call[2].requestId, name)
  }
  assert.throws(() => service.roleCommand({ version: 'bad', name: 'claim', requestId: 'r' }))
  const result = { botId: 'w', ok: true, text: 'result' }, work = { row: { id: 'logical' }, delivery: { id: 'occurrence' }, actor: { memberId: 'alice' } }
  assert.equal(await service.roleResult(result), true)
  assert.equal(seen.at(-1), result)
  assert.equal(await service.scheduled(work), 'scheduled')
  assert.equal(seen.at(-1), work)
})

test('proposal/worker targets stay in envelope scope and permission request identity is preserved', async () => {
  const { service, state, rt, actor } = fixture()
  state.projectAgentProposals = { foreign: { projectId: 'other', memberId: 'alice' } }
  state.projectHarnessWorkers = { foreign: { projectId: 'other' }, own: { projectId: 'p' } }
  let calls = 0
  rt.projectAgents.endpoint = async () => { calls++; return {} }
  rt.projectHarness = { input: async body => { calls++; assert.equal(body.requestId, 'permission-request'); return { sent: true } } }
  const command = { version: DEVELOPMENT_PROTOCOL, kind: 'command', projectId: 'p', requestId: 'transport-command' }
  for (const [name, payload] of [['proposal.publish', { proposalId: 'foreign' }], ['execution.input', { workerId: 'foreign' }]]) {
    await assert.rejects(service.endpoint('project-development', { ...command, name, payload }, actor), /another Project|unavailable/)
  }
  assert.equal(calls, 0)
  const result = await service.endpoint('project-development', { ...command, name: 'execution.input', payload: { workerId: 'own', requestId: 'permission-request' } }, actor)
  assert.equal(result.requestId, 'transport-command')
  assert.equal(calls, 1)
})

test('stopping, blocked admission, acceptance and legacy paused runs have actionable views', async () => {
  const { service, state, actor } = fixture(), task = state.tasks.t
  task.deliveryAttemptId = 'a'
  const attempt = state.projectAttempts.a = { id: 'a', projectId: 'p', taskId: 't', status: 'running', runId: 'run', cancelRequested: true }
  assert.equal(service.view(task, actor).waitingFor, 'worker-exit')
  attempt.cancelRequested = false
  state.projectQueue.q = { id: 'q', projectId: 'p', taskId: 't', status: 'blocked', reason: 'Preflight failed' }
  assert.deepEqual(service.view(task, actor).nextActions, ['queue.cancel', 'queue.retry', 'chief.inspect'])
  delete state.projectQueue.q
  attempt.status = 'waiting-acceptance'
  assert.ok(service.view(task, actor).nextActions.includes('task.accept'))
  attempt.status = 'running'
  state.projectExecutions.run = { id: 'run', projectId: 'p', taskId: 't', status: 'paused' }
  assert.equal(service.view(task, actor).phase, 'paused')
  task.collaboration = { status: 'claimed', generation: 1, history: [], claim: { id: 'c', workerId: 'w', status: 'active' } }
  state.projectHarnessWorkers.w = { id: 'w', projectId: 'p', taskId: 't', generation: 9, status: 'waiting-input', pending: { kind: 'permission', id: 'pending' } }
  const input = service.view(task, actor)
  assert.ok(input.nextActions.includes('execution.input'))
  assert.equal(input.executionGeneration, 9)
  assert.equal(input.inputRequestId, 'pending')
})
