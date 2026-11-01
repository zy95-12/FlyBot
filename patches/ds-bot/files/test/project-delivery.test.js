import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { roleExecutionPrompt } from '../src/host/project-role-policy.js'
import { createProjectDelivery } from '../src/host/project-delivery.js'
import { fakeContext } from './fake-ctx.js'
import { apply as applyWorkflow } from '../../plugins/workflow/index.js'
import { createWorkflowService } from '../../plugins/workflow/src/service.js'

const alice = { memberId: 'owner-1' }
const bob = { memberId: 'bob' }
const git = (path, args) => execFileSync('git', args, { cwd: path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
async function setup(t, testCommand = [process.execPath, '--test', 'code.test.mjs'], { sdkContract = false, pool = false } = {}) {
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
  const rt = createRuntime(ctx, { home, projectWorkbench: true, projectDispatch: pool ? 'pools' : 'workflow', projectWorkspaceRoot: join(directory, 'execution'), projectRepositories: { 'example/demo': { path: repository, model: 'fixture/model', testCommand, allowedPaths: ['code.mjs', 'code.test.mjs'] } } })
  await rt.load()
  const published = []
  const publisher = { publish: async attempt => {
    const pr = { number: attempt.publicationBinding?.number ?? published.length + 1, sha: attempt.candidateSha, url: 'https://example.invalid/pr/1', repository: 'example/demo' }
    published.push(pr); return pr
  }, read: async pr => ({ sha: pr.sha, state: 'open', baseRef: 'main', baseSha: git(repository, ['rev-parse', 'main']) }) }
  rt.projectDelivery = createProjectDelivery(rt, { publisher })
  let workflow
  if (sdkContract) { ctx.flybot = rt.flybot; workflow = applyWorkflow(ctx, { persist: false }).service }
  else {
    workflow = createWorkflowService({ persist: false, readProject: id => rt.readProject(id),
    projectContext: (taskId, projectId) => rt.flybot.projects.context(taskId, projectId),
    bindRun: (id, projectId, details) => rt.flybot.projects.bindRun(id, projectId, details) })
  for (const [name, fn] of [['state', () => workflow.state()], ['create', body => workflow.create(body)], ['graph', body => workflow.saveGraph(body)], ['assign', body => workflow.assign(body)]]) rt.flybot.api.handle(`workflow/${name}`, fn, { read: name === 'state' })
  ctx.effect(() => () => workflow.dispose(), 'test workflow')
  }
  t.after(async () => { await ctx.dispose(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }) })
  const task = await rt.taskEndpoint('task-create', { botId: 'a', projectId: 'p1', title: 'Fix addition', criteria: 'add(2,3) must equal 5' }, bob)
  const start = requestId => rt.projectEndpoint('project-task-run', { taskId: task.id, requestId }, bob)
  const attempt = () => Object.values(rt.state.projectAttempts).at(-1)
  const gate = (role, outputs = {}) => rt.projectDelivery.gate({ taskId: task.id, workflowId: attempt().workflowId, runId: attempt().runId, nodeId: role, outputs })
  return { rt, home, task, start, attempt, gate, repository, published, publisher, workflow, directory }
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
  assert.equal(attempt.workflowVersion, 'project-delivery/v4')
})


test('only managers stop one delivery Run and failed Worker release retains its capacity', async t => {
  const fixture = await setup(t)
  await fixture.start('stop-one')
  const { rt } = fixture, attempt = fixture.attempt()
  let resets = 0
  rt.flybot.api.handle('workflow/reset', body => {
    assert.equal(body.runId, attempt.runId)
    assert.equal(body.workflowId, attempt.workflowId)
    resets++
    return { ok: true }
  })
  rt.state.bots.worker = { id: 'worker', projectId: 'p1', ephemeral: { plugin: 'workflow' }, attemptId: attempt.id }
  await assert.rejects(rt.projectEndpoint('project-attempt-stop', { attemptId: attempt.id }, bob), /denied/)
  const stopping = await rt.projectEndpoint('project-attempt-stop', { attemptId: attempt.id }, alice)
  assert.equal(stopping.stopping, true)
  assert.equal(rt.projectScheduler.slots('p1'), 1)
  await assert.rejects(fixture.gate('developer'), /stopped/)
  delete rt.state.bots.worker
  const stopped = await rt.projectEndpoint('project-attempt-stop', { attemptId: attempt.id }, alice)
  assert.equal(stopped.attempt.status, 'cancelled')
  assert.equal(resets, 2)
})


test('human return preserves old evidence and retry can only accept its own newly verified commit', async t => {
  const fixture = await setup(t)
  await fixture.start('before-return')
  await complete(fixture)
  const old = structuredClone(fixture.attempt())
  assert.match(old.evidence.implementation.diffStat, /code\.mjs/)
  for (const nodeId of ['developer', 'tester', 'reviewer']) fixture.workflow.advance({ workflowId: old.workflowId, runId: old.runId, nodeId, outcome: 'done' })
  await assert.rejects(fixture.rt.projectEndpoint('project-task-reject', { attemptId: old.id, reason: 'Add negative cases' }, bob), /denied/)
  await fixture.rt.projectEndpoint('project-task-reject', { attemptId: old.id, reason: 'Add negative cases' }, alice)
  assert.equal(fixture.rt.state.projectAttempts[old.id].status, 'failed')
  assert.equal(fixture.rt.state.projectAttempts[old.id].evidence.tests.sha, old.candidateSha)
  const retry = await fixture.start('after-return')
  assert.equal(retry.attempt.status, 'running', retry.attempt.failure?.message)
  assert.equal(retry.attempt.feedback.previousAttemptId, old.id)
  assert.equal(retry.attempt.feedback.reason, 'Add negative cases')
  assert.match(fixture.rt.projectDelivery.context(fixture.task.id).brief, /Add negative cases/)
  await complete(fixture)
  const next = fixture.attempt()
  assert.notEqual(next.id, old.id)
  assert.notEqual(next.workspaces.developer.path, old.workspaces.developer.path)
  await assert.rejects(fixture.rt.projectEndpoint('project-task-accept', { attemptId: old.id }, alice), /evidence/)
  await fixture.rt.projectEndpoint('project-task-accept', { attemptId: next.id }, alice)
  assert.equal(next.status, 'accepted')
  assert.equal(fixture.rt.state.tasks[fixture.task.id].status, 'accepted')
  assert.equal(fixture.rt.state.projectAttempts[old.id].status, 'failed')
})


test('temporary role context freezes memory, repository instructions and session ownership', async t => {
  const fixture = await setup(t)
  writeFileSync(join(fixture.repository, 'AGENTS.md'), 'Repository rule: verify negative inputs')
  git(fixture.repository, ['add', 'AGENTS.md']); git(fixture.repository, ['commit', '-m', 'Repository instructions'])
  const saved = await fixture.rt.projectEndpoint('project-role-memory-write', { projectId: 'p1', role: 'developer', text: 'Preserve input precision', source: { kind: 'human', reference: 'explicit published rule' } }, alice)
  await fixture.rt.projectEndpoint('project-agent-definition', { projectId: 'p1', role: 'developer', memoryRefs: [saved.memory.id] }, alice)
  await fixture.start('session-first')
  const first = fixture.attempt()
  const descriptor = first.roleSessions.developer
  assert.match(roleExecutionPrompt('Work', descriptor), /Repository rule: verify negative inputs/)
  assert.match(descriptor.context.text, /complete-policy-reference/)
  assert.match(descriptor.context.text, /Preserve input precision/)
  assert.match(descriptor.context.text, /add\(2,3\) must equal 5/)
  assert.equal(descriptor.attemptId, first.id)
  const worker = { id: 'worker-test', sessionId: 'worker-session' }
  await fixture.rt.projectDelivery.bindSession(first.workspaces.developer, worker)
  assert.equal(descriptor.sessionId, worker.sessionId)
  await assert.rejects(fixture.rt.projectDelivery.bindSession(first.workspaces.developer, { id: 'another', sessionId: 'another-session' }), /already bound/)
  await fixture.rt.projectDelivery.releaseSession(worker.id)
  assert.equal(descriptor.status, 'released')
  await assert.rejects(fixture.rt.projectDelivery.bindSession(first.workspaces.developer, worker), /released/)
  await fixture.rt.projectEndpoint('project-agent-definition', { projectId: 'p1', role: 'developer', instructions: 'New persona' }, alice)
  assert.doesNotMatch(descriptor.context.text, /New persona/)
  fixture.rt.bindProject({ kind: 'run', id: first.runId, projectId: 'p1', status: 'failed', taskId: fixture.task.id, attemptId: first.id })
  await fixture.start('session-second')
  assert.notEqual(fixture.attempt().roleSessions.developer.id, descriptor.id)
  assert.match(fixture.attempt().roleSessions.developer.context.text, /New persona/)
  assert.match(fixture.attempt().roleSessions.developer.context.text, /previousAttemptId/)
})


