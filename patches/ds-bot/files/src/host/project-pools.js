// Per-logical-Bot routing on existing Task records. Execution remains a host adapter.
import { randomUUID, createHash } from 'node:crypto'
import { ownEntry } from './store.js'
export const POOL_PROTOCOL = 'project-handoff/v1'
const refuse = message => Object.assign(new Error(message), { code: 'bot/handoff' })
const clone = value => structuredClone(value)
const intentHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const reasonOf = value => { if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw refuse('A bounded handoff reason is required'); return value.trim() }

export function createProjectPools(rt) {
  let adapter, tail = Promise.resolve()
  let recovered = false
  const serial = fn => { const result = tail.then(fn, fn); tail = result.catch(() => {}); return result }
  const taskOf = id => { const task = ownEntry(rt.state.tasks, id); if (!task?.projectId) throw refuse('Unknown Project Task'); return task }
  const definitions = projectId => rt.projectAgents.deliveryDefinitions(projectId)
  const targetOf = (projectId, botId) => {
    const target = definitions(projectId).roles.find(role => role.id === botId)
    if (!target) throw refuse('Target logical Bot is not in this Project')
    return target
  }
  async function authority(task) {
    const actor = { memberId: task.collaboration.initiatedBy }
    rt.requireProjectAccess(actor, task.projectId, 'task-write', task)
    await rt.projectDelegations?.background(actor.memberId, task.collaboration.sourceSessionId)
    rt.requireProjectAccess(actor, task.projectId, 'task-write', task)
    rt.projects.requireActive(task.projectId)
    return actor
  }
  async function current(task, token) {
    const claim = task.collaboration?.claim
    if (!claim || claim.id !== token?.id || claim.generation !== token?.generation || claim.botId !== token?.botId || claim.status !== 'active') throw refuse('Claim is stale or belongs to another Bot')
    await authority(task)
    if (task.collaboration.claim !== claim || claim.status !== 'active' || claim.generation !== token.generation) throw refuse('Claim was revoked during authority validation')
    return claim
  }
  async function offer(task, { from, to, reason, requestId, attemptId, evidence = [], purpose = 'work', expectedGeneration }) {
    if (!adapter) throw refuse('Handoff execution adapter is unavailable')
    reason = reasonOf(reason)
    const c = task.collaboration, target = targetOf(task.projectId, to)
    if (typeof requestId !== 'string' || !/^[\w-]{1,120}$/.test(requestId)) throw refuse('A stable handoff requestId is required')
    const duplicate = c.history.find(row => row.requestId === requestId)
    if (duplicate) {
      if (duplicate.from !== from || duplicate.to !== to || duplicate.reason !== reason) throw refuse('Handoff idempotency key was reused with different content')
      return clone(duplicate)
    }
    await authority(task)
    const fromRole = from ? targetOf(task.projectId, from).role : ''
    const cycles = c.history.filter(row => row.from === from && row.to === to).length
    const trustedEvidence = await adapter.evidence?.({ task, attemptId }) ?? []
    const acceptance = task.poolAcceptance?.[target.role] ?? (target.role === 'chief' ? task.acceptance : undefined)
    const handoff = { card: task.id, fromRole, toRole: target.role, attempt: cycles, owner: c.initiatedBy, acceptance, evidence: trustedEvidence, idempotencyKey: requestId }
    const checked = adapter.validate(handoff, { roles: definitions(task.projectId).roles.map(row => row.role), pools: Object.fromEntries(definitions(task.projectId).roles.map(row => [row.role, { workers: 1 }])), execOwner: c.initiatedBy, seen: c.history.map(row => row.requestId), cycleMax: rt.config.projectHandoff?.cycleMax ?? 3, quota: rt.config.projectHandoff?.quota ?? {}, used: c.usage ?? {} })
    if (!checked.ok) throw refuse(`Handoff refused (${checked.code}): ${checked.reason}`)
    if (expectedGeneration !== undefined && c.generation !== expectedGeneration) throw refuse('Claim generation changed before handoff admission')
    const row = { id: `handoff-${randomUUID()}`, version: POOL_PROTOCOL, policyVersion: 'project-role-policy/v1', definitionRevision: definitions(task.projectId).revision, projectId: task.projectId, taskId: task.id, attemptId, initiatedBy: c.initiatedBy, from, to, reason, requestId, purpose, evidence: clone(trustedEvidence), claims: clone(evidence), requirements: { title: task.title, criteria: task.criteria ?? '' }, status: 'pending', generation: ++c.generation, createdAt: Date.now() }
    c.history.push(row); c.botId = to; c.status = target.role === 'chief' ? 'arbitration' : 'queued'; c.currentHandoffId = row.id; delete c.claim
    task.handoff = { from: fromRole || 'requester', to: target.role, reason, at: row.createdAt }
    await rt.save()
    return clone(row)
  }
  async function admit(attempt, actor, { targetRole = 'developer', kind } = {}) {
    const task = taskOf(attempt.taskId)
    if (kind && task.projectTaskKind && kind !== task.projectTaskKind) throw refuse('Task kind cannot change at execution admission')
    kind ??= task.projectTaskKind ?? 'code'
    rt.requireProjectAccess(actor, task.projectId, 'task-write', task)
    const target = definitions(task.projectId).roles.find(row => row.role === targetRole)
    if (!target || !['code', 'decision', 'release'].includes(kind)) throw refuse('Unsupported Task target or kind')
    task.collaboration ??= { version: POOL_PROTOCOL, initiatedBy: actor.memberId, generation: 0, history: [] }
    const c = task.collaboration
    if (c.claim?.status === 'active') throw refuse('Task still has an active execution claim')
    c.sourceSessionId = actor.sessionId ?? null
    c.initiatedBy = actor.memberId
    c.attemptId = attempt.id; c.kind = kind
    return offer(task, { from: null, to: target.id, reason: 'Authorized Task execution request', requestId: attempt.id, attemptId: attempt.id })
  }
  async function claim(taskId, botId) {
    const task = taskOf(taskId), c = task.collaboration
    if (!c || c.botId !== botId || c.status !== 'queued') return null
    await authority(task); targetOf(task.projectId, botId)
    if (Object.values(rt.state.tasks).some(row => row.collaboration?.claim?.botId === botId && row.collaboration.claim.status === 'active')) return null
    if (adapter.ready && !adapter.ready({ task, definition: targetOf(task.projectId, botId) })) return null
    const receipt = c.history.find(row => row.id === c.currentHandoffId)
    if (!receipt || receipt.status !== 'pending') throw refuse('Task has no pending handoff receipt')
    const limit = rt.config.projectHandoff?.quota?.steps
    if (Number.isFinite(limit) && (c.usage?.steps ?? 0) >= limit) { c.status = 'blocked'; c.block = { reason: 'Handoff refused (quota): execution step quota is exhausted', at: Date.now() }; await rt.save(); throw refuse(c.block.reason) }
    const claim = { id: `claim-${randomUUID()}`, botId, generation: ++c.generation, taskId: task.id, projectId: task.projectId, attemptId: c.attemptId, status: 'active', createdAt: Date.now() }
    c.usage ??= {}; c.usage.steps = (c.usage.steps ?? 0) + 1
    c.claim = claim; c.status = 'claimed'; receipt.status = 'accepted'; receipt.acceptedAt = Date.now(); receipt.claimId = claim.id
    await rt.save()
    return clone(claim)
  }
  async function decide(taskId, token, decision) {
    const task = taskOf(taskId), c = task.collaboration
    const prior = c?.history.find(row => row.execution?.id === token?.id)
    if (prior) {
      await authority(task)
      if (prior.decision.intentHash !== intentHash(decision)) throw refuse('Execution decision idempotency key was reused with different content')
      return clone(c.history.find(row => row.requestId === (decision.requestId ?? token.id)) ?? { status: 'blocked', reason: c.block?.reason })
    }
    const claim = await current(task, token)
    const action = decision?.action, reason = reasonOf(decision?.reason)
    if (!['handoff', 'return', 'transfer', 'complete', 'arbitrate'].includes(action)) throw refuse('Bot must hand off, return, transfer or request Chief judgement')
    const role = targetOf(task.projectId, claim.botId).role
    const next = ['complete', 'arbitrate'].includes(action) ? definitions(task.projectId).roles.find(row => row.role === 'chief') : targetOf(task.projectId, decision.to)
    if (!next) throw refuse('Chief is not configured')
    // Stop confirmation precedes relinquishing the claim and capacity.
    if (claim.workerId && !await adapter.release(claim.workerId)) throw refuse('Worker exit is unconfirmed; claim and capacity remain held')
    await current(task, token)
    if (action === 'handoff' || action === 'complete') await adapter.complete({ task, claim, role, outputs: decision.outputs ?? {} })
    await current(task, token)
    claim.status = 'completed'; claim.decision = { action, reason, intentHash: intentHash(decision), at: Date.now() }
    const receipt = c.history.find(row => row.id === c.currentHandoffId)
    receipt.finishedAt = Date.now(); receipt.decision = clone(claim.decision); receipt.execution = clone(claim)
    c.usage ??= {}; c.usage.ms = (c.usage.ms ?? 0) + Date.now() - claim.createdAt
    const usage = rt.state.projectHarnessWorkers?.[claim.workerId]?.usage
    c.usage.tokens = (c.usage.tokens ?? 0) + (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
    if (next.role === 'developer' && c.kind === 'code') c.attemptId = await adapter.rework?.({ task, claim, reason }) ?? c.attemptId
    try {
      return await offer(task, { from: claim.botId, to: next.id, reason, requestId: decision.requestId ?? claim.id, attemptId: c.attemptId, evidence: decision.evidence ?? [], purpose: action, expectedGeneration: claim.generation })
    } catch (error) {
      c.status = 'blocked'; c.block = { reason: error.message, at: Date.now() }; await rt.save(); throw error
    }
  }
  function available(projectId, botId, actor) {
    rt.requireProjectAccess(actor, projectId); targetOf(projectId, botId)
    return Object.values(rt.state.tasks).filter(task => task.projectId === projectId && task.collaboration?.botId === botId && ['queued', 'arbitration'].includes(task.collaboration.status)).map(clone)
  }
  const owns = botId => Object.values(rt.state.tasks).some(task => task.collaboration?.claim?.workerId === botId || task.collaboration?.history.some(row => row.execution?.workerId === botId))
  async function result({ botId, ok, text }) {
    const task = Object.values(rt.state.tasks).find(task => task.collaboration?.claim?.workerId === botId && task.collaboration.claim.status === 'active')
    if (!task) return owns(botId)
    const token = clone(task.collaboration.claim)
    let decision
    try {
      const output = String(text).match(/(?:^|\n)OUTPUT handoff:\s*([^\n]+)/)?.[1]
      decision = ok && output ? JSON.parse(output) : { action: 'arbitrate', reason: ok ? 'Worker did not provide a valid handoff decision' : `Execution failed: ${String(text).slice(0, 1000)}` }
    } catch { decision = { action: 'arbitrate', reason: 'Worker returned malformed handoff JSON' } }
    try { await decide(task.id, token, decision) }
    catch (error) {
      const c = task.collaboration; c.status = 'blocked'; c.block = { reason: error.message, at: Date.now() }
      if (c.claim?.workerId) {
        c.claim.status = 'blocked'; ++c.generation
        try { c.claim.exitConfirmed = await adapter.release(c.claim.workerId) } catch { c.claim.exitConfirmed = false }
      }
      await rt.save()
    }
    return true
  }
  async function pump() {
    if (!adapter || rt.readOnly?.()) return
    const offered = Object.values(rt.state.tasks).filter(task => task.collaboration?.status === 'queued')
    for (const task of offered) {
      let token
      try { token = await serial(() => claim(task.id, task.collaboration.botId)) }
      catch (error) { rt.warn?.('Bot pool claim refused: %s', error.message); continue }
      if (!token) continue
      try {
        const workerId = await adapter.execute({ task, claim: token, definition: targetOf(task.projectId, token.botId) })
        await serial(async () => { const claim = await current(task, token); claim.workerId = workerId; await rt.save() })
        await adapter.dispatch({ task, claim: token, workerId })
      } catch (error) {
        await serial(async () => { const c = task.collaboration; if (c.claim?.id !== token.id) return; c.status = 'blocked'; c.block = { reason: String(error.message).slice(0, 1000), at: Date.now() }; await rt.save() })
      }
    }
  }
  async function revokePrincipal(projectId, memberId) {
    for (const task of Object.values(rt.state.tasks)) {
      const c = task.collaboration
      if (task.projectId !== projectId || c?.initiatedBy !== memberId || !['queued', 'claimed'].includes(c.status)) continue
      c.status = 'blocked'; ++c.generation; c.block = { reason: 'Initiating human authority was revoked', at: Date.now() }
      if (c.claim) c.claim.status = 'revoked'
      await rt.save()
      if (c.claim?.workerId) { try { c.claim.exitConfirmed = await adapter.release(c.claim.workerId) } catch { c.claim.exitConfirmed = false } }
      await rt.save()
    }
  }
  function recover() {
    if (recovered || rt.readOnly?.()) return false
    recovered = true
    let changed = false
    for (const task of Object.values(rt.state.tasks)) {
      const c = task.collaboration
      if (!c?.claim || c.claim.status !== 'active') continue
      c.status = 'blocked'; c.claim.status = 'interrupted'; c.block = { reason: 'Host restarted; worker exit and resources must be reconciled before reassigning', at: Date.now() }; ++c.generation; changed = true
    }
    return changed
  }
  return { connect(value) { adapter = value; return () => { if (adapter === value) adapter = null } }, admit: (attempt, actor, body) => serial(() => admit(attempt, actor, body)), available, owns,
    claim: (id, botId) => serial(() => claim(id, botId)), decide: (id, token, decision) => serial(() => decide(id, token, decision)), result: row => serial(() => result(row)), pump, recover, revokePrincipal }
}
export function install(rt) { rt.projectPools = createProjectPools(rt) }
