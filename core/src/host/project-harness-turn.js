import { fileURLToPath } from 'node:url'
// One real SDK turn. The host owns Workflow completion and acceptance, never this driver.
export async function runHarnessTurn(request, { emit, permission, signal, loadCodex = () => import('@openai/codex-sdk'), loadClaude = () => import('@anthropic-ai/claude-agent-sdk') }) {
  let text = '', completed = false, sessionId = request.sessionId ?? null, usage = null
  if (request.harness === 'codex') {
    const { Codex } = await loadCodex()
    const denyScript = fileURLToPath(new URL('./project-harness-deny-tool.mjs', import.meta.url))
    const quote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$').replaceAll('`', '\\`')}"`
    const connectorPolicy = { remote_plugin: false, skill_mcp_dependency_install: false }
    const chiefConfig = request.noTools ? { features: { ...connectorPolicy, shell_tool: false }, tools: { view_image: false }, apps: { _default: { enabled: false } },
      hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: `node ${quote(denyScript)}` }] }] } } : { features: connectorPolicy }
    const client = new Codex({ env: request.env, configOverrides: ['mcp_servers={}', 'plugins={}', 'apps={_default={enabled=false}}'], ...(request.baseUrl ? { baseUrl: request.baseUrl } : {}), config: { ...(request.config ?? {}), ...chiefConfig } })
    const options = { workingDirectory: request.cwd, model: request.model, approvalPolicy: 'never',
      sandboxMode: request.readOnly ? 'read-only' : 'workspace-write', networkAccessEnabled: false, webSearchMode: 'disabled' }
    const thread = sessionId ? client.resumeThread(sessionId, options) : client.startThread(options)
    const { events } = await thread.runStreamed(request.prompt, { signal })
    for await (const event of events) {
      await emit({ type: 'sdk-event', harness: request.harness, event })
      if (event.type === 'thread.started') sessionId = event.thread_id
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') text = event.item.text
      if (event.type === 'turn.completed') { completed = true; usage = event.usage }
      if (event.type === 'turn.failed' || event.type === 'error') throw new Error('Codex SDK turn failed')
    }
  } else if (request.harness === 'claude-agent') {
    const { query } = await loadClaude()
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const stream = query({ prompt: request.prompt, options: {
      cwd: request.cwd, model: request.model, env: request.env, abortController: controller,
      settingSources: [], mcpServers: {}, persistSession: true,
      ...(sessionId ? { resume: sessionId } : {}), maxTurns: request.probe ? 1 : 30, maxBudgetUsd: request.maxBudgetUsd ?? 1,
      permissionMode: 'default',
      tools: request.noTools ? [] : request.readOnly ? ['Read', 'Glob', 'Grep', 'Bash'] : ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write'],
      hooks: request.noTools ? { PreToolUse: [{ hooks: [async () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Use FlyBot scoped action proposals only' } })] }] } : {},
      canUseTool: async (name, input, options) => {
        if (request.noTools) return { behavior: 'deny', message: 'Generic Chief tools are disabled' }
        const answer = await permission({ name, input, requestId: options.requestId ?? options.toolUseID })
        return answer.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'FlyBot operator refused this action' }
      },
    } })
    try {
      for await (const event of stream) {
        await emit({ type: 'sdk-event', harness: request.harness, event })
        if (event.session_id) sessionId = event.session_id
        if (event.type === 'result') {
          if (event.is_error || event.subtype !== 'success') throw new Error('Claude Agent SDK turn failed')
          text = event.result ?? ''; usage = { usage: event.usage, totalCostUsd: event.total_cost_usd }; completed = true
        }
      }
    } finally { signal?.removeEventListener('abort', abort); stream.close?.() }
  } else throw new Error('Unknown SDK Harness')
  if (!completed || !sessionId || signal?.aborted) throw new Error('SDK stream ended without a completed turn and bound Session')
  return { text, sessionId, usage }
}