test('host sealing collapses worker intermediate history before candidate handoff', async t => {
  const fixture = await setup(t)
  await fixture.start('collapse-worker-history')
  const attempt = fixture.attempt(), cwd = attempt.workspaces.developer.path
  writeFileSync(join(cwd, 'intermediate-only.txt'), 'Do not transfer transient worker content')
  git(cwd, ['add', '.']); git(cwd, ['-c', 'user.name=Worker', '-c', 'user.email=worker@localhost', 'commit', '-m', 'Transient worker checkpoint'])
  rmSync(join(cwd, 'intermediate-only.txt'))
  writeFileSync(join(cwd, 'code.mjs'), 'export const add=(a,b)=>a+b;\n')
  git(cwd, ['add', '-A']); git(cwd, ['-c', 'user.name=Worker', '-c', 'user.email=worker@localhost', 'commit', '-m', 'Final worker code'])
  await fixture.gate('developer')
  assert.equal(git(cwd, ['rev-list', '--count', `${attempt.baseSha}..${attempt.candidateSha}`]), '1')
  assert.equal(git(cwd, ['rev-parse', `${attempt.candidateSha}^`]), attempt.baseSha)
  assert.deepEqual(attempt.evidence.implementation.paths, ['code.mjs'])
})

test('SDK role completion requires matching sealed event evidence, and tampering blocks later gates', async t => {
  const fixture = await setup(t)
  await fixture.start('sdk-evidence')
  const attempt = fixture.attempt(), session = attempt.roleSessions.developer
  session.execution.harness = 'codex'; session.botId = 'sdk-worker'; session.backendSessionId = 'thread'; session.resourceLease = { generation: 1 }
  writeFileSync(join(attempt.workspaces.developer.path, 'code.mjs'), 'export const add=(a,b)=>a+b;\n')
  await assert.rejects(fixture.gate('developer'), /SDK execution evidence/)
  const log = join(fixture.home, 'sealed-sdk.jsonl'), text = '{"type":"completed","sessionId":"thread"}\n'
  writeFileSync(log, text)
  const row = { id: 'sdk-worker', projectId: 'p1', taskId: fixture.task.id, attemptId: attempt.id, role: 'developer', sessionKey: session.id, generation: 1, backendSessionId: 'thread', harness: 'codex', sdkVersion: '0.166.0', resourceId: 'local', sealedLog: log, eventSha256: createHash('sha256').update(text).digest('hex'), resultHash: 'result-hash' }
  await assert.rejects(fixture.rt.projectDelivery.recordExecution({ ...row, projectId: 'foreign' }), /does not belong/)
  await fixture.rt.projectDelivery.recordExecution(row)
  await fixture.gate('developer')
  writeFileSync(log, 'tampered events')
  await assert.rejects(fixture.gate('tester'), /SDK execution evidence/)
  assert.equal(fixture.published.length, 0)
})

test('workspace cleanup refuses orphan native workers and unknown SDK leases after a terminal Run', async t => {
  const fixture = await setup(t)
  await fixture.start('cleanup-worker-proof')
  const attempt = fixture.attempt()
  fixture.rt.bindProject({ kind: 'run', id: attempt.runId, projectId: 'p1', status: 'failed', taskId: fixture.task.id, attemptId: attempt.id })
  fixture.rt.state.bots.orphan = { id: 'orphan', ephemeral: { plugin: 'workflow' }, attemptId: attempt.id }
  await assert.rejects(fixture.rt.projectEndpoint('project-attempt-cleanup', { attemptId: attempt.id }, alice), /Native worker release/)
  delete fixture.rt.state.bots.orphan
  fixture.rt.state.projectResourceLeases = { unknown: { attemptId: attempt.id, status: 'unreachable' } }
  await assert.rejects(fixture.rt.projectEndpoint('project-attempt-cleanup', { attemptId: attempt.id }, alice), /resource release/)
  fixture.rt.state.projectResourceLeases.unknown.status = 'released'
  await fixture.rt.projectEndpoint('project-attempt-cleanup', { attemptId: attempt.id }, alice)
})


test('existing Workflow executes three SDK contract workers through seal/test/review/accept and releases every lease', async t => {
  const fixture = await setup(t, undefined, { sdkContract: true })
  const { rt, directory } = fixture, runtimeDir = join(directory, 'contract-runtime')
  writeFileSync(join(fixture.repository, 'AGENTS.md'), 'Complete policy.\n'.repeat(500) + '\nSDK_MODEL_POLICY_TAIL\n')
  git(fixture.repository, ['add', '.']); git(fixture.repository, ['commit', '-m', 'Complete runtime policy'])
  mkdirSync(join(runtimeDir, 'src/host'), { recursive: true })
  writeFileSync(join(runtimeDir, 'src/host/project-harness-worker.mjs'), `
import {createInterface} from 'node:readline';import{writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';
const write=v=>process.stdout.write(JSON.stringify(v)+'\\n');write({type:'ready',sdk:{codex:'0.166.0','claude-agent':'0.3.316'}});
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
if(m.type==='stop'){write({type:'stopped',released:true});setTimeout(()=>process.exit(0),20);return;}
if(m.type!=='start')return;
if(!m.prompt.includes('project-role-context/v1') || !m.prompt.includes('project-role-policy/v1') || !m.prompt.includes('SDK_MODEL_POLICY_TAIL')){write({type:'failure',reason:'Missing model-visible role context'});return;}
let text;if(!m.settings.readOnly){writeFileSync('code.mjs','export const add=(a,b)=>a+b;\\n');text='OUTPUT implementation: fixed addition';}
else if(m.prompt.includes('Independently review the candidate diff')){const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();text='OUTPUT review: '+JSON.stringify({commit,verdict:'approve',summary:'Contract reviewer inspected the exact candidate'});}
else text='OUTPUT tests: inspected the committed tests';
write({type:'sdk-event',event:{type:'thread.started',thread_id:'contract-'+process.pid}});
write({type:'completed',sessionId:'contract-'+process.pid,text,usage:{input_tokens:1}});
});`)
  rt.config.projectResources = { execution: { type: 'local', root: directory, runtimeDir, capacity: 3, allowedProjectOwnerIds: ['owner-1'], harnesses: ['codex', 'claude-agent'],
    profiles: { 'owner-1': { codex: { home: join(directory, 'codex-home'), configDir: join(directory, 'codex-config'), model: 'contract-model' }, 'claude-agent': { home: join(directory, 'claude-home'), configDir: join(directory, 'claude-config'), model: 'contract-model' } } } } }
  rt.state.projectResourceHealth = { execution: { status: 'ready', at: Date.now() } }
  rt.state.projectHarnessHealth = { 'p1:execution:codex': { status: 'ready' }, 'p1:execution:claude-agent': { status: 'ready' } }
  for (const role of ['developer', 'tester', 'reviewer']) await rt.projectEndpoint('project-agent-definition', { projectId: 'p1', role, execution: { harness: role === 'developer' ? 'codex' : 'claude-agent', resourceIds: ['execution'] } }, alice)
  const started = await fixture.start('full-sdk-contract')
  assert.equal(started.attempt.status, 'running', started.attempt.failure?.message)
  for (let n = 0; n < 400; n++) { if (['waiting-acceptance', 'failed'].includes(fixture.attempt().status) && Object.values(rt.state.projectHarnessWorkers ?? {}).every(row => row.status === 'released')) break; await new Promise(resolve => setTimeout(resolve, 15)) }
  const attempt = fixture.attempt()
  assert.equal(attempt.status, 'waiting-acceptance', attempt.failure?.message)
  assert.equal(rt.state.projectExecutions[attempt.runId].status, 'done')
  assert.equal(Object.keys(attempt.evidence.execution).length, 3)
  assert.equal(attempt.evidence.tests.passed, true)
  assert.equal(attempt.evidence.tests.sha, attempt.evidence.review.sha)
  assert.equal(rt.projectResources.occupied('execution'), 0)
  assert.ok(Object.values(rt.state.projectHarnessWorkers).every(row => row.status === 'released'))
  await rt.projectEndpoint('project-task-accept', { attemptId: attempt.id }, alice)
  assert.equal(attempt.status, 'accepted')
  await rt.projectEndpoint('project-attempt-cleanup', { attemptId: attempt.id }, alice)
})

test('repository preflight rejects a missing path allowlist before any execution allocation', async t => {
  const fixture = await setup(t)
  delete fixture.rt.config.projectRepositories['example/demo'].allowedPaths
  await assert.rejects(fixture.start('missing-allowlist'), /allowedPaths/)
  assert.equal(Object.keys(fixture.rt.state.projectAttempts ?? {}).length, 0)
  assert.equal(Object.keys(fixture.rt.state.projectWorkspaces ?? {}).length, 0)
  assert.equal(Object.keys(fixture.rt.state.projectResourceLeases ?? {}).length, 0)
  assert.equal(fixture.rt.state.tasks[fixture.task.id].status, 'open')
})

test('repository preflight rejects an unavailable test runtime before model execution', async t => {
  const fixture = await setup(t)
  fixture.rt.config.projectRepositories['example/demo'].testCommand = ['/missing/flybot-test-runtime']
  await assert.rejects(fixture.start('missing-runtime'), /testCommand/)
  assert.equal(Object.keys(fixture.rt.state.projectAttempts ?? {}).length, 0)
  assert.equal(Object.keys(fixture.rt.state.projectWorkspaces ?? {}).length, 0)
})

