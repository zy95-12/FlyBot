// Actual unchanged-platform + actual DSH shared-project acceptance probe (M2).
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export async function checkShared({ credentials, api, call, saved, waitFor, workspace, verifyArtifact }) {
  const alice = await api('platform-login', { email: 'alice@example.com', password: credentials.alicePassword })
  const aliceCall = (endpoint, body = {}) => api(endpoint, body, alice.sessionToken)
  const state = await aliceCall('state')
  const model = state.models.find(row => /deepseek-flash/.test(row.ref))?.ref ?? state.models.at(-1)?.ref
  const bob = await api('platform-login', { email: 'bob@example.com', password: credentials.bobPassword, memberId: alice.memberId, role: 'owner' })
  assert.notEqual(alice.memberId, bob.memberId)
  const bobCall = (endpoint, body = {}) => api(endpoint, body, bob.sessionToken)
  const { project } = await aliceCall('project-create', { name: 'M2 shared project' })
  assert.deepEqual((await bobCall('projects')).projects, [])
  const invitation = await aliceCall('project-invite', { id: project.id })
  await bobCall('project-join', { token: invitation.token, role: 'owner' })
  assert.equal((await bobCall('project-read', { id: project.id })).project.role, 'member')
  const botId = saved().projects[project.id].chief.botId
  const task = await bobCall('task-create', { botId, projectId: project.id, title: 'Shared execution probe', requesterId: alice.memberId })
  assert.equal(task.requesterId, bob.memberId)
  for (const member of [alice.sessionToken, bob.sessionToken]) {
    const board = await api('project-board', { id: project.id }, member)
    assert.ok(board.tasks.some(row => row.id === task.id))
  }
  assert.equal((await call('project-archive', { id: project.id, role: 'owner' }, bob.sessionToken)).ok, false)
  const created = await aliceCall('project-workflow', { projectId: project.id, operation: 'create', name: 'M2 shared probe', nodes: [
    { id: 'probe', name: 'Shared probe', model, prompt: 'Execute the isolated code/test probe.', tools: [], outputs: [{ name: 'proof' }] },
  ], edges: [] })
  assert.equal(created.ok, true, created.error)
  const workflow = created.workflows.find(row => row.name === 'M2 shared probe')
  assert.ok(workflow)
  const started = await bobCall('project-workflow', { projectId: project.id, operation: 'assign', workflowId: workflow.id, taskId: task.id })
  assert.equal(started.ok, true, started.error)
  await waitFor(() => existsSync(join(workspace, 'proof.json')), 'shared actual shell execution')
  await verifyArtifact(workspace)
  await waitFor(() => Object.values(saved().projectExecutions).some(run => run.taskId === task.id && run.status === 'done'), 'shared canonical Run terminal state')
  assert.equal((await call('flybot/workflow/state', {}, bob.sessionToken)).ok, false, 'Unscoped workflow API stays denied')
  await aliceCall('project-member-remove', { id: project.id, memberId: bob.memberId })
  assert.equal((await call('project-detail', { id: project.id }, bob.sessionToken)).ok, false)
  assert.equal((await call('task-update', { id: task.id, note: 'Stale tab' }, bob.sessionToken)).ok, false)
  assert.equal((await bobCall('tasks')).length, 0)
  // Independently suspend the platform account through its existing admin API.
  const admin = await fetch(`${credentials.origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: credentials.adminPassword }) })
  assert.equal(admin.status, 200)
  const adminData = await admin.json()
  const cookie = admin.headers.getSetCookie().map(row => row.split(';')[0]).join('; ')
  const disabled = await fetch(`${credentials.origin}/api/admin/users/${credentials.bobId}/status`, { method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': adminData.csrf_token }, body: JSON.stringify({ status: 'suspended' }) })
  assert.equal(disabled.status, 200)
  const denied = await call('projects', {}, bob.sessionToken)
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'bot/unauthorized')
  await aliceCall('auth-revoke')
  assert.equal((await call('projects', {}, alice.sessionToken)).ok, false)
  return { milestone: 'M2', platform: 'unchanged control-plane HTTP', runtime: 'actual DSH', model: 'deterministic mock',
    checks: ['two platform accounts', 'stable subject mapping', 'single-use Project invite', 'shared Task/board', 'shared Workflow execution',
      'member versus owner gates', 'member removal/stale page denied', 'platform suspension revokes session', 'logout revoked'],
    notRun: ['real model', 'real GitHub delivery', 'production deployment'] }
}
