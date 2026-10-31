import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { createWorkflowService } from '../../plugins/workflow/src/service.js'
import { fakeContext } from './fake-ctx.js'

const alice = { memberId: 'owner-1' }
const bob = { memberId: 'bob' }
const outsider = { memberId: 'outsider' }
async function setup(t) {
  const home = mkdtempSync(join(tmpdir(), 'flybot-access-'))
  const state = { version: 2, mainBotIds: ['a'], members: { 'owner-1': { id: 'owner-1' }, bob: { id: 'bob' }, outsider: { id: 'outsider' } },
    bots: { a: { id: 'a', name: 'Chief', ownerId: 'owner-1', role: 'Owner', sessionId: 'a', projectId: 'p1', createdAt: 1 } },
    projects: { p1: { id: 'p1', name: 'Shared', ownerUserId: 'owner-1', status: 'active', createdAt: 1, updatedAt: 1, roles: { maintainers: [], members: ['bob'] } },
      p2: { id: 'p2', name: 'Private', ownerUserId: 'outsider', status: 'active', createdAt: 1, updatedAt: 1 } },
    rooms: {}, tasks: {}, projectRuns: {}, exchanges: [], exchangeTurns: {}, agents: {} }
  writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  const ctx = fakeContext()
  Object.assign(ctx, { llm: { listProviders: () => [], listModels: async () => [] },
    workspaceRegistry: { get: () => undefined, archiveSession: async () => {} },
    sessionController: { resolveAgent: async () => ({ agent: undefined }) }, sessions: { flush: async () => {} } })
  const rt = createRuntime(ctx, { home, projectWorkbench: true })
  await rt.load()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  return rt
}

test('only current Project members see shared state; body identity and AI roles grant nothing', async t => {
  const rt = await setup(t)
  assert.deepEqual((await rt.projectEndpoint('projects', {}, bob)).projects.map(row => row.id), ['p1'])
  await assert.rejects(rt.projectEndpoint('project-detail', { id: 'p2', role: 'owner', memberId: 'outsider' }, bob), /access denied/)
  await assert.rejects(rt.projectEndpoint('project-board', { id: 'p1', actorId: 'owner-1' }, outsider), /access denied/)
  await assert.rejects(rt.projectEndpoint('project-archive', { id: 'p1' }, bob), /access denied/)
  assert.equal(rt.state.projects.p1.status, 'active')
})

test('Project invitations are hashed, single use and grant membership to the authenticated actor', async t => {
  const rt = await setup(t)
  const invite = await rt.projectEndpoint('project-invite', { id: 'p1', role: 'owner' }, alice)
  assert.ok(invite.token)
  assert.ok(!JSON.stringify(rt.state.projectInvites).includes(invite.token))
  await rt.projectEndpoint('project-join', { token: invite.token, memberId: 'bob', role: 'owner' }, outsider)
  assert.equal(rt.projectRoleOf(rt.state.projects.p1, 'outsider'), 'member')
  await assert.rejects(rt.projectEndpoint('project-join', { token: invite.token }, bob), /unavailable/)
  await assert.rejects(rt.projectEndpoint('project-invite', { id: 'p1' }, bob), /access denied/)
})

test('members create shared Tasks but cannot accept deliveries or update someone else’s request', async t => {
  const rt = await setup(t)
  const task = await rt.taskEndpoint('task-create', { botId: 'a', projectId: 'p1', title: 'Bob request', requesterId: 'owner-1' }, bob)
  assert.equal(task.requesterId, 'bob')
  assert.equal(task.projectId, 'p1')
  assert.equal(rt.taskVisible(rt.state.tasks[task.id], alice), true)
  const own = await rt.taskEndpoint('task-create', { botId: 'a', projectId: 'p1', title: 'Alice request' }, alice)
  await assert.rejects(rt.taskEndpoint('task-update', { id: own.id, title: 'Foreign change' }, bob), /cannot|Only|denied/)
  rt.state.tasks[task.id].status = 'result-ready'
  await assert.rejects(rt.taskEndpoint('task-accept-result', { id: task.id }, bob), /denied/)
  await rt.taskEndpoint('task-accept-result', { id: task.id }, alice)
  assert.equal(rt.state.tasks[task.id].status, 'accepted')
})

test('membership removal immediately revokes existing actor and task access while preserving work', async t => {
  const rt = await setup(t)
  const task = await rt.taskEndpoint('task-create', { botId: 'a', projectId: 'p1', title: 'Keep work' }, bob)
  await rt.projectEndpoint('project-member-remove', { id: 'p1', memberId: 'bob' }, alice)
  await assert.rejects(rt.projectEndpoint('project-detail', { id: 'p1' }, bob), /access denied/)
  await assert.rejects(rt.taskEndpoint('task-update', { id: task.id, note: 'Stale page' }, bob), /cannot|Only|denied/)
  assert.equal(rt.taskVisible(rt.state.tasks[task.id], bob), false)
  assert.equal(rt.state.tasks[task.id].requesterId, 'bob')
  assert.equal(rt.state.tasks[task.id].status, 'open')
})