test('candidate seal distinguishes no change and refuses a changed symbolic link leaving its workspace', async t => {
  const fixture = await setup(t)
  await fixture.start('no-change')
  await assert.rejects(fixture.gate('developer'), /no code change/)
  const symlink = await setup(t)
  await symlink.start('symlink')
  const file = join(symlink.attempt().workspaces.developer.path, 'code.mjs')
  const fs = await import('node:fs')
  fs.rmSync(file); fs.symlinkSync(join(symlink.repository, 'outside'), file)
  fs.writeFileSync(join(symlink.repository, 'outside'), 'private outside file')
  await assert.rejects(symlink.gate('developer'), /symbolic link outside/)
  assert.equal(fixture.published.length, 0)
})

test('complete role policy reaches the execution prompt and remains pinned to its source commit', async t => {
  const fixture = await setup(t)
  const fs = await import('node:fs')
  fs.mkdirSync(join(fixture.repository, '.claude/skills/review-pr'), { recursive: true })
  writeFileSync(join(fixture.repository, 'AGENTS.md'), 'Policy preamble.\n'.repeat(500) + '\nREQUIRED_END_OF_FULL_POLICY\n')
  writeFileSync(join(fixture.repository, '.claude/skills/review-pr/SKILL.md'), 'FULL_REVIEW_PROTOCOL: use Ran and Not run at the exact tip.')
  git(fixture.repository, ['add', '.']); git(fixture.repository, ['commit', '-m', 'Policy sources'])
  await fixture.start('full-policy')
  const attempt = fixture.attempt()
  assert.ok(attempt.rolePolicies?.developer?.text.includes('REQUIRED_END_OF_FULL_POLICY'), 'Do not truncate governing rules at the old 6000-character preview limit')
  assert.ok(attempt.rolePolicies.reviewer.text.includes('FULL_REVIEW_PROTOCOL'))
  assert.equal(attempt.rolePolicies.developer.sources.find(row => row.name === 'AGENTS.md').sha256, createHash('sha256').update(readFileSync(join(fixture.repository, 'AGENTS.md'))).digest('hex'))
  assert.equal(attempt.rolePolicies.developer.commit, attempt.baseSha)
  assert.equal(attempt.roleSessions.developer.context.sources.policy.sha256, attempt.rolePolicies.developer.sha256)
  assert.ok(roleExecutionPrompt(attempt.workflowDefinition.nodes.find(node => node.id === 'developer').prompt, attempt.roleSessions.developer).includes('REQUIRED_END_OF_FULL_POLICY'), 'The runtime prompt, not only stored metadata, must carry the full policy')
  let nativeInput
  fixture.rt.createBot = async input => {
    nativeInput = input
    const bot = { id: 'native-policy-worker', sessionId: 'native-policy-session', ...input }
    fixture.rt.state.bots[bot.id] = bot
    return bot
  }
  await fixture.rt.flybot.scope('policy-test').bot.create({ name: 'Native policy worker', ephemeral: true, executionProjectId: 'p1', executionWorkDir: attempt.workspaces.developer.path, instructions: 'Cleaned short node prompt' })
  assert.match(nativeInput.systemPrompt, /REQUIRED_END_OF_FULL_POLICY/)
  assert.match(nativeInput.instructions, /project-role-policy\/v1/)
  await implement(fixture)
  attempt.rolePolicies.reviewer.text += 'changed rules'
  await assert.rejects(fixture.gate('tester'), /policy evidence/)
})

test('a required role convention source cannot silently disappear', async t => {
  const fixture = await setup(t)
  fixture.rt.config.projectRepositories['example/demo'].requiredRolePolicySources = { developer: ['MISSING_POLICY.md'] }
  const started = await fixture.start('required-policy')
  assert.equal(started.attempt.status, 'failed')
  assert.match(started.attempt.failure.message, /Required role policy source/)
  assert.equal(Object.keys(fixture.rt.state.projectHarnessWorkers ?? {}).length, 0)
})


