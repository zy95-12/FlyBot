import { createHash } from 'node:crypto'
import { ownEntry, setEntry } from './store.js'
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const taskSessionId = (projectId, taskId, role) => `task-session-${digest([projectId, taskId, role]).slice(0, 32)}`

// Logical Sessions outlive processes and Attempts. Backend bindings never cross cwd/profile.
export function taskSession(state, session) {
  const task = ownEntry(state.tasks ?? {}, session.taskId)
  if (!task || task.projectId !== session.projectId || !['developer', 'tester', 'reviewer'].includes(session.role)) throw new Error('Task Session scope changed')
  state.projectTaskSessions ??= {}
  const id = taskSessionId(session.projectId, session.taskId, session.role)
  let record = ownEntry(state.projectTaskSessions, id)
  if (!record) { record = { id, projectId: session.projectId, taskId: session.taskId, role: session.role, bindings: [], createdAt: Date.now() }; setEntry(state.projectTaskSessions, id, record) }
  if (record.projectId !== session.projectId || record.taskId !== session.taskId || record.role !== session.role) throw new Error('Task Session identity changed')
  return record
}
export function backendBindingKey({ harness, resourceId, principalId, cwd, model, profile, definition }) {
  return digest({ harness, resourceId, principalId, cwd, model, home: profile.home, configDir: profile.configDir, baseUrl: profile.baseUrl ?? null, definition })
}
// Both lifecycle proofs are produced by the host, never by role output. A prior
// service exit must be tied to the exact lease the supervisor reconciled.
export function confirmedWorkerExit(state, worker) {
  if (!worker || !Number.isSafeInteger(worker.generation) || worker.generation < 1) return false
  if (worker.status !== 'released') {
    const lease = ownEntry(state.projectResourceLeases ?? {}, worker.leaseId), proof = worker.releaseProof
    return Boolean(worker.status === 'failed' && worker.releasedAt && worker.exit?.code === 0 && proof?.kind === 'sdk-stop-ack-and-process-exit' && proof.workerId === worker.id && proof.generation === worker.generation &&
      lease?.status === 'released' && lease.projectId === worker.projectId && lease.attemptId === worker.attemptId && lease.role === worker.role && lease.resourceId === worker.resourceId && lease.generation === worker.generation &&
      lease.worker?.kind === 'sdk' && lease.worker.handle === worker.id && lease.releaseProof?.kind === proof.kind && lease.releaseProof.workerId === worker.id && lease.releaseProof.generation === worker.generation && lease.releaseProof.at === proof.at)
  }
  const proof = worker.releaseProof
  if (proof?.kind === 'sdk-stop-ack-and-process-exit') return proof.generation === worker.generation
  if (proof?.kind !== 'systemd-prior-invocation-exited' || !/^[a-f0-9]{32}$/.test(proof.previousInvocationId ?? '')) return false
  const lease = ownEntry(state.projectResourceLeases ?? {}, worker.leaseId)
  return Boolean(lease?.status === 'released' && lease.projectId === worker.projectId && lease.attemptId === worker.attemptId && lease.role === worker.role && lease.resourceId === worker.resourceId && lease.generation === worker.generation &&
    lease.worker?.kind === 'sdk' && lease.worker.handle === worker.id && lease.processScope?.kind === 'systemd-control-group' && lease.processScope.killMode === 'control-group' && lease.processScope.invocationId === proof.previousInvocationId &&
    lease.releaseProof?.kind === proof.kind && lease.releaseProof.previousInvocationId === proof.previousInvocationId)
}
export function resumableBinding(state, record, key) {
  const previous = record.bindings.findLast(row => row.key === key)
  if (!previous) return null
  const worker = ownEntry(state.projectHarnessWorkers ?? {}, previous.workerId)
  const lease = worker && ownEntry(state.projectResourceLeases ?? {}, worker.leaseId)
  if (!worker || worker.projectId !== record.projectId || worker.taskId !== record.taskId || worker.role !== record.role || worker.logicalSessionId !== record.id || worker.bindingKey !== key || !confirmedWorkerExit(state, worker) || lease?.status !== 'released' || lease.projectId !== record.projectId || lease.resourceId !== worker.resourceId || lease.generation !== worker.generation || worker.backendSessionId !== previous.sessionId) throw new Error('Previous Task Session exit or binding is unconfirmed')
  return previous
}
