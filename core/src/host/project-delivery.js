// Delivery coordinates artifacts/worktrees around the existing Workflow service.
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rm, writeFile, lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { ownEntry, setEntry } from './store.js'
import { DELIVERY_ROLES, DELIVERY_VERSION, deliveryGraph } from './project-delivery-template.js'
import { repositorySettings, preflightRepository } from './project-repository-policy.js'
import { createResourceWorkspaces, fileDigest } from './project-resource-workspaces.js'
import { ROLE_POLICY_FILES, assembleRolePolicy, verifyRolePolicy, deliveryReviewReport, checkDevelopmentEvidence } from './project-role-policy.js'
import { roleContext, contextHash } from './project-role-context.js'
import { githubPublisher } from './project-github.js'

const exec = promisify(execFile)
const hash = value => createHash('sha256').update(value).digest('hex')
const ongoing = new Set(['preparing', 'running'])
const reject = message => Object.assign(new Error(message), { code: 'bot/delivery' })
const inside = (root, path) => { const rel = relative(root, path); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) }
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|PASSWORD|SECRET|API_KEY|GIT_CONFIG|NODE_OPTIONS/.test(key)))
async function git(path, args, preserveWhitespace = false) {
  const { stdout } = await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: path, timeout: 30_000, maxBuffer: 2 * 1024 * 1024, env: { ...cleanEnv(), GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'FlyBot project automation', GIT_AUTHOR_EMAIL: 'flybot-project@localhost',
      GIT_COMMITTER_NAME: 'FlyBot project automation', GIT_COMMITTER_EMAIL: 'flybot-project@localhost' },
  })
  return preserveWhitespace ? stdout : stdout.trim()
}

