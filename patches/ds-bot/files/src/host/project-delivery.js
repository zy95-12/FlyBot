// Delivery coordinates artifacts/worktrees around the existing Workflow service.
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { ownEntry, setEntry } from './store.js'
import { DELIVERY_ROLES, DELIVERY_VERSION, deliveryGraph } from './project-delivery-template.js'
import { repositorySettings } from './project-repository-policy.js'
import { skillInstructions } from './project-agent-skills.js'
import { githubPublisher } from './project-github.js'

const exec = promisify(execFile)
const hash = value => createHash('sha256').update(value).digest('hex')
const ongoing = new Set(['preparing', 'running'])
const reject = message => Object.assign(new Error(message), { code: 'bot/delivery' })
const inside = (root, path) => { const rel = relative(root, path); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) }
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|PASSWORD|SECRET|API_KEY|GIT_CONFIG|NODE_OPTIONS/.test(key)))
async function git(path, args) {
  const { stdout } = await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: path, timeout: 30_000, maxBuffer: 2 * 1024 * 1024, env: { ...cleanEnv(), GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'FlyBot project automation', GIT_AUTHOR_EMAIL: 'flybot-project@localhost',
      GIT_COMMITTER_NAME: 'FlyBot project automation', GIT_COMMITTER_EMAIL: 'flybot-project@localhost' },
  })
  return stdout.trim()
}

