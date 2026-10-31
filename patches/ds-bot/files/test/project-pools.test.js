import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectPools, POOL_PROTOCOL } from '../src/host/project-pools.js'
import { validateHandoff } from '../../plugins/workflow/src/pool-contract.js'
function setup() {
  const roles = ['chief', 'developer', 'tester', 'reviewer'].map(role => ({ id: `p:${role}`, role }))
  const task = { id: 'task', projectId: 'p', title: 'Repair code', criteria: 'Actual tests pass' }
  const rt = { state: { tasks: { task }, projectHarnessWorkers: {} }, config: {}, save: async () => {}, projectAgents: { deliveryDefinitions: () => ({ revision: 7, roles }) }, projects: { requireActive() {} }, requireProjectAccess(actor, projectId) { if (actor.memberId !== 'owner' || projectId !== 'p' || rt.revoked) throw new Error('Current authority denied') } }
  const pool = createProjectPools(rt), completed = []
  const adapter = { validate: validateHandoff, complete: async input => completed.push(input), release: async () => true, rework: async ({ claim }) => claim.attemptId }
  pool.connect(adapter)
  return { rt, task, pool, adapter, completed, admit: () => pool.admit({ id: 'attempt', taskId: 'task' }, { memberId: 'owner' }), claim: () => pool.claim('task', 'p:developer') }
}
test('a logical Bot owns its pool and exactly one concurrent claim succeeds', async () => {
  const f = setup(); await f.admit()
  assert.equal(f.task.collaboration.version, POOL_PROTOCOL)
  assert.equal(f.pool.available('p', 'p:reviewer', { memberId: 'owner' }).length, 0)
  assert.equal(f.pool.available('p', 'p:developer', { memberId: 'owner' }).length, 1)
  const claims = await Promise.all([f.claim(), f.claim()])
  assert.equal(claims.filter(Boolean).length, 1)
  assert.equal(f.task.collaboration.history[0].status, 'accepted')
  assert.throws(() => f.pool.available('p', 'other-project:developer', { memberId: 'owner' }), /Target/)
})
test('non-DAG handoff, explicit return and Chief completion requests preserve the same Task', async () => {
  const f = setup(); await f.admit()
  const dev = await f.claim()
  await f.pool.decide('task', dev, { action: 'handoff', to: 'p:reviewer', reason: 'Review the design before testing' })
  const review = await f.pool.claim('task', 'p:reviewer')
  await f.pool.decide('task', review, { action: 'return', to: 'p:developer', reason: 'The negative case needs a regression' })
  const next = await f.claim()
  await f.pool.decide('task', next, { action: 'complete', reason: 'Request final criteria judgement' })
  assert.equal(Object.keys(f.rt.state.tasks).length, 1)
  assert.equal(f.task.collaboration.status, 'arbitration')
  assert.equal(f.task.collaboration.botId, 'p:chief')
  assert.notEqual(f.task.status, 'accepted')
  assert.deepEqual(f.task.collaboration.history.map(row => row.to), ['p:developer', 'p:reviewer', 'p:developer', 'p:chief'])
  assert.equal(f.completed.length, 2)
})
test('duplicate decisions have one effect, altered retries and stale claims cannot affect a successor', async () => {
  const f = setup(); await f.admit(); const first = await f.claim()
  const decision = { action: 'handoff', to: 'p:tester', reason: 'Run candidate tests' }
  const receipt = await f.pool.decide('task', first, decision)
  assert.equal((await f.pool.decide('task', first, decision)).id, receipt.id)
  assert.equal(f.completed.length, 1)
  await assert.rejects(f.pool.decide('task', first, { ...decision, reason: 'Changed intent' }), /idempotency/)
  const next = await f.pool.claim('task', 'p:tester')
  await assert.rejects(f.pool.decide('task', { ...next, generation: first.generation }, { action: 'complete', reason: 'Stale result' }), /stale/)
  assert.equal(f.task.collaboration.claim.id, next.id)
})
test('real handoff validator refuses missing acceptance evidence and leaves a recoverable block', async () => {
  const f = setup(); await f.admit(); const claim = await f.claim()
  f.task.poolAcceptance = { tester: { requires: [{ pr: 99, checks: 'tests-ok' }] } }
  await assert.rejects(f.pool.decide('task', claim, { action: 'handoff', to: 'p:tester', reason: 'Missing required green check', evidence: [{ pr: 99, checks: 'tests-ok' }] }), /missing-evidence/)
  assert.equal(f.task.collaboration.status, 'blocked')
  assert.equal(f.task.collaboration.history.length, 1)
})
test('revoked authority and unconfirmed worker exit preserve the claim and prevent transfer', async () => {
  const f = setup(); await f.admit(); const claim = await f.claim()
  f.task.collaboration.claim.workerId = 'live-worker'; f.adapter.release = async () => false
  await assert.rejects(f.pool.decide('task', claim, { action: 'handoff', to: 'p:tester', reason: 'Transfer while alive' }), /unconfirmed/)
  assert.equal(f.task.collaboration.claim.status, 'active')
  f.rt.revoked = true
  await assert.rejects(f.pool.decide('task', claim, { action: 'arbitrate', reason: 'Authority was removed' }), /authority/)
  assert.equal(f.task.collaboration.history.length, 1)
})
test('restart fences active claims, preserves receipts and never fabricates resource release', async () => {
  const f = setup(); await f.admit(); const claim = await f.claim()
  f.task.collaboration.claim.workerId = 'unknown-worker'
  assert.equal(f.pool.recover(), true); assert.equal(f.pool.recover(), false)
  assert.equal(f.task.collaboration.status, 'blocked')
  assert.equal(f.task.collaboration.claim.workerId, 'unknown-worker')
  await assert.rejects(f.pool.decide('task', claim, { action: 'complete', reason: 'Late callback' }), /stale/)
})
test('cycle and quota budgets gate actual transfers instead of producing shadow-only warnings', async () => {
  const f = setup(); f.rt.config.projectHandoff = { quota: { steps: 0 } }
  await f.admit()
  await assert.rejects(f.claim(), /quota/)
  assert.equal(f.task.collaboration.status, 'blocked')
})

test('a busy receiving resource leaves the Task pending without an idle worker claim', async () => {
  const f = setup(); f.adapter.ready = () => false; await f.admit()
  assert.equal(await f.claim(), null)
  assert.equal(f.task.collaboration.status, 'queued')
  assert.equal(f.task.collaboration.claim, undefined)
  assert.equal(f.task.collaboration.history[0].status, 'pending')
})

test('late native or SDK results stay on the original run surface after restart', async () => {
  const f = setup(); await f.admit(); await f.claim()
  f.task.collaboration.claim.workerId = 'retired-worker'
  f.pool.recover()
  assert.equal(f.pool.owns('retired-worker'), true)
  assert.equal(await f.pool.result({ botId: 'retired-worker', ok: true, text: 'OUTPUT handoff: {}' }), true)
  assert.equal(f.task.collaboration.status, 'blocked')
  assert.equal(f.task.collaboration.history.length, 1)
})
