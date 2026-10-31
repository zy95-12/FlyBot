import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { createProjectDelivery } from '../src/host/project-delivery.js'
import { fakeContext } from './fake-ctx.js'
import { createWorkflowService } from '../../plugins/workflow/src/service.js'

const alice = { memberId: 'owner-1' }
const bob = { memberId: 'bob' }
const git = (path, args) => execFileSync('git', args, { cwd: path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
async function setup(t, testCommand = [process.execPath, '--test', 'code.test.mjs']) {
  const directory = mkdtempSync(join(tmpdir(), 'flybot-delivery-'))
  const home = join(directory, 'home')
  const repository = join(directory, 'repo')
  mkdirSync(home); mkdirSync(repository)
  git(repository, ['init', '-b', 'main'])
  git(repository, ['config', 'user.name', 'Fixture'])
  git(repository, ['config', 'user.email', 'fixture@localhost'])
  writeFileSync(join(repository, 'code.mjs'), 'export const add = (a,b) => a-b;\n')
  writeFileSync(join(repository, 'code.test.mjs'), "import assert from 'node:assert/strict'; import {add} from './code.mjs'; assert.equal(add(2,3),5); assert.equal(add(-7,2),-5); assert.equal(add(11,13),24);\n")
  git(repository, ['add', '.']); git(repository, ['commit', '-m', 'Fixture base'])
  writeFileSync(join(home, 'state.json'), JSON.stringify({ version: 2, members: { 'owner-1': { id: 'owner-1' }, bob: { id: 'bob' } },
    bots: { a: { id: 'a', ownerId: 'owner-1', name: 'Chief', role: 'Chief', sessionId: 'a', projectId: 'p1' } }, mainBotIds: ['a'],
    projects: { p1: { id: 'p1', name: 'Code', status: 'active', ownerUserId: 'owner-1', repository: 'example/demo', defaultBranch: 'main', roles: { members: ['bob'], maintainers: [] }, createdAt: 1, updatedAt: 1 } }, tasks: {}, rooms: {}, projectRuns: {} }))
  const ctx = fakeContext()
  Object.assign(ctx, { llm: { listProviders: () => [], listModels: async () => [] }, workspaceRegistry: { get: () => undefined, archiveSession: async () => {} },
    sessionController: { resolveAgent: async () => ({ agent: undefined }) }, sessions: { flush: async () => {} } })
  const rt = createRuntime(ctx, { home, projectWorkbench: true, projectWorkspaceRoot: join(directory, 'execution'), projectRepositories: { 'example/demo': { path: repository, model: 'fixture/model', testCommand, allowedPaths: ['code.mjs', 'code.test.mjs'] } } })
  await rt.load()
  const published = []
  const publisher = { publish: async attempt => {
    const pr = { number: published.length + 1, sha: attempt.candidateSha, url: 'https://example.invalid/pr/1', repository: 'example/demo' }
    published.push(pr); return pr
  }, read: async pr => ({ sha: pr.sha, state: 'open' }) }
  rt.projectDelivery = createProjectDelivery(rt, { publisher })
  const workflow = createWorkflowService({ persist: false, readProject: id => rt.readProject(id),
    projectContext: (taskId, projectId) => rt.flybot.projects.context(taskId, projectId),
    bindRun: (id, projectId, details) => rt.flybot.projects.bindRun(id, projectId, details) })
  for (const [name, fn] of [['state', () => workflow.state()], ['create', body => workflow.create(body)], ['graph', body => workflow.saveGraph(body)], ['assign', body => workflow.assign(body)]]) rt.flybot.api.handle(`workflow/${name}`, fn, { read: name === 'state' })
  ctx.effect(() => () => workflow.dispose(), 'test workflow')
  t.after(async () => { await ctx.dispose(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }) })
  const task = await rt.taskEndpoint('task-create', { botId: 'a', projectId: 'p1', title: 'Fix addition', criteria: 'add(2,3) must equal 5' }, bob)
  const start = requestId => rt.projectEndpoint('project-task-run', { taskId: task.id, requestId }, bob)
  const attempt = () => Object.values(rt.state.projectAttempts).at(-1)
  const gate = (role, outputs = {}) => rt.projectDelivery.gate({ taskId: task.id, workflowId: attempt().workflowId, runId: attempt().runId, nodeId: role, outputs })
  return { rt, home, task, start, attempt, gate, repository, published, publisher }
}

async function implement(fixture) {
  writeFileSync(join(fixture.attempt().workspaces.developer.path, 'code.mjs'), 'export const add = (a,b) => a+b;\n')
  await fixture.gate('developer')
}
async function complete(fixture) {
  await implement(fixture)
  await fixture.gate('tester')
  await fixture.gate('reviewer', { review: JSON.stringify({ commit: fixture.attempt().candidateSha, verdict: 'approve', summary: 'Addition and coverage match the acceptance criteria' }) })
  fixture.rt.bindProject({ kind: 'run', id: fixture.attempt().runId, projectId: 'p1', status: 'done', taskId: fixture.task.id, attemptId: fixture.attempt().id })
}

test('delivery allocates three isolated worktrees and binds duplicate starts to one Attempt', async t => {
  const fixture = await setup(t)
  const first = await fixture.start('request-1')
  assert.equal(first.attempt.status, 'running', first.attempt.failure?.message)
  assert.equal((await fixture.start('request-1')).already, true)
  const paths = Object.values(first.attempt.workspaces).map(row => row.path)
  assert.equal(new Set(paths).size, 3)
  await implement(fixture)
  assert.match(readFileSync(join(fixture.repository, 'code.mjs'), 'utf8'), /a-b/)
  assert.equal(fixture.attempt().evidence.implementation.sha, git(paths[0], ['rev-parse', 'HEAD']))
})

test('only matching tests, independent Review, current PR head and an authorized human can accept', async t => {
  const fixture = await setup(t)
  await fixture.start('request-1')
  await complete(fixture)
  const attempt = fixture.attempt()
  assert.equal(attempt.status, 'waiting-acceptance')
  assert.equal(attempt.evidence.tests.sha, attempt.evidence.review.sha)
  assert.equal(attempt.pr.sha, attempt.candidateSha)
  assert.equal(fixture.rt.state.tasks[fixture.task.id].status, 'result-ready')
  await assert.rejects(fixture.rt.taskEndpoint('task-accept-result', { id: fixture.task.id }, alice), /commit-specific/)
  await assert.rejects(fixture.rt.projectEndpoint('project-task-accept', { attemptId: attempt.id }, bob), /access denied/)
  await fixture.rt.projectEndpoint('project-task-accept', { attemptId: attempt.id }, alice)
  assert.equal(attempt.status, 'accepted')
  assert.equal(fixture.rt.state.tasks[fixture.task.id].status, 'accepted')
  await fixture.rt.projectEndpoint('project-attempt-cleanup', { attemptId: attempt.id }, alice)
  assert.ok(Object.values(attempt.workspaces).every(row => row.status === 'released'))
})

test('failing tests retain evidence, cannot publish or accept, and a retry creates a new Attempt', async t => {
  const fixture = await setup(t, [process.execPath, '-e', 'process.exit(9)'])
  await fixture.start('request-1')
  await implement(fixture)
  await assert.rejects(fixture.gate('tester'), /tests failed/)
  const failed = fixture.attempt()
  assert.equal(failed.status, 'failed')
  assert.equal(failed.evidence.tests.passed, false)
  assert.equal(fixture.published.length, 0)
  fixture.rt.bindProject({ kind: 'run', id: failed.runId, projectId: 'p1', status: 'failed', taskId: fixture.task.id, attemptId: failed.id })
  await assert.rejects(fixture.rt.projectEndpoint('project-task-accept', { attemptId: failed.id }, alice), /not produced/)
  await fixture.start('request-2')
  assert.notEqual(fixture.attempt().id, failed.id)
  assert.equal(fixture.rt.state.projectAttempts[failed.id].evidence.tests.passed, false)
})

test('a changed candidate or PR head makes existing evidence stale', async t => {
  const fixture = await setup(t)
  await fixture.start('request-1')
  await complete(fixture)
  const attempt = fixture.attempt()
  fixture.publisher.read = async () => ({ sha: 'different-head', state: 'open' })
  await assert.rejects(fixture.rt.projectEndpoint('project-task-accept', { attemptId: attempt.id }, alice), /PR changed/)
  fixture.publisher.read = async pr => ({ sha: pr.sha, state: 'open' })
  writeFileSync(join(attempt.workspaces.developer.path, 'code.mjs'), 'export const add = () => 5;\n')
  await assert.rejects(fixture.rt.projectEndpoint('project-task-accept', { attemptId: attempt.id }, alice), /stale/)
  assert.notEqual(fixture.rt.state.tasks[fixture.task.id].status, 'accepted')
})

test('Review must name the exact tested commit; no output can replace a missing verdict', async t => {
  const fixture = await setup(t)
  await fixture.start('request-1')
  await implement(fixture)
  await fixture.gate('tester')
  await assert.rejects(fixture.gate('reviewer', { review: '{"verdict":"approve","commit":"wrong","summary":"looks good"}' }), /different commit/)
  assert.equal(fixture.attempt().status, 'failed')
  assert.equal(fixture.published.length, 0)
})


test('restart explicitly interrupts an unfinished Attempt and preserves its workspace/evidence history', async t => {
  const fixture = await setup(t)
  await fixture.start('request-1')
  await implement(fixture)
  const snapshot = JSON.parse(readFileSync(join(fixture.home, 'state.json'), 'utf8'))
  await fixture.rt.ctx.dispose()
  writeFileSync(join(fixture.home, 'state.json'), JSON.stringify(snapshot))
  const ctx = fakeContext()
  const restarted = createRuntime(ctx, fixture.rt.config)
  await restarted.load()
  const recovered = restarted.state.projectAttempts[fixture.attempt().id]
  assert.equal(recovered.status, 'interrupted')
  assert.equal(restarted.state.tasks[fixture.task.id].status, 'failed')
  assert.equal(recovered.evidence.implementation.sha, snapshot.projectAttempts[recovered.id].candidateSha)
  assert.equal(restarted.state.projectExecutions[recovered.runId].status, 'interrupted')
  assert.equal(restarted.projectDelivery.recover(), false)
  await ctx.dispose()
})

test('a code Task cannot be accepted through generic transitions before it has delivery evidence', async t => {
  const fixture = await setup(t)
  await assert.rejects(fixture.rt.taskEndpoint('task-update', { id: fixture.task.id, column: 'done' }, alice), /commit-specific/)
  assert.equal(fixture.rt.state.tasks[fixture.task.id].status, 'open')
})

test('cleanup refuses paths outside its owned root and independent Task worktrees do not share edits', async t => {
  const fixture = await setup(t)
  await fixture.start('request-1')
  const first = fixture.attempt()
  const other = await fixture.rt.taskEndpoint('task-create', { botId: 'a', projectId: 'p1', title: 'Another request' }, bob)
  await fixture.rt.projectEndpoint('project-task-run', { taskId: other.id, requestId: 'other-1' }, bob)
  const second = fixture.attempt()
  assert.notEqual(first.workspaces.developer.path, second.workspaces.developer.path)
  writeFileSync(join(first.workspaces.developer.path, 'code.mjs'), 'changed only in the first worktree')
  assert.match(readFileSync(join(second.workspaces.developer.path, 'code.mjs'), 'utf8'), /a-b/)
  second.status = 'failed'
  second.workspaces.developer.path = fixture.repository
  await assert.rejects(fixture.rt.projectEndpoint('project-attempt-cleanup', { attemptId: second.id }, alice), /owned delivery root/)
  assert.match(readFileSync(join(fixture.repository, 'code.mjs'), 'utf8'), /a-b/)
})

test('repository path policy blocks unexpected files before a candidate can be published', async t => {
  const fixture = await setup(t)
  await fixture.start('request-1')
  writeFileSync(join(fixture.attempt().workspaces.developer.path, 'unexpected.txt'), 'outside the task paths')
  await assert.rejects(fixture.gate('developer'), /provisioned repository paths/)
  assert.equal(fixture.attempt().status, 'failed')
  assert.equal(fixture.published.length, 0)
})


test('duplicate role results reuse sealed evidence without resetting another role worktree', async t => {
  const fixture = await setup(t)
  await fixture.start('request-1')
  await implement(fixture)
  const attempt = fixture.attempt()
  const testerFile = join(attempt.workspaces.tester.path, 'inspection.txt')
  writeFileSync(testerFile, 'tester work in progress')
  const replay = await fixture.gate('developer')
  assert.equal(replay.already, true)
  assert.equal(readFileSync(testerFile, 'utf8'), 'tester work in progress')
  await fixture.gate('tester')
  assert.equal((await fixture.gate('tester')).already, true)
})


test('managed delivery definitions and role/model snapshots cannot be edited or reset in place', async t => {
  const fixture = await setup(t)
  await fixture.start('request-1')
  const attempt = fixture.attempt()
  assert.equal(attempt.workflowDefinition.nodes[0].model, 'fixture/model')
  for (const operation of ['graph', 'set-model', 'concurrency', 'reset', 'delete']) await assert.rejects(fixture.rt.projectEndpoint('project-workflow', { projectId: 'p1', workflowId: attempt.workflowId, operation, nodes: [] }, alice), /immutable/)
  assert.equal(attempt.workflowVersion, 'project-delivery/v1')
})
