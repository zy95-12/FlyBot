// Opt-in paid acceptance. No credential values are returned in this report.
import assert from 'node:assert/strict'
import { isAbsolute, dirname } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolveGithubIdentity, githubPublisher } from '../../core/src/host/project-github.js'

export function codexSettings(argv) {
  const value = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined
  const configDir = value('--codex-profile'), model = value('--codex-model'), login = value('--github-login')
  const repository = value('--github-repo'), githubConfigDir = value('--github-config-dir')
  if (['--live-check', '--real-model', '--workbench', '--workbench-serve', '--shared'].some(flag => argv.includes(flag))) throw new Error('Codex acceptance requires its dedicated mode; do not combine native/browser modes')
  if (!isAbsolute(configDir ?? '') || !model || model.startsWith('--') || !login || !isAbsolute(githubConfigDir ?? '') || !repository?.startsWith(`${login}/`)) throw new Error('Codex acceptance requires explicit absolute --codex-profile, --codex-model, --github-login, owned --github-repo and absolute --github-config-dir')
  return { configDir, home: dirname(configDir), model, login, repository, githubConfigDir }
}

export async function checkCodexDelivery({ api, saved, waitFor, settings, artifacts }) {
  const identity = await resolveGithubIdentity({ credential: 'gh-cli', configDir: settings.githubConfigDir, login: settings.login })
  assert.equal(identity.login, settings.login)
  const invitation = await api('auth-invite')
  const human = await api('auth-redeem', { token: invitation.token, displayName: settings.login })
  const owner = (endpoint, body = {}) => api(endpoint, body, human.sessionToken)
  const { project } = await owner('project-create', { name: 'M7 actual local Codex acceptance', repository: settings.repository })
  const execution = { harness: 'codex', resourceIds: ['codex-local'], model: settings.model, maxConcurrent: 1 }
  for (const role of ['chief', 'developer', 'tester', 'reviewer']) {
    const { memory } = await owner('project-role-memory-write', { projectId: project.id, role, text: 'M7_CODEX_PUBLIC_MEMORY: this is an isolated validation artifact; inspect actual code and evidence, never merge or change credentials.', source: { kind: 'human', reference: 'Owner-authorized local Codex acceptance 2026-11-01' } })
    await owner('project-agent-definition', { projectId: project.id, role, memoryRefs: [memory.id], execution })
  }
  const health = await owner('project-runtime-check', { projectId: project.id, resourceId: 'codex-local', harness: 'codex', role: 'developer' })
  assert.equal(health.status, 'ready', health.reason)
  const title = '[M7 real Codex artifact] Fix numeric addition'
  const criteria = 'This is an isolated integration artifact, not a FlyBot product change. Edit only code.mjs and code.test.mjs. Export add(a,b) computing numeric addition for positive, negative, zero and fractional inputs; use node tests with explicit regression cases. Do not modify repository policy/configuration, publish or merge. Host independently tests sealed code and publishes a draft artifact PR.'
  await owner('project-agent-message', { projectId: project.id, visibility: 'public', text: `Create exactly one shared Task. Title: ${title}. Criteria: ${criteria}. Do not run it yet. Return the scoped task proposal JSON; no tools.` })
  const task = await waitFor(() => Object.values(saved().tasks ?? {}).find(row => row.projectId === project.id), 'real Codex Chief creates Task')
  assert.equal(task.title, title)
  assert.match(task.criteria, /code\.mjs/)
  await waitFor(() => Object.values(saved().projectHarnessWorkers ?? {}).filter(row => row.projectId === project.id).every(row => row.status === 'released'), 'Chief worker release')
  assert.equal(Object.values(saved().tasks).filter(row => row.projectId === project.id).length, 1)
  const attempts = [], progress = event => {
    if (!artifacts) return
    mkdirSync(artifacts, { recursive: true, mode: 0o700 })
    writeFileSync(`${artifacts}/codex-progress.json`, JSON.stringify({ event, projectId: project.id, taskId: task.id, attempts }, null, 2), { mode: 0o600 })
  }
  const publisher = githubPublisher({ credential: 'gh-cli', configDir: settings.githubConfigDir, login: settings.login })
  for (let index = 0; index < 2; index++) {
    progress(`starting Attempt ${index + 1}`)
    const started = await owner('project-task-run', { taskId: task.id, requestId: `codex-live-${index}` })
    const id = started.attempt.id
    await waitFor(() => {
      const row = saved().projectAttempts[id]
      progress(`Attempt ${index + 1}: ${row.status}`)
      const blocked = Object.values(saved().projectHarnessWorkers ?? {}).find(worker => worker.attemptId === id && worker.status === 'waiting-input')
      assert.equal(blocked?.status, undefined, 'Real SDK role needs owner input; inspect private runtime before retrying')
      return ['failed', 'waiting-acceptance'].includes(row.status) ? row : null
    }, 'real SDK delivery')
    await waitFor(() => Object.values(saved().projectAttempts[id].roleSessions).every(row => row.status === 'released'), 'all actual SDK role workers released')
    const row = saved().projectAttempts[id]
    assert.equal(row.status, 'waiting-acceptance', row.failure?.message)
    assert.equal(row.evidence.tests.passed, true)
    assert.equal(row.evidence.tests.sha, row.candidateSha)
    assert.equal(row.evidence.review.sha, row.candidateSha)
    assert.equal(row.evidence.review.verdict, 'approve')
    assert.equal((await publisher.read(row.pr)).sha, row.candidateSha)
    const sessions = Object.values(row.roleSessions)
    assert.equal(new Set(sessions.map(session => session.backendSessionId)).size, 3)
    assert.ok(sessions.every(session => session.execution.harness === 'codex' && session.backendSessionId && session.context.text.includes('M7_CODEX_PUBLIC_MEMORY')))
    await waitFor(() => saved().projectExecutions[row.runId]?.status === 'done', 'canonical Run completion')
    attempts.push({ id, candidateSha: row.candidateSha, pr: row.pr, tests: row.evidence.tests, review: row.evidence.review,
      sessions: sessions.map(session => ({ role: session.role, backendSessionId: session.backendSessionId, status: session.status })) })
    if (index === 0) await owner('project-task-reject', { attemptId: id, reason: 'Add a dedicated regression assertion for add(-4.5, 0) === -4.5 in code.test.mjs. Keep correct numeric addition and produce a fresh candidate.' })
    else {
      assert.notEqual(row.candidateSha, attempts[0].candidateSha)
      await owner('project-task-accept', { attemptId: id })
      assert.equal(saved().tasks[task.id].status, 'accepted')
    }
  }
  for (const row of attempts) await owner('project-attempt-cleanup', { attemptId: row.id })
  const resources = await owner('project-resources', { projectId: project.id })
  assert.equal(resources.activeSlots, 0)
  progress('accepted and cleaned')
  return { milestone: 'M7 Codex-only live acceptance', model: settings.model, executorLogin: identity.login,
    runtime: 'actual DSH HTTP + official Codex SDK + local machine + GitHub', health,
    checks: ['explicit authorized profile and GitHub identity', 'real SDK authentication probe', 'real Codex Chief creates scoped shared Task', 'public role memory in each execution context', 'distinct real Developer/Tester/Reviewer SDK threads', 'independent host tests at sealed candidate SHA', 'real GitHub draft PR head verified', 'owner-authorized scripted return/retry/new candidate/re-review/acceptance', 'confirmed role release and workspace cleanup'],
    attempts, notRun: ['browser UI in this run', 'Claude SDK', 'mixed Harness/two-resource acceptance', 'production deployment', 'PR merge', 'independent repository review PASS'] }
}