test('default per-Bot pools execute a non-DAG SDK return/rework path with one resource and Chief completion inbox', async t => {
  const fixture = await setup(t, undefined, { sdkContract: true, pool: true })
  const { rt, directory } = fixture, runtimeDir = join(directory, 'pool-runtime')
  mkdirSync(join(runtimeDir, 'src/host'), { recursive: true })
  writeFileSync(join(runtimeDir, 'src/host/project-harness-worker.mjs'), `
import{createInterface}from'node:readline';import{writeFileSync,readFileSync}from'node:fs';import{execFileSync}from'node:child_process';
const write=v=>process.stdout.write(JSON.stringify(v)+'\\n');write({type:'ready',sdk:{codex:'0.166.0'}});
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
if(m.type==='stop'){write({type:'stopped',released:true});setTimeout(()=>process.exit(0),20);return;}if(m.type!=='start')return;
const code=readFileSync('code.mjs','utf8');let decision;
if(!m.settings.readOnly){
const rework=code.includes('stage-one');writeFileSync('code.mjs',rework?'export const add=(a,b)=>a+b;\\n':'export const add=(a,b)=>a+b; // stage-one\\n');
if(rework)writeFileSync('code.test.mjs',readFileSync('code.test.mjs','utf8')+'assert.equal(add(-4.5,0),-4.5);\\n');
decision={action:'handoff',to:'p1:reviewer',reason:rework?'Regression added; run tests':'Review before testing',outputs:{implementation:'Fixed addition'}};
}else if(m.prompt.includes('(project-role-policy/v1, reviewer)')){
if(code.includes('stage-one'))decision={action:'return',to:'p1:developer',reason:'Add fractional negative-zero regression before further verification'};
else if(!m.prompt.includes('\"passed\":true'))decision={action:'transfer',to:'p1:tester',reason:'Run tests before final review'};\nelse decision={action:'complete',reason:'Candidate matches criteria; request Chief judgement',outputs:{review:JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),verdict:'approve',summary:'Inspected exact candidate and regression'})}};
}else decision={action:'handoff',to:'p1:reviewer',reason:'Host tests should verify this candidate',outputs:{tests:'Inspected regression'}};
write({type:'sdk-event',event:{type:'thread.started',thread_id:'pool-'+process.pid}});write({type:'completed',sessionId:'pool-'+process.pid,text:'OUTPUT handoff: '+JSON.stringify(decision),usage:{input_tokens:1}});
});`)
  rt.config.projectResources = { one: { type: 'local', root: directory, runtimeDir, capacity: 1, allowedProjectOwnerIds: ['owner-1'], harnesses: ['codex'], profiles: { 'owner-1': { codex: { home: join(directory, 'sdk-home'), configDir: join(directory, 'sdk-config'), model: 'contract-model' } } } } }
  rt.state.projectResourceHealth = { one: { status: 'ready', at: Date.now() } }
  rt.state.projectHarnessHealth = { 'p1:one:codex': { status: 'ready' } }
  for (const role of ['developer', 'tester', 'reviewer']) await rt.projectEndpoint('project-agent-definition', { projectId: 'p1', role, execution: { harness: 'codex', resourceIds: ['one'] } }, alice)
  const started = await fixture.start('dynamic-pool')
  assert.ok(started.attempt, `One free resource must admit only the receiving role, instead of reserving the full DAG: ${JSON.stringify(started.queue)}`)
  assert.equal(started.attempt.status, 'running', started.attempt.failure?.message)
  assert.equal(started.attempt.workflowId, undefined)
  assert.equal(Object.keys(started.attempt.workspaces).length, 0)
  assert.equal(rt.projectResources.occupied('one'), 0)
  for (let n = 0; n < 400; n++) {
    await rt.projectPools.pump()
    if (['arbitration', 'blocked'].includes(rt.state.tasks[fixture.task.id].collaboration.status)) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(rt.state.tasks[fixture.task.id].collaboration.status, 'arbitration', JSON.stringify(rt.state.tasks[fixture.task.id].collaboration.block))
  assert.deepEqual(rt.state.tasks[fixture.task.id].collaboration.history.map(row => row.to), ['p1:developer', 'p1:reviewer', 'p1:developer', 'p1:reviewer', 'p1:tester', 'p1:reviewer', 'p1:chief'])
  assert.equal(Object.values(rt.state.projectAttempts).length, 2)
  assert.equal(Object.values(rt.state.tasks).filter(row => row.projectId === 'p1').length, 1)
  assert.equal(rt.projectResources.occupied('one'), 0)
  assert.equal(Object.values(rt.state.projectAttempts)[0].status, 'returned')
  assert.equal(fixture.attempt().evidence.tests.passed, true)
  const reviewLogs = Object.values(rt.state.projectHarnessWorkers).filter(row => row.role === 'reviewer').map(row => row.sealedLog)
  assert.equal(new Set(reviewLogs).size, 3, 'Revisited role Sessions must retain distinct immutable SDK logs')
  assert.equal(fixture.attempt().roleSessionHistory.length, 1)
  assert.equal(fixture.attempt().status, 'waiting-acceptance', JSON.stringify(rt.state.tasks[fixture.task.id].collaboration.history.at(-1)))
  assert.equal(fixture.workflow.state().workflows.filter(row => row.projectId === 'p1').length, 0)
  await assert.rejects(rt.projectEndpoint('project-task-accept', { attemptId: fixture.attempt().id }, alice), /Chief arbitration/)
})

test('a Chief SDK contract process returns incomplete coverage then closes the same Task after a fresh Attempt', async t => {
  const fixture = await setup(t, undefined, { sdkContract: true, pool: true })
  const { rt, directory } = fixture, runtimeDir = join(directory, 'chief-contract-runtime')
  mkdirSync(join(runtimeDir, 'src/host'), { recursive: true })
  writeFileSync(join(runtimeDir, 'src/host/project-harness-worker.mjs'), `
import{createInterface}from'node:readline';import{writeFileSync,readFileSync}from'node:fs';import{execFileSync}from'node:child_process';
const write=v=>process.stdout.write(JSON.stringify(v)+'\\n');write({type:'ready',sdk:{codex:'0.166.0'}});
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='stop'){write({type:'stopped',released:true});setTimeout(()=>process.exit(0),20);return;}if(m.type!=='start')return;
let text;if(m.settings.noTools){const context=JSON.parse(m.prompt.split('<untrusted-role-context>\\n')[1].split('\\n</untrusted-role-context>')[0]);const missing=!context.projectFacts.tasks[0].evidence.implementation.paths.includes('code.test.mjs');text=JSON.stringify({summary:'Chief checked exact candidate and requested fractional regression before closure',decisions:[{taskId:${JSON.stringify(fixture.task.id)},action:missing?'return':'close',targetBotId:'p1:developer',reason:missing?'Add the explicit fractional regression required by acceptance criteria':'Requested code fix and draft delivery evidence are complete',criteria:[{criterion:context.projectFacts.tasks[0].criteria,passed:true,evidence:'Matching host test SHA, sealed SDK review and open candidate PR'}]}]});}
else if(!m.settings.readOnly){if(readFileSync('code.mjs','utf8').includes('a+b'))writeFileSync('code.test.mjs',readFileSync('code.test.mjs','utf8')+'assert.equal(add(-4.5,1.5),-3);\\n');writeFileSync('code.mjs','export const add=(a,b)=>a+b;\\n');text='OUTPUT handoff: '+JSON.stringify({action:'handoff',to:'p1:tester',reason:'Implementation ready for tests',outputs:{implementation:'Fixed addition'}});}
else if(m.prompt.includes('(project-role-policy/v1, reviewer)')){text='OUTPUT handoff: '+JSON.stringify({action:'complete',reason:'Request Chief final judgement',outputs:{review:JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),verdict:'approve',summary:'Reviewed exact candidate'})}});}
else text='OUTPUT handoff: '+JSON.stringify({action:'handoff',to:'p1:reviewer',reason:'Configured tests will verify candidate',outputs:{tests:'Inspect actual host result'}});
write({type:'sdk-event',event:{type:'thread.started',thread_id:'chief-contract-'+process.pid}});write({type:'completed',sessionId:'chief-contract-'+process.pid,text,usage:{input_tokens:1}});
});`)
  rt.config.projectResources = { one: { type: 'local', root: directory, runtimeDir, capacity: 1, allowedProjectOwnerIds: ['owner-1'], harnesses: ['codex'], profiles: { 'owner-1': { codex: { home: join(directory, 'chief-sdk-home'), configDir: join(directory, 'chief-sdk-config'), model: 'contract-model' } } } } }
  rt.state.projectResourceHealth = { one: { status: 'ready', at: Date.now() } }; rt.state.projectHarnessHealth = { 'p1:one:codex': { status: 'ready' } }
  for (const role of ['chief', 'developer', 'tester', 'reviewer']) await rt.projectEndpoint('project-agent-definition', { projectId: 'p1', role, execution: { harness: 'codex', resourceIds: ['one'] } }, alice)
  rt.state.projectAgents ??= {}
  rt.state.projectAgents['public-p1'] = { id: 'public-p1', projectId: 'p1', visibility: 'public', memberId: null, botId: 'a', sessionId: 'a', carrierGeneration: 1 }
  rt.state.bots.a.projectAgent = { id: 'public-p1', visibility: 'public', memberId: null }; rt.readProject('p1').chief = { botId: 'a', sessionId: 'a' }
  await rt.projectEndpoint('project-chief-configure', { projectId: 'p1', enabled: true, inspection: { enabled: false } }, alice)
  rt.state.tasks[fixture.task.id].criteria += '; include an explicit fractional regression test'
  await fixture.start('chief-final-accept')
  for (let n = 0; n < 500; n++) {
    await rt.projectPools.pump(); await rt.projectChiefControl.pump()
    const task = rt.state.tasks[fixture.task.id]
    if (task.status === 'accepted' && rt.projectResources.occupied('one') === 0 || task.collaboration.status === 'blocked') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const task = rt.state.tasks[fixture.task.id], chiefRuns = Object.values(rt.state.projectExecutions).filter(run => run.kind === 'chief-control')
  assert.equal(task.status, 'accepted', JSON.stringify({ block: task.collaboration.block, chiefRuns }))
  assert.equal(fixture.attempt().status, 'accepted')
  assert.equal(task.collaboration.status, 'closed')
  assert.equal(task.collaboration.history.at(-1).status, 'completed')
  assert.ok(fixture.attempt().acceptedViaChief)
  assert.equal(rt.projectResources.occupied('one'), 0)
  assert.equal(chiefRuns.length, 2)
  assert.equal(Object.values(rt.state.projectAttempts).length, 2)
  assert.ok(chiefRuns.every(run => run.status === 'done'))
  assert.equal(chiefRuns[0].executionEvidence.kind, 'sdk-chief')
  assert.equal(chiefRuns[0].executionEvidence.chiefRunId, chiefRuns[0].id)
  assert.ok(rt.state.bots.a, 'Logical Chief remains resident after its SDK turn ends')
  assert.equal(rt.readProject('p1').kind, undefined, 'Run metadata must not be written onto the Project returned by bindProject')
  assert.equal(Object.values(rt.state.tasks).length, 1)
})

test('Chief recovery before any sealed candidate pins a fresh Attempt to the current repaired repository base', async t => {
  const f = await setup(t, undefined, { pool: true })
  await f.start('before-backend-repair')
  const previous = f.attempt(), base = previous.baseSha
  writeFileSync(join(f.repository, 'host-repair.txt'), 'Verified repair to the execution backend\n')
  git(f.repository, ['add', 'host-repair.txt']); git(f.repository, ['commit', '-m', 'Repair host before retry'])
  const current = git(f.repository, ['rev-parse', 'HEAD'])
  previous.status = 'interrupted'
  const id = await f.rt.projectDelivery.reworkPool({ task: f.rt.state.tasks[f.task.id], claim: { id: 'chief-recovery', attemptId: previous.id, botId: 'p1:chief' }, reason: 'Confirmed prior exit; retry on repaired host', force: true })
  assert.equal(f.rt.state.projectAttempts[id].baseSha, current)
  assert.equal(previous.baseSha, base)
  assert.equal(f.rt.state.projectAttempts[id].taskId, f.task.id)
  assert.equal(previous.status, 'interrupted')
})

test('Chief route resumes interrupted unsealed code only with confirmed worker release and retains failure history', async t => {
  const f = await setup(t, undefined, { pool: true }); await f.start('resume-unsealed')
  const previous = f.attempt(), path = join(f.directory, 'unsealed-worktree')
  git(f.repository, ['worktree', 'add', '--detach', path, previous.baseSha])
  writeFileSync(join(path, 'code.mjs'), 'export const add = (a,b) => a+b;\n')
  previous.workspaces.developer = { id: 'resume-w', kind: 'worktree', status: 'allocated', repository: f.repository, path }
  previous.status = 'interrupted'; previous.failure = { message: 'Restart while awaiting host preparation' }
  const oldRunId = previous.runId; f.rt.state.projectExecutions[oldRunId].status = 'failed'
  f.rt.state.projectHarnessWorkers = { stopped: { id: 'stopped', attemptId: previous.id, status: 'released' } }
  f.rt.state.projectResourceLeases = { lease: { id: 'lease', attemptId: previous.id, status: 'released' } }
  const id = await f.rt.projectDelivery.reworkPool({ task: f.rt.state.tasks[f.task.id], claim: { id: 'resume-claim', attemptId: previous.id, botId: 'p1:chief' }, reason: 'Git index capability repaired', force: false, decisionId: 'chief-resume' })
  assert.equal(id, previous.id); assert.equal(previous.status, 'running')
  assert.equal(readFileSync(join(path, 'code.mjs'), 'utf8'), 'export const add = (a,b) => a+b;\n')
  assert.equal(previous.resumptions[0].failure.message, 'Restart while awaiting host preparation')
  assert.equal(previous.resumptions[0].decisionId, 'chief-resume')
  assert.notEqual(previous.runId, oldRunId); assert.equal(f.rt.state.projectExecutions[oldRunId].status, 'failed')
  assert.equal(previous.failure, undefined)
  previous.status = 'interrupted'; f.rt.state.projectResourceLeases.lease.status = 'unreachable'
  f.rt.state.projectResourceLeases.lease.worker = { kind: 'sdk', handle: 'unknown-worker' }
  f.rt.state.projectHarnessWorkers.stopped.status = 'unreachable'
  const next = await f.rt.projectDelivery.reworkPool({ task: f.rt.state.tasks[f.task.id], claim: { id: 'unknown-exit', attemptId: previous.id, botId: 'p1:chief' }, reason: 'Unknown worker requires isolation', force: false })
  assert.notEqual(next, previous.id, 'Unknown capacity never permits reuse of the old working directory')
  assert.equal(f.rt.state.projectResourceLeases.lease.status, 'unreachable')
})

test('a transferred unsealed implementation is a labelled draft reference, not a missing or accepted candidate', async t => {
  const f = await setup(t, undefined, { pool: true })
  f.rt.projectPools.connect({ validate: () => ({ ok: true }) })
  await f.start('draft-reference')
  const attempt = f.attempt(), task = f.rt.state.tasks[f.task.id]
  const defs = f.rt.projectAgents.deliveryDefinitions('p1').roles
  const dev = defs.find(row => row.role === 'developer'), tester = defs.find(row => row.role === 'tester')
  await f.rt.projectDelivery.preparePoolRole(task, { id: 'draft-dev', attemptId: attempt.id, generation: 1 }, dev)
  const path = attempt.workspaces.developer.path
  writeFileSync(join(path, 'code.mjs'), 'export const add = (a,b) => a+b;\n')
  await f.rt.projectDelivery.preparePoolRole(task, { id: 'draft-test', attemptId: attempt.id, generation: 2 }, tester)
  const facts = JSON.parse(attempt.roleSessions.tester.context.text.split('<untrusted-role-context>\n')[1].split('\n</untrusted-role-context>')[0]).projectFacts
  assert.equal(facts.candidateSha, null)
  assert.equal(facts.workingDraft.kind, 'unverified-workspace-reference')
  assert.equal(facts.workingDraft.path, path)
  assert.equal(attempt.evidence.implementation, undefined)
  assert.notEqual(readFileSync(join(attempt.workspaces.tester.path, 'code.mjs'), 'utf8'), readFileSync(join(path, 'code.mjs'), 'utf8'))
})

test('restart preserves a tested pool checkpoint waiting for Chief only when every execution is released', async t => {
  for (const variant of ['quiescent', 'unknown-lease', 'unknown-worker', 'active-claim']) {
    const f = await setup(t, undefined, { pool: true }); f.rt.projectPools.connect({ validate: () => ({ ok: true }) }); await f.start('checkpoint-' + variant)
    const a = f.attempt(), task = f.rt.state.tasks[f.task.id]
    const roles = f.rt.projectAgents.deliveryDefinitions('p1').roles
    await f.rt.projectDelivery.preparePoolRole(task, { id: 'dev', attemptId: a.id, generation: 1 }, roles.find(r => r.role === 'developer'))
    writeFileSync(join(a.workspaces.developer.path, 'code.mjs'), 'export const add = (a,b) => a+b;\n')
    await f.rt.projectDelivery.completePoolRole({ task, claim: { attemptId: a.id }, role: 'developer', outputs: {} })
    await f.rt.projectDelivery.preparePoolRole(task, { id: 'test', attemptId: a.id, generation: 2 }, roles.find(r => r.role === 'tester'))
    await f.rt.projectDelivery.completePoolRole({ task, claim: { attemptId: a.id }, role: 'tester', outputs: {} })
    task.collaboration.status = 'blocked'
    task.collaboration.claim = { botId: 'p1:chief', status: variant === 'active-claim' ? 'active' : 'waiting-human', workerId: 'chief-worker', chiefRunId: 'chief-run' }
    f.rt.state.projectExecutions['chief-run'] = { status: 'done' }
    f.rt.state.projectHarnessWorkers = { 'chief-worker': { status: 'released', leaseId: 'chief-lease' }, dev: { attemptId: a.id, status: variant === 'unknown-worker' ? 'unreachable' : 'released' } }
    f.rt.state.projectResourceLeases = { 'chief-lease': { status: 'released' }, lease: { attemptId: a.id, status: variant === 'unknown-lease' ? 'unreachable' : 'released' } }
    const sha = a.candidateSha, tests = structuredClone(a.evidence.tests)
    const delivery = createProjectDelivery(f.rt)
    assert.equal(delivery.recover(), true)
    assert.equal(delivery.recover(), false)
    if (variant === 'quiescent') {
      assert.equal(a.status, 'running')
      assert.equal(a.restartCheckpoints[0].kind, 'quiescent-chief-wait')
      assert.equal(a.candidateSha, sha)
      assert.deepEqual(a.evidence.tests, tests)
      assert.equal(task.collaboration.claim.status, 'waiting-human')
    } else assert.equal(a.status, 'interrupted')
  }
})

test('published pool rework retains its PR binding and seals a descendant of the retained candidate', async t => {
  const f = await setup(t, undefined, { pool: true })
  f.rt.projectPools.connect({ validate: () => ({ ok: true }) })
  await f.start('published-rework')
  const task = f.rt.state.tasks[f.task.id], first = f.attempt()
  const developer = f.rt.projectAgents.deliveryDefinitions('p1').roles.find(row => row.role === 'developer')
  await f.rt.projectDelivery.preparePoolRole(task, { id: 'first-dev', attemptId: first.id, generation: 1 }, developer)
  writeFileSync(join(first.workspaces.developer.path, 'code.mjs'), 'export const add = (a,b) => a+b;\n')
  await f.rt.projectDelivery.completePoolRole({ task, claim: { attemptId: first.id }, role: 'developer', outputs: {} })
  const original = first.candidateSha
  first.pr = { number: 48, repository: 'example/demo', sha: original, url: 'https://example.invalid/pr/48' }
  first.status = 'waiting-acceptance'
  first.pr.sha = 'f'.repeat(40)
  await assert.rejects(f.rt.projectDelivery.reworkPool({ task, claim: { id: 'bad-return', attemptId: first.id, botId: 'p1:chief' }, reason: 'Reject inconsistent prior evidence' }), /binding is inconsistent/)
  assert.equal(first.status, 'waiting-acceptance')
  assert.equal(Object.keys(f.rt.state.projectAttempts).length, 1)
  first.pr.sha = original
  const id = await f.rt.projectDelivery.reworkPool({ task, claim: { id: 'chief-return', attemptId: first.id, botId: 'p1:chief' }, reason: 'Maintain the existing PR after its base advanced' })
  const next = f.rt.state.projectAttempts[id]
  assert.deepEqual(next.publicationBinding, { number: 48, repository: 'example/demo', branch: first.branch, previousSha: original, upstreamSha: first.baseSha, upstreamRef: 'main' })
  await f.rt.projectDelivery.preparePoolRole(task, { id: 'next-dev', attemptId: id, generation: 2 }, developer)
  writeFileSync(join(next.workspaces.developer.path, 'code.mjs'), 'export const add = (a,b) => Number(a)+Number(b); // intermediate\n')
  git(next.workspaces.developer.path, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-am', 'Private intermediate work'])
  writeFileSync(join(next.workspaces.developer.path, 'code.mjs'), 'export const add = (a,b) => Number(a)+Number(b);\n')
  await f.rt.projectDelivery.completePoolRole({ task, claim: { attemptId: id }, role: 'developer', outputs: {} })
  assert.equal(git(next.workspaces.developer.path, ['rev-parse', next.candidateSha + '^']), original)
  assert.equal(first.candidateSha, original)
  assert.equal(first.pr.number, 48)
  assert.notEqual(next.branch, first.branch, 'independent worktrees retain distinct local branches')
  assert.equal(Object.keys(f.rt.state.tasks).length, 1)
})


test('human retry of a published delivery preserves its PR and rejects inconsistent bindings before admission', async t => {
  const f = await setup(t)
  await f.start('first-publication'); await complete(f)
  const first = f.attempt(), sha = first.candidateSha
  await f.rt.projectEndpoint('project-task-reject', { attemptId: first.id, reason: 'Add a regression' }, alice)
  const retry = await f.start('human-retry')
  assert.deepEqual(retry.attempt.publicationBinding, { number: first.pr.number, repository: first.pr.repository, branch: first.branch, previousSha: sha, upstreamSha: first.baseSha, upstreamRef: 'main' })
  assert.equal(git(retry.attempt.workspaces.developer.path, ['rev-parse', 'HEAD']), sha)
  f.rt.projectDelivery.runReported({ id: retry.attempt.runId, taskId: f.task.id, attemptId: retry.attempt.id, projectId: 'p1', status: 'failed' })
  f.attempt().publicationBinding.repository = 'other/repo'
  const count = Object.keys(f.rt.state.projectAttempts).length
  await assert.rejects(f.start('inconsistent-retry'), /binding is inconsistent/)
  assert.equal(Object.keys(f.rt.state.projectAttempts).length, count)
})

test('published rework pins the actual target and seals both published and resolved upstream histories', async t => {
  for (const committed of [false, true]) await t.test(committed ? 'committed merge' : 'resolved merge index', async t => {
  const f = await setup(t, undefined, { pool: true })
  f.rt.projectPools.connect({ validate: () => ({ ok: true }) }); await f.start('upstream-rework')
  const task = f.rt.state.tasks[f.task.id], first = f.attempt()
  const developer = f.rt.projectAgents.deliveryDefinitions('p1').roles.find(row => row.role === 'developer')
  await f.rt.projectDelivery.preparePoolRole(task, { id: 'dev-before', attemptId: first.id, generation: 1 }, developer)
  writeFileSync(join(first.workspaces.developer.path, 'code.mjs'), 'export const add = (a,b) => a+b;\n')
  await f.rt.projectDelivery.completePoolRole({ task, claim: { attemptId: first.id }, role: 'developer', outputs: {} })
  const seed = first.candidateSha
  writeFileSync(join(f.repository, 'code.mjs'), 'export const add = (a,b) => a-b;\nexport const contract = () => "backend-v2";\n')
  writeFileSync(join(f.repository, 'code.test.mjs'), 'import assert from "node:assert/strict"; import {add,contract} from "./code.mjs"; assert.equal(add(2,3),5); assert.equal(contract(),"backend-v2");\n')
  git(f.repository, ['add', '.']); git(f.repository, ['commit', '-m', 'Advance trusted upstream backend'])
  const upstream = git(f.repository, ['rev-parse', 'HEAD'])
  f.publisher.read = async pr => ({ sha: pr.sha, state: 'open', baseRef: 'main', baseSha: upstream })
  first.pr = { number: 48, repository: 'example/demo', sha: seed }; first.status = 'waiting-acceptance'
  const currentRead = f.publisher.read
  for (const remote of [{ sha: seed, state: 'closed', baseRef: 'main', baseSha: upstream }, { sha: seed, state: 'open', baseRef: 'main', baseSha: '0'.repeat(40) }]) {
    f.publisher.read = async () => remote
    await assert.rejects(f.rt.projectDelivery.reworkPool({ task, claim: { id: 'unavailable-target', attemptId: first.id, botId: 'p1:chief' }, reason: 'Reject stale or unprovisioned upstream before allocation' }), /target is stale|not provisioned/)
    assert.equal(first.status, 'waiting-acceptance')
    assert.equal(Object.keys(f.rt.state.projectAttempts).length, 1)
  }
  f.publisher.read = currentRead
  const id = await f.rt.projectDelivery.reworkPool({ task, claim: { id: 'upstream-return', attemptId: first.id, botId: 'p1:chief' }, reason: 'Integrate current backend without losing published history' })
  const next = f.rt.state.projectAttempts[id]
  assert.equal(next.publicationBinding.upstreamSha, upstream)
  await f.rt.projectDelivery.preparePoolRole(task, { id: 'dev-after', attemptId: id, generation: 2 }, developer)
  const path = next.workspaces.developer.path
  await assert.rejects(f.rt.projectDelivery.completePoolRole({ task, claim: { attemptId: id }, role: 'developer', outputs: {} }), /merge the pinned upstream/)
  assert.equal(git(path, ['rev-parse', 'HEAD']), seed)
  const mergePath = git(path, ['rev-parse', '--git-path', 'MERGE_HEAD'])
  writeFileSync(mergePath, first.baseSha + '\n')
  await assert.rejects(f.rt.projectDelivery.completePoolRole({ task, claim: { attemptId: id }, role: 'developer', outputs: {} }), /merge the pinned upstream/)
  rmSync(mergePath)
  assert.throws(() => git(path, ['merge', '--no-commit', '--no-ff', upstream]), /Command failed/)
  await assert.rejects(f.rt.projectDelivery.completePoolRole({ task, claim: { attemptId: id }, role: 'developer', outputs: {} }), /unresolved/)
  writeFileSync(join(path, 'code.mjs'), 'export const add = (a,b) => a+b;\nexport const contract = () => "backend-v2";\n')
  git(path, ['add', '.'])
  if (committed) git(path, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Resolved merge before host sealing'])
  await f.rt.projectDelivery.completePoolRole({ task, claim: { attemptId: id }, role: 'developer', outputs: {} })
  assert.deepEqual(git(path, ['show', '-s', '--format=%P', next.candidateSha]).split(' '), [seed, upstream])
  assert.equal(first.candidateSha, seed)
  assert.equal(next.evidence.upstreamIntegration.sha, upstream)
  const tester = f.rt.projectAgents.deliveryDefinitions('p1').roles.find(row => row.role === 'tester')
  await f.rt.projectDelivery.preparePoolRole(task, { id: 'test-after', attemptId: id, generation: 3 }, tester)
  await f.rt.projectDelivery.completePoolRole({ task, claim: { attemptId: id }, role: 'tester', outputs: {} })
  assert.equal(next.evidence.tests.passed, true)
  })
})

test('context admission checkpoints require host rejection and no external execution', async t => {
  for (const variant of ['safe','session','worker','bound','started','receipt','chief','cancel']) {
    const f=await setup(t,undefined,{pool:true}); f.rt.projectPools.connect({validate:()=>({ok:true})}); await f.start('admission-'+variant)
    const a=f.attempt(),task=f.rt.state.tasks[f.task.id]
    const execution={id:'failed-admission',status:'failed',attemptId:a.id,taskId:task.id,failure:'Execution admission failed: Role context exceeds 48000 characters'}
    task.collaboration.status='blocked'
    task.collaboration.history=[{attemptId:a.id,to:'p1:developer',status:'rejected',execution}]
    task.collaboration.claim={botId:'p1:chief',status:'waiting-human',workerId:'chief',chiefRunId:'chief-run'}
    f.rt.state.projectExecutions['chief-run']={status:'done'}
    f.rt.state.projectHarnessWorkers={chief:{status:'released',leaseId:'chief-lease',releaseProof:{kind:'sdk-stop-ack-and-process-exit'}}}
    f.rt.state.projectResourceLeases={'chief-lease':{status:'released'},reserved:{id:'reserved',attemptId:a.id,status:'reserved'}}
    if(variant==='session')a.roleSessions={developer:{id:'prepared'}}
    if(variant==='worker')f.rt.state.projectHarnessWorkers.dev={attemptId:a.id,status:'released'}
    if(variant==='bound')f.rt.state.projectResourceLeases.reserved.worker={kind:'sdk',handle:'unknown'}
    if(variant==='started')f.rt.state.projectResourceLeases.reserved.startedAt=1
    if(variant==='receipt')task.collaboration.history=[]
    if(variant==='chief')f.rt.state.projectHarnessWorkers.chief.releaseProof={kind:'assertion'}
    if(variant==='cancel')a.cancelRequested=true
    const before=structuredClone(task)
    createProjectDelivery(f.rt).recover()
    assert.equal(a.status,variant==='safe'?'running':'interrupted',variant)
    if(variant==='safe'){
      assert.equal(a.restartCheckpoints[0].kind,'quiescent-preparation-admission')
      assert.deepEqual(task,before)
      assert.equal(f.rt.state.projectResourceLeases.reserved.status,'reserved','delivery does not release live resources')
      await f.rt.projectResources.release('reserved',undefined)
      assert.equal(f.rt.state.projectResourceLeases.reserved.releaseProof.kind,'unbound-reservation-release')
    }
  }
})

test('failed context admission preserves an existing unsealed developer workspace',async t=>{
  const f=await setup(t,undefined,{pool:true}); f.rt.projectPools.connect({validate:()=>({ok:true})}); await f.start('context-retry')
  const a=f.attempt(),task=f.rt.state.tasks[f.task.id],dev=f.rt.projectAgents.deliveryDefinitions('p1').roles.find(r=>r.role==='developer')
  await f.rt.projectDelivery.preparePoolRole(task,{id:'first',attemptId:a.id,generation:1},dev)
  const path=a.workspaces.developer.path
  writeFileSync(join(path,'code.mjs'),'export const preserved = true;\n')
  a.seedSha=a.baseSha
  f.rt.state.projectKnowledge={p1:[{id:'large',text:'x'.repeat(49000)}]}
  await assert.rejects(f.rt.projectDelivery.preparePoolRole(task,{id:'second',attemptId:a.id,generation:2},dev),/exceeds/)
  assert.equal(readFileSync(join(path,'code.mjs'),'utf8'),'export const preserved = true;\n')
  assert.equal(a.preparationFailures.at(-1).releasedBeforeExternalStart,false)
  assert.equal(a.roleSessions.developer.poolClaimId,'first')
})

test('context failure releases an actual unbound reservation before registering any SDK Session',async t=>{
  const f=await setup(t,undefined,{pool:true});f.rt.projectPools.connect({validate:()=>({ok:true})})
  f.rt.config.projectResources={one:{type:'local',root:f.directory,capacity:1,allowedProjectOwnerIds:['owner-1'],harnesses:['codex'],profiles:{'owner-1':{codex:{home:join(f.directory,'sdk-home'),configDir:join(f.directory,'sdk-config'),model:'fixture/model'}}}}}
  f.rt.state.projectResourceHealth={one:{status:'ready',at:Date.now()}};f.rt.state.projectHarnessHealth={'p1:one:codex':{status:'ready'}}
  await f.rt.projectEndpoint('project-agent-definition',{projectId:'p1',role:'developer',execution:{harness:'codex',resourceIds:['one']}},alice)
  await f.start('unbound-context-failure')
  const a=f.attempt(),task=f.rt.state.tasks[f.task.id],dev=f.rt.projectAgents.deliveryDefinitions('p1').roles.find(r=>r.role==='developer')
  f.rt.state.projectKnowledge={p1:[{id:'large',text:'x'.repeat(49000)}]}
  await assert.rejects(f.rt.projectDelivery.preparePoolRole(task,{id:'rejected',attemptId:a.id,generation:1},dev),/exceeds/)
  const lease=Object.values(f.rt.state.projectResourceLeases).find(x=>x.attemptId===a.id)
  assert.equal(lease.status,'released')
  assert.equal(lease.releaseProof.kind,'unbound-reservation-release')
  assert.equal(a.preparationFailures.at(-1).releasedBeforeExternalStart,true)
  assert.deepEqual(a.roleSessions,{})
  assert.equal(Object.values(f.rt.state.projectHarnessWorkers??{}).filter(x=>x.attemptId===a.id).length,0)
  assert.equal(a.workspaces.developer.status,'allocated')
})

test('workspace allocation failure releases an actual reservation before any external execution', async t => {
  const f = await setup(t, undefined, { pool: true })
  f.rt.projectPools.connect({ validate: () => ({ ok: true }) })
  f.rt.projectScheduler.wake = () => {}
  f.rt.config.projectResources = { one: { type: 'local', root: f.directory, capacity: 1, allowedProjectOwnerIds: ['owner-1'], harnesses: ['codex'], profiles: { 'owner-1': { codex: { home: join(f.directory, 'sdk-home'), configDir: join(f.directory, 'sdk-config'), model: 'fixture/model' } } } } }
  f.rt.state.projectResourceHealth = { one: { status: 'ready', at: Date.now() } }
  f.rt.state.projectHarnessHealth = { 'p1:one:codex': { status: 'ready' } }
  await f.rt.projectEndpoint('project-agent-definition', { projectId: 'p1', role: 'developer', execution: { harness: 'codex', resourceIds: ['one'] } }, alice)
  await f.start('allocation-failure')
  const a = f.attempt(), task = f.rt.state.tasks[f.task.id]
  // A real filesystem obstacle after reservation and before git worktree creation.
  writeFileSync(join(f.directory, 'delivery'), 'Not a directory')
  const dev = f.rt.projectAgents.deliveryDefinitions('p1').roles.find(row => row.role === 'developer')
  await assert.rejects(f.rt.projectDelivery.preparePoolRole(task, { id: 'failed-allocation', attemptId: a.id, generation: 1 }, dev), /ENOTDIR|EEXIST/)
  const lease = Object.values(f.rt.state.projectResourceLeases).find(row => row.attemptId === a.id)
  assert.equal(lease.status, 'released')
  assert.equal(lease.releaseProof.kind, 'unbound-reservation-release')
  assert.equal(a.preparationFailures.at(-1).releasedBeforeExternalStart, true)
  assert.deepEqual(a.roleSessions, {})
  assert.equal(Object.values(f.rt.state.projectHarnessWorkers ?? {}).filter(row => row.attemptId === a.id).length, 0)
})

test('every pool receiver is host-prepared in its own checkout before registering a role Session', async t => {
  const f = await setup(t, undefined, { pool: true })
  f.rt.projectPools.connect({ validate: () => ({ ok: true }) })
  const settings = f.rt.config.projectRepositories['example/demo']
  // A real child process verifies the cwd and creates only ignored dependency data.
  settings.workspacePrepareCommand = [process.execPath, '-e', "const fs=require('fs');if(!fs.existsSync('code.mjs'))process.exit(31);fs.mkdirSync('node_modules',{recursive:true});fs.writeFileSync('node_modules/ready',process.cwd())"]
  await f.start('prepare-receivers')
  const a = f.attempt(), task = f.rt.state.tasks[f.task.id]
  for (const [index, role] of ['developer', 'tester', 'reviewer'].entries()) {
    const definition = f.rt.projectAgents.deliveryDefinitions('p1').roles.find(row => row.role === role)
    const node = await f.rt.projectDelivery.preparePoolRole(task, { id: `prepare-${role}`, attemptId: a.id, generation: index + 1 }, definition)
    assert.equal(readFileSync(join(node.executionWorkDir, 'node_modules/ready'), 'utf8'), node.executionWorkDir)
    assert.equal(a.workspacePreparations.at(-1).workspaceId, a.workspaces[role].id)
    assert.equal(a.roleSessions[role].status, 'prepared')
  }
  assert.equal(a.workspacePreparations.length, 3)
  assert.equal(new Set(Object.values(a.workspaces).map(row => row.path)).size, 3)
  settings.workspacePrepareCommand = [process.execPath, '-e', 'process.exit(37)']
  const previous = structuredClone(a.roleSessions.reviewer)
  const reviewer = f.rt.projectAgents.deliveryDefinitions('p1').roles.find(row => row.role === 'reviewer')
  await assert.rejects(f.rt.projectDelivery.preparePoolRole(task, { id: 'prepare-failed', attemptId: a.id, generation: 9 }, reviewer), error => error.code === 37)
  assert.deepEqual(a.roleSessions.reviewer, previous)
  assert.equal(a.workspacePreparations.length, 3)
  assert.equal(a.preparationFailures.at(-1).role, 'reviewer')
})

test('independent host tests prepare dependencies after cleaning their exact candidate checkout', async t => {
  const f = await setup(t, [process.execPath, '-e', "const fs=require('fs');if(fs.readFileSync('node_modules/ready','utf8')!==process.cwd())process.exit(33)"])
  f.rt.config.projectRepositories['example/demo'].workspacePrepareCommand = [process.execPath, '-e', "const fs=require('fs');fs.mkdirSync('node_modules',{recursive:true});fs.writeFileSync('node_modules/ready',process.cwd())"]
  await f.start('host-preparation')
  await implement(f)
  const a = f.attempt(), path = a.workspaces.tester.path
  mkdirSync(join(path, 'node_modules')); writeFileSync(join(path, 'node_modules/stale'), 'Must be removed')
  await f.gate('tester')
  assert.equal(a.evidence.tests.passed, true)
  assert.equal(a.workspacePreparations.at(-1).workspaceId, a.workspaces.tester.id)
  assert.equal((await import('node:fs')).existsSync(join(path, 'node_modules/stale')), false)
})

test('bound-resource preparation executes before SDK registration and failure retains unknown occupancy', async t => {
  const f = await setup(t, undefined, { pool: true })
  f.rt.projectPools.connect({ validate: () => ({ ok: true }) })
  f.rt.projectScheduler.wake = () => {}
  f.rt.config.projectResources = { one: { type: 'local', root: f.directory, capacity: 1, allowedProjectOwnerIds: ['owner-1'], harnesses: ['codex'], profiles: { 'owner-1': { codex: { home: join(f.directory, 'sdk-home'), configDir: join(f.directory, 'sdk-config'), model: 'fixture/model' } } } } }
  f.rt.state.projectResourceHealth = { one: { status: 'ready', at: Date.now() } }
  f.rt.state.projectHarnessHealth = { 'p1:one:codex': { status: 'ready' } }
  await f.rt.projectEndpoint('project-agent-definition', { projectId: 'p1', role: 'developer', execution: { harness: 'codex', resourceIds: ['one'] } }, alice)
  const settings = f.rt.config.projectRepositories['example/demo']
  settings.workspacePrepareCommand = [process.execPath, '-e', "if(!require('fs').existsSync('code.mjs'))process.exit(31)"]
  await f.start('resource-preparation')
  const a = f.attempt(), task = f.rt.state.tasks[f.task.id]
  const dev = f.rt.projectAgents.deliveryDefinitions('p1').roles.find(row => row.role === 'developer')
  await f.rt.projectDelivery.preparePoolRole(task, { id: 'prepared-resource', attemptId: a.id, generation: 1 }, dev)
  assert.equal(a.workspacePreparations.at(-1).resourceId, 'one')
  const original = structuredClone(a.roleSessions.developer)
  const first = a.resourceLeases.developer
  await f.rt.projectResources.release(first.id, first.generation)
  const preparationCommand = settings.workspacePrepareCommand
  settings.workspacePrepareCommand = [process.execPath, '-e', 'process.exit(37)']
  await assert.rejects(f.rt.projectDelivery.preparePoolRole(task, { id: 'resource-command-failed', attemptId: a.id, generation: 2 }, dev), error => error.code === 37)
  assert.equal(f.rt.state.projectResourceLeases[a.resourceLeases.developer.id].status, 'released')
  assert.equal(a.preparationFailures.at(-1).releasedBeforeExternalStart, true)
  settings.workspacePrepareCommand = preparationCommand
  const command = f.rt.projectResources.command
  f.rt.projectResources.command = async (...args) => {
    const lease = a.resourceLeases.developer
    await f.rt.projectResources.markStarted(lease.id, lease.generation, { kind: 'sdk', handle: 'unknown-worker' })
    await command(...args)
    throw new Error('Connection lost after external registration')
  }
  await assert.rejects(f.rt.projectDelivery.preparePoolRole(task, { id: 'unknown-preparation', attemptId: a.id, generation: 2 }, dev), /Connection lost/)
  const held = f.rt.state.projectResourceLeases[a.resourceLeases.developer.id]
  assert.equal(held.status, 'running')
  assert.equal(held.worker.handle, 'unknown-worker')
  assert.equal(a.preparationFailures.at(-1).releasedBeforeExternalStart, false)
  assert.deepEqual(a.roleSessions.developer, original)
})

test('unstarted bound delivery refreshes a verified descendant target without replacing its draft or Attempt',async t=>{
  for(const variant of ['safe','reserved','unknown','worker','session','history','execution','candidate','cancel','native','unproven-release','released-bound','stale-state','unrelated','missing','moved-head','moved-ref']){
    const f=await setup(t,undefined,{pool:true});f.rt.projectScheduler.wake=()=>{} // Keep deliberate lease snapshots stable during admission checks.
    f.rt.projectPools.connect({validate:()=>({ok:true})});await f.start('target-refresh-'+variant)
    const a=f.attempt(),task=f.rt.state.tasks[f.task.id],dev=f.rt.projectAgents.deliveryDefinitions('p1').roles.find(r=>r.role==='developer'),base=a.baseSha
    a.seedSha=base;a.publicationBinding={number:48,repository:'example/demo',branch:'original-delivery',previousSha:base,upstreamSha:base,upstreamRef:'main'}
    f.rt.state.projectKnowledge={p1:[{id:'oversize',text:'x'.repeat(49000)}]}
    await assert.rejects(f.rt.projectDelivery.preparePoolRole(task,{id:'before',attemptId:a.id,generation:1},dev),/exceeds/)
    f.rt.state.projectKnowledge={p1:[]}
    const path=a.workspaces.developer.path;writeFileSync(join(path,'code.mjs'),'export const preservedDraft = true;\n')
    writeFileSync(join(f.repository,'backend.mjs'),'export const backend = 2;\n');git(f.repository,['add','backend.mjs']);git(f.repository,['commit','-m','Advance trusted target'])
    const target=git(f.repository,['rev-parse','HEAD']),old=structuredClone(a.publicationBinding)
    if(['reserved','unknown'].includes(variant))f.rt.state.projectResourceLeases={held:{attemptId:a.id,status:variant==='reserved'?'reserved':'unreachable'}}
    if(variant==='worker')f.rt.state.projectHarnessWorkers={old:{attemptId:a.id,status:'released'}}
    if(variant==='session')a.roleSessions.developer={id:'external-session'}
    if(variant==='history')a.roleSessionHistory=[{id:'past-session'}]
    if(variant==='execution')a.evidence.execution={developer:{id:'recorded'}}
    if(variant==='candidate')a.candidateSha=base
    if(variant==='cancel')a.cancelRequested=true
    if(variant==='native')f.rt.state.bots.live={ephemeral:true,attemptId:a.id}
    if(variant==='unproven-release')f.rt.state.projectResourceLeases={held:{attemptId:a.id,status:'released'}}
    if(variant==='released-bound')f.rt.state.projectResourceLeases={held:{attemptId:a.id,status:'released',releaseProof:{kind:'unbound-reservation-release'},worker:{kind:'sdk',handle:'missing'}}}
    if(variant==='stale-state')f.publisher.read=async()=>{a.status='interrupted';return{sha:base,state:'open',baseRef:'main',baseSha:target}}
    if(variant==='unrelated'){
      const unrelated=git(f.repository,['commit-tree',git(f.repository,['rev-parse','HEAD^{tree}']),'-m','Unrelated target'])
      f.publisher.read=async()=>({sha:base,state:'open',baseRef:'main',baseSha:unrelated})
    }
    if(variant==='missing')f.publisher.read=async()=>({sha:base,state:'open',baseRef:'main',baseSha:'1'.repeat(40)})
    if(variant==='moved-head')f.publisher.read=async()=>({sha:target,state:'open',baseRef:'main',baseSha:target})
    if(variant==='moved-ref')f.publisher.read=async()=>({sha:base,state:'open',baseRef:'other',baseSha:target})
    const prepare=()=>f.rt.projectDelivery.preparePoolRole(task,{id:'after',attemptId:a.id,generation:2},dev)
    if(variant==='safe'){
      await prepare();assert.equal(a.publicationBinding.upstreamSha,target);assert.equal(a.publicationBindingHistory.length,1)
      assert.deepEqual(a.publicationBindingHistory[0].previous,old);assert.deepEqual(a.publicationBindingHistory[0].current,a.publicationBinding)
      assert.equal(a.publicationBindingHistory[0].claimId,'after');assert.equal(a.publicationBindingHistory[0].generation,2)
      assert.equal(a.seedSha,base);assert.equal(a.baseSha,base);assert.equal(a.id,task.deliveryAttemptId)
      assert.match(a.roleSessions.developer.context.text,new RegExp(target));assert.equal(Object.values(f.rt.state.projectAttempts).length,1)
    }else{
      await assert.rejects(prepare(),/recorded or unknown execution|descendant|not provisioned|stale or unavailable/,variant)
      assert.deepEqual(a.publicationBinding,old);assert.equal(a.publicationBindingHistory,undefined)
    }
    assert.equal(readFileSync(join(path,'code.mjs'),'utf8'),'export const preservedDraft = true;\n')
    assert.equal(git(path,['rev-parse','HEAD']),base)
  }
})

async function publicationFailure(t) {
  const f = await setup(t)
  await f.start('publication-recovery')
  await implement(f); await f.gate('tester')
  const a = f.attempt()
  f.rt.state.projectHarnessWorkers ??= {}; f.rt.state.projectResourceLeases ??= {}
  a.publicationBinding = { number: 48, repository: 'example/demo', branch: a.branch, previousSha: a.baseSha, upstreamSha: a.baseSha, upstreamRef: 'main' }
  f.publisher.publish = async () => { throw new Error('PR head does not match the tested candidate') }
  await assert.rejects(f.rt.projectDelivery.completePoolRole({ task: { ...f.task, collaboration: { kind: 'code' } }, claim: { attemptId: a.id }, role: 'reviewer', outputs: { review: JSON.stringify({ commit: a.candidateSha, verdict: 'approve', summary: 'Independent exact-commit review' }) } }), /PR head does not match/)
  assert.equal(a.status, 'running'); assert.equal(a.pr, undefined)
  f.publisher.publish = async attempt => { const pr = { number: 48, sha: attempt.candidateSha, repository: 'example/demo' }; f.published.push(pr); return pr }
  const retry = actor => f.rt.projectEndpoint('project-attempt-publication-retry', { attemptId: a.id }, actor ?? alice)
  return { ...f, a, retry }
}

test('existing-PR recovery reuses sealed tests/Review and stays subject to Chief acceptance', async t => {
  const f = await publicationFailure(t), a = f.a
  a.protocol = 'project-handoff/v1'
  const evidence = structuredClone(a.evidence), sessions = structuredClone(a.roleSessions)
  const first = await f.retry()
  assert.equal(first.attempt.pr.number, 48); assert.equal(first.attempt.status, 'waiting-acceptance')
  assert.equal(f.rt.state.tasks[f.task.id].status, 'result-ready')
  assert.deepEqual(a.evidence, evidence); assert.deepEqual(a.roleSessions, sessions)
  assert.equal(Object.keys(f.rt.state.projectAttempts).length, 1)
  assert.equal((await f.retry()).already, true)
  assert.equal(a.publicationRecoveries.length, 1)
  await assert.rejects(f.rt.projectEndpoint('project-task-accept', { attemptId: a.id }, alice), /Chief arbitration/)
})

test('publication recovery refuses unauthorized, stale and still-executing evidence before any push', async t => {
  const f = await publicationFailure(t), a = f.a
  await assert.rejects(f.retry(bob), /access denied/)
  for (const mutate of [
    () => { a.evidence.tests.sha = 'wrong' },
    () => { a.evidence.review.verdict = 'request-changes' },
    () => { f.rt.state.tasks[f.task.id].criteria = 'changed' },
    () => { a.cancelRequested = true },
    () => { a.status = 'returned' },
    () => { delete a.publicationBinding },
    () => { delete a.roleSessions.reviewer },
    () => { f.rt.state.projectHarnessWorkers.fake = { attemptId: a.id, status: 'running' } },
    () => { f.rt.state.projectResourceLeases.fake = { attemptId: a.id, status: 'reserved' } },
    () => { f.rt.state.tasks[f.task.id].deliveryAttemptId = 'other' },
    () => { a.evidence.tests.sha256 = 'changed' },
    () => { a.roleSessions.reviewer.execution.harness = 'codex-sdk' },
  ]) {
    const before = structuredClone(a), task = structuredClone(f.rt.state.tasks[f.task.id])
    mutate(); await assert.rejects(f.retry()); assert.equal(f.published.length, 0)
    for (const key of Object.keys(a)) delete a[key]
    Object.assign(a, before); f.rt.state.tasks[f.task.id] = task
    delete f.rt.state.projectHarnessWorkers.fake; delete f.rt.state.projectResourceLeases.fake
  }
  writeFileSync(join(a.workspaces.developer.path, 'code.mjs'), 'modified after testing')
  await assert.rejects(f.retry(), /Candidate changed/); assert.equal(f.published.length, 0)
})

test('failed PR reconciliation never fabricates a receipt or consumes prior evidence', async t => {
  const f = await publicationFailure(t), before = structuredClone(f.a.evidence)
  f.publisher.publish = async () => { throw new Error('Existing PR upstream changed') }
  await assert.rejects(f.retry(), /upstream changed/)
  assert.equal(f.a.pr, undefined); assert.equal(f.a.status, 'running')
  assert.deepEqual(f.a.evidence, before)
  f.publisher.publish = async () => ({ number: 48, sha: 'wrong' })
  await assert.rejects(f.retry(), /does not match candidate/)
  assert.equal(f.a.pr, undefined)
})
