import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runHarnessTurn } from '../src/host/project-harness-turn.js'
const request = { harness: 'codex', cwd: '/workspace/task', model: 'explicit-model', prompt: 'Implement only the frozen Task', env: { HOME: '/explicit/profile', CODEX_HOME: '/explicit/codex' } }
function codex(events, inspect = () => {}) {
  return async () => ({ Codex: class {
    constructor(options) { inspect(options) }
    startThread(options) { inspect(options); return this.thread() }
    resumeThread(id, options) { inspect({ id, ...options }); return this.thread() }
    thread() { return { runStreamed: async () => ({ events: (async function* () { yield* events })() }) } }
  } })
}

test('Codex adapter binds explicit environment and Session, and turn completion is separate from delivery', async () => {
  const observed = [], events = []
  const result = await runHarnessTurn(request, { emit: event => events.push(event), loadCodex: codex([
    { type: 'thread.started', thread_id: 'thread-one' }, { type: 'item.completed', item: { type: 'agent_message', text: 'OUTPUT implementation: changed code' } }, { type: 'turn.completed', usage: { input_tokens: 3 } },
  ], value => observed.push(value)) })
  assert.equal(result.sessionId, 'thread-one')
  assert.equal(result.text, 'OUTPUT implementation: changed code')
  assert.deepEqual(observed[0].env, request.env)
  assert.equal(observed[1].sandboxMode, 'workspace-write')
  assert.equal(observed[1].approvalPolicy, 'never')
  assert.equal(result.accepted, undefined)
  assert.equal(events.length, 3)
})

test('truncated, failed and aborted SDK streams never report completion', async () => {
  for (const events of [[{ type: 'thread.started', thread_id: 't' }], [{ type: 'error', message: 'auth failed' }], [{ type: 'turn.failed' }]]) {
    await assert.rejects(runHarnessTurn(request, { emit() {}, loadCodex: codex(events) }), /failed|without/)
  }
  const signal = AbortSignal.abort()
  await assert.rejects(runHarnessTurn(request, { signal, emit() {}, loadCodex: codex([{ type: 'thread.started', thread_id: 't' }, { type: 'turn.completed' }]) }), /without/)
})

test('continuation resumes the bound Codex thread, preserving resource cwd', async () => {
  const observed = []
  await runHarnessTurn({ ...request, sessionId: 'original' }, { emit() {}, loadCodex: codex([{ type: 'turn.completed' }], value => observed.push(value)) })
  assert.equal(observed[1].id, 'original')
  assert.equal(observed[1].workingDirectory, request.cwd)
})

test('Claude Agent SDK uses explicit environment and forwards permission requests', async () => {
  let options, asked = false
  const result = await runHarnessTurn({ ...request, harness: 'claude-agent' }, { emit() {}, permission: async () => { asked = true; return { allow: false } },
    loadClaude: async () => ({ query(input) {
      options = input.options
      return (async function* () {
        assert.equal((await options.canUseTool('Bash', { command: 'echo test' }, { toolUseID: 'tool-1' })).behavior, 'deny')
        yield { type: 'system', session_id: 'claude-session' }; yield { type: 'result', subtype: 'success', result: 'OUTPUT review: findings', usage: {} }
      })()
    } }) })
  assert.equal(asked, true)
  assert.deepEqual(options.env, request.env)
  assert.deepEqual(options.settingSources, [])
  assert.equal(result.sessionId, 'claude-session')
})
