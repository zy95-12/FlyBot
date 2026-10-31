import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectScheduler } from '../src/host/project-scheduler.js'
import { deliveryMetrics } from '../src/host/workbench-state.js'
import { repositorySettings } from '../src/host/project-repository-policy.js'

function fixture() {
  const project = { id: 'p1', repository: 'example/repo', ownerUserId: 'owner-1', status: 'active', quota: { maxConcurrent: 1 } }
  const state = { projects: { p1: project }, bots: {}, tasks: { one: { id: 'one', projectId: 'p1', requesterId: 'bob', status: 'open' }, two: { id: 'two', projectId: 'p1', requesterId: 'bob', status: 'open' } }, projectAttempts: {}, projectExecutions: {} }
  let member = true, count = 0
  const rt = { state, config: { projectRepositories: { 'example/repo': { path: '/provisioned/repo', testCommand: ['node', '--test'], allowedPaths: ['core'] } } },
    readOnly: () => undefined, sharedProjectMode: () => true, flybotIsRead: () => true, warn() {}, save: async () => {},
    listProjects: () => [project], readProject: () => project,
    projectCan: actor => actor.memberId === 'owner-1' || member && actor.memberId === 'bob',
    requireProjectAccess(actor) { if (!rt.projectCan(actor)) throw new Error('Access denied'); return project },
    projectDelivery: { endpoint: async (_endpoint, body, actor) => {
      const id = `attempt-${++count}`
      const attempt = { id, taskId: body.taskId, projectId: 'p1', initiatedBy: actor.memberId, status: 'running' }
      state.projectAttempts[id] = attempt
      state.projectExecutions[id] = { id, taskId: body.taskId, projectId: 'p1', attemptId: id, status: 'running' }
      return { attempt }
    } },
  }
  return { rt, project, state, scheduler: createProjectScheduler(rt, { preflight: async () => repositorySettings(rt, project) }), revoke: () => { member = false } }
}

test('Project quota really queues without allocating another Attempt and drains after release', async () => {
  const { scheduler, state } = fixture()
  const actor = { memberId: 'bob' }
  await scheduler.request({ taskId: 'one', requestId: 'one' }, actor)
  const queued = await scheduler.request({ taskId: 'two', requestId: 'two' }, actor)
  assert.equal(queued.queue.status, 'waiting')
  assert.equal(Object.keys(state.projectAttempts).length, 1)
  assert.equal((await scheduler.request({ taskId: 'two', requestId: 'two' }, actor)).already, true)
  assert.equal(scheduler.slots('p1'), 1)
  state.projectAttempts['attempt-1'].status = 'waiting-acceptance'
  state.projectExecutions['attempt-1'].status = 'done'
  await scheduler.drain()
  assert.equal(state.projectQueue[queued.queue.id].status, 'started')
  assert.equal(Object.keys(state.projectAttempts).length, 2)
  assert.equal(state.projectAttempts['attempt-2'].initiatedBy, 'bob')
})

test('revoked queue authority cancels immediately and orphan Workers keep their slot until released', async () => {
  const { scheduler, state, revoke } = fixture()
  await scheduler.request({ taskId: 'one', requestId: 'one' }, { memberId: 'bob' })
  const queued = await scheduler.request({ taskId: 'two', requestId: 'two' }, { memberId: 'bob' })
  state.projectAttempts['attempt-1'].status = 'failed'
  state.projectExecutions['attempt-1'].status = 'failed'
  state.bots.worker = { id: 'worker', projectId: 'p1', ephemeral: { plugin: 'workflow' }, attemptId: 'attempt-1' }
  await scheduler.drain()
  assert.equal(state.projectQueue[queued.queue.id].status, 'waiting')
  revoke()
  assert.equal(scheduler.revalidate('p1'), true)
  assert.equal(state.projectQueue[queued.queue.id].status, 'cancelled')
  delete state.bots.worker
  await scheduler.drain()
  assert.equal(Object.keys(state.projectAttempts).length, 1)
})

