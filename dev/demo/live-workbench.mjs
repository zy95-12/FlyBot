// Live acceptance deliberately has no canned model reply or injected GitHub publisher.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createWorkbenchGateway } from '../../core/src/host/workbench-gateway.js'
import { githubPublisher } from '../../core/src/host/project-github.js'

export async function checkLiveWorkbench({ credentials, port, cookie, saved, waitFor, githubRepository, githubConfigDir, artifacts }) {
  const { chromium } = createRequire(join(resolve(process.env.FLYBOT_DEMO_BROWSER_HOME ?? join(import.meta.dirname, 'browser')), 'package.json'))('playwright')
  const gateway = createWorkbenchGateway({ upstreamOrigin: `http://127.0.0.1:${port}`, upstreamCookie: cookie })
  const startedAt = Date.now(), evidence = [], checks = [], pageErrors = []
  const progress = (event, extra = {}) => {
    if (!artifacts) return
    mkdirSync(artifacts, { recursive: true, mode: 0o700 })
    writeFileSync(join(artifacts, 'live-progress.json'), JSON.stringify({ event, elapsedMs: Date.now() - startedAt, evidence, ...extra }, null, 2), { mode: 0o600 })
  }
  progress('live acceptance starting')
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening')
  let browser
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) })
    const aliceContext = await browser.newContext(), bobContext = await browser.newContext()
    const alice = await aliceContext.newPage(), bob = await bobContext.newPage()
    for (const page of [alice, bob]) page.on('pageerror', failure => pageErrors.push(failure.message))
    const base = `http://127.0.0.1:${gateway.address().port}`
    const visible = (page, text) => page.locator('main').getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 })
    const click = (page, text) => page.getByRole('button', { name: text, exact: true }).click()
    const raw = (page, endpoint, payload = {}) => page.evaluate(async ({ endpoint, payload }) => {
      const response = await fetch('/api/bot', { method: 'POST', headers: { 'content-type': 'application/json', 'x-flybot-member-session': sessionStorage.getItem('flybot.member') }, body: JSON.stringify({ endpoint, payload }) })
      return response.json()
    }, { endpoint, payload })
    const api = async (page, endpoint, payload = {}) => { const result = await raw(page, endpoint, payload); assert.equal(result.ok, true, `${endpoint}: ${result.error?.message ?? result.error?.code}`); return result.value }
    const navigate = async (page, id, tab = 'board', taskId = '') => {
      await page.goto(`${base}/#/projects/${id}/${tab}${taskId ? `/${taskId}` : ''}`)
      await visible(page, taskId ? saved().tasks[taskId].title : saved().projects[id].name)
    }
    const awaitAgent = async (page, id, visibility = 'private') => waitFor(async () => {
      const row = await api(page, 'project-agent-history', { projectId: id, visibility })
      return !row.busy && row.messages.some(message => message.kind === 'agent') ? row : null
    }, `${visibility} real-model response`)
    const awaitAttempt = async (id, taskId, count) => waitFor(() => {
      const rows = Object.values(saved().projectAttempts ?? {}).filter(row => row.taskId === taskId)
      const row = rows[count - 1]
      if (!row) return null
      progress('delivery running', { projectId: id, taskId, attemptId: row.id, status: row.status, roles: Object.keys(row.evidence ?? {}) })
      return ['failed', 'waiting-acceptance', 'accepted'].includes(row.status) ? row : null
    }, 'actual model delivery evidence')
    const record = async (page, attempt) => {
      const log = await api(page, 'project-attempt-log', { attemptId: attempt.id })
      const row = { attemptId: attempt.id, taskId: attempt.taskId, projectId: attempt.projectId, status: attempt.status, candidateSha: attempt.candidateSha,
        tests: { passed: attempt.evidence.tests?.passed, sha: attempt.evidence.tests?.sha, logSha256: log.text ? createHash('sha256').update(log.text).digest('hex') : null },
        review: attempt.evidence.review, pr: attempt.pr, feedback: attempt.feedback, elapsedMs: Date.now() - attempt.createdAt }
      evidence.push(row); progress('evidence recorded')
      return row
    }
    for (const [page, name, password] of [[alice, 'alice', credentials.alicePassword], [bob, 'bob', credentials.bobPassword]]) {
      await page.goto(base); await page.getByLabel('Email', { exact: true }).fill(`${name}@example.com`)
      await page.getByLabel('Password', { exact: true }).fill(password); await click(page, 'Sign in'); await visible(page, 'Projects')
    }
    const self = await api(bob, 'workbench-state'), bobId = self.self.memberId
    checks.push('two real platform logins through shared browser entry')
    const createProject = async (name, repository) => {
      await alice.goto(base); await visible(alice, 'Projects')
      await alice.getByLabel('Project name', { exact: true }).fill(name)
      await alice.getByLabel('Provisioned repository', { exact: true }).selectOption(repository)
      await click(alice, 'Create Project'); await visible(alice, name)
      const id = await waitFor(() => Object.values(saved().projects).find(row => row.name === name)?.id, 'Project creation')
      await click(alice, 'Members'); await alice.getByRole('button', { name: 'Create one-use Project invitation', exact: true }).waitFor()
      await click(alice, 'Create one-use Project invitation')
      const token = (await alice.locator('main pre').innerText()).split(': ').at(-1)
      await bob.goto(base); await visible(bob, 'Projects')
      await bob.getByLabel('Project invitation', { exact: true }).fill(token); await click(bob, 'Join'); await visible(bob, name)
      return id
    }
    const projectId = await createProject('Live DeepSeek shared delivery', githubRepository)
    progress('Project joined', { projectId })
    for (const [page, note] of [[alice, 'Alice live private sentinel'], [bob, 'Bob live private sentinel']]) {
      await navigate(page, projectId, 'private')
      await page.getByLabel('Remember privately', { exact: true }).fill(note)
      await page.locator('#memory-text').locator('xpath=ancestor::form').getByRole('button', { name: 'Save', exact: true }).click()
      await visible(page, note)
      await page.getByLabel('Message', { exact: true }).fill('Use project_agent_context and reply with the exact text of my own private note. Do not publish it or create a Task.')
      await click(page, 'Send'); const history = await awaitAgent(page, projectId)
      assert.ok(history.messages.filter(row => row.kind === 'agent').some(row => row.text.includes(note)), 'the real agent must receive and acknowledge its own structured private context')
    }
    const bobAgent = await api(bob, 'project-agents', { projectId })
    assert.equal(JSON.stringify(bobAgent).includes('Alice live private sentinel'), false)
    const aliceHistory = await api(alice, 'project-agent-history', { projectId })
    assert.equal(JSON.stringify(aliceHistory).includes('Bob live private sentinel'), false)
    checks.push('real private agents execute scoped tools and keep per-user notes isolated')
    await navigate(bob, projectId, 'bots'); await visible(bob, 'Public Chief')
    const title = '[Live validation artifact] Fix numeric addition'
    await bob.getByLabel('Message', { exact: true }).fill(`Create exactly one shared Task using project_agent_task. Title exactly: ${title}. Criteria: code.mjs exports add(a,b) computing numeric addition for positive, negative, zero and fractional inputs; run node tests; add regression tests in code.test.mjs. Context: isolated integration artifact in an explicitly authorized test fork, no production change, never merge its PR; the host owns GitHub publication and independent immutable acceptance tests. Do not start execution, only create the Task, and keep private notes out of it.`)
    await click(bob, 'Send')
    const task = await waitFor(() => Object.values(saved().tasks).find(row => row.projectId === projectId && row.requesterId === bobId), 'real Chief creates requested Task')
    await awaitAgent(bob, projectId, 'public')
    assert.match(task.title, /addition/i)
    assert.equal(Object.values(saved().tasks).filter(row => row.projectId === projectId).length, 1, 'one real human request must not create duplicate Tasks')
    assert.equal(JSON.stringify(task).includes('private sentinel'), false)
    checks.push('real Chief scoped tool creates shared Task as Bob')
    await navigate(bob, projectId, 'tasks', task.id); await click(bob, 'Run / retry')
    const firstStarted = await waitFor(() => Object.values(saved().projectAttempts ?? {}).find(row => row.taskId === task.id), 'first live Attempt')
    await bob.reload(); await visible(bob, task.title)
    assert.equal(Object.values(saved().projectAttempts).filter(row => row.taskId === task.id).length, 1)
    const duplicate = await api(bob, 'project-task-run', { taskId: task.id, requestId: 'duplicate-live-request' }).catch(() => null)
    assert.equal(Object.values(saved().projectAttempts).filter(row => row.taskId === task.id).length, 1)
    void duplicate
    const first = await awaitAttempt(projectId, task.id, 1)
    assert.equal(first.status, 'waiting-acceptance', first.failure?.message)
    await waitFor(() => saved().projectExecutions[first.runId]?.status === 'done', 'first live Run completion')
    await record(alice, first)
    assert.equal(firstStarted.id, first.id)
    const publisher = githubPublisher({ credential: 'gh-cli', configDir: githubConfigDir })
    assert.equal((await publisher.read(first.pr)).sha, first.candidateSha)
    assert.equal(first.evidence.tests.sha, first.evidence.review.sha)
    assert.equal(first.pr.sha, first.candidateSha)
    assert.equal((await raw(bob, 'project-task-accept', { attemptId: first.id })).ok, false)
    await navigate(alice, projectId, 'tasks', task.id); await visible(alice, 'Accept this commit')
    const feedback = 'Add a dedicated regression assertion for add(-4.5, 0) === -4.5 in code.test.mjs, and keep the correct addition implementation. This is human-requested follow-up coverage; produce a fresh candidate and preserve prior evidence.'
    await alice.getByLabel('Requested changes', { exact: true }).fill(feedback)
    await click(alice, 'Request changes')
    await waitFor(() => saved().projectAttempts[first.id].status === 'failed', 'Alice returns first candidate')
    await navigate(bob, projectId, 'tasks', task.id); await click(bob, 'Run / retry')
    const second = await awaitAttempt(projectId, task.id, 2)
    assert.equal(second.status, 'waiting-acceptance', second.failure?.message)
    assert.equal(second.feedback.previousAttemptId, first.id)
    assert.equal(second.feedback.reason, feedback)
    assert.notEqual(second.candidateSha, first.candidateSha)
    assert.match(readFileSync(join(second.workspaces.developer.path, 'code.test.mjs'), 'utf8'), /-4\.5/)
    await waitFor(() => saved().projectExecutions[second.runId]?.status === 'done', 'second live Run completion')
    assert.equal((await publisher.read(second.pr)).sha, second.candidateSha)
    assert.equal(second.evidence.tests.sha, second.evidence.review.sha)
    assert.equal(second.pr.sha, second.candidateSha)
    await navigate(alice, projectId, 'tasks', task.id); await visible(alice, 'Accept this commit'); await click(alice, 'Accept this commit')
    await waitFor(() => saved().tasks[task.id].status === 'accepted', 'Alice accepts matching live candidate')
    await record(alice, saved().projectAttempts[second.id])
    const metrics = (await api(alice, 'project-resources', { projectId })).metrics
    assert.equal(metrics.acceptedTasks, 1); assert.equal(metrics.duration.samples, 1)
    checks.push('real Developer/Tester/Reviewer and immutable host tests at matching SHA', 'real GitHub draft PR heads verified', 'Alice browser return reaches retry context and fresh code/tests commit', 'Alice browser acceptance changes canonical Task and actual metrics', 'Bob acceptance refused', 'refresh/duplicate request preserves one active Attempt')
    if (artifacts) {
      await navigate(alice, projectId); await alice.setViewportSize({ width: 1440, height: 1000 })
      await alice.screenshot({ path: join(artifacts, 'live-accepted-desktop.png'), fullPage: true })
      await navigate(bob, projectId); await bob.setViewportSize({ width: 390, height: 844 })
      assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await bob.screenshot({ path: join(artifacts, 'live-accepted-mobile.png'), fullPage: true })
    }
    const failureProject = await createProject('Live deterministic failure gate', 'example/intentional-failure')
    await api(alice, 'project-quota', { projectId: failureProject, maxConcurrent: 1 })
    const failing = []
    for (const name of ['Exercise mandatory failing host check', 'Queued request cancelled by revocation']) {
      await navigate(bob, failureProject)
      await bob.getByLabel('Requirement', { exact: true }).fill(name)
      await bob.getByLabel('Acceptance criteria', { exact: true }).fill('Fix numeric addition in code.mjs and add code.test.mjs coverage. The operator host test intentionally exits nonzero; do not bypass or change host configuration, report failure honestly.')
      await click(bob, 'Create Task')
      failing.push(await waitFor(() => Object.values(saved().tasks).find(row => row.projectId === failureProject && row.title === name), 'failure Task creation'))
    }
    await navigate(bob, failureProject, 'tasks', failing[0].id); await click(bob, 'Run / retry')
    await waitFor(() => Object.values(saved().projectAttempts).find(row => row.taskId === failing[0].id), 'failure Attempt admitted')
    await navigate(bob, failureProject, 'tasks', failing[1].id); await click(bob, 'Run / retry')
    const queued = await waitFor(() => Object.values(saved().projectQueue ?? {}).find(row => row.taskId === failing[1].id && row.status === 'waiting'), 'live quota queue')
    assert.equal(Object.values(saved().projectAttempts).some(row => row.taskId === failing[1].id), false)
    await navigate(alice, failureProject, 'members'); await visible(alice, 'Bob · member'); await click(alice, 'Remove')
    await bob.getByRole('alert').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(saved().projectQueue[queued.id].status, 'cancelled')
    assert.equal((await raw(bob, 'project-agent-history', { projectId: failureProject })).ok, false)
    const failed = await awaitAttempt(failureProject, failing[0].id, 1)
    assert.equal(failed.status, 'failed'); assert.equal(failed.evidence.tests.passed, false); assert.equal(failed.pr, undefined)
    await record(alice, failed)
    await waitFor(async () => (await api(alice, 'project-resources', { projectId: failureProject })).activeSlots === 0, 'failed Worker release')
    await navigate(alice, failureProject, 'tasks', failing[0].id); await click(alice, 'Run / retry')
    const failedRetry = await awaitAttempt(failureProject, failing[0].id, 2)
    assert.equal(failedRetry.status, 'failed'); assert.equal(failedRetry.evidence.tests.passed, false)
    assert.notEqual(failedRetry.id, failed.id); assert.equal(failedRetry.pr, undefined)
    await record(alice, failedRetry)
    assert.equal((await raw(alice, 'project-task-accept', { attemptId: failedRetry.id })).ok, false)
    await api(alice, 'project-member-remove', { projectId, memberId: bobId })
    assert.equal((await raw(bob, 'project-agent-history', { projectId })).ok, false)
    checks.push('intentional host test failure refuses PR and acceptance', 'failed Task retry preserves failure evidence', 'live quota queue allocates no workspace', 'member revocation cancels queued work and denies old agent/page')
    for (const id of [projectId, failureProject]) await waitFor(async () => (await api(alice, 'project-resources', { projectId: id })).activeSlots === 0, 'all live Worker leases released')
    for (const attempt of Object.values(saved().projectAttempts)) await api(alice, 'project-attempt-cleanup', { attemptId: attempt.id })
    assert.ok(Object.values(saved().projectWorkspaces).every(row => row.status === 'released'))
    assert.deepEqual(await aliceContext.cookies(), []); assert.deepEqual(await bobContext.cookies(), [])
    assert.equal((await bob.request.get(`${base}/api/sessions`)).status(), 404)
    await click(alice, 'Sign out'); await visible(alice, 'Sign in')
    assert.equal(await alice.evaluate(() => sessionStorage.getItem('flybot.member')), null)
    assert.deepEqual(pageErrors, [])
    checks.push('all role worktrees cleaned and Worker leases released', 'owner cookie absent and raw Harness APIs refused', 'logout revokes browser credential')
    progress('live acceptance complete')
    return { milestone: 'M6', model: 'real DeepSeek official deepseek-flash', providerOrigin: 'https://api.deepseek.com/anthropic', platform: 'unchanged control-plane', runtime: 'actual DSH + Chromium + real GitHub', checks, evidence, metrics, elapsedMs: Date.now() - startedAt, notRun: ['production deployment', 'repository independent review PASS', 'merge'] }
  } catch (failure) {
    const pages = await Promise.all((browser?.contexts() ?? []).flatMap(context => context.pages()).map(async page => ({ route: new URL(page.url()).hash, headings: await page.locator('main h1').allTextContents(), alerts: await page.getByRole('alert').allTextContents() })))
    progress('live acceptance failed', { pages, pageErrors, reason: String(failure.message).replaceAll(process.env.DEEPSEEK_API_KEY, '[redacted]') })
    let message = String(failure.message)
    for (const secret of [process.env.DEEPSEEK_API_KEY, credentials.alicePassword, credentials.bobPassword, credentials.adminPassword, cookie]) if (secret) message = message.replaceAll(secret, '[redacted]')
    throw new Error(message)
  } finally { await browser?.close(); gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)) }
}
