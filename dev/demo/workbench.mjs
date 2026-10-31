// Actual shared UI, unchanged control-plane and real DSH. No owner cookie enters a page.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createWorkbenchGateway } from '../../core/src/host/workbench-gateway.js'

export async function checkWorkbench({ credentials, port, cookie, saved, waitFor, artifacts }) {
  const browserRoot = process.env.FLYBOT_DEMO_BROWSER_HOME ?? join(import.meta.dirname, 'browser')
  const { chromium } = createRequire(join(resolve(browserRoot), 'package.json'))('playwright')
  const gateway = createWorkbenchGateway({ upstreamOrigin: `http://127.0.0.1:${port}`, upstreamCookie: cookie })
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening')
  let browser
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) })
    const aliceContext = await browser.newContext(), bobContext = await browser.newContext()
    const alice = await aliceContext.newPage(), bob = await bobContext.newPage()
    const pages = [alice, bob], errors = []
    for (const page of pages) page.on('pageerror', failure => errors.push(failure.message))
    const base = `http://127.0.0.1:${gateway.address().port}`
    const visible = async (page, text) => page.locator('main').getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const click = (page, text) => page.getByRole('button', { name: text, exact: true }).click()
    const api = (page, endpoint, payload = {}) => page.evaluate(async ({ endpoint, payload }) => {
      const response = await fetch('/api/bot', { method: 'POST', headers: { 'content-type': 'application/json', 'x-flybot-member-session': sessionStorage.getItem('flybot.member') }, body: JSON.stringify({ endpoint, payload }) })
      return response.json()
    }, { endpoint, payload })
    for (const [page, name, password] of [[alice, 'alice', credentials.alicePassword], [bob, 'bob', credentials.bobPassword]]) {
      await page.goto(base)
      await page.getByLabel('Email', { exact: true }).fill(`${name}@example.com`)
      await page.getByLabel('Password', { exact: true }).fill(password)
      await click(page, 'Sign in'); await visible(page, 'Projects')
    }
    await alice.getByLabel('Project name', { exact: true }).fill('Shared browser demo')
    await alice.getByLabel('Provisioned repository', { exact: true }).selectOption('example/delivery-fixture')
    await click(alice, 'Create Project'); await visible(alice, 'Shared browser demo')
    const projectId = await waitFor(() => Object.values(saved().projects).find(project => project.name === 'Shared browser demo')?.id, 'browser Project creation')
    await click(alice, 'Members'); await click(alice, 'Create one-use Project invitation')
    const result = await alice.locator('main pre').innerText()
    const invitation = result.split(': ').at(-1)
    await bob.getByLabel('Project invitation', { exact: true }).fill(invitation)
    await click(bob, 'Join'); await visible(bob, 'Shared browser demo')
    const bobMember = Object.values(saved().members).find(member => member.displayName === 'Bob')?.id
    assert.ok(bobMember)
    await click(alice, 'My Project agent')
    await alice.getByLabel('Remember privately', { exact: true }).fill('Alice browser private note')
    await alice.locator('#memory-text').locator('xpath=ancestor::form').getByRole('button', { name: 'Save', exact: true }).click()
    await visible(alice, 'Alice browser private note')
    await click(bob, 'My Project agent')
    await bob.getByLabel('Remember privately', { exact: true }).fill('Bob browser private note')
    await bob.locator('#memory-text').locator('xpath=ancestor::form').getByRole('button', { name: 'Save', exact: true }).click()
    await visible(bob, 'Bob browser private note')
    assert.equal(await bob.getByText('Alice browser private note', { exact: true }).count(), 0)
    await click(bob, 'Public Bots'); await visible(bob, 'Public Chief')
    await bob.getByLabel('Message', { exact: true }).fill('Create a shared Task from this public request. Fix addition and test add(2,3).')
    await click(bob, 'Send')
    const task = await waitFor(() => Object.values(saved().tasks).find(task => task.title === 'A public Chief Task'), 'Chief creates Task from browser request')
    assert.equal(task.requesterId, bobMember)
    await click(bob, 'Task board'); await visible(bob, task.title)
    await click(alice, 'Task board'); await visible(alice, task.title)
    await click(bob, task.title)
    await click(bob, 'Run / retry')
    await waitFor(() => Object.values(saved().projectAttempts).find(row => row.taskId === task.id), 'browser starts delivery')
    await bob.reload(); await visible(bob, 'Run / retry')
    assert.equal(Object.values(saved().projectAttempts).filter(row => row.taskId === task.id).length, 1)
    await waitFor(() => Object.values(saved().projectAttempts).find(row => row.taskId === task.id && row.status === 'failed'), 'actual delivery credential refusal')
    await bob.reload(); await visible(bob, 'Attempt · failed')
    await click(bob, 'Test log')
    await bob.locator('main pre').filter({ hasText: 'pass' }).first().waitFor()
    await click(bob, 'Run / retry')
    await waitFor(() => Object.values(saved().projectAttempts).filter(row => row.taskId === task.id).length === 2, 'browser retry creates distinct Attempt')
    await waitFor(() => Object.values(saved().projectAttempts).filter(row => row.taskId === task.id).every(row => row.status === 'failed'), 'retry preserves independent evidence')
    await waitFor(async () => (await api(alice, 'project-resources', { projectId })).value.activeSlots === 0, 'actual Worker release after failed Attempts')
    const detail = await api(alice, 'project-task-detail', { taskId: task.id })
    assert.equal(detail.value.attempts.length, 2)
    for (const attempt of detail.value.attempts) {
      assert.equal(attempt.evidence.tests.passed, true)
      assert.equal(attempt.evidence.tests.sha, attempt.evidence.review.sha)
      assert.match(attempt.failure.message, /credential/)
      assert.equal((await api(alice, 'project-task-accept', { attemptId: attempt.id })).ok, false)
      assert.equal((await api(alice, 'project-attempt-cleanup', { attemptId: attempt.id })).ok, true)
    }
    await click(bob, 'Task board')
    await bob.setViewportSize({ width: 390, height: 844 })
    await visible(bob, task.title)
    assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile view must not overflow horizontally')
    if (artifacts) {
      mkdirSync(artifacts, { recursive: true, mode: 0o700 })
      await bob.screenshot({ path: join(artifacts, 'project-mobile.png'), fullPage: true })
      await alice.setViewportSize({ width: 1440, height: 1000 })
      await click(alice, 'Task board'); await alice.reload(); await visible(alice, task.title)
      await alice.screenshot({ path: join(artifacts, 'project-desktop.png'), fullPage: true })
    }
    assert.deepEqual(await aliceContext.cookies(), [])
    assert.deepEqual(await bobContext.cookies(), [])
    assert.equal((await bob.request.get(`${base}/api/sessions`)).status(), 404)
    assert.equal((await api(bob, 'state')).ok, undefined, 'private operator state is not proxied')
    await click(alice, 'Members'); await visible(alice, 'Bob · member')
    await click(alice, 'Remove')
    await bob.getByRole('alert').waitFor({ state: 'visible', timeout: 15_000 })
    assert.equal(await bob.getByRole('button', { name: task.title, exact: true }).count(), 0)
    assert.equal((await api(bob, 'project-detail', { projectId })).ok, false)
    await click(alice, 'Sign out'); await visible(alice, 'Sign in')
    assert.equal(await alice.evaluate(() => sessionStorage.getItem('flybot.member')), null)
    assert.deepEqual(errors, [])
    return { milestone: 'M6', platform: 'unchanged control-plane', runtime: 'actual DSH + Chromium + restricted gateway', model: 'deterministic mock',
      checks: ['two platform logins through browser', 'Project creation and one-use join through UI', 'private Project notes isolated', 'public Chief tool creates shared Task', 'real Developer/Tester/Reviewer worktrees', 'independent test evidence at matching commit', 'missing credential refuses publication/acceptance', 'refresh preserves one Attempt', 'browser retry preserves history', '390px layout', 'owner cookie absent in both browsers', 'raw Harness API denied', 'revocation clears stale page', 'logout clears member credential'],
      notRun: ['real model', 'real GitHub publication in this browser run', 'production deployment'] }
  } catch (failure) {
    let message = String(failure.message ?? 'Browser acceptance failed')
    for (const secret of [credentials.alicePassword, credentials.bobPassword, credentials.adminPassword, cookie]) if (secret) message = message.replaceAll(secret, '[redacted]')
    throw new Error(message)
  } finally {
    await browser?.close()
    gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve))
  }
}