export function createProjectDelivery(rt, { publisher } = {}) {
  const { state, config } = rt
  const root = resolve(config.projectWorkspaceRoot ?? join(dirname(rt.dshHome), 'flybot-workspaces'))
  const artifacts = resolve(rt.home, 'project-artifacts')
  let recovered = false
  let tail = Promise.resolve()
  const serial = fn => { const result = tail.then(fn, fn); tail = result.then(() => {}, () => {}); return result }
  const attempts = () => (state.projectAttempts ??= {})
  const attemptTails = new Map()
  const serialAttempt = (id, fn) => {
    const result = (attemptTails.get(id) ?? Promise.resolve()).then(fn, fn)
    const settled = result.then(() => {}, () => {})
    attemptTails.set(id, settled)
    void settled.then(() => { if (attemptTails.get(id) === settled) attemptTails.delete(id) })
    return result
  }
  const taskOf = id => ownEntry(state.tasks, String(id ?? ''))
  const projectOf = id => rt.projects.repository.get(id, { includeDeleted: true })
  const settingsOf = project => repositorySettings(rt, project)
  const publisherOf = project => publisher ?? githubPublisher(settingsOf(project).github)
  const current = taskId => Object.values(attempts()).reverse().find(attempt => attempt.taskId === taskId)
  const view = attempt => structuredClone(attempt)
  async function fail(attempt, error, status = 'failed') {
    attempt.status = status
    attempt.failure = { message: String(error?.message ?? error).slice(0, 1000), at: Date.now() }
    attempt.updatedAt = Date.now()
    rt.taskDeliveryState?.(attempt.taskId, attempt.id, 'failed', attempt.failure.message)
    await rt.save()
  }
  async function allocate(attempt, project, settings) {
    const repository = await realpath(settings.path)
    attempt.baseSha = await git(repository, ['rev-parse', 'HEAD'])
    attempt.branch = `flybot/delivery-${attempt.id.slice(-12)}`
    await mkdir(root, { recursive: true, mode: 0o700 })
    if (await realpath(root) !== root) throw reject('Delivery root must not be a symlink')
    for (const role of DELIVERY_ROLES) {
      if (attempt.cancelRequested) throw reject('Delivery was stopped')
      const path = join(root, attempt.id, role)
      await mkdir(join(root, attempt.id), { recursive: true, mode: 0o700 })
      const workspace = { id: `workspace-${randomUUID()}`, projectId: project.id, attemptId: attempt.id, role, path, repository,
        kind: 'worktree', status: 'allocating', createdAt: Date.now() }
      setEntry(state.projectWorkspaces, workspace.id, workspace)
      attempt.workspaces[role] = workspace
      await rt.save() // Persist cleanup intent before git creates the worktree.
      const args = role === 'developer' ? ['worktree', 'add', '-b', attempt.branch, path, attempt.baseSha] : ['worktree', 'add', '--detach', path, attempt.baseSha]
      await git(repository, args)
      workspace.status = 'allocated'
      await rt.save()
    }
  }
  async function start(body, actor) {
    const task = taskOf(body.taskId)
    if (!task?.projectId) throw reject('A delivery needs a Project Task')
    const project = rt.requireProjectAccess(actor, task.projectId, 'create')
    rt.requireProjectAccess(actor, project.id, 'task-write', task)
    if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId)) throw reject('A delivery needs a stable requestId')
    const requestKey = hash(`${project.id}\n${task.id}\n${body.requestId}`)
    const prior = Object.values(attempts()).find(attempt => attempt.requestKey === requestKey)
    if (prior) return { attempt: view(prior), already: true }
    if (Object.values(attempts()).some(attempt => attempt.taskId === task.id && (ongoing.has(attempt.status) || attempt.status === 'waiting-acceptance'))) throw reject('Task already has an active Attempt')
    if (task.status === 'accepted' || task.status === 'cancelled') throw reject('Terminal Task cannot start a delivery')
    const settings = settingsOf(project)
    const at = Date.now()
    const attempt = { id: `attempt-${randomUUID()}`, projectId: project.id, taskId: task.id, requestKey,
      workflowVersion: DELIVERY_VERSION, status: 'preparing', initiatedBy: actor.memberId, executionOwnerId: project.ownerUserId,
      requirement: { title: task.title, criteria: task.criteria ?? '', note: task.note ?? '', repository: project.repository },
      workspaces: {}, evidence: {}, createdAt: at, updatedAt: at }
    setEntry(attempts(), attempt.id, attempt)
    task.deliveryAttemptId = attempt.id
    await rt.save() // Reserve idempotency and ownership before any filesystem effects.
    try {
      await allocate(attempt, project, settings)
      if (attempt.cancelRequested) throw reject('Delivery was stopped')
      const model = settings.model ?? config.projectModel ?? await rt.defaultModel?.()
      if (typeof model !== 'string' || !model) throw reject('A served delivery model must be provisioned')
      const graph = deliveryGraph(model)
      const definitions = rt.projectAgents?.deliveryDefinitions(project.id)
      for (const node of graph.nodes) {
        const role = definitions?.roles.find(role => role.role === node.id)
        if (!role) continue
        node.model = role.model || model
        node.prompt += '\n\nProject role persona:\n' + role.instructions + '\n\n' + skillInstructions(role.resolvedSkills)
      }
      attempt.agentDefinitions = definitions
      attempt.workflowDefinition = structuredClone(graph)
      const made = await rt.projectEndpoint('project-workflow', { projectId: project.id, operation: 'create', name: `${DELIVERY_VERSION} ${attempt.id}`, ...graph }, { memberId: project.ownerUserId })
      if (made.ok === false) throw reject(made.error)
      const workflow = made.workflows.find(row => row.name.endsWith(attempt.id))
      if (!workflow) throw reject('Versioned delivery Workflow was not created')
      attempt.workflowId = workflow.id
      if (attempt.cancelRequested) throw reject('Delivery was stopped')
      attempt.status = 'running'
      if (rt.taskDeliveryState?.(task.id, attempt.id, 'working', 'Delivery started') === false) throw reject('Task ended before delivery started')
      await rt.save()
      const assigned = await rt.projectEndpoint('project-workflow', { projectId: project.id, operation: 'assign', workflowId: workflow.id, taskId: task.id }, actor)
      if (assigned.ok === false) throw reject(assigned.error)
      const run = assigned.workflows.find(row => row.id === workflow.id)?.run
      attempt.runId = run?.id ?? null
      await rt.save()
      return { attempt: view(attempt) }
    } catch (error) { await fail(attempt, error, attempt.cancelRequested ? 'cancelled' : 'failed'); return { attempt: view(attempt) } }
  }
  function context(taskId) {
    const attempt = current(taskId)
    if (!attempt || !ongoing.has(attempt.status)) return undefined
    return { attemptId: attempt.id, workflowId: attempt.workflowId, workspaceId: attempt.workspaces.developer?.id, brief: `${attempt.requirement.title}\n${attempt.requirement.note}\nAcceptance criteria: ${attempt.requirement.criteria}\nBase commit: ${attempt.baseSha}`, workDirs: Object.fromEntries(Object.entries(attempt.workspaces).map(([role, workspace]) => [role, workspace.path])) }
  }
  async function verifyCandidate(attempt) {
    if (!attempt.candidateSha) throw reject('Candidate commit is missing')
    const path = attempt.workspaces.developer.path
    if (await git(path, ['rev-parse', 'HEAD']) !== attempt.candidateSha || await git(path, ['status', '--porcelain'])) throw reject('Candidate changed; test and Review evidence is stale')
  }
  async function seal(attempt) {
    const settings = settingsOf(projectOf(attempt.projectId))
    const path = attempt.workspaces.developer.path
    const names = [...(await git(path, ['diff', '--name-only', attempt.baseSha])).split('\n'), ...(await git(path, ['ls-files', '--others', '--exclude-standard'])).split('\n')].filter(Boolean)
    const roots = settings.allowedPaths
    if (!Array.isArray(roots) || !roots.length || roots.some(value => typeof value !== 'string' || value.startsWith('/') || value.includes('..')) || names.some(name => !roots.some(prefix => name === prefix || name.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)))) throw reject('Code changes exceed the provisioned repository paths')
    if (await git(path, ['status', '--porcelain'])) {
      await git(path, ['add', '--all', '--', '.'])
      await git(path, ['commit', '-m', `Implement Task ${attempt.taskId}`])
    }
    attempt.candidateSha = await git(path, ['rev-parse', 'HEAD'])
    if (attempt.candidateSha === attempt.baseSha) throw reject('Developer produced no code change')
    attempt.evidence.implementation = { sha: attempt.candidateSha, paths: names, diffStat: await git(path, ['diff', '--stat', attempt.baseSha, attempt.candidateSha]), at: Date.now() }
    for (const role of ['tester', 'reviewer']) {
      await git(attempt.workspaces[role].path, ['reset', '--hard', attempt.candidateSha])
      await git(attempt.workspaces[role].path, ['clean', '-ffdx'])
    }
  }
  async function testCandidate(attempt) {
    await verifyCandidate(attempt)
    const settings = settingsOf(projectOf(attempt.projectId))
    const path = attempt.workspaces.tester.path
    await git(path, ['reset', '--hard', attempt.candidateSha])
    await git(path, ['clean', '-ffdx'])
    const [command, ...args] = settings.testCommand
    let passed = false
    let output = ''
    try {
      const result = await exec(command, args, { cwd: path, env: cleanEnv(), timeout: Math.min(settings.testTimeoutMs ?? 120_000, 300_000), maxBuffer: 1024 * 1024 })
      passed = true
      output = result.stdout + result.stderr
    } catch (error) { output = String(error.stdout ?? '') + String(error.stderr ?? '') + '\nTest process failed or exceeded its limit' }
    await mkdir(join(artifacts, attempt.id), { recursive: true, mode: 0o700 })
    const log = join(artifacts, attempt.id, 'tests.log')
    await writeFile(log, output, { mode: 0o600 })
    attempt.evidence.tests = { sha: attempt.candidateSha, passed, command: settings.testCommand, log, sha256: hash(output), at: Date.now() }
    if (!passed) throw reject('Configured tests failed; see Attempt evidence')
  }
  async function review(attempt, outputs) {
    await verifyCandidate(attempt)
    const path = attempt.workspaces.reviewer.path
    if (await git(path, ['rev-parse', 'HEAD']) !== attempt.candidateSha || await git(path, ['status', '--porcelain'])) throw reject('Reviewer did not inspect the clean candidate commit')
    let result
    try { result = typeof outputs?.review === 'string' ? JSON.parse(outputs.review) : outputs?.review } catch { throw reject('Review output must be commit-specific JSON') }
    if (!result || result.commit !== attempt.candidateSha || !['approve', 'request-changes'].includes(result.verdict) || typeof result.summary !== 'string' || !result.summary.trim()) throw reject('Review verdict is missing or names a different commit')
    attempt.evidence.review = { sha: result.commit, verdict: result.verdict, summary: result.summary.slice(0, 8000), at: Date.now() }
    if (result.verdict !== 'approve') throw reject('Reviewer requested changes')
    if (attempt.evidence.tests?.sha !== attempt.candidateSha || !attempt.evidence.tests.passed) throw reject('Matching passing tests are missing')
    if (attempt.cancelRequested) throw reject('Delivery was stopped')
    attempt.pr = await publisherOf(projectOf(attempt.projectId)).publish(attempt, projectOf(attempt.projectId))
    if (attempt.pr.sha !== attempt.candidateSha) throw reject('Published PR does not match candidate')
    if (attempt.cancelRequested) throw reject('Delivery was stopped')
    attempt.status = 'waiting-acceptance'
    if (rt.taskDeliveryState?.(attempt.taskId, attempt.id, 'result-ready', 'Delivery evidence ready for human acceptance') === false) throw reject('Task ended before delivery evidence was ready')
  }
  async function gate({ taskId, workflowId, runId, nodeId, outputs, ok = true }) {
    const attempt = current(taskId)
    if (attempt?.cancelRequested) throw reject('Delivery was stopped')
    if (!attempt || attempt.workflowId !== workflowId) throw reject('Delivery Attempt/Workflow mismatch')
    if (['accepted', 'cancelled'].includes(taskOf(taskId)?.status)) throw reject('Task has already ended')
    const completed = nodeId === 'developer' ? attempt.evidence.implementation : nodeId === 'tester' ? attempt.evidence.tests?.passed && attempt.evidence.tests : nodeId === 'reviewer' ? attempt.evidence.review?.verdict === 'approve' && attempt.pr : null
    if (completed && ['running', 'waiting-acceptance'].includes(attempt.status) && attempt.runId === runId) {
      await verifyCandidate(attempt)
      return { candidateSha: attempt.candidateSha, already: true }
    }
    if (attempt.status !== 'running') throw reject('Attempt is no longer running')
    if (attempt.runId && attempt.runId !== runId) throw reject('Attempt Run mismatch')
    attempt.runId = runId
    try {
      if (!ok) throw reject(`${nodeId} failed`)
      if (nodeId === 'developer') await seal(attempt)
      else if (nodeId === 'tester') await testCandidate(attempt)
      else if (nodeId === 'reviewer') await review(attempt, outputs)
      else throw reject('Unknown delivery role')
      attempt.updatedAt = Date.now()
      await rt.save()
      return { candidateSha: attempt.candidateSha }
    } catch (error) { await fail(attempt, error); throw error }
  }
  async function accept(body, actor) {
    const attempt = ownEntry(attempts(), body.attemptId)
    if (!attempt) throw reject('Unknown Attempt')
    rt.requireProjectAccess(actor, attempt.projectId, 'accept')
    if (attempt.status === 'accepted') return { attempt: view(attempt), already: true }
    if (attempt.status !== 'waiting-acceptance') throw reject('Attempt has not produced delivery evidence')
    await verifyCandidate(attempt)
    const task = taskOf(attempt.taskId)
    if (task.status !== 'result-ready') throw reject('Task is not waiting for delivery acceptance')
    if (task.title !== attempt.requirement.title || (task.criteria ?? '') !== attempt.requirement.criteria) throw reject('Requirements changed; delivery evidence is stale')
    if (!attempt.runId || ownEntry(state.projectExecutions, attempt.runId)?.status !== 'done') throw reject('Delivery Run has not finished successfully')
    if (!attempt.pr || !attempt.evidence.tests?.passed || attempt.evidence.tests.sha !== attempt.candidateSha || attempt.evidence.review?.sha !== attempt.candidateSha || attempt.evidence.review.verdict !== 'approve') throw reject('Delivery evidence is missing or stale')
    const testLog = await readFile(attempt.evidence.tests.log, 'utf8')
    if (hash(testLog) !== attempt.evidence.tests.sha256) throw reject('Test log changed; evidence is stale')
    const pr = await publisherOf(projectOf(attempt.projectId)).read(attempt.pr)
    if (pr.sha !== attempt.candidateSha || pr.state !== 'open') throw reject('PR changed or closed; evidence is stale')
    attempt.status = 'accepted'
    attempt.acceptedBy = actor.memberId
    attempt.acceptedAt = Date.now()
    rt.taskDeliveryState?.(attempt.taskId, attempt.id, 'accepted', 'Human accepted commit-specific evidence', actor)
    await rt.save()
    return { attempt: view(attempt) }
  }
  async function cleanup(body, actor) {
    const attempt = ownEntry(attempts(), body.attemptId)
    if (!attempt) throw reject('Unknown Attempt')
    rt.requireProjectAccess(actor, attempt.projectId)
    if (!['owner', 'maintainer'].includes(rt.projectRoleOf?.(projectOf(attempt.projectId), actor.memberId))) throw reject('Only a Project manager may clean workspaces')
    if (ongoing.has(attempt.status) || attempt.status === 'waiting-acceptance') throw reject('Active delivery workspaces cannot be cleaned')
    for (const workspace of Object.values(attempt.workspaces)) {
      if (workspace.status === 'released') continue
      if (!inside(root, resolve(workspace.path)) || workspace.attemptId !== attempt.id) throw reject('Workspace is outside the owned delivery root')
      const actual = await realpath(workspace.path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (actual && !inside(root, actual)) throw reject('Workspace resolves outside the delivery root')
      const registered = (await git(workspace.repository, ['worktree', 'list', '--porcelain'])).split('\n').includes(`worktree ${workspace.path}`)
      if (registered) await git(workspace.repository, ['worktree', 'remove', '--force', workspace.path])
      else if (actual) await rm(workspace.path, { recursive: true, force: true })
      workspace.status = 'released'
      workspace.releasedAt = Date.now()
      if (ownEntry(state.projectWorkspaces, workspace.id)) Object.assign(state.projectWorkspaces[workspace.id], { status: workspace.status, releasedAt: workspace.releasedAt })
    }
    await rt.save()
    rt.projectScheduler?.wake()
    return { attempt: view(attempt) }
  }
  async function endpoint(endpoint, body, actor) {
    if (endpoint === 'project-attempt-stop') {
      const attempt = ownEntry(attempts(), body.attemptId)
      if (!attempt) throw reject('Unknown Attempt')
      rt.requireProjectAccess(actor, attempt.projectId, 'run-control')
      if (!ongoing.has(attempt.status)) return { attempt: view(attempt), already: true }
      attempt.cancelRequested = true
      await rt.save()
      return serial(() => serialAttempt(attempt.id, async () => {
      if (attempt.runId) {
        const result = await rt.flybotEndpoint('workflow/reset', { workflowId: attempt.workflowId, runId: attempt.runId }, { actor })
        if (result?.ok === false) throw reject(result.error)
      }
      const remaining = Object.values(state.bots).filter(bot => bot.ephemeral && bot.attemptId === attempt.id)
      if (remaining.length) return { attempt: view(attempt), stopping: true, remainingWorkers: remaining.length }
      await fail(attempt, new Error('Stopped by an authorized Project member'), 'cancelled')
      rt.projectScheduler?.wake()
      return { attempt: view(attempt) }
      }))
    }
    if (endpoint === 'project-attempt-log') {
      const attempt = ownEntry(attempts(), body.attemptId)
      if (!attempt) throw reject('Unknown Attempt')
      rt.requireProjectAccess(actor, attempt.projectId)
      const evidence = attempt.evidence.tests
      if (!evidence?.log) return { text: null, reason: 'No test log is available' }
      const text = await readFile(evidence.log, 'utf8')
      if (hash(text) !== evidence.sha256) throw reject('Test log changed; evidence is stale')
      return { text, sha: evidence.sha, sha256: evidence.sha256 }
    }
    if (endpoint === 'project-task-run') return serial(() => start(body, actor))
    if (endpoint === 'project-task-reject') return serialAttempt(body.attemptId, async () => {
      const attempt = ownEntry(attempts(), body.attemptId)
      if (!attempt) throw reject('Unknown Attempt')
      rt.requireProjectAccess(actor, attempt.projectId, 'accept')
      if (attempt.status !== 'waiting-acceptance') throw reject('Attempt is not waiting for acceptance')
      await fail(attempt, new Error(String(body.reason ?? 'Human requested changes').slice(0, 1000)))
      return { attempt: view(attempt) }
    })
    if (endpoint === 'project-task-accept') return serialAttempt(body.attemptId, () => accept(body, actor))
    if (endpoint === 'project-attempt-cleanup') return serialAttempt(body.attemptId, () => cleanup(body, actor))
    const task = taskOf(body.taskId)
    if (!task?.projectId) throw reject('Unknown Project Task')
    rt.requireProjectAccess(actor, task.projectId)
    return { task: structuredClone(task), attempts: Object.values(attempts()).filter(attempt => attempt.taskId === task.id).map(view) }
  }
  function recover() {
    if (recovered || rt.readOnly?.()) return false
    recovered = true
    let changed = false
    for (const attempt of Object.values(attempts())) {
      if (!ongoing.has(attempt.status)) continue
      attempt.status = 'interrupted'
      attempt.failure = { message: 'Host restarted before delivery completed; start a new Attempt', at: Date.now() }
      rt.taskDeliveryState?.(attempt.taskId, attempt.id, 'failed', attempt.failure.message)
      if (attempt.runId && ownEntry(state.projectExecutions, attempt.runId)) state.projectExecutions[attempt.runId].status = 'interrupted'
      changed = true
    }
    return changed
  }
  function runReported(run) {
    const attempt = run.attemptId ? ownEntry(attempts(), run.attemptId) : current(run.taskId)
    if (!attempt || attempt.taskId !== run.taskId || attempt.projectId !== run.projectId || (attempt.runId && attempt.runId !== run.id) || !['running', 'waiting-acceptance'].includes(attempt.status)) return
    if (run.attemptId) attempt.runId = run.id
    if (run.status === 'done' && attempt.status === 'waiting-acceptance') return
    if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'done') {
      attempt.status = 'failed'
      attempt.failure = { message: run.status === 'done' ? 'Workflow ended without validated delivery evidence' : `Workflow ${run.status}`, at: Date.now() }
      rt.taskDeliveryState?.(attempt.taskId, attempt.id, 'failed', attempt.failure.message)
    }
  }
  const ownsWorkspace = (projectId, path) => Object.values(state.projectWorkspaces ?? {}).find(workspace => workspace.projectId === projectId && workspace.path === path && workspace.kind === 'worktree' && workspace.status === 'allocated' && ongoing.has(ownEntry(attempts(), workspace.attemptId)?.status))
  return { endpoint, context, recover, runReported, ownsWorkspace, gate: input => serialAttempt(current(input.taskId)?.id ?? input.taskId, () => gate(input)) }
}

export function install(rt) {
  rt.projectDelivery = createProjectDelivery(rt)
  rt.taskNeedsDelivery = task => Boolean(task?.projectId && ownEntry(rt.config.projectRepositories ?? {}, rt.readProject(task.projectId)?.repository))
}
