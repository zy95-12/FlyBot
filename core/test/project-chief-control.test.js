import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectChiefControl, inspectionFacts, allocationProof } from '../src/host/project-chief-control.js'
const thresholds = { maxHandoffsWithoutProgress: 3, longExecutionMs: 10000, missingHeartbeatMs: 5000, longWaitMs: 8000 }
test('Chief inspection counts verified artifact progress rather than message or transfer churn', () => {
  const task = { id: 't', updatedAt: 1, deliveryAttemptId: 'a', collaboration: { status: 'queued', generation: 7, history: Array.from({ length: 5 }, (_, index) => ({ evidence: [], reason: 'Progress message ' + index, createdAt: index + 1 })) } }
  const state = { projectAttempts: { a: { evidence: {} } } }
  assert.equal(inspectionFacts(state, task, thresholds, 100).handoffsWithoutProgress, 5)
  assert.match(inspectionFacts(state, task, thresholds, 100).reasons[0], /without verified/)
  task.collaboration.history[3].evidence = [{ kind: 'implementation', sha: 'candidate' }]
  task.collaboration.history[4].evidence = [{ kind: 'implementation', sha: 'candidate' }]
  assert.equal(inspectionFacts(state, task, thresholds, 100).handoffsWithoutProgress, 5, 'A new implementation commit alone cannot clear the bounce count')
  task.collaboration.history[3].evidence.push({ kind: 'host-tests', passed: true, sha: 'candidate', sha256: 'host-log' })
  task.collaboration.history[4].evidence.push({ kind: 'host-tests', passed: true, sha: 'candidate', sha256: 'another-run-log' })
  const facts = inspectionFacts(state, task, thresholds, 100)
  assert.equal(facts.handoffsWithoutProgress, 1, 'Repeating tests at the same SHA cannot reset the checkpoint')
  assert.equal(facts.lastMeaningfulProgressAt, 4)
  assert.equal(facts.progressEvidence[0].testLogSha256, 'host-log')
  task.chiefObservations = { fingerprint: 'a message is not a checkpoint', handoffCount: 5 }
  task.collaboration.history.forEach(row => { row.evidence = [] })
  assert.equal(inspectionFacts(state, task, thresholds, 100).handoffsWithoutProgress, 5)
})
test('Chief inspection thresholds are configuration and identify long execution, heartbeat and waits', () => {
  const task = { id: 't', updatedAt: 1, collaboration: { status: 'claimed', history: [], claim: { status: 'active', workerId: 'w', createdAt: 1 } } }
  const state = { projectHarnessWorkers: { w: { status: 'running', createdAt: 1 } } }
  assert.equal(inspectionFacts(state, task, thresholds, 20000).reasons.length, 2)
  assert.equal(inspectionFacts(state, task, { ...thresholds, longExecutionMs: 50000, missingHeartbeatMs: 50000 }, 20000).reasons.length, 0)
  task.collaboration.status = 'blocked'
  assert.match(inspectionFacts(state, task, thresholds, 20000).reasons.at(-1), /wait/)
})
test('failed schedule configuration does not silently enable autonomous Chief authority', async () => {
  const rt = { state: { projectChiefPolicies: {} }, requireProjectAccess() {}, projectDelegations: { background: async () => true }, projectScheduledTasks: { save: async () => { throw new Error('Original Schedule service is unavailable') } }, save: async () => {} }
  const control = createProjectChiefControl(rt)
  await assert.rejects(control.configure({ projectId: 'p', enabled: true }, { memberId: 'owner' }), /unavailable/)
  assert.equal(rt.state.projectChiefPolicies.p, undefined)
  assert.equal(control.template.when.seconds, 1800)
})