test('a maintainer may invite Members and configure quota but may not re-role owners', async t => {
  const rt = await setup(t)
  await rt.projectEndpoint('project-role', { id: 'p1', memberId: 'bob', role: 'maintainer' }, alice)
  assert.ok((await rt.projectEndpoint('project-invite', { id: 'p1' }, bob)).token)
  assert.deepEqual(await rt.projectEndpoint('project-quota', { id: 'p1', maxConcurrent: 1 }, bob), { quota: { maxConcurrent: 1 } })
  await assert.rejects(rt.projectEndpoint('project-role', { id: 'p1', memberId: 'owner-1', role: 'member' }, bob), /access denied/)
  await assert.rejects(rt.projectEndpoint('project-member-remove', { id: 'p1', memberId: 'owner-1' }, bob), /owner/)
})


test('explicit null cannot detach a new shared Task from membership revocation', async t => {
  const rt = await setup(t)
  await assert.rejects(rt.taskEndpoint('task-create', { botId: 'a', projectId: null, title: 'Escape' }, bob), /another Project/)
  assert.deepEqual(rt.state.tasks, {})
})

test('Workflow gateway isolates projects, serializes quota admission and makes duplicate starts harmless', async t => {
  const rt = await setup(t)
  const service = createWorkflowService({ persist: false, readProject: id => rt.readProject(id),
    projectContext: (taskId, projectId) => rt.flybot.projects.context(taskId, projectId),
    bindRun: (id, projectId, details) => rt.flybot.projects.bindRun(id, projectId, details) })
  rt.ctx.effect(() => () => service.dispose(), 'test workflow')
  rt.flybot.api.handle('workflow/state', () => service.state(), { read: true })
  rt.flybot.api.handle('workflow/create', body => service.create(body))
  rt.flybot.api.handle('workflow/graph', body => service.saveGraph(body))
  rt.flybot.api.handle('workflow/assign', body => service.assign(body))
  const create = async (projectId, actor, name) => rt.projectEndpoint('project-workflow', { projectId, operation: 'create', name,
    nodes: [{ id: 'dev', name: 'Dev', prompt: 'Implement', tools: [] }], edges: [] }, actor)
  const shared = await create('p1', alice, 'Shared graph')
  assert.equal(shared.ok, true)
  await create('p2', outsider, 'Hidden graph')
  const graph = shared.workflows.find(row => row.name === 'Shared graph')
  const snapshot = await rt.projectEndpoint('project-workflow', { projectId: 'p1' }, bob)
  assert.deepEqual(snapshot.workflows.map(row => row.name), ['Shared graph'])
  await assert.rejects(create('p1', bob, 'Forbidden'), /access denied/)
  const first = await rt.taskEndpoint('task-create', { botId: 'a', projectId: 'p1', title: 'First' }, bob)
  const second = await rt.taskEndpoint('task-create', { botId: 'a', projectId: 'p1', title: 'Second' }, bob)
  await rt.projectEndpoint('project-quota', { id: 'p1', maxConcurrent: 1 }, alice)
  const start = taskId => rt.projectEndpoint('project-workflow', { projectId: 'p1', operation: 'assign', workflowId: graph.id, taskId }, bob)
  const results = await Promise.allSettled([start(first.id), start(second.id)])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  assert.match(results.find(row => row.status === 'rejected').reason.message, /quota/)
  assert.equal((await start(first.id)).already, true)
  assert.equal(Object.values(rt.state.projectExecutions).filter(run => run.status === 'running').length, 1)
  assert.equal(rt.authorize(bob, 'flybot/workflow/state', {}).ok, false)
  await assert.rejects(rt.projectEndpoint('project-workflow', { projectId: 'p1', operation: 'create', name: 'Ambient credentials', nodes: [{ id: 'x', tools: ['github'] }] }, alice), /credentials/)
})

test('unscoped plugin reads and global usage cannot leak other Projects in workbench mode', async t => {
  const rt = await setup(t)
  for (const endpoint of ['flybot/workflow/state', 'flybot/tree/state', 'flybot/timeline/state', 'workflows', 'workflow-save', 'usage']) assert.equal(rt.authorize(bob, endpoint, {}).ok, false, endpoint)
  rt.state.bots.a.systemPrompt = 'Alice private configuration'
  assert.deepEqual(await rt.flybotEndpoint('bots', {}, { actor: bob }), [])
  await rt.projectEndpoint('project-member-remove', { id: 'p1', memberId: 'bob' }, alice)
  assert.deepEqual(await rt.flybotEndpoint('changes', {}, { actor: bob }).then(result => result.changes), [])
})


test('demoting an inviter immediately invalidates its outstanding invitations', async t => {
  const rt = await setup(t)
  await rt.projectEndpoint('project-role', { id: 'p1', memberId: 'bob', role: 'maintainer' }, alice)
  const invite = await rt.projectEndpoint('project-invite', { id: 'p1' }, bob)
  await rt.projectEndpoint('project-role', { id: 'p1', memberId: 'bob', role: 'member' }, alice)
  await assert.rejects(rt.projectEndpoint('project-join', { token: invite.token }, outsider), /unavailable/)
  assert.equal(rt.projectCan(outsider, 'p1'), false)
})
