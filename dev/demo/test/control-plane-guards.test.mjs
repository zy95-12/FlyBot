import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve(import.meta.dirname, '../control_plane.py')

test('refuse a missing platform checkout before importing platform code or creating data', t => {
  const directory = mkdtempSync(join(tmpdir(), 'flybot-platform-guard-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const result = spawnSync('python3', [script, '--control-plane', directory, '--check'], { encoding: 'utf8' })
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /Expected a control-plane checkout/)
  assert.deepEqual(readdirSync(directory), [])
})

test('reject optimized Python before assertions can silently stop checking the platform', t => {
  const directory = mkdtempSync(join(tmpdir(), 'flybot-platform-guard-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const app = join(directory, 'control_plane/app')
  const sentinel = join(directory, 'imported')
  mkdirSync(app, { recursive: true })
  writeFileSync(join(app, 'main.py'), `from pathlib import Path\nPath(${JSON.stringify(sentinel)}).touch()\n`)
  const result = spawnSync('python3', ['-O', script, '--control-plane', directory, '--check'], { encoding: 'utf8' })
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /without Python optimization/)
  assert.equal(existsSync(sentinel), false)
})


test('real model and GitHub flags refuse incomplete configuration before platform import', t => {
  const directory = mkdtempSync(join(tmpdir(), 'flybot-demo-flags-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const flags of [['--real-model'], ['--github-repo', 'example/demo'], ['--serve-workbench', '--github-repo', 'example/demo', '--github-config-dir', 'relative']]) {
    const result = spawnSync('python3', [script, '--control-plane', directory, ...flags], { encoding: 'utf8' })
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stderr, /requires|GitHub requires|must be absolute/)
  }
  assert.deepEqual(readdirSync(directory), [])
})
