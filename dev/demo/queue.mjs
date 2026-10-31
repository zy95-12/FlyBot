import assert from 'node:assert/strict'
export async function checkQueue({ api, call, saved, waitFor }) {
  const invitation = await api('auth-invite')
  const alice = await api('auth-redeem', { token: invitation.token, displayName: 'Alice' })
  const owner = (endpoint, body = {}) => api(endpoint, body, alice.sessionToken)
  const second = await owner('auth-invite')
  const bob = await api('auth-redeem', { token: second.token, displayName: 'Bob' })
  const member = (endpoint, body = {}) => api(endpoint, body, bob.sessionToken)
  const { project } = await owner('project-create', { name: 'Queued delivery', repository: 'example/delivery-fixture' })
  const invite = await owner('project-invite', { projectId: project.id })
  await member('project-join', { token: invite.token })
  await owner('project-quota', { projectId: project.id, maxConcurrent: 1 })
  const { public: chief } = await owner('project-agents', { projectId: project.id })
  const tasks = []
  for (let index = 0; index < 3; index++) tasks.push(await member('task-create', { projectId: project.id, botId: chief.botId, title: `Fix addition ${index}`, criteria: 'add(2,3) equals 5' }))
  const first = await member('project-task-run', { taskId: tasks[0].id, requestId: 'queue-first' })
  assert.equal(first.attempt.status, 'running', first.attempt.failure?.message)
  const queued = await member('project-task-run', { taskId: tasks[1].id, requestId: 'queue-second' })
  assert.equal(queued.queue.status, 'waiting')
  assert.equal(Object.values(saved().projectAttempts).length, 1, 'queue must not allocate an Attempt or worktree')
  const duplicate = await member('project-task-run', { taskId: tasks[1].id, requestId: 'queue-second' })
  assert.equal(duplicate.queue.id, queued.queue.id)
  await waitFor(() => saved().projectQueue[queued.queue.id]?.status === 'started', 'real Workflow release drains queued delivery')
  assert.equal(Object.values(saved().projectAttempts).length, 2)
  const third = await member('project-task-run', { taskId: tasks[2].id, requestId: 'queue-revoked' })
  assert.equal(third.queue.status, 'waiting')
  await owner('project-member-remove', { projectId: project.id, memberId: bob.memberId })
  assert.equal(saved().projectQueue[third.queue.id].status, 'cancelled')
  assert.equal((await call('project-resources', { projectId: project.id }, bob.sessionToken)).ok, false)
  await waitFor(() => Object.values(saved().projectAttempts).every(row => row.status === 'failed'), 'credential gate finishes both actual delivery Attempts')
  // Workflow status is saved before its asynchronous worker release finishes.
  // Cleanup deliberately refuses workspaces while a worker can still use them.
  await waitFor(() => {
    const state = saved()
    const attempts = new Set(Object.keys(state.projectAttempts))
    return !Object.values(state.bots).some(bot => bot.ephemeral && attempts.has(bot.attemptId)) &&
      !Object.values(state.projectResourceLeases ?? {}).some(lease => attempts.has(lease.attemptId) && lease.status !== 'released')
  }, 'confirmed worker release before workspace cleanup')
  for (const attempt of Object.values(saved().projectAttempts)) await owner('project-attempt-cleanup', { attemptId: attempt.id })
  const resources = await owner('project-resources', { projectId: project.id })
  assert.equal(resources.activeSlots, 0)
  assert.equal(resources.metrics.acceptedTasks, 0)
  assert.equal(resources.metrics.duration.medianMs, null)
  return { milestone: 'M5', runtime: 'actual DSH', model: 'deterministic mock', checks: ['quota queues before worktree allocation', 'duplicate queue request idempotent', 'Workflow release drains queue', 'revoked member queued request cancelled', 'confirmed worker release before workspace cleanup', 'no invented acceptance metrics'], notRun: ['real model', 'real GitHub publication'] }
}
