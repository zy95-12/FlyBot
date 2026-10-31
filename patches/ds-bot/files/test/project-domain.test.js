import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const seed = () => ({ version: 2, revision: 1, mainBotIds: ['a'],
  members: { 'owner-1': { id: 'owner-1', createdAt: 1, designatedChiefId: 'a' } },
  bots: { a: { id: 'a', name: 'Chief', role: 'Developer', ownerId: 'owner-1', sessionId: 'a', createdAt: 1, projectId: 'p1' } },
  rooms: {}, tasks: {}, projects: {
    p1: { id: 'p1', name: 'One', ownerUserId: 'owner-1', status: 'active', createdAt: 1, updatedAt: 1 },
    p2: { id: 'p2', name: 'Two', ownerUserId: 'owner-1', status: 'active', createdAt: 1, updatedAt: 1 },
  }, projectRuns: {}, exchanges: [], exchangeTurns: {}, agents: {}, questions: {}, prefs: {}, grants: {},
})

async function start(t, data = seed(), home = mkdtempSync(join(tmpdir(), 'flybot-domain-'))) {
  writeFileSync(join(home, 'state.json'), JSON.stringify(data))
  const ctx = fakeContext()
  Object.assign(ctx, { llm: { listProviders: () => [], listModels: async () => [] },
    workspaceRegistry: { get: () => undefined, archiveSession: async () => {} },
    sessionController: { resolveAgent: async () => ({ agent: undefined }) }, sessions: { flush: async () => {} },
  })
  const rt = createRuntime(ctx, { home })
  await rt.load()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  return { rt, home, ctx }
}

test('a created Task keeps its project when its Bot is rebound, updated and restarted', async t => {
  const { rt, home, ctx } = await start(t)
  const task = await rt.taskEndpoint('task-create', { botId: 'a', title: 'Implement feature' })
  assert.equal(task.projectId, 'p1')
  rt.bindProject({ kind: 'bot', id: 'a', projectId: 'p2' })
  await rt.taskEndpoint('task-update', { id: task.id, note: 'Retry with another execution context' })
  const saved = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.equal(saved.tasks[task.id].projectId, 'p1')
  assert.equal((await rt.projectBoard('p1')).rows[0].id, task.id)
  assert.equal((await rt.projectBoard('p2')).rows.length, 0)
  await assert.rejects(rt.taskEndpoint('task-update', { id: task.id, projectId: 'p2', title: 'Must not mutate' }), /project.*immutable/i)
  assert.equal(rt.state.tasks[task.id].title, 'Implement feature')
  await ctx.dispose()
  const restarted = await start(t, saved, home)
  assert.equal(restarted.rt.state.tasks[task.id].projectId, 'p1')
})

test('legacy task migration is durable and does not reinterpret later Bot bindings', async t => {
  const data = seed()
  data.tasks.old = { id: 'old', ownerBotId: 'a', title: 'Old', status: 'working', createdAt: 1 }
  const { rt, home } = await start(t, data)
  assert.equal(rt.state.tasks.old.projectId, 'p1')
  rt.bindProject({ kind: 'bot', id: 'a', projectId: 'p2' })
  await rt.save()
  assert.equal(JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).tasks.old.projectId, 'p1')
  assert.equal(rt.projects.migrateLegacy(), false)
})

test('conflicting legacy bindings remain explicitly unassigned with migration evidence', async t => {
  const data = seed()
  data.projectRuns['run-old'] = 'p2'
  data.tasks.old = { id: 'old', ownerBotId: 'a', runId: 'run-old', title: 'Ambiguous', status: 'working' }
  const { rt } = await start(t, data)
  assert.equal(rt.state.tasks.old.projectId, null)
  assert.equal(rt.state.tasks.old.projectResolution.reason, 'ambiguous')
  assert.deepEqual(rt.state.tasks.old.projectResolution.candidates, ['p1', 'p2'])
})

test('run and workspace ownership is direct, immutable and survives project deletion as history', async t => {
  const { rt, home } = await start(t)
  const workspace = await rt.projectEndpoint('project-workspace-create', { projectId: 'p1', path: home })
  assert.equal(workspace.workspace.projectId, 'p1')
  rt.bindProject({ kind: 'run', id: 'r1', projectId: 'p1', workspaceId: workspace.workspace.id })
  assert.equal(rt.state.projectExecutions.r1.projectId, 'p1')
  assert.throws(() => rt.bindProject({ kind: 'run', id: 'r1', projectId: 'p2' }), /immutable/i)
  await rt.projectEndpoint('project-delete', { id: 'p1' })
  assert.equal(rt.readProject('p1'), null)
  assert.equal(rt.projects.repository.get('p1', { includeDeleted: true }).status, 'deleted')
  assert.equal(rt.state.projectExecutions.r1.projectId, 'p1')
  assert.equal(rt.state.projectWorkspaces[workspace.workspace.id].projectId, 'p1')
})

