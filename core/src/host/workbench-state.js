import { ownEntry } from './store.js'
import { repositoryAllowed, repositorySettings } from './project-repository-policy.js'
const median = values => values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2

export function deliveryMetrics(state, projectId, now = Date.now()) {
  const since = now - 7 * 24 * 3600_000
  const accepted = Object.values(state.projectAttempts ?? {}).filter(attempt => attempt.projectId === projectId && attempt.status === 'accepted' && attempt.acceptedAt >= since && attempt.acceptedAt <= now)
  const samples = accepted.map(attempt => ({ attempt, task: ownEntry(state.tasks, attempt.taskId) })).filter(row => Number.isFinite(row.task?.createdAt) && row.attempt.acceptedAt >= row.task.createdAt)
    .map(row => row.attempt.acceptedAt - row.task.createdAt).sort((a, b) => a - b)
  return { window: { kind: 'rolling-seven-days', since, until: now }, acceptedTasks: new Set(accepted.map(attempt => attempt.taskId)).size,
    duration: { basis: 'Task created to human acceptance, includes queue/execution/human wait', samples: samples.length,
      meanMs: samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null, medianMs: samples.length ? median(samples) : null } }
}

export function install(rt) {
  let cpu = process.cpuUsage()
  let measured = process.hrtime.bigint()
  rt.workbenchEndpoint = async (endpoint, body, actor) => {
    if (endpoint === 'auth-mode') return { workbench: rt.sharedProjectMode(), mode: rt.platformIdentityEnabled ? 'platform' : 'local', panelUrl: rt.config.controlPlane?.origin ?? null }
    if (!rt.sharedProjectMode() || !actor?.memberId) throw Object.assign(new Error('Sign in to the Project workbench'), { code: 'bot/unauthorized' })
    if (endpoint === 'workbench-state') {
      const projects = await rt.projectEndpoint('projects', {}, actor)
      return { demoMode: rt.config.projectDemoMode ?? null, self: { memberId: actor.memberId, displayName: actor.displayName ?? actor.memberId }, ...projects,
        models: await rt.catalog(), repositories: Object.entries(rt.config.projectRepositories ?? {}).filter(([, settings]) => repositoryAllowed(settings, actor.memberId)).map(([name]) => name) }
    }
    const id = String(body.projectId ?? '')
    const project = rt.requireProjectAccess(actor, id)
    let repository = { configured: false }
    try { const settings = repositorySettings(rt, project); repository = { configured: true, name: project.repository, model: settings.model ?? rt.config.projectModel ?? null } } catch { /* Unprovisioned repository is represented as configured:false. */ }
    const workers = Object.values(rt.state.bots).filter(bot => bot.projectId === id && bot.ephemeral).map(bot => ({ id: bot.id, role: bot.role, attemptId: bot.attemptId ?? null, workspaceId: bot.workspaceId ?? null, createdAt: bot.createdAt }))
    const nowCpu = process.cpuUsage(), now = process.hrtime.bigint()
    const elapsedMicros = Number(now - measured) / 1000
    const percent = elapsedMicros > 0 ? (nowCpu.user + nowCpu.system - cpu.user - cpu.system) * 100 / elapsedMicros : null
    const host = { scope: 'shared-host-process', rssBytes: process.memoryUsage().rss, cpuPercent: elapsedMicros >= 100_000 ? percent : null, cpuSampleMs: elapsedMicros / 1000,
      cpuLimit: null, memoryLimitBytes: null, gpu: null, reason: 'Per-Project CPU/memory limits and GPU pools are not reported by the current platform API' }
    cpu = nowCpu; measured = now
    return { projectId: id, quota: project.quota ?? { maxConcurrent: 2 }, activeSlots: rt.projectScheduler.slots(id),
      queue: Object.values(rt.state.projectQueue ?? {}).filter(entry => entry.projectId === id).map(entry => structuredClone(entry)), workers,
      workspaces: Object.values(rt.state.projectWorkspaces ?? {}).filter(workspace => workspace.projectId === id),
      harnessWorkers: Object.values(rt.state.projectHarnessWorkers ?? {}).filter(row => row.projectId === id).map(({ eventLog: _log, cwd: _cwd, ...row }) => structuredClone(row)),
      executionResources: rt.projectResources?.list(id) ?? [],
      resourceLeases: Object.values(rt.state.projectResourceLeases ?? {}).filter(row => row.projectId === id).map(({ worker: _worker, ...row }) => structuredClone(row)),
      repository, host, metrics: deliveryMetrics(rt.state, id), platformInstance: rt.platformInstance ? await rt.platformInstance(actor).catch(() => null) : null }
  }
}
