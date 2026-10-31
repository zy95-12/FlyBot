// Persisted Project admission queue. The existing Workflow service still dispatches Runs.
import { createHash, randomUUID } from 'node:crypto'
import { ownEntry, setEntry } from './store.js'
import { repositorySettings } from './project-repository-policy.js'
const ACTIVE = new Set(['queued', 'running', 'working', 'paused', 'legacy'])
const error = message => Object.assign(new Error(message), { code: 'bot/invalid' })

export function createProjectScheduler(rt) {
  const { state } = rt
  const entries = () => (state.projectQueue ??= {})
  let recovered = false
  let tail = Promise.resolve()
  const serial = fn => { const result = tail.then(fn, fn); tail = result.then(() => {}, () => {}); return result }
  function slots(projectId) {
    const keys = new Set()
    for (const run of Object.values(state.projectExecutions ?? {})) if (run.projectId === projectId && ACTIVE.has(run.status)) keys.add(run.attemptId ?? run.id)
    for (const attempt of Object.values(state.projectAttempts ?? {})) if (attempt.projectId === projectId && ['preparing', 'running'].includes(attempt.status)) keys.add(attempt.id)
    for (const bot of Object.values(state.bots)) if (bot.projectId === projectId && bot.ephemeral && bot.attemptId) keys.add(bot.attemptId)
    for (const lease of Object.values(state.projectResourceLeases ?? {})) if (lease.projectId === projectId && lease.status !== 'released' && lease.attemptId) keys.add(lease.attemptId)
    return keys.size
  }
  const quota = project => project.quota?.maxConcurrent ?? 2
  function revalidate(projectId) {
    let changed = false
    for (const entry of Object.values(entries())) {
      if (entry.projectId !== projectId || entry.status !== 'waiting') continue
      const task = ownEntry(state.tasks, entry.taskId)
      const actor = { memberId: entry.memberId }
      if (!task || ['accepted', 'cancelled'].includes(task.status) || !rt.projectCan(actor, projectId, 'task-write', task)) {
        entry.status = 'cancelled'
        entry.reason = 'Task ended or requester no longer has Project authority'
        entry.updatedAt = Date.now()
        changed = true
      }
    }
    return changed
  }
  function resourceBlock(projectId) {
    try { rt.projectResources?.plan(projectId, rt.projectAgents?.deliveryDefinitions(projectId)); return null }
    catch (failure) { return String(failure.message).slice(0, 300) }
  }
  async function request(body, actor) {
    const task = ownEntry(state.tasks, String(body.taskId ?? ''))
    if (!task?.projectId) throw error('Unknown Project Task')
    const project = rt.requireProjectAccess(actor, task.projectId, 'create')
    rt.requireProjectAccess(actor, project.id, 'task-write', task)
    repositorySettings(rt, project)
    if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId)) throw error('A run needs a stable requestId')
    const requestKey = createHash('sha256').update(`${project.id}\n${task.id}\n${body.requestId}`).digest('hex')
    const prior = Object.values(state.projectAttempts ?? {}).find(attempt => attempt.requestKey === requestKey)
    if (prior) return { attempt: structuredClone(prior), already: true }
    const queued = Object.values(entries()).find(entry => entry.requestKey === requestKey || entry.taskId === task.id && entry.status === 'waiting')
    if (queued) return { queue: structuredClone(queued), already: true }
    if (['accepted', 'cancelled'].includes(task.status)) throw error('Task has ended')
    if (Object.values(state.projectAttempts ?? {}).some(attempt => attempt.taskId === task.id && ['preparing', 'running', 'waiting-acceptance'].includes(attempt.status))) throw error('Task already has an active Attempt')
    const resourceReason = resourceBlock(project.id)
    if (slots(project.id) < quota(project) && !resourceReason) return rt.projectDelivery.endpoint('project-task-run', body, actor)
    const entry = { id: `queue-${randomUUID()}`, projectId: project.id, taskId: task.id, requestId: body.requestId, requestKey,
      memberId: actor.memberId, status: 'waiting', ...(resourceReason ? { reason: resourceReason } : {}), enqueuedAt: Date.now(), updatedAt: Date.now() }
    setEntry(entries(), entry.id, entry)
    await rt.save()
    return { queue: structuredClone(entry) }
  }
  async function drain() {
    if (rt.readOnly?.() || !rt.sharedProjectMode?.() || !rt.flybotIsRead?.('workflow/state')) return
    let changed = false
    for (const project of rt.listProjects()) if (revalidate(project.id)) changed = true
    const pending = Object.values(entries()).filter(entry => entry.status === 'waiting').sort((a, b) => a.enqueuedAt - b.enqueuedAt || a.id.localeCompare(b.id))
    for (const entry of pending) {
      const project = rt.readProject(entry.projectId)
      if (!project || project.status !== 'active') { entry.status = 'blocked'; entry.reason = 'Project is archived or unavailable'; changed = true; continue }
      if (slots(project.id) >= quota(project)) continue
      const blocked = resourceBlock(project.id)
      if (blocked) { entry.reason = blocked; changed = true; continue }
      entry.status = 'starting'
      entry.updatedAt = Date.now()
      await rt.save()
      try {
        const result = await rt.projectDelivery.endpoint('project-task-run', { taskId: entry.taskId, requestId: entry.requestId }, { memberId: entry.memberId })
        entry.status = result.attempt?.status === 'failed' ? 'failed' : 'started'
        entry.attemptId = result.attempt?.id ?? null
        if (result.attempt?.failure) entry.reason = result.attempt.failure.message
      } catch (failure) { entry.status = 'failed'; entry.reason = String(failure.message ?? failure).slice(0, 1000) }
      entry.updatedAt = Date.now()
      changed = true
    }
    if (changed) await rt.save()
  }
  async function cancel(body, actor) {
    const entry = ownEntry(entries(), String(body.queueId ?? ''))
    if (!entry) throw error('Unknown queued request')
    const task = ownEntry(state.tasks, entry.taskId)
    rt.requireProjectAccess(actor, entry.projectId, 'task-write', task)
    if (!['waiting', 'blocked'].includes(entry.status)) throw error('Queued request has already started or ended')
    entry.status = 'cancelled'; entry.updatedAt = Date.now(); entry.reason = 'Cancelled by an authorized member'
    await rt.save()
    return { queue: structuredClone(entry) }
  }
  function recover() {
    if (recovered || rt.readOnly?.()) return false
    recovered = true
    let changed = false
    for (const entry of Object.values(entries())) if (entry.status === 'starting') {
      const attempt = Object.values(state.projectAttempts ?? {}).find(attempt => attempt.requestKey === entry.requestKey)
      entry.status = attempt ? 'started' : 'waiting'
      entry.attemptId = attempt?.id ?? null
      changed = true
    }
    return changed
  }
  const wake = () => { void serial(drain).catch(failure => rt.warn('Project queue: %s', failure.message)) }
  return { request: (body, actor) => serial(() => request(body, actor)), cancel: (body, actor) => serial(() => cancel(body, actor)),
    slots, revalidate, recover, drain: () => serial(drain), wake }
}
export function install(rt) {
  rt.projectScheduler = createProjectScheduler(rt)
  if (!rt.sharedProjectMode?.()) return
  rt.ctx.effect(() => {
    const timer = setInterval(() => rt.projectScheduler.wake(), 1000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'ds-bot: Project admission queue')
}