export function createProjectDelivery(rt, { publisher } = {}) {
  const { state, config } = rt
  const root = resolve(config.projectWorkspaceRoot ?? join(dirname(rt.dshHome), 'flybot-workspaces'))
  const artifacts = resolve(rt.home, 'project-artifacts')
  const resourceWorkspaces = createResourceWorkspaces(rt, { hostGit: git, artifacts })
  const workspaceGit = (workspace, args) => {
    if (workspace.resourceLease) rt.projectResources.requireBinding(workspace.projectId, workspace.resourceLease)
    return workspace.kind === 'resource-clone' ? resourceWorkspaces.git(workspace, args) : git(workspace.path, args)
  }
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
    for (const lease of Object.values(attempt.resourceLeases ?? {})) await rt.projectResources?.release(lease.id, lease.generation)
    await rt.save()
  }
  async function allocate(attempt, project, settings, roles = DELIVERY_ROLES) {
    const repository = await realpath(settings.path)
    attempt.baseSha ??= await git(repository, ['rev-parse', 'HEAD'])
    attempt.branch = `flybot/delivery-${attempt.id.slice(-12)}`
    await mkdir(root, { recursive: true, mode: 0o700 })
    if (await realpath(root) !== root) throw reject('Delivery root must not be a symlink')
    for (const role of roles) {
      if (attempt.workspaces[role]) continue
      if (attempt.cancelRequested) throw reject('Delivery was stopped')
      const lease = attempt.resourceLeases?.[role]
      const resource = lease ? rt.projectResources.requireBinding(project.id, lease) : null
      const workspaceRoot = resource?.root ?? root
      const path = resource ? join(workspaceRoot, 'delivery', attempt.id, role) : join(root, attempt.id, role)
      if (!resource || resource.type === 'local') await mkdir(resource ? join(workspaceRoot, 'delivery', attempt.id) : join(root, attempt.id), { recursive: true, mode: 0o700 })
      const workspace = { id: `workspace-${randomUUID()}`, projectId: project.id, attemptId: attempt.id, role, path, repository,
        kind: resource?.type === 'docker' ? 'resource-clone' : 'worktree', resourceId: lease?.resourceId ?? null, resourceRoot: workspaceRoot, ...(lease ? { resourceLease: lease } : {}), status: 'allocating', createdAt: Date.now() }
      setEntry(state.projectWorkspaces, workspace.id, workspace)
      attempt.workspaces[role] = workspace
      await rt.save() // Persist cleanup intent before git creates the worktree.
      const args = role === 'developer' ? ['worktree', 'add', '-b', attempt.branch, path, attempt.baseSha] : ['worktree', 'add', '--detach', path, attempt.baseSha]
      if (workspace.kind === 'resource-clone') await resourceWorkspaces.allocate(workspace, attempt)
      else await git(repository, args)
      workspace.status = 'allocated'
      await rt.save()
    }
    if (!attempt.workspaces['host-verifier'] && Object.values(attempt.workspaces).some(row => row.kind === 'resource-clone')) {
      const path = join(root, attempt.id, 'host-verifier')
      const workspace = { id: `workspace-${randomUUID()}`, projectId: project.id, attemptId: attempt.id, role: 'host-verifier', path, repository,
        kind: 'worktree', resourceId: null, resourceRoot: root, status: 'allocating', createdAt: Date.now() }
      setEntry(state.projectWorkspaces, workspace.id, workspace); attempt.workspaces['host-verifier'] = workspace; await rt.save()
      await git(repository, ['worktree', 'add', '--detach', path, attempt.baseSha]); workspace.status = 'allocated'; await rt.save()
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
    const settings = await preflightRepository(rt, project)
    const previous = current(task.id)
    const feedback = previous?.failure ? { previousAttemptId: previous.id, kind: previous.returned ? 'human-return' : 'execution-failure', reason: previous.failure.message, candidateSha: previous.candidateSha ?? null } : null
    const at = Date.now()
    const attempt = { id: `attempt-${randomUUID()}`, projectId: project.id, taskId: task.id, requestKey,
      workflowVersion: DELIVERY_VERSION, status: 'preparing', initiatedBy: actor.memberId, executionOwnerId: project.ownerUserId,
      requirement: { title: task.title, criteria: task.criteria ?? '', note: task.note ?? '', repository: project.repository },
      ...(feedback ? { feedback } : {}), workspaces: {}, evidence: {}, createdAt: at, updatedAt: at }
    setEntry(attempts(), attempt.id, attempt)
    task.deliveryAttemptId = attempt.id
    await rt.save() // Reserve idempotency and ownership before any filesystem effects.
    try {
      const definitions = rt.projectAgents?.deliveryDefinitions(project.id)
      attempt.agentDefinitions = definitions
      if (config.projectDispatch !== 'workflow') {
        attempt.protocol = 'project-handoff/v1'
        attempt.workflowVersion = 'project-delivery/pools-v1'
        attempt.baseSha = await git(settings.path, ['rev-parse', 'HEAD'])
        attempt.roleSessions = {}; attempt.rolePolicies = {}; attempt.resourceLeases = {}
        attempt.runId = `pool-run-${randomUUID()}`
        attempt.status = 'running'
        rt.bindProject({ kind: 'run', id: attempt.runId, projectId: project.id, taskId: task.id, attemptId: attempt.id, status: 'queued' })
        await rt.projectPools.admit(attempt, actor, body)
        await rt.save()
        return { attempt: view(attempt) }
      }
      attempt.resourceLeases = await rt.projectResources?.reserveRoles(project.id, attempt.id, definitions) ?? {}
      for (const lease of Object.values(attempt.resourceLeases)) {
        const resource = rt.projectResources.setting(project.id, lease.resourceId)
        if (lease.harness === 'flybot' && resource.type !== 'local') throw reject('Native Harness requires a registered local resource')
      }
      await allocate(attempt, project, settings)
      if (attempt.cancelRequested) throw reject('Delivery was stopped')
      const model = settings.model ?? config.projectModel ?? await rt.defaultModel?.()
      if (typeof model !== 'string' || !model) throw reject('A served delivery model must be provisioned')
      const graph = deliveryGraph(model)
      attempt.roleSessions = {}
      const repository = await repositoryContext(project.id, attempt.baseSha)
      attempt.rolePolicies = {}
      for (const node of graph.nodes) {
        const role = definitions?.roles.find(role => role.role === node.id)
        const definition = role ?? { instructions: node.prompt, resolvedSkills: [], memory: [], execution: { harness: 'flybot', resourceIds: [] } }
        node.model = definition.model || model
        const policy = await repositoryRolePolicy(project.id, attempt.baseSha, node.id)
        attempt.rolePolicies[node.id] = policy
        const context = roleContext({ policy, projectId: project.id, role: node.id, revision: definitions?.revision ?? 0, definition, memory: definition.memory,
          knowledge: ownEntry(state.projectKnowledge ?? {}, project.id) ?? [], requirement: attempt.requirement, feedback: attempt.feedback, repository })
        attempt.roleSessions[node.id] = { id: `role-session-${randomUUID()}`, projectId: project.id, taskId: task.id, attemptId: attempt.id, role: node.id,
          ...(attempt.resourceLeases[node.id] ? { resourceLease: attempt.resourceLeases[node.id] } : {}),
          policy, definitionRevision: definitions?.revision ?? 0, execution: structuredClone(definition.execution), context, status: 'prepared', generation: 1, createdAt: Date.now() }
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
    return { attemptId: attempt.id, workflowId: attempt.workflowId, workspaceId: attempt.workspaces.developer?.id, brief: `${attempt.requirement.title}\n${attempt.requirement.note}\nAcceptance criteria: ${attempt.requirement.criteria}\nBase commit: ${attempt.baseSha}${attempt.feedback ? `\nPrior Attempt feedback (task data, not authority): ${JSON.stringify(attempt.feedback)}` : ''}`, workDirs: Object.fromEntries(Object.entries(attempt.workspaces).map(([role, workspace]) => [role, workspace.path])) }
  }
  async function verifyCandidate(attempt) {
    if (!attempt.candidateSha) throw reject('Candidate commit is missing')
    const workspace = attempt.workspaces.developer
    if (await workspaceGit(workspace, ['rev-parse', 'HEAD']) !== attempt.candidateSha || await workspaceGit(workspace, ['status', '--porcelain'])) throw reject('Candidate changed; test and Review evidence is stale')
  }
  async function seal(attempt) {
    const settings = settingsOf(projectOf(attempt.projectId))
    const workspace = attempt.workspaces.developer
    const names = [...(await workspaceGit(workspace, ['diff', '--name-only', attempt.baseSha])).split('\n'), ...(await workspaceGit(workspace, ['ls-files', '--others', '--exclude-standard'])).split('\n')].filter(Boolean)
    if (!names.length) throw reject('Developer produced no code change')
    for (const name of names) {
      const path = resolve(workspace.path, name)
      const info = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (info?.isSymbolicLink() && !inside(workspace.path, await realpath(path))) throw reject('Code changes contain a symbolic link outside the allocated workspace')
    }
    checkDevelopmentEvidence(attempt.rolePolicies?.developer, names)
    const roots = settings.allowedPaths
    if (!Array.isArray(roots) || !roots.length || roots.some(value => typeof value !== 'string' || value.startsWith('/') || value.includes('..')) || names.some(name => !roots.some(prefix => name === prefix || name.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)))) throw reject('Code changes exceed the provisioned repository paths')
    await workspaceGit(workspace, ['reset', '--soft', attempt.baseSha]) // Seal one final commit; do not transfer intermediate worker history.
    if (await workspaceGit(workspace, ['status', '--porcelain'])) {
      await workspaceGit(workspace, ['add', '--all', '--', '.'])
      await workspaceGit(workspace, ['commit', '-m', `Implement Task ${attempt.taskId}`])
    }
    attempt.candidateSha = await workspaceGit(workspace, ['rev-parse', 'HEAD'])
    if (attempt.candidateSha === attempt.baseSha) throw reject('Developer produced no code change')
    if (workspace.kind === 'resource-clone') await resourceWorkspaces.importCandidate(workspace, attempt)
    attempt.evidence.implementation = { sha: attempt.candidateSha, paths: names, diffStat: await workspaceGit(workspace, ['diff', '--stat', attempt.baseSha, attempt.candidateSha]), at: Date.now() }
    for (const role of ['tester', 'reviewer', ...(attempt.workspaces['host-verifier'] ? ['host-verifier'] : [])]) {
      const target = attempt.workspaces[role]
      if (!target) continue
      if (target.kind === 'resource-clone') await resourceWorkspaces.checkout(target, attempt)
      else { await workspaceGit(target, ['reset', '--hard', attempt.candidateSha]); await workspaceGit(target, ['clean', '-ffdx']) }
    }
  }
  async function testCandidate(attempt) {
    await verifyCandidate(attempt)
    const settings = settingsOf(projectOf(attempt.projectId))
    const workspace = attempt.workspaces['host-verifier'] ?? attempt.workspaces.tester
    const path = workspace.path
    await workspaceGit(workspace, ['reset', '--hard', attempt.candidateSha])
    await workspaceGit(workspace, ['clean', '-ffdx'])
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
    attempt.evidence.tests = { executor: 'independent-host-controller', workspaceId: workspace.id, resourceId: workspace.resourceId, sha: attempt.candidateSha, passed, command: settings.testCommand, log, sha256: hash(output), at: Date.now() }
    if (!passed) throw reject('Configured tests failed; see Attempt evidence')
  }
  async function review(attempt, outputs) {
    await verifyCandidate(attempt)
    const workspace = attempt.workspaces.reviewer
    if (await workspaceGit(workspace, ['rev-parse', 'HEAD']) !== attempt.candidateSha || await workspaceGit(workspace, ['status', '--porcelain'])) throw reject('Reviewer did not inspect the clean candidate commit')
    let result
    try { result = typeof outputs?.review === 'string' ? JSON.parse(outputs.review) : outputs?.review } catch { throw reject('Review output must be commit-specific JSON') }
    if (!result || result.commit !== attempt.candidateSha || !['approve', 'request-changes'].includes(result.verdict) || typeof result.summary !== 'string' || !result.summary.trim()) throw reject('Review verdict is missing or names a different commit')
    const policy = attempt.rolePolicies?.reviewer
    const execution = attempt.evidence.execution?.reviewer
    const commands = []
    if (execution?.log) for (const line of (await readFile(execution.log, 'utf8')).split('\n').filter(Boolean)) {
      const item = JSON.parse(line).event?.item
      if (item?.type === 'command_execution' && typeof item.exit_code === 'number') commands.push({ command: item.command, exitCode: item.exit_code, executor: 'reviewer-sdk' })
    }
    attempt.evidence.review = { ...(policy ? { policySha256: policy.sha256, report: deliveryReviewReport({ verdict: result.verdict, sha: result.commit, commands }) } : {}), sha: result.commit, verdict: result.verdict, summary: result.summary.slice(0, 8000), at: Date.now() }
    if (result.verdict !== 'approve') throw reject('Reviewer requested changes')
    if (attempt.evidence.tests?.sha !== attempt.candidateSha || !attempt.evidence.tests.passed) throw reject('Matching passing tests are missing')
    if (attempt.cancelRequested) throw reject('Delivery was stopped')
    attempt.pr = await publisherOf(projectOf(attempt.projectId)).publish(attempt, projectOf(attempt.projectId))
    if (attempt.pr.sha !== attempt.candidateSha) throw reject('Published PR does not match candidate')
    if (attempt.cancelRequested) throw reject('Delivery was stopped')
    attempt.status = 'waiting-acceptance'
    if (rt.taskDeliveryState?.(attempt.taskId, attempt.id, 'result-ready', 'Delivery evidence ready for human acceptance') === false) throw reject('Task ended before delivery evidence was ready')
  }
  async function recordExecution(worker) {
    const attempt = ownEntry(attempts(), worker.attemptId)
    const session = attempt?.roleSessions?.[worker.role]
    if (!attempt || attempt.status !== 'running' || session?.id !== worker.sessionKey || session.botId !== worker.id || worker.projectId !== attempt.projectId || worker.taskId !== attempt.taskId || session.resourceLease?.generation !== worker.generation || session.backendSessionId !== worker.backendSessionId) throw reject('SDK evidence does not belong to this execution Session')
    if (!worker.sealedLog || await fileDigest(worker.sealedLog) !== worker.eventSha256) throw reject('SDK event evidence is missing or changed')
    attempt.evidence.execution ??= {}
    const record = { workerId: worker.id, role: worker.role, sessionId: worker.backendSessionId, resourceId: worker.resourceId, harness: worker.harness, sdkVersion: worker.sdkVersion,
      generation: worker.generation, contextSha256: session.context.sha256, log: worker.sealedLog, sha256: worker.eventSha256, resultHash: worker.resultHash, at: Date.now() }
    if (attempt.evidence.execution[worker.role] && attempt.evidence.execution[worker.role].resultHash !== record.resultHash) throw reject('SDK result was already sealed')
    attempt.evidence.execution[worker.role] = record
    await rt.save()
  }
  async function verifyExecution(attempt, role) {
    const session = attempt.roleSessions?.[role]
    if (!session || session.execution.harness === 'flybot') return
    const evidence = attempt.evidence.execution?.[role]
    if (!evidence || evidence.workerId !== session.botId || evidence.sessionId !== session.backendSessionId || evidence.generation !== session.resourceLease?.generation || evidence.contextSha256 !== session.context.sha256 || await fileDigest(evidence.log) !== evidence.sha256) throw reject('SDK execution evidence is missing, stale or changed')
  }
  async function gate({ taskId, workflowId, runId, nodeId, outputs, ok = true }) {
    const attempt = current(taskId)
    if (attempt?.cancelRequested) throw reject('Delivery was stopped')
    if (!attempt || attempt.workflowId !== workflowId) throw reject('Delivery Attempt/Workflow mismatch')
    if (['accepted', 'cancelled'].includes(taskOf(taskId)?.status)) throw reject('Task has already ended')
    for (const [role, policy] of Object.entries(attempt.rolePolicies ?? {})) verifyRolePolicy(policy, attempt.roleSessions[role]?.context.sources.policy?.sha256)
    for (const role of Object.keys(attempt.evidence.execution ?? {})) await verifyExecution(attempt, role)
    await verifyExecution(attempt, nodeId)
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
    if (attempt.protocol === 'project-handoff/v1' && attempt.chiefDecision?.verdict !== 'approve') throw reject('Chief arbitration is required before overall completion')
    if (attempt.status !== 'waiting-acceptance') throw reject('Attempt has not produced delivery evidence')
    await verifyCandidate(attempt)
    const task = taskOf(attempt.taskId)
    if (task.status !== 'result-ready') throw reject('Task is not waiting for delivery acceptance')
    if (task.title !== attempt.requirement.title || (task.criteria ?? '') !== attempt.requirement.criteria) throw reject('Requirements changed; delivery evidence is stale')
    if (!attempt.runId || ownEntry(state.projectExecutions, attempt.runId)?.status !== 'done') throw reject('Delivery Run has not finished successfully')
    if (!attempt.pr || !attempt.evidence.tests?.passed || attempt.evidence.tests.sha !== attempt.candidateSha || attempt.evidence.review?.sha !== attempt.candidateSha || attempt.evidence.review.verdict !== 'approve') throw reject('Delivery evidence is missing or stale')
    for (const role of DELIVERY_ROLES) await verifyExecution(attempt, role)
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
    if (Object.values(state.bots ?? {}).some(bot => bot.ephemeral && bot.attemptId === attempt.id)) throw reject('Native worker release has not been confirmed')
    if (Object.values(state.projectResourceLeases ?? {}).some(lease => lease.attemptId === attempt.id && lease.status !== 'released')) throw reject('Execution resource release has not been confirmed')
    for (const workspace of Object.values(attempt.workspaces)) {
      if (workspace.status === 'released') continue
      if (workspace.kind === 'resource-clone') {
        await resourceWorkspaces.cleanup(workspace)
        workspace.status = 'released'; workspace.releasedAt = Date.now()
        Object.assign(state.projectWorkspaces[workspace.id], { status: 'released', releasedAt: workspace.releasedAt }); await rt.save(); continue
      }
      const ownedRoot = workspace.resourceRoot ?? root
      if (!inside(ownedRoot, resolve(workspace.path)) || workspace.attemptId !== attempt.id) throw reject('Workspace is outside the owned delivery root')
      const actual = await realpath(workspace.path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (actual && !inside(ownedRoot, actual)) throw reject('Workspace resolves outside the delivery root')
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
      if (attempt.protocol === 'project-handoff/v1') {
        const claim = taskOf(attempt.taskId)?.collaboration?.claim
        if (claim?.workerId) {
          if (state.projectHarnessWorkers?.[claim.workerId]) await rt.projectHarness.release(claim.workerId)
          else await rt.flybot.scope('flybot-workflow').bot.remove(claim.workerId)
        }
        if (claim) claim.status = 'cancelled'
        const collaboration = taskOf(attempt.taskId)?.collaboration
        if (collaboration) { collaboration.status = 'cancelled'; ++collaboration.generation }
      }
      if (attempt.runId && attempt.protocol !== 'project-handoff/v1') {
        const result = await rt.flybotEndpoint('workflow/reset', { workflowId: attempt.workflowId, runId: attempt.runId }, { actor })
        if (result?.ok === false) throw reject(result.error)
      }
      const remaining = [...Object.values(state.bots).filter(bot => bot.ephemeral && bot.attemptId === attempt.id), ...Object.values(state.projectResourceLeases ?? {}).filter(lease => lease.attemptId === attempt.id && lease.worker?.kind === 'sdk' && lease.status !== 'released')]
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
      const evidence = body.role ? attempt.evidence.execution?.[body.role] : attempt.evidence.tests
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
      attempt.returned = { by: actor.memberId, at: Date.now() }
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
  async function preparePoolRole(task, claim, definition) {
    const attempt = ownEntry(attempts(), claim.attemptId)
    if (!attempt || attempt.taskId !== task.id || attempt.protocol !== 'project-handoff/v1' || attempt.status !== 'running') throw reject('Pool Attempt is unavailable')
    const role = definition.role, project = projectOf(task.projectId)
    const settings = await preflightRepository(rt, project)
    const policy = await repositoryRolePolicy(project.id, attempt.baseSha, role)
    const sessionId = `role-session-${randomUUID()}`
    const execution = definition.execution
    const lease = execution.resourceIds?.length ? await rt.projectResources.reserve({ projectId: project.id, attemptId: attempt.id, role, sessionKey: sessionId, ...execution }) : null
    if (lease) attempt.resourceLeases[role] = lease
    await allocate(attempt, project, settings, [role])
    const workspace = attempt.workspaces[role]
    if (lease) workspace.resourceLease = lease
    if (attempt.seedSha && role === 'developer' && !attempt.candidateSha) await workspaceGit(workspace, ['reset', '--hard', attempt.seedSha])
    if (attempt.candidateSha) {
      if (workspace.kind === 'resource-clone') await resourceWorkspaces.checkout(workspace, attempt)
      else await workspaceGit(workspace, ['reset', '--hard', attempt.candidateSha])
    }
    const context = roleContext({ policy, projectId: project.id, role, revision: attempt.agentDefinitions.revision, definition, memory: definition.memory, knowledge: ownEntry(state.projectKnowledge ?? {}, project.id) ?? [], requirement: attempt.requirement, feedback: attempt.feedback, repository: await repositoryContext(project.id, attempt.baseSha) })
    attempt.rolePolicies[role] = policy
    const session = { id: sessionId, projectId: project.id, taskId: task.id, attemptId: attempt.id, role, execution: cloneExecution(execution), policy, context, generation: claim.generation, poolClaimId: claim.id, status: 'prepared', ...(lease ? { resourceLease: lease } : {}) }
    if (attempt.roleSessions[role]) {
      (attempt.roleSessionHistory ??= []).push(structuredClone({ ...attempt.roleSessions[role], executionEvidence: attempt.evidence.execution?.[role] ?? null }))
      if (attempt.evidence.execution) delete attempt.evidence.execution[role]
    }
    attempt.roleSessions[role] = session
    rt.taskDeliveryState?.(task.id, attempt.id, 'working', `${definition.name} claimed the Task`)
    rt.bindProject({ kind: 'run', id: attempt.runId, projectId: project.id, taskId: task.id, attemptId: attempt.id, status: 'running' })
    await rt.save()
    const prompt = `Read your assigned Task and role policy. Choose to work, return or transfer based on the actual requirements. You may go directly to another logical Bot without Chief approval. Only Chief can judge overall completion. Never close the Task yourself.\nLogical Bots: ${JSON.stringify(rt.projectAgents.deliveryDefinitions(project.id).roles.map(row => ({ id: row.id, role: row.role })))}\nFinish with OUTPUT handoff: a single-line JSON object {"action":"handoff|return|transfer|complete|arbitrate","to":"logical Bot id when handing off or returning","reason":"specific reason","outputs":{}}. For completed developer work include outputs.implementation, tester work outputs.tests; review outputs.review must be a JSON string with the exact commit, verdict and summary. Use transfer to route without claiming your role work is complete. Choose the next Bot based on evidence; no fixed order is required. Missing evidence or uncertainty should request Chief judgement.\nTask kind: ${task.collaboration.kind}`
    return { nodeId: role, name: definition.name, role: definition.name, prompt, model: definition.model || settings.model, tools: [], executionProjectId: project.id, executionWorkDir: workspace.path }
  }
  async function completePoolRole({ task, claim, role, outputs }) {
    const attempt = ownEntry(attempts(), claim.attemptId)
    if (!attempt || attempt.status !== 'running') throw reject('Pool Attempt is no longer running')
    for (const [name, policy] of Object.entries(attempt.rolePolicies)) verifyRolePolicy(policy, attempt.roleSessions[name]?.context.sources.policy?.sha256)
    await verifyExecution(attempt, role)
    if (task.collaboration.kind !== 'code') {
      attempt.evidence[role] = { outputs: structuredClone(outputs), at: Date.now(), policySha256: attempt.rolePolicies[role].sha256 }
    } else if (role === 'developer') await seal(attempt)
    else if (role === 'tester') await testCandidate(attempt)
    else if (role === 'reviewer') await review(attempt, outputs)
    await rt.save()
  }
  async function reworkPool({ task, claim, reason }) {
    const previous = ownEntry(attempts(), claim.attemptId)
    if (!previous?.candidateSha) return previous.id
    const id = `attempt-${randomUUID()}`
    previous.status = 'returned'; previous.returned = { at: Date.now(), by: claim.botId, reason }
    const next = { id, protocol: previous.protocol, projectId: previous.projectId, taskId: task.id, requestKey: hash(`${task.projectId}\n${task.id}\n${claim.id}`), workflowVersion: previous.workflowVersion, status: 'running', initiatedBy: previous.initiatedBy, executionOwnerId: previous.executionOwnerId, baseSha: previous.baseSha, seedSha: previous.candidateSha, requirement: structuredClone(previous.requirement), feedback: { previousAttemptId: previous.id, kind: 'bot-return', reason, candidateSha: previous.candidateSha }, agentDefinitions: rt.projectAgents.deliveryDefinitions(task.projectId), roleSessions: {}, rolePolicies: {}, resourceLeases: {}, workspaces: {}, evidence: {}, createdAt: Date.now(), updatedAt: Date.now(), runId: `pool-run-${randomUUID()}` }
    setEntry(attempts(), id, next); task.deliveryAttemptId = id
    rt.bindProject({ kind: 'run', id: previous.runId, projectId: task.projectId, taskId: task.id, attemptId: previous.id, status: 'failed' })
    rt.bindProject({ kind: 'run', id: next.runId, projectId: task.projectId, taskId: task.id, attemptId: id, status: 'queued' })
    await rt.save()
    return id
  }
  const cloneExecution = execution => structuredClone(execution)
  async function repositoryRolePolicy(projectId, commit, role) {
    const project = projectOf(projectId)
    const settings = settingsOf(project)
    const configured = settings.rolePolicySources?.[role]
    const names = configured ?? [...ROLE_POLICY_FILES.common, ...ROLE_POLICY_FILES[role]]
    if (!Array.isArray(names) || names.length > 40 || names.some(name => typeof name !== 'string' || name.startsWith('/') || name.includes('..') || /[\\\r\n\0]/.test(name))) throw reject('Role policy source list is invalid')
    const sources = []
    for (const name of [...new Set(names)]) {
      const entry = await git(settings.path, ['ls-tree', commit, '--', name])
      if (!entry) continue
      if (!/^100(?:644|755) blob /.test(entry)) throw reject('Role policy source must be a regular repository file')
      sources.push({ name, commit, text: await git(settings.path, ['show', `${commit}:${name}`], true) })
    }
    let profile = settings.rolePolicyProfile ?? 'repository'
    if (!settings.rolePolicyProfile && await git(settings.path, ['ls-tree', '--name-only', commit, '--', 'package.json'])) {
      const entry = JSON.parse(await git(settings.path, ['show', `${commit}:package.json`]))
      if (entry.name === 'flybot' && await git(settings.path, ['ls-tree', '--name-only', commit, '--', 'core/cordis.patch.yml'])) profile = 'flybot-development'
    }
    const requiredFiles = settings.requiredRolePolicySources?.[role] ?? (profile === 'flybot-development' ? [...ROLE_POLICY_FILES.common.filter(name => !name.startsWith('decisions/')), ...ROLE_POLICY_FILES[role]] : configured ?? [])
    return assembleRolePolicy({ role, commit, sources, requiredFiles, profile })
  }
  async function repositoryContext(projectId, commit) {
    const project = projectOf(projectId)
    if (!ownEntry(config.projectRepositories ?? {}, project?.repository)) return []
    const settings = settingsOf(project)
    commit ??= await git(settings.path, ['rev-parse', 'HEAD'])
    const rows = []
    for (const name of ['AGENTS.md', 'PROJECT.md', 'ROADMAP.md', 'LESSONS.md']) {
      const exists = await git(settings.path, ['ls-tree', '--name-only', commit, '--', name])
      if (!exists) continue
      const text = await git(settings.path, ['show', `${commit}:${name}`])
      rows.push({ name, text: text.slice(0, 6000), truncated: text.length > 6000, totalCharacters: text.length, sha256: contextHash(text), commit })
    }
    return rows
  }
  function sessionFor(workspace) {
    const attempt = ownEntry(attempts(), workspace?.attemptId)
    if (!attempt || attempt.projectId !== workspace.projectId || attempt.workspaces[workspace.role]?.id !== workspace.id) throw reject('Foreign execution Workspace')
    return attempt.roleSessions?.[workspace.role]
  }
  async function bindSession(workspace, bot) {
    const session = sessionFor(workspace)
    if (!session) return // Legacy v1 Attempts have no execution-session snapshot.
    if (session.status === 'released') throw reject('Execution Session was released')
    if (session.botId && (session.botId !== bot.id || session.sessionId !== bot.sessionId)) throw reject('Execution Session is already bound')
    session.botId = bot.id
    session.sessionId = bot.sessionId
    session.status = 'bound'
    if (session.resourceLease) await rt.projectResources?.markStarted(session.resourceLease.id, session.resourceLease.generation, bot.kind === 'sdk' ? { kind: 'sdk', handle: bot.id } : { kind: 'native', botId: bot.id })
    await rt.save()
  }
  async function releaseSession(botId) {
    for (const attempt of Object.values(attempts())) for (const session of Object.values(attempt.roleSessions ?? {})) {
      if (session.botId !== botId || session.status === 'released') continue
      session.status = 'released'
      session.releasedAt = Date.now()
      if (session.resourceLease) await rt.projectResources?.release(session.resourceLease.id, session.resourceLease.generation)
      await rt.save()
    }
  }
  const ownsWorkspace = (projectId, path) => Object.values(state.projectWorkspaces ?? {}).find(workspace => workspace.projectId === projectId && workspace.path === path && DELIVERY_ROLES.includes(workspace.role) && ['worktree', 'resource-clone'].includes(workspace.kind) && workspace.status === 'allocated' && ongoing.has(ownEntry(attempts(), workspace.attemptId)?.status))
  return { endpoint, context, preparePoolRole, completePoolRole, reworkPool, recordExecution, repositoryContext, repositoryRolePolicy, bindSession, releaseSession, sessionFor, recover, runReported, ownsWorkspace, gate: input => serialAttempt(current(input.taskId)?.id ?? input.taskId, () => gate(input)) }
}

export function install(rt) {
  rt.projectDelivery = createProjectDelivery(rt)
  rt.taskNeedsDelivery = task => Boolean(task?.projectId && ownEntry(rt.config.projectRepositories ?? {}, rt.readProject(task.projectId)?.repository))
}
