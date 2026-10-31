// Resource-side JSONL worker. No credentials in command arguments or persistent stdin logs.
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { runHarnessTurn } from './project-harness-turn.js'
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
const write = value => process.stdout.write(JSON.stringify(value) + '\n')
const answers = new Map()
let controller, sessionId, settings, busy = false
const permission = request => new Promise(resolve => {
  const id = randomUUID(); answers.set(id, resolve); write({ type: 'permission', id, request })
})
async function turn(message) {
  if (busy) { write({ type: 'failure', reason: 'SDK Session is already answering' }); return }
  busy = true; controller = new AbortController()
  try {
    settings ??= message.settings
    sessionId ??= settings.sessionId
    const result = await runHarnessTurn({ ...settings, sessionId, prompt: message.prompt }, { emit: write, permission, signal: controller.signal })
    sessionId = result.sessionId
    write({ type: 'completed', ...result })
  } catch { write({ type: 'failure', reason: 'SDK execution failed; inspect the redacted event evidence and resource environment' }) }
  finally { busy = false }
}
input.on('line', line => {
  try {
    const message = JSON.parse(line)
    if (message.type === 'start' || message.type === 'input') void turn(message)
    else if (message.type === 'permission') { const resolve = answers.get(message.id); answers.delete(message.id); resolve?.({ allow: message.allow === true }) }
    else if (message.type === 'stop') { controller?.abort(); for (const resolve of answers.values()) resolve({ allow: false }); input.close(); process.exitCode = 0; setTimeout(() => process.exit(0), 2000).unref() }
  } catch { write({ type: 'failure', reason: 'Invalid worker protocol input' }) }
})
input.on('close', () => { controller?.abort(); setTimeout(() => process.exit(0), 2000).unref() })
write({ type: 'ready', pid: process.pid, sdk: { codex: '0.166.0', 'claude-agent': '0.3.316' } })