test('queue startup recovery is idempotent and Project repository grants follow the provisioned owner', async () => {
  const { scheduler, state, project, rt } = fixture()
  state.projectQueue = { q: { id: 'q', status: 'starting', projectId: 'p1', taskId: 'one', requestKey: 'key' } }
  assert.equal(scheduler.recover(), true)
  assert.equal(state.projectQueue.q.status, 'waiting')
  assert.equal(scheduler.recover(), false)
  assert.equal(repositorySettings(rt, project).path, '/provisioned/repo')
  assert.throws(() => repositorySettings(rt, { ...project, ownerUserId: 'bob' }), /not provisioned/)
  rt.config.projectRepositories['example/repo'].allowedProjectOwnerIds = ['bob']
  assert.equal(repositorySettings(rt, { ...project, ownerUserId: 'bob' }).path, '/provisioned/repo')
})

test('metrics state its rolling window and use actual acceptance samples for mean/median', () => {
  const now = 10 * 24 * 3600_000
  const state = { tasks: { a: { createdAt: now - 1000 }, b: { createdAt: now - 3000 }, c: { createdAt: now - 10_000 } }, projectAttempts: {
    a: { projectId: 'p1', taskId: 'a', status: 'accepted', acceptedAt: now }, b: { projectId: 'p1', taskId: 'b', status: 'accepted', acceptedAt: now },
    old: { projectId: 'p1', taskId: 'c', status: 'accepted', acceptedAt: 1 }, missing: { projectId: 'p2', taskId: 'none', status: 'accepted', acceptedAt: now },
  } }
  const metrics = deliveryMetrics(state, 'p1', now)
  assert.equal(metrics.window.kind, 'rolling-seven-days')
  assert.equal(metrics.acceptedTasks, 2)
  assert.equal(metrics.duration.samples, 2)
  assert.equal(metrics.duration.meanMs, 2000)
  assert.equal(metrics.duration.medianMs, 2000)
  assert.equal(deliveryMetrics(state, 'empty', now).duration.meanMs, null)
})

test('resource capacity uses the existing durable queue and SDK leases keep Project slots occupied', async () => {
  const { rt, state, scheduler } = fixture()
  let full = true
  rt.projectResources = { plan() { if (full) throw new Error('Resource capacity is full') } }
  const queued = await scheduler.request({ taskId: 'one', requestId: 'resource-limited' }, { memberId: 'bob' })
  assert.equal(queued.queue.status, 'waiting')
  assert.equal(Object.keys(state.projectAttempts).length, 0)
  await scheduler.drain()
  assert.equal(state.projectQueue[queued.queue.id].status, 'waiting')
  full = false
  await scheduler.drain()
  assert.equal(state.projectQueue[queued.queue.id].status, 'started')
  state.projectAttempts['attempt-1'].status = 'failed'
  state.projectExecutions['attempt-1'].status = 'failed'
  state.projectResourceLeases = { sdk: { projectId: 'p1', attemptId: 'attempt-1', status: 'unreachable' } }
  assert.equal(scheduler.slots('p1'), 1)
  state.projectResourceLeases.sdk.status = 'released'
  assert.equal(scheduler.slots('p1'), 0)
})

test('a waiting request with invalidated provisioning is blocked before allocation', async () => {
  const { scheduler, rt, state } = fixture()
  await scheduler.request({ taskId: 'one', requestId: 'first' }, { memberId: 'bob' })
  const queued = await scheduler.request({ taskId: 'two', requestId: 'next' }, { memberId: 'bob' })
  state.projectAttempts['attempt-1'].status = 'failed'; state.projectExecutions['attempt-1'].status = 'failed'
  delete rt.config.projectRepositories['example/repo'].allowedPaths
  await scheduler.drain()
  assert.equal(state.projectQueue[queued.queue.id].status, 'blocked')
  assert.match(state.projectQueue[queued.queue.id].reason, /allowedPaths/)
  assert.equal(Object.keys(state.projectAttempts).length, 1)
})
