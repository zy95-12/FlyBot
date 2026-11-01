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
export function resumableBinding(state, record, key) {
  const previous = record.bindings.findLast(row => row.key === key)
  if (!previous) return null
  const worker = ownEntry(state.projectHarnessWorkers ?? {}, previous.workerId)
  const lease = worker && ownEntry(state.projectResourceLeases ?? {}, worker.leaseId)
  if (!worker || worker.projectId !== record.projectId || worker.taskId !== record.taskId || worker.role !== record.role || worker.logicalSessionId !== record.id || worker.bindingKey !== key || worker.status !== 'released' || worker.releaseProof?.kind !== 'sdk-stop-ack-and-process-exit' || worker.releaseProof.generation !== worker.generation || lease?.status !== 'released' || lease.projectId !== record.projectId || lease.resourceId !== worker.resourceId || lease.generation !== worker.generation || worker.backendSessionId !== previous.sessionId) throw new Error('Previous Task Session exit or binding is unconfirmed')
  return previous
}
