// Isolated domain/transport regressions, never a production fault injector.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DEVELOPMENT_PROTOCOL } from '../../core/src/host/project-development-service.js'
import { EFFECT_PROTOCOL } from '../../core/src/host/project-effects.js'
import { INPUT_PROTOCOL } from '../../core/src/host/project-inputs.js'
import { SOURCE_PROTOCOL } from '../../core/src/host/project-sources.js'
import { TRUST_PROFILE } from '../../core/src/host/project-execution-profile.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const SCENARIOS = [
  ['saved-not-dispatched', 'project-effects-runtime', 'real store rename acknowledges the same handoff/claim before any external dispatch'],
  ['uncommitted-intent', 'project-effects', 'intent and business state commit together; uncommitted or failed saves cannot execute'],
  ['delivery-without-receipt', 'project-effects', 'storage recovery retries a launch checkpoint or receipt without dropping committed work'],
  ['remote-success-local-failure', 'project-outbox', 'remote success with a failed local receipt resumes after restart without another comment'],
  ['ambiguous-remote-success', 'project-outbox', 'comment response loss/restart reconciles the original remote receipt without a second POST'],
  ['late-generation', 'project-effects', 'old completion cannot acknowledge a replaced generation'],
  ['old-sha-stopped-context', 'project-sources', 'ended/context subscriptions and old-SHA checks/Review remain facts without waking or changing acceptance evidence'],
  ['source-revision-replay', 'project-sources', 'restart, duplicate, edited and out-of-order revisions preserve history without duplicate effective input'],
  ['revoked-write', 'project-outbox', 'revoked watch authority and tampered immutable body cannot replay a queued personal write'],
  ['capacity-two-writers', 'project-resources', 'concurrent reservations cannot oversubscribe and failed release does not wake a new worker'],
  ['unknown-exit', 'project-resources', 'restart retains unknown-process leases until explicit reconciliation confirms release'],
  ['completed-chief-deferral', 'project-chief-control', 'completed Chief deferral releases its execution claim while preserving the blocked Task and current Attempt'],
  ['autonomous-return-rework', 'project-delivery', 'default per-Bot pools execute a non-DAG SDK return/rework path with one resource and Chief completion inbox'],
  ['busy-safe-turn', 'project-harness', 'busy SDK queues feedback until a safe next turn in the same worker, thread and claim'],
  ['browser-offline-source', 'project-effects-runtime', 'scheduled Source polling survives closed browser sessions using scoped current-principal broker proof'],
  ['private-scope', 'project-agents', 'private agents have stable per-user/project identities and only shared public facts overlap'],
].map(([id, file, name]) => Object.freeze({ id, file: `core/test/${file}.test.js`, name }))

export function fixtureCommand(id) {
  const scenario = SCENARIOS.find(row => row.id === id)
  if (!scenario) throw new Error('Unknown isolated recovery scenario')
  const pattern = scenario.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return { scenario, args: ['--max-old-space-size=512', '--import', resolve(ROOT, 'core/test/harness-resolve.mjs'), '--test', '--test-concurrency=1', '--test-name-pattern', `^${pattern}$`, resolve(ROOT, scenario.file)] }
}
const digest = text => createHash('sha256').update(text ?? '').digest('hex')
export function classifyFixture(result) {
  const text = result.stdout ?? ''
  const total = label => { const matches = [...text.matchAll(new RegExp(`^(?:# |ℹ )${label} (\\d+)$`, 'gm'))]; return matches.length === 1 ? Number(matches[0][1]) : null }
  const passed = total('pass'), failed = total('fail'), notSelected = total('skipped')
  return { ok: result.status === 0 && !result.error && passed !== null && passed > 0 && failed === 0 && notSelected !== null,
    passed, failed, notSelected, exitCode: result.status, signal: result.signal ?? null,
    stdoutSha256: digest(text), stderrSha256: digest(result.stderr),
    evidence: 'local fixture with controlled adapters; not a real vendor SDK or GitHub call' }
}
export function recoveryReport(results, revision) {
  return { version: 'project-service-recovery/v1', at: new Date().toISOString(), revision,
    ok: /^[a-f0-9]{40}$/.test(revision ?? '') && results.length > 0 && results.every(row => row.ok), node: process.version,
    contracts: { service: DEVELOPMENT_PROTOCOL, effects: EFFECT_PROTOCOL, inputs: INPUT_PROTOCOL, sources: SOURCE_PROTOCOL, executionProfile: TRUST_PROFILE },
    scope: 'isolated test state/files/worktrees; controlled SDK/external adapters; no production configuration or fault injection',
    scenarios: results, notRun: ['real vendor SDK/GitHub feedback acceptance (record separately)', 'production fault injection', 'hostile-code/multi-tenant isolation', 'original UI acceptance #41'] }
}
export function runCli(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { list: { type: 'boolean' }, scenario: { type: 'string', multiple: true }, output: { type: 'string' } }, strict: true })
  if (values.list) { process.stdout.write(JSON.stringify({ scenarios: SCENARIOS, scope: 'listing only; no fixture execution' }, null, 2) + '\n'); return true }
  const ids = [...new Set(values.scenario ?? SCENARIOS.map(row => row.id))]
  const commands = ids.map(fixtureCommand) // Reject every unknown ID before starting any child.
  const output = values.output ? resolve(values.output) : null
  if (output && (existsSync(output) || existsSync(output + '.logs'))) throw new Error('Choose a new evidence path; existing recovery artifacts are never overwritten')
  if (output) { mkdirSync(dirname(output), { recursive: true }); mkdirSync(output + '.logs', { mode: 0o700 }) }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|PASSWORD|SECRET|API_KEY|GH_CONFIG_DIR|GIT_CONFIG|NODE_OPTIONS|NODE_TEST_CONTEXT/.test(key)))
  Object.assign(env, { TZ: 'UTC', FORCE_COLOR: '0' })
  const results = commands.map(({ scenario, args: childArgs }) => {
    const result = spawnSync(process.execPath, childArgs, { cwd: ROOT, env, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 })
    if (output) writeFileSync(`${output}.logs/${scenario.id}.log`, (result.stdout ?? '') + '\n' + (result.stderr ?? ''), { mode: 0o600, flag: 'wx' })
    return { id: scenario.id, file: scenario.file, name: scenario.name, ...classifyFixture(result) }
  })
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', timeout: 5000 }).stdout?.trim()
  const report = recoveryReport(results, revision)
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  return report.ok
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!runCli()) process.exitCode = 1 }
  catch { process.stderr.write('Recovery demonstration failed; check the selected scenario IDs, dependencies and a new private evidence path.\n'); process.exitCode = 1 }
}
