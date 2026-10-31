// No-key negative probes invoke both installed official SDKs with isolated empty profiles.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runHarnessTurn } from '../../core/src/host/project-harness-turn.js'
const root = await mkdtemp(join(tmpdir(), 'flybot-m7-harnesses-'))
execFileSync('git', ['init', '-q', root])
const results = []
try {
  for (const harness of ['codex', 'claude-agent']) {
    const home = join(root, harness)
    await mkdir(home, { recursive: true })
    const env = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: home, CODEX_HOME: home, CLAUDE_CONFIG_DIR: home,
      OPENAI_BASE_URL: 'http://127.0.0.1:1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', API_TIMEOUT_MS: '2000', CLAUDE_CODE_MAX_RETRIES: '0' }
    let events = 0, error = null
    try {
      await runHarnessTurn({ harness, env, cwd: root, model: harness === 'codex' ? 'gpt-5-codex' : 'claude-sonnet-4-5', prompt: 'Reply ready without tool calls.', readOnly: true, noTools: true,
        baseUrl: 'http://127.0.0.1:1' }, { signal: AbortSignal.timeout(15_000), emit: () => { events++ }, permission: async () => ({ allow: false }) })
    } catch (failure) { error = failure }
    assert.ok(events > 0, 'Installed SDK/runtime must accept the configured no-tools protocol before its provider failure')
    assert.ok(error, 'Missing credentials/unreachable provider must never produce successful execution')
    results.push({ harness, sdkInvoked: true, events, result: 'refused completion without configured authorization/provider' })
  }
  process.stdout.write(JSON.stringify({ results, notRun: ['real provider', 'paid inference', 'authenticated code changes'] }) + '\n')
} finally { await rm(root, { recursive: true, force: true }) }