async function controlFixture() {
  const { createProjectPools } = await import('../src/host/project-pools.js')
  const task = { id: 't', projectId: 'p', title: 'Fix code', criteria: 'Exact candidate passes', status: 'result-ready', deliveryAttemptId: 'a', collaboration: { initiatedBy: 'owner', kind: 'code', generation: 1, status: 'arbitration', botId: 'p:chief', attemptId: 'a', currentHandoffId: 'receipt', history: [{ id: 'receipt', status: 'pending', to: 'p:chief', createdAt: 1, evidence: [] }] } }
  let request, accepted = 0, permitted = true
  const roles = ['chief', 'developer', 'tester', 'reviewer'].map(role => ({ id: `p:${role}`, role }))
  const rt = { state: { tasks: { t: task }, projectExecutions: {}, projectAttempts: { a: { id: 'a', candidateSha: 'candidate', evidence: {} } }, projectChiefPolicies: { p: { enabled: true, authorityMemberId: 'owner', revision: 1, inspection: { thresholds, prompt: 'Inspect evidence' } } }, projectAgents: { 'public-p': { botId: 'chief', sessionId: 'chief', carrierGeneration: 1 } } }, config: {}, save: async () => {}, projects: { requireActive() {} }, requireProjectAccess(actor, id) { if (!permitted || actor.memberId !== 'owner' || id !== 'p') throw new Error('Current role denied') }, projectDelegations: { background: async () => true }, bindProject(body) { rt.state.projectExecutions[body.id] = { ...body }; return { id: body.projectId, status: 'active' } }, projectAgents: { deliveryDefinitions: () => ({ roles }), chiefBusy: () => false, startChiefJob: async args => { request = args; return 'native-job' } }, projectDelivery: { chiefAccept: async () => { accepted++; task.status = 'accepted' } } }
  const control = createProjectChiefControl(rt); rt.projectChiefControl = control; rt.projectPools = createProjectPools(rt)
  await control.pump()
  const result = overrides => ({ ok: true, text: JSON.stringify({ summary: 'Judgement', decisions: [{ taskId: 't', action: 'close', reason: 'Criteria met', criteria: [{ criterion: task.criteria, passed: true, evidence: 'Verified host facts' }], ...overrides }] }), executionEvidence: { kind: 'native-chief', chiefRunId: request.runId, carrierGeneration: 1, botId: 'chief', sessionId: 'chief' } })
  return { rt, task, control, request, result, accepted: () => accepted, revokeRole() { permitted = false } }
}
test('Chief results cannot close a Task that progressed during reasoning or whose actor lost permission', async () => {
  const f = await controlFixture(); ++f.task.collaboration.generation
  await f.request.onResult(f.result())
  assert.equal(f.accepted(), 0); assert.equal(f.rt.state.projectExecutions[f.request.runId].status, 'failed')
  const g = await controlFixture(); g.revokeRole(); await g.request.onResult(g.result())
  assert.equal(g.accepted(), 0)
})
test('Chief cannot close another Project, bypass evidence criteria or accept a replaced carrier', async () => {
  const f = await controlFixture(); f.rt.state.tasks.foreign = { id: 'foreign', projectId: 'elsewhere', status: 'working' }
  await f.request.onResult(f.result({ taskId: 'foreign' }))
  assert.equal(f.accepted(), 0); assert.equal(f.rt.state.tasks.foreign.status, 'working')
  const g = await controlFixture(); await g.request.onResult(g.result({ criteria: [] }))
  assert.equal(g.accepted(), 0); assert.equal(Object.values(g.rt.state.projectChiefDecisions)[0].status, 'rejected')
  const h = await controlFixture(); h.rt.state.projectAgents['public-p'].carrierGeneration = 2
  await h.request.onResult(h.result()); assert.equal(h.accepted(), 0)
})
test('an unmanaged restart does not fabricate successful Chief execution or replay its old result', async () => {
  const f = await controlFixture()
  assert.equal(f.control.recover(), true); f.rt.projectPools.recover()
  const restored = createProjectChiefControl(f.rt); f.rt.projectChiefControl = restored
  await restored.pump()
  assert.equal(f.rt.state.projectExecutions[f.request.runId].status, 'interrupted')
  await f.request.onResult(f.result())
  assert.equal(f.accepted(), 0)
  assert.equal(f.task.status, 'result-ready')
})

test('host registration proof distinguishes never-allocated recovery from an unknown external worker', () => {
  const task = { deliveryAttemptId: 'a', collaboration: { claim: { status: 'interrupted' } } }
  const state = { projectAttempts: { a: { workspaces: {}, roleSessions: {} } } }
  assert.equal(allocationProof(state, task).status, 'not-allocated')
  state.projectResourceLeases = { l: { attemptId: 'a', status: 'unreachable' } }
  assert.equal(allocationProof(state, task).status, 'recorded-or-unknown')
  state.projectResourceLeases = {}; task.collaboration.claim.workerId = 'unknown-worker'
  assert.equal(allocationProof(state, task).status, 'recorded-or-unknown')
  delete task.collaboration.claim.workerId; state.projectAttempts.a.roleSessions.developer = { status: 'prepared' }
  assert.equal(allocationProof(state, task).status, 'recorded-or-unknown')
})
