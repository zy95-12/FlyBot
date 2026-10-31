import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

test('real DSH exercises code/test/cwd/member boundaries and removes disposable data', { timeout: 150_000 }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'flybot-runtime-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, '../run.mjs')], {
    encoding: 'utf8', timeout: 140_000,
    env: { ...process.env, TMPDIR: directory, M0_REPORT: '' },
  })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.dsh, '0.2.1-rc.2')
  assert.equal(report.transport, 'real DSH HTTP')
  assert.match(report.model, /deterministic mock/)
  assert.ok(report.checks.includes('independent code verification'))
  assert.ok(report.checks.includes('two distinct member sessions'))
  assert.ok(report.checks.includes('shared plugin write denied'))
  assert.ok(report.notRun.includes('real model'))
  assert.deepEqual(readdirSync(directory), [], 'No private runtime data may remain after success')
})
