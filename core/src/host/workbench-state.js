import { ownEntry } from './store.js'
import { repositoryAllowed, repositoryReadiness } from './project-repository-policy.js'
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

export function taskExecutionStatus(state, task) {
  const queued = Object.values(state.projectQueue ?? {}).find(row => row.taskId === task.id && row.status === 'waiting')
  const collaboration = task.collaboration
  const worker = collaboration?.claim?.workerId
  const sdk = worker ? state.projectHarnessWorkers?.[worker] : null
  const activeNative = worker ? state.bots?.[worker] : null
  const attempt = state.projectAttempts?.[task.deliveryAttemptId]
  let phase = task.status === 'accepted' ? 'accepted' : task.status === 'cancelled' ? 'cancelled' : 'published'
  if (['accepted', 'cancelled'].includes(task.status)) return { taskId: task.id, publication: 'published', phase, botId: collaboration?.botId ?? null, reason: null }
  if (queued) phase = 'queued'
  else if (['arbitration', 'chief-working'].includes(collaboration?.status)) phase = 'awaiting-chief'
  else if (collaboration?.status === 'blocked') phase = 'blocked'
  else if (collaboration?.status === 'queued') phase = 'queued'
  else if (collaboration?.status === 'claimed') phase = sdk?.status === 'running' || activeNative ? 'running' : sdk?.status === 'waiting-input' ? 'awaiting-input' : 'starting'
  else if (attempt?.status === 'waiting-acceptance') phase = 'awaiting-acceptance'
  else if (['failed', 'interrupted'].includes(attempt?.status)) phase = 'failed'
  else if (attempt?.status === 'running') phase = 'running'
  return { taskId: task.id, publication: 'published', phase, botId: collaboration?.botId ?? null, reason: collaboration?.block?.reason ?? queued?.reason ?? null }
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
    const repository = await repositoryReadiness(rt, project)
    if (body.view === 'summary') return {
      projectId: id, quota: project.quota ?? { maxConcurrent: 2 }, activeSlots: rt.projectScheduler.slots(id), repository,
      queue: Object.values(rt.state.projectQueue ?? {}).filter(row => row.projectId === id && ['waiting', 'blocked'].includes(row.status)).map(({ id, taskId, status, reason }) => ({ id, taskId, status, reason })),
      taskExecution: Object.values(rt.state.tasks).filter(task => task.projectId === id).map(task => taskExecutionStatus(rt.state, task)),
      metrics: deliveryMetrics(rt.state, id),
    }
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
      harnessWorkers: Object.values(rt.state.projectHarnessWorkers ?? {}).filter(row => row.projectId === id && (row.visibility !== 'private' || row.memberId === actor.memberId) && (!row.roomId || (() => { const room = ownEntry(rt.state.projectRooms ?? {}, row.roomId); return room?.projectId === id && (!room.memberIds.length || room.memberIds.includes(actor.memberId)) })())).map(({ eventLog: _log, sealedLog: _sealedLog, cwd: _cwd, ...row }) => structuredClone(row)),
      executionResources: rt.projectResources?.list(id, actor) ?? [],
      resourceLeases: Object.values(rt.state.projectResourceLeases ?? {}).filter(row => row.projectId === id).map(({ worker: _worker, ...row }) => structuredClone(row)),
      chief: rt.projectChiefControl?.view(id, actor) ?? null,
      taskExecution: Object.values(rt.state.tasks).filter(task => task.projectId === id).map(task => taskExecutionStatus(rt.state, task)),
      repository, host, metrics: deliveryMetrics(rt.state, id), platformInstance: rt.platformInstance ? await rt.platformInstance(actor).catch(() => null) : null }
  }
}
