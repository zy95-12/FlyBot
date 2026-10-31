import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const checkout = process.env.FLYBOT_DEMO_CONTROL_PLANE
if (!checkout) throw new Error('Set FLYBOT_DEMO_CONTROL_PLANE to the unchanged control-plane checkout')
const result = spawnSync(process.env.FLYBOT_DEMO_PYTHON ?? 'python3', [resolve(import.meta.dirname, 'control_plane.py'), '--control-plane', resolve(checkout), '--workbench-check', '--port', '0'], {
  encoding: 'utf8', timeout: 180_000, maxBuffer: 1024 * 1024,
})
if (result.status !== 0) throw new Error(result.stderr || 'Workbench browser runner failed')
const report = JSON.parse(result.stdout)
assert.equal(report.milestone, 'M6')
for (const check of ['private Project notes isolated', 'public Chief tool creates shared Task', 'browser retry preserves history', 'owner cookie absent in both browsers', 'revocation clears stale page']) assert.ok(report.checks.includes(check), check)
assert.ok(report.notRun.includes('real model'))
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
