// Operator-provisioned execution capabilities; Project configuration only references IDs.
import { execFile, spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { ownEntry, setEntry } from './store.js'
const exec = promisify(execFile)
const failure = message => Object.assign(new Error(message), { code: 'bot/resource' })
const active = lease => lease.status !== 'released'
const contains = (root, path) => { const part = relative(root, path); return part === '' || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) }
const safeEnv = () => ({ PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' })

export function createProjectResources(rt) {
  const { state, config } = rt
  const leases = () => (state.projectResourceLeases ??= {})
  const resources = () => config.projectResources ?? {}
  let recovered = false
  let tail = Promise.resolve()
  const serial = fn => { const result = tail.then(fn, fn); tail = result.then(() => {}, () => {}); return result }
  const occupied = id => Object.values(leases()).filter(row => row.resourceId === id && active(row)).length
  function setting(projectId, resourceId) {
    const project = rt.readProject(projectId)
    const resource = ownEntry(resources(), resourceId)
    if (!project || !resource || !resource.allowedProjectOwnerIds?.includes(project.ownerUserId) || resource.projectIds && !resource.projectIds.includes(projectId)) throw failure('Execution resource is not authorized for this Project')
    if (!['local', 'docker'].includes(resource.type) || !isAbsolute(resource.root ?? '') || !Number.isInteger(resource.capacity) || resource.capacity < 1 || resource.capacity > 64) throw failure('Execution resource configuration is invalid')
    if (resource.type === 'docker' && (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(resource.container ?? '') || !/^\d+(?::\d+)?$/.test(resource.user ?? ''))) throw failure('Docker resource needs an explicit container and numeric UID')
    return resource
  }
  function list(projectId) {
    return Object.keys(resources()).flatMap(id => {
      try {
        const item = setting(projectId, id)
        const observation = ownEntry(state.projectResourceHealth ?? {}, id)
        return [{ id, type: item.type, capacity: { configured: item.capacity, occupied: occupied(id) }, harnesses: item.harnesses ?? [],
          harnessStatus: (item.harnesses ?? []).map(harness => ({ harness, ...(ownEntry(state.projectHarnessHealth ?? {}, `${projectId}:${id}:${harness}`) ?? { status: harness === 'flybot' ? 'native-host-provider' : 'unconfigured' }) })),
          health: observation ?? { status: 'unconfigured', reason: 'Environment has not been probed', at: null },
          metrics: { cpu: null, memory: null, basis: 'unavailable' }, platformInstanceId: item.platformInstanceId ?? null }]
      } catch { return [] /* Unauthorized/malformed resources are not enumerable. */ }
    })
  }
  function checkPool(projectId, execution = {}) {
    for (const id of execution.resourceIds ?? []) setting(projectId, id)
  }
  function select(request, pending = []) {
    const { projectId, harness, resourceIds, role, maxConcurrent } = request
    checkPool(projectId, { resourceIds })
    const usage = id => occupied(id) + pending.filter(row => row.resourceId === id).length
    if (maxConcurrent && [...Object.values(leases()).filter(active), ...pending].filter(row => row.projectId === projectId && row.role === role).length >= maxConcurrent) throw failure('Role capacity is full')
    const candidates = resourceIds.map(id => ({ id, item: setting(projectId, id) })).filter(({ item }) => !item.disabled && item.harnesses?.includes(harness))
    if (!candidates.length) throw failure('No compatible execution resource in the selected pool')
    const available = candidates.filter(({ id, item }) => {
      const health = ownEntry(state.projectResourceHealth ?? {}, id)
      const auth = ownEntry(state.projectHarnessHealth ?? {}, `${projectId}:${id}:${harness}`)
      return health?.status === 'ready' && (harness === 'flybot' || auth?.status === 'ready') && usage(id) < item.capacity
    })
    if (!available.length) throw failure('Execution resource capacity or readiness is unavailable')
    available.sort((a, b) => usage(a.id) / a.item.capacity - usage(b.id) / b.item.capacity || a.id.localeCompare(b.id))
    return available[0]
  }
  function plan(projectId, definitions) {
    const pending = []
    for (const role of definitions?.roles ?? []) {
      if (role.role === 'chief' || !role.execution?.resourceIds?.length) continue
      const execution = role.execution
      const selected = select({ projectId, role: role.role, harness: execution.harness, resourceIds: execution.resourceIds, maxConcurrent: execution.maxConcurrent }, pending)
      pending.push({ resourceId: selected.id, projectId, role: role.role })
    }
    return pending
  }
  async function reserve(request) {
    const existing = Object.values(leases()).find(row => row.sessionKey === request.sessionKey)
    if (existing) {
      if (existing.projectId !== request.projectId || existing.attemptId !== request.attemptId || existing.role !== request.role || existing.harness !== request.harness || existing.status === 'released') throw failure('Execution resource Session key is already bound or released')
      return structuredClone(existing)
    }
    const selected = select(request)
    const lease = { id: `resource-lease-${randomUUID()}`, generation: 1, projectId: request.projectId, attemptId: request.attemptId, role: request.role,
      sessionKey: request.sessionKey, resourceId: selected.id, harness: request.harness, principalId: rt.readProject(request.projectId).ownerUserId, runtimeUser: selected.item.type === 'docker' ? selected.item.user : `uid:${process.getuid?.() ?? 'unknown'}`,
      status: 'reserved', createdAt: Date.now() }
    setEntry(leases(), lease.id, lease)
    await rt.save()
    return structuredClone(lease)
  }
  async function reserveRoles(projectId, attemptId, definitions) {
    plan(projectId, definitions)
    const reserved = {}
    for (const role of definitions?.roles ?? []) {
      if (role.role === 'chief' || !role.execution?.resourceIds?.length) continue
      reserved[role.role] = await reserve({ projectId, attemptId, role: role.role, sessionKey: `${attemptId}:${role.role}`, ...role.execution })
    }
    return reserved
  }
  function requireLease(id, generation) {
    const lease = ownEntry(leases(), id)
    if (!lease || lease.generation !== generation) throw failure('Execution lease generation mismatch')
    return lease
  }
  async function markStarted(id, generation, worker) {
    const lease = requireLease(id, generation)
    if (lease.status === 'released') throw failure('Execution resource lease was released')
    if (lease.worker && JSON.stringify(lease.worker) !== JSON.stringify(worker)) throw failure('Execution resource worker is already bound')
    lease.worker = structuredClone(worker); lease.status = 'running'
    await rt.save()
  }
  async function release(id, generation, confirmation) {
    const lease = requireLease(id, generation)
    if (lease.status === 'released') return
    const worker = lease.worker
    const confirmed = !worker || worker.kind === 'native' && !ownEntry(state.bots ?? {}, worker.botId) || confirmation?.handle === worker.handle && confirmation?.exited === true
    lease.status = confirmed ? 'released' : 'stopping'
    if (confirmed) lease.releasedAt = Date.now()
    await rt.save()
    if (confirmed) rt.projectScheduler?.wake()
  }
  function recover() {
    if (recovered || rt.readOnly?.()) return false
    recovered = true
    let changed = false
    for (const lease of Object.values(leases()).filter(active)) {
      if (lease.status === 'unreachable') continue
      lease.status = 'unreachable'; changed = true
    }
    return changed
  }
  async function reconcile() {
    for (const lease of Object.values(leases()).filter(active)) {
      if ((!lease.worker || lease.worker.kind === 'native') && !ownEntry(state.bots ?? {}, lease.worker.botId)) await release(lease.id, lease.generation)
      else if (lease.worker?.kind !== 'native' && lease.worker) lease.status = 'unreachable'
    }
    await rt.save()
  }
  function startProcess(projectId, resourceId, { argv, cwd }) {
    const item = setting(projectId, resourceId)
    if (!Array.isArray(argv) || !argv.length || !isAbsolute(cwd ?? '') || !contains(item.root, cwd)) throw failure('Invalid resource process target')
    const options = { env: safeEnv(), stdio: ['pipe', 'pipe', 'pipe'], detached: item.type === 'local' }
    return item.type === 'local' ? spawn(argv[0], argv.slice(1), { ...options, cwd })
      : spawn('docker', ['exec', '-i', '--user', item.user, '--workdir', cwd, item.container, 'env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', ...argv], options)
  }
  async function command(projectId, resourceId, { argv, cwd, timeout = 30_000, input } = {}) {
    const item = setting(projectId, resourceId)
    if (!Array.isArray(argv) || !argv.length || argv.some(value => typeof value !== 'string' || value.includes('\0')) || !isAbsolute(cwd ?? '') || !contains(item.root, cwd)) throw failure('Invalid resource command or working directory')
    const options = { timeout: Math.min(timeout, 120_000), maxBuffer: 2 * 1024 * 1024, env: safeEnv() }
    // No shell interpolation. Target paths and credentials never become host shell code.
    if (input !== undefined) throw failure('Resource command input requires a streaming adapter')
    if (item.type === 'local') {
      const [actualRoot, actualCwd] = await Promise.all([realpath(item.root), realpath(cwd)])
      if (!contains(actualRoot, actualCwd)) throw failure('Resource working directory escapes its registered root')
      return exec(argv[0], argv.slice(1), { ...options, cwd: actualCwd })
    }
    return exec('docker', ['exec', '--user', item.user, '--workdir', cwd, item.container, 'env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8', ...argv], options)
  }
  async function probe(projectId, resourceId) {
    const item = setting(projectId, resourceId)
    let row
    try {
      const result = await command(projectId, resourceId, { argv: ['node', '-p', 'JSON.stringify({node:process.version,uid:process.getuid?.(),platform:process.platform})'], cwd: item.root, timeout: 5000 })
      row = { status: 'ready', environment: JSON.parse(result.stdout.trim()), at: Date.now(), authentication: 'not-probed' }
    } catch { row = { status: 'unreachable', reason: 'Resource runtime probe failed; check configured target, UID and directory', at: Date.now(), authentication: 'not-probed' } }
    state.projectResourceHealth ??= {}; setEntry(state.projectResourceHealth, resourceId, row); await rt.save()
    return structuredClone(row)
  }
  return { setting, list, checkPool, plan, command, startProcess, probe, occupied, reconcile, recover,
    reserveRoles: (...args) => serial(() => reserveRoles(...args)),
    reserve: request => serial(() => reserve(request)), markStarted: (...args) => serial(() => markStarted(...args)), release: (...args) => serial(() => release(...args)) }
}
export function install(rt) { rt.projectResources = createProjectResources(rt) }
