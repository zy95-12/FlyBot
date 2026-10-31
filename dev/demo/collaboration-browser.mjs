// Actual Chromium + gateway + FlyBot authorization/service. DSH/model delivery is a
// deterministic fixture; this is NOT the operator's real shared-service acceptance.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { createRuntime } from '../../core/index.js'
import { fakeContext } from '../../core/test/fake-ctx.js'
import { createWorkbenchGateway } from '../../core/src/host/workbench-gateway.js'
const browserRoot = process.env.FLYBOT_BROWSER_TOOLS ?? resolve(import.meta.dirname, 'browser')
const home = await mkdtemp(join(tmpdir(), 'flybot-collaboration-browser-'))
let upstream, gateway, browser, ctx
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)) })
const close = server => server ? new Promise(resolve => server.close(resolve)) : Promise.resolve()
try {
  const members = Object.fromEntries(['owner-1', 'maintainer', 'member'].map(id => [id, { id, displayName: id }]))
  const projects = Object.fromEntries(['one', 'two'].map(id => [id, { id, name: id === 'one' ? 'Engineering' : 'Other Project', ownerUserId: 'owner-1', status: 'active', roles: { maintainers: ['maintainer'], members: ['member'] }, createdAt: 1, updatedAt: 1 }]))
  await writeFile(join(home, 'state.json'), JSON.stringify({ version: 2, members, projects, bots: {}, tasks: {}, rooms: {}, mainBotIds: [] }))
  ctx = fakeContext(); let route
  Object.assign(ctx, { llm: { listProviders: () => [], listModels: async () => [] }, workspaceRegistry: { get: () => undefined, archiveSession: async () => {} }, sessionController: { resolveAgent: async () => ({ agent: undefined }) }, sessions: { flush: async () => {} } })
  ctx.connection.fetch.register = spec => { if (spec.path.endsWith('bot')) route = spec; return () => {} }
  const rt = createRuntime(ctx, { home, projectWorkbench: true }); await rt.load()
  let botNumber = 0
  rt.catalog = async () => []
  rt.createBot = async spec => { const id = `fixture-bot-${++botNumber}`; rt.state.bots[id] = { ...spec, id, sessionId: id, createdAt: Date.now() }; await rt.save(); return rt.state.bots[id] }
  rt.flybotEndpoint = async () => ({ workflows: [] })
  rt.authenticate = async memberId => {
    assert.equal(typeof memberId, 'string', 'channel passes the extracted session token')
    if (!members[memberId] || rt.state.authSessions[memberId]?.revokedAt) return null
    return { memberId, displayName: memberId, sessionId: memberId }
  }
  for (const memberId of Object.keys(members)) rt.state.authSessions[memberId] = { memberId }
  // Run the complete rooms-page bootstrap through the registered channel before
  // sockets/Chromium, including lazy creation of the public and private agents.
  const channel = async (token, endpoint, payload = {}) => {
    const response = await route.fetch(new Request('http://localhost/api/bot', {
      method: 'POST', headers: { 'x-flybot-member-session': token },
      body: JSON.stringify({ endpoint, payload }),
    }))
    return response.json()
  }
  const initializedAgents = []
  for (const memberId of Object.keys(members)) {
    for (const endpoint of ['workbench-state', 'project-detail', 'project-resources', 'project-agents', 'project-members', 'project-workflow', 'project-rooms', 'project-task-pools']) {
      const result = await channel(memberId, endpoint, { projectId: 'one', operation: 'state' })
      assert.equal(result.ok, true, `${memberId} ${endpoint}: ${JSON.stringify(result)}`)
      if (endpoint === 'project-agents') initializedAgents.push(result.value)
    }
  }
  assert.equal(new Set(initializedAgents.map(agent => agent.public.botId)).size, 1, 'one shared Chief')
  assert.equal(new Set(initializedAgents.map(agent => agent.mine.botId)).size, 3, 'distinct private carriers')
  for (const agent of initializedAgents) {
    assert.ok(rt.state.bots[agent.public.botId])
    assert.ok(rt.state.bots[agent.mine.botId])
    assert.notEqual(agent.public.botId, agent.mine.botId)
  }
  const roomsResponse = token => channel(token, 'project-rooms', { projectId: 'one' })
  assert.equal((await roomsResponse('unknown')).ok, false)
  rt.state.authSessions.member.revokedAt = Date.now()
  assert.equal((await roomsResponse('member')).ok, false)
  delete rt.state.authSessions.member.revokedAt
  if (process.argv.includes('--channel-only')) {
    console.log('Complete workbench bootstrap and channel authentication checks passed; Chromium/backend clicks Not run')
  } else {
    const { chromium } = createRequire(join(browserRoot, 'package.json'))('playwright')
    rt.deliver = async ({ sessionId, exchangeId }) => {
      rt.projectAgents.onEvent({ id: sessionId }, { type: 'user/message', data: { source: { exchangeId } } })
      rt.projectAgents.onEvent({ id: sessionId }, { type: 'turn/start', data: { turn: 1 } })
      rt.projectAgents.onEvent({ id: sessionId }, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '**Fixture reply** from scoped role' }] } } })
      rt.projectAgents.onEvent({ id: sessionId }, { type: 'turn/end', data: { turn: 1 } })
    }
    upstream = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const response = await route.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body: Buffer.concat(chunks), duplex: 'half' }))
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()))
    })
    const origin = await listen(upstream)
    gateway = createWorkbenchGateway({ upstreamOrigin: origin, upstreamCookie: 'fixture-owner=server-only' })
    const entry = await listen(gateway)
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) })
    const pages = {}
    for (const memberId of Object.keys(members)) {
      const context = await browser.newContext({ viewport: { width: memberId === 'member' ? 390 : 1200, height: 850 } })
      await context.addInitScript(id => sessionStorage.setItem('flybot.member', id), memberId)
      const page = await context.newPage(); pages[memberId] = page
      await page.goto(`${entry}/#/projects/one/rooms`)
      await page.getByRole('heading', { name: 'Project conversations', exact: true }).waitFor()
    }
    const owner = pages['owner-1']
    await owner.getByLabel('Room name', { exact: true }).fill('Release discussion')
    for (const role of ['developer', 'tester', 'reviewer']) await owner.locator(`input[name=roles][value=${role}]`).check()
    await owner.getByRole('button', { name: 'Create room', exact: true }).click()
    await owner.getByRole('heading', { name: 'Release discussion', exact: true }).waitFor()
    const roomURL = owner.url()
    await owner.getByLabel('Room message (@role)', { exact: true }).fill('@developer @tester @reviewer inspect boundaries')
    await owner.getByRole('button', { name: 'Send to room', exact: true }).click()
    await owner.getByText('Fixture reply', { exact: true }).first().waitFor()
    await owner.getByLabel('Document name', { exact: true }).fill('scope.md')
    await owner.getByLabel('Document content', { exact: true }).fill('Room scoped document')
    await owner.getByRole('button', { name: 'Register document', exact: true }).click()
    await owner.getByRole('button', { name: 'scope.md', exact: true }).waitFor()
    await owner.reload(); await owner.getByRole('button', { name: 'scope.md', exact: true }).click()
    await owner.getByText('scope.md\nRoom scoped document', { exact: true }).waitFor()
    for (const memberId of ['maintainer', 'member']) {
      const page = pages[memberId]; await page.goto(roomURL)
      await page.getByRole('heading', { name: 'Release discussion', exact: true }).waitFor()
      await page.getByLabel('Room message (@role)', { exact: true }).fill(`@chief hello from ${memberId}`)
      await page.getByRole('button', { name: 'Send to room', exact: true }).click()
      await page.getByText(`@chief hello from ${memberId}`, { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no narrow-screen overflow')
    }
    const privateRoom = await rt.projectEndpoint('project-room-create', { projectId: 'one', name: 'Owner only room', memberIds: ['owner-1'], roles: ['chief'] }, { memberId: 'owner-1' })
    const member = pages.member
    await member.goto(`${entry}/#/projects/one/rooms/${privateRoom.id}`)
    await member.getByRole('alert').filter({ hasText: 'Room is unavailable' }).waitFor()
    await member.goto(`${entry}/#/projects/two/rooms/${new URL(roomURL).hash.split('/').at(-1)}`)
    await member.getByRole('alert').filter({ hasText: 'Room is unavailable' }).waitFor()
    assert.deepEqual(await owner.context().cookies(), [], 'owner cookie never reaches browser')
    const raw = await owner.evaluate(async () => (await fetch('/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'state' }) })).status)
    assert.equal(raw, 403)
    console.log(JSON.stringify({ kind: 'deterministic-browser-backend', checks: ['Owner/Maintainer/Member clicks', 'scoped role mentions and replies', 'registered document', 'refresh/reconnect', '390px viewport', 'cross-member room denial', 'cross-Project room denial', 'owner cookie and raw API isolation'], notRun: ['real DSH/model', 'operator shared-service three-role acceptance', 'deployment'] }))
  }
} finally {
  await browser?.close(); await close(gateway); await close(upstream); await ctx?.dispose(); await rm(home, { recursive: true, force: true })
}