test('archive refuses new work, deletion refuses unfinished work and preserves evidence', async t => {
  const { rt } = await start(t)
  const task = await rt.taskEndpoint('task-create', { botId: 'a', title: 'Keep evidence' })
  await rt.projectEndpoint('project-archive', { id: 'p1' })
  await assert.rejects(rt.taskEndpoint('task-create', { botId: 'a', title: 'Too late' }), /archived/i)
  await assert.rejects(rt.projectEndpoint('project-delete', { id: 'p1' }), /unfinished/i)
  await rt.taskEndpoint('task-cancel', { id: task.id })
  await rt.projectEndpoint('project-delete', { id: 'p1' })
  assert.equal(rt.state.tasks[task.id].projectId, 'p1')
})


test('cross-project execution references are refused before any binding is written', async t => {
  const { rt, home } = await start(t)
  const task = await rt.taskEndpoint('task-create', { botId: 'a', title: 'One project only' })
  const { workspace } = await rt.projectEndpoint('project-workspace-create', { projectId: 'p2', path: home })
  assert.throws(() => rt.bindProject({ kind: 'run', id: 'bad-task', projectId: 'p2', taskId: task.id }), /same Project/)
  assert.throws(() => rt.bindProject({ kind: 'run', id: 'bad-workspace', projectId: 'p1', workspaceId: workspace.id }), /same Project/)
  assert.equal(rt.state.projectExecutions['bad-task'], undefined)
  assert.equal(rt.state.projectExecutions['bad-workspace'], undefined)
  assert.throws(() => rt.flybot.projects.context(task.id, 'p2'), /same Project/)
  assert.deepEqual(rt.flybot.projects.context(task.id), { projectId: 'p1', taskId: task.id })
})

test('new project endpoints use authenticated human ownership, not body claims or AI roles', async t => {
  const { rt, home } = await start(t)
  rt.state.members.guest = { id: 'guest' }
  rt.state.bots.a.role = 'Owner'
  for (const [endpoint, body] of [
    ['project-archive', { id: 'p1' }], ['project-detail', { id: 'p1' }],
    ['project-workspace-create', { projectId: 'p1', path: home }],
  ]) await assert.rejects(rt.projectEndpoint(endpoint, { ...body, memberId: 'owner-1' }, { memberId: 'guest' }), /Only the owner/)
  assert.equal(rt.state.projects.p1.status, 'active')
  assert.deepEqual(rt.state.projectWorkspaces, {})
})

test('legacy provider import records every conflicting run and leaves board reads pure', async t => {
  const data = seed()
  data.tasks.old = { id: 'old', ownerBotId: 'a', status: 'working' }
  data.projectRuns = { r1: 'p1', r2: 'p2' }
  const { rt } = await start(t, data)
  rt.onProjectProvider(() => [{ taskId: 'old', runId: 'r1' }, { taskId: 'old', runId: 'r2' }])
  assert.equal(rt.state.tasks.old.projectId, null)
  assert.deepEqual(rt.state.tasks.old.projectResolution.candidates, ['p1', 'p2'])
  assert.deepEqual(rt.state.tasks.old.projectResolution.runIds, ['r1', 'r2'])
  const before = JSON.stringify(rt.state)
  await rt.projectBoard('p1')
  assert.equal(JSON.stringify(rt.state), before)
  assert.equal(rt.projects.importRunRefs(rt.projectRunRefs()), false)
})

test('removing a member refuses owned Projects and unfinished requests; history keeps attribution', async t => {
  const { rt } = await start(t)
  rt.state.members.member = { id: 'member' }
  rt.state.projects.p1.ownerUserId = 'member'
  assert.deepEqual(await rt.removeMember('member'), { ok: false, error: 'owns_projects' })
  rt.state.projects.p1.ownerUserId = 'owner-1'
  rt.state.projects.p1.roles = { maintainers: ['member'], members: [] }
  rt.state.tasks.history = { id: 'history', requesterId: 'member', projectId: 'p1', status: 'working' }
  assert.deepEqual(await rt.removeMember('member'), { ok: false, error: 'unfinished_tasks' })
  rt.state.tasks.history.status = 'accepted'
  assert.deepEqual(await rt.removeMember('member'), { ok: true })
  assert.deepEqual(rt.state.projects.p1.roles.maintainers, [])
  assert.equal(rt.state.tasks.history.requesterId, 'member')
})

test('unknown legacy Run activity blocks deletion until a terminal report arrives', async t => {
  const data = seed()
  data.projectRuns.legacy = 'p1'
  const { rt } = await start(t, data)
  await assert.rejects(rt.projectEndpoint('project-delete', { id: 'p1' }), /active Runs/)
  rt.bindProject({ kind: 'run', id: 'legacy', projectId: 'p1', status: 'done' })
  await rt.projectEndpoint('project-delete', { id: 'p1' })
  assert.equal(rt.state.projectExecutions.legacy.status, 'done')
})

test('rework and subtasks inherit durable parent ownership after routing is rebound', async t => {
  const { rt } = await start(t)
  const parent = await rt.taskEndpoint('task-create', { botId: 'a', title: 'Parent' })
  rt.bindProject({ kind: 'bot', id: 'a', projectId: 'p2' })
  const child = { id: 'child', ownerBotId: 'a', requesterId: 'owner-1', parentId: parent.id }
  rt.projects.stampTask(child)
  assert.equal(child.projectId, 'p1')
  const rework = { id: 'rework', ownerBotId: 'a', reworkOf: parent.id }
  rt.projects.stampTask(rework)
  assert.equal(rework.projectId, 'p1')
})
