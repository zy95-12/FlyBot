// Owner setup: bounded connectivity probes and private target-resource PTYs.
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { ownEntry, setEntry } from './store.js'
import { createPluginModel } from './plugin-model.js'
const refuse = message => Object.assign(new Error(message), { code: 'bot/forbidden' })
const delay = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref?.() })
export function createProjectRuntimeSetup(rt) {
  const terminals = new Map(), checks = new Map()
  const nativeProbe = createPluginModel(rt, { allow: ['project-runtime-probe'], limits: { maxTokens: 12, perMinute: 2, timeoutMs: 8000 } })
  const audits = () => (rt.state.projectTerminalAudit ??= {})
  async function authorized(body, actor, admin = false) {
    const project = rt.requireProjectAccess(actor, body.projectId, 'configure')
    const resource = rt.projectResources.setting(project.id, body.resourceId)
    if (admin && !resource.adminMemberIds?.includes(actor.memberId)) throw refuse('Explicit resource administration grant is required for a terminal')
    if (!['flybot', 'codex', 'claude-agent'].includes(body.harness) || !resource.harnesses?.includes(body.harness)) throw refuse('Harness is not authorized on this resource')
    return { project, resource }
  }
  async function probeSDK(body, project, resource) {
    const selected = await rt.projectHarness.profile(project.id, body.resourceId, body.harness)
    const definitions = rt.projectAgents.deliveryDefinitions(project.id)
    const role = definitions.roles.find(row => row.role === body.role) ?? definitions.roles.find(row => row.execution?.harness === body.harness)
    const model = role?.execution?.model ?? selected.selected.model
    if (!model) return { status: 'unconfigured', reason: 'Set an explicit SDK model on this role/profile' }
    const id = `probe-${randomUUID()}`, cwd = join(resource.root, 'connection-probes', id)
    const lease = await rt.projectResources.reserve({ projectId: project.id, attemptId: id, sessionKey: id, role: 'probe', harness: body.harness, resourceIds: [body.resourceId], purpose: 'probe' })
    let child, exited = false, stopped = false, completion = false, authError = false
    try {
      await rt.projectResources.command(project.id, body.resourceId, { cwd: resource.root, argv: ['mkdir', '-p', cwd] })
      await rt.projectResources.command(project.id, body.resourceId, { cwd, argv: ['git', 'init', '-q'] })
      const runtime = resource.runtimeDir ?? resolve(import.meta.dirname, '../..')
      child = rt.projectResources.startProcess(project.id, body.resourceId, { cwd, argv: ['node', join(runtime, 'src/host/project-harness-worker.mjs')] })
      await rt.projectResources.markStarted(lease.id, lease.generation, { kind: 'sdk', handle: id })
      const closed = new Promise(resolve => child.once('close', () => { exited = true; resolve() }))
      child.once('error', () => {}) // The exit/readiness check below reports a bounded environment error.
      child.stderr.resume() // Raw SDK stderr may contain credential material; never persist or relay it.
      let finish
      const finished = new Promise(resolve => { finish = resolve })
      const lines = createInterface({ input: child.stdout })
      lines.on('line', line => {
        try {
          const event = JSON.parse(line)
          if (event.type === 'stopped') stopped = event.released === true
          if (event.type === 'completed') { completion = true; finish() }
          if (event.type === 'failure') finish()
          if (/401|403|api.key|authentication|unauthorized|login required/i.test(line)) authError = true
        } catch { /* Malformed probe output is not successful authentication. */ }
      })
      child.stdin.write(JSON.stringify({ type: 'start', settings: { harness: body.harness, env: selected.env, cwd, model, probe: true, noTools: true, readOnly: true, maxBudgetUsd: 0.01,
        ...(selected.selected.baseUrl ? { baseUrl: selected.selected.baseUrl } : {}) }, prompt: 'Reply ready. Do not use tools.' }) + '\n')
      await Promise.race([finished, closed, delay(10_000)])
      if (!exited) { child.stdin.end(JSON.stringify({ type: 'stop' }) + '\n'); await Promise.race([closed, delay(6000)]) }
      return { status: completion && exited && stopped ? 'ready' : authError ? 'authRequired' : 'environmentError', reason: completion && exited && stopped ? 'Minimal SDK inference completed; this is not task execution' : authError ? 'SDK authentication is required or was rejected' : 'SDK/runtime probe did not complete within its bound', model }
    } finally {
      await rt.projectResources.release(lease.id, lease.generation, ...(child ? [{ handle: id, exited: exited && stopped }] : []))
      if (exited && stopped || !child) await rt.projectResources.command(project.id, body.resourceId, { cwd: resource.root, argv: ['rm', '-rf', '--', cwd] }).catch(() => {}) // Owned probe directory only; failed cleanup is not auth success.
    }
  }
  async function check(body, actor) {
    const { project, resource } = await authorized(body, actor)
    const key = `${project.id}:${body.resourceId}:${body.harness}`
    if (checks.has(key)) return checks.get(key)
    const previous = ownEntry(rt.state.projectHarnessHealth ?? {}, key)
    if (previous && Date.now() - previous.at < 3000 && previous.status !== 'checking') return structuredClone(previous)
    const promise = (async () => {
      rt.state.projectHarnessHealth ??= {}
      setEntry(rt.state.projectHarnessHealth, key, { status: 'checking', at: Date.now(), principalId: project.ownerUserId })
      await rt.save()
      let result
      const environment = await rt.projectResources.probe(project.id, body.resourceId)
      if (environment.status !== 'ready') result = { status: 'unreachable', reason: environment.reason }
      else if (body.harness === 'flybot') {
        if (resource.type !== 'local') result = { status: 'environmentError', reason: 'Native DSH requires the configured local host' }
        else {
          const role = rt.projectAgents.deliveryDefinitions(project.id).roles.find(row => row.role === body.role)
          const reply = await nativeProbe('project-runtime-probe', { prompt: 'Reply ready.', maxTokens: 8, model: role?.model || rt.config.projectModel })
          result = reply.ok ? { status: 'ready', reason: 'Minimal provider inference completed' } : { status: ['AUTH', 'NO_KEY'].includes(reply.code) ? 'authRequired' : 'environmentError', reason: reply.code }
        }
      } else {
        try { result = await probeSDK(body, project, resource) }
        catch (failure) { result = { status: failure.code === 'bot/resource' ? 'unreachable' : failure.code === 'bot/harness' ? 'unconfigured' : 'environmentError', reason: failure.code === 'bot/resource' ? 'Resource capacity or environment is unavailable' : 'Explicit SDK profile, model or runtime configuration is incomplete' } }
      }
      const row = { ...result, at: Date.now(), principalId: project.ownerUserId, sdkVersion: rt.projectHarness.versions[body.harness] ?? null, resourceId: body.resourceId, harness: body.harness }
      setEntry(rt.state.projectHarnessHealth, key, row); await rt.save(); rt.projectScheduler?.wake(); return structuredClone(row)
    })().finally(() => checks.delete(key))
    checks.set(key, promise); return promise
  }
  async function close(terminal, reason) {
    if (terminal.closed) return
    terminal.process.stdin.end(JSON.stringify({ type: 'close' }) + '\n')
    await Promise.race([terminal.exited, delay(3000)])
    if (!terminal.released) { terminal.process.kill('SIGTERM'); await Promise.race([terminal.exited, delay(1000)]) }
    terminal.closed = true; terminal.output = []
    Object.assign(ownEntry(audits(), terminal.id), { closedAt: Date.now(), reason, released: terminal.released === true })
    await rt.save()
    if (reason === 'owner-close') void check(terminal.target, terminal.actor).catch(() => {}) // Current grants are rechecked; a failed recheck does not reopen the terminal.
  }
  async function open(body, actor) {
    const { project, resource } = await authorized(body, actor, true)
    if (!actor.sessionId) throw refuse('Terminal requires a live authenticated Session')
    if ([...terminals.values()].filter(row => (!row.closed || !row.released) && row.actor.memberId === actor.memberId).length >= 2) throw refuse('Close an existing configuration terminal first')
    const selected = await rt.projectHarness.profile(project.id, body.resourceId, body.harness, { forSetup: true })
    const runtime = resource.runtimeDir ?? resolve(import.meta.dirname, '../..')
    await rt.projectResources.command(project.id, body.resourceId, { cwd: resource.root, argv: ['mkdir', '-p', selected.selected.home, selected.selected.configDir] })
    const process = rt.projectResources.startProcess(project.id, body.resourceId, { cwd: resource.root, argv: ['python3', '-u', join(runtime, 'src/host/project-terminal-worker.py')] })
    const terminal = { id: `terminal-${randomUUID()}`, actor: { ...actor }, target: { projectId: project.id, resourceId: body.resourceId, harness: body.harness, role: body.role }, process,
      output: [], seq: 0, createdAt: Date.now(), lastSeen: Date.now(), expiresAt: Date.now() + 10 * 60_000, released: false }
    terminal.exited = new Promise(resolve => process.once('close', () => { terminal.processExited = true; resolve() }))
    process.once('error', () => { terminal.closed = true })
    process.stderr.resume()
    createInterface({ input: process.stdout }).on('line', line => {
      try {
        const event = JSON.parse(line)
        if (event.type === 'output' && !terminal.closed) {
          terminal.output.push({ seq: ++terminal.seq, text: Buffer.from(event.data, 'base64').toString('utf8') })
          while (terminal.output.reduce((sum, row) => sum + row.text.length, 0) > 65536) terminal.output.shift()
        }
        if (event.type === 'closed') terminal.released = event.released === true
      } catch { /* PTY protocol failures do not become screen/log output. */ }
    })
    terminals.set(terminal.id, terminal)
    setEntry(audits(), terminal.id, { id: terminal.id, projectId: project.id, resourceId: body.resourceId, harness: body.harness, principalId: selected.principalId, initiatedBy: actor.memberId, createdAt: terminal.createdAt })
    process.stdin.write(JSON.stringify({ cwd: selected.selected.home, env: { ...selected.env, TERM: 'xterm-256color', FLYBOT_PROFILE_DIR: selected.selected.configDir, FLYBOT_SETUP_HARNESS: body.harness } }) + '\n')
    await rt.save()
    return { terminalId: terminal.id, expiresAt: terminal.expiresAt, resourceId: body.resourceId, harness: body.harness,
      instructions: body.harness === 'flybot' ? 'Configure the explicitly registered native DSH profile using its provider setup commands. Close to recheck.' : `Configure this private profile. To save an API key with hidden input: node ${JSON.stringify(join(runtime, 'src/host/project-profile-auth.mjs'))}. Codex may also use its supported login/device flow in this same profile. Claude Agent SDK uses API/cloud credentials.` }
  }
  async function access(body, actor, heartbeat = true) {
    const terminal = terminals.get(body.terminalId)
    if (!terminal || terminal.actor.memberId !== actor.memberId || terminal.actor.sessionId !== actor.sessionId) throw refuse('This terminal belongs to another authenticated Session')
    try {
      await authorized(terminal.target, actor, true)
      const session = ownEntry(rt.state.authSessions ?? {}, actor.sessionId)
      if (!session || session.revokedAt || Date.now() > terminal.expiresAt || rt.platformIdentityEnabled && !await rt.validatePlatformActor(actor)) throw refuse('Configuration terminal expired or access was revoked')
    } catch (error) { await close(terminal, 'authorization-ended'); throw error }
    if (heartbeat) terminal.lastSeen = Date.now()
    return terminal
  }
  async function endpoint(endpoint, body, actor) {
    if (endpoint === 'project-runtime-check') return check(body, actor)
    if (endpoint === 'project-terminal-open') return open(body, actor)
    const terminal = await access(body, actor)
    if (endpoint === 'project-terminal-close') { await close(terminal, 'owner-close'); return { closed: true, released: terminal.released } }
    if (terminal.closed || terminal.released) return { closed: true, output: [], seq: terminal.seq }
    if (endpoint === 'project-terminal-input') {
      if (typeof body.text !== 'string' || body.text.length > 8192) throw refuse('Invalid terminal input')
      terminal.process.stdin.write(JSON.stringify({ type: 'input', data: Buffer.from(body.text).toString('base64') }) + '\n'); return { sent: true }
    }
    if (endpoint === 'project-terminal-resize') {
      terminal.process.stdin.write(JSON.stringify({ type: 'resize', rows: Math.max(8, Math.min(100, Number(body.rows) || 24)), cols: Math.max(20, Math.min(240, Number(body.cols) || 80)) }) + '\n'); return { resized: true }
    }
    return { closed: terminal.closed, seq: terminal.seq, output: terminal.output.filter(row => row.seq > (Number(body.since) || 0)) }
  }
  async function sweep() {
    for (const terminal of terminals.values()) {
      if (terminal.closed) { if (Date.now() - terminal.createdAt > 15 * 60_000) terminals.delete(terminal.id); continue }
      if (Date.now() - terminal.lastSeen > 15_000) { await close(terminal, 'connection-ended'); continue }
      try { await access({ terminalId: terminal.id }, terminal.actor, false) } catch { /* access closes revoked/expired terminals. */ }
    }
  }
  return { endpoint, check, sweep, revoke: (sessionId, projectId, memberId) => Promise.all([...terminals.values()].filter(row => sessionId ? row.actor.sessionId === sessionId : row.target.projectId === projectId && row.actor.memberId === memberId).map(row => close(row, 'authorization-ended'))), dispose: () => Promise.all([...terminals.values()].map(row => close(row, 'host-shutdown'))) }
}
export function install(rt) {
  rt.projectRuntimeSetup = createProjectRuntimeSetup(rt)
  if (!rt.sharedProjectMode?.()) return
  rt.ctx.effect(() => { const timer = setInterval(() => { void rt.projectRuntimeSetup.sweep().catch(error => rt.warn('Terminal grant check: %s', error.message)) }, 5000); timer.unref?.(); return () => { clearInterval(timer); return rt.projectRuntimeSetup.dispose() } }, 'ds-bot: private resource terminals')
}
