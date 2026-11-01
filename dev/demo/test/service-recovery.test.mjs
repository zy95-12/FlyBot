import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { classifyFixture, fixtureCommand, recoveryReport, runCli } from '../service-recovery.mjs'

test('recovery reporting rejects zero selected tests, nonzero process exit and missing proof without exposing raw output', () => {
  const stdout = '# pass 1\n# fail 0\n# skipped 7\nsecret-private-token\n'
  const accepted = classifyFixture({ status: 0, stdout, stderr: 'private-stderr' })
  assert.equal(accepted.ok, true)
  assert.equal(JSON.stringify(accepted).includes('secret-private-token'), false)
  for (const result of [{ status: 0, stdout: '# pass 0\n# fail 0\n# skipped 8\n' }, { status: 1, stdout }, { status: 0, stdout: '# pass 1\n' }, { status: null, stdout, signal: 'SIGTERM' }]) assert.equal(classifyFixture(result).ok, false)
  assert.equal(recoveryReport([accepted], 'unknown').ok, false)
  assert.equal(recoveryReport([], 'a'.repeat(40)).ok, false)
  assert.throws(() => fixtureCommand('arbitrary-production-command'), /Unknown/)
  assert.ok(fixtureCommand('browser-offline-source').args.includes('--test-name-pattern'))
})

test('operator recovery CLI runs an actual isolated store fixture, cleans its data and preserves old evidence', t => {
  const directory = mkdtempSync(join(tmpdir(), 'flybot-recovery-cli-')), scratch = join(directory, 'scratch'), report = join(directory, 'report.json')
  mkdirSync(scratch); t.after(() => rmSync(directory, { recursive: true, force: true }))
  const args = [resolve(import.meta.dirname, '../service-recovery.mjs'), '--scenario', 'browser-offline-source', '--output', report]
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000, env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch } })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const proof = JSON.parse(readFileSync(report, 'utf8'))
  assert.equal(proof.ok, true); assert.equal(proof.scenarios[0].passed, 1)
  assert.equal(proof.contracts.sources, 'project-source/v1')
  assert.match(proof.scope, /controlled SDK/)
  assert.equal(statSync(report).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(scratch), [])
  const before = readFileSync(report, 'utf8')
  assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000 }).status, 1)
  assert.equal(readFileSync(report, 'utf8'), before)
})

test('listing is inert, unknown selection cannot create output, and console-only execution remains source-bound', t => {
  const directory=mkdtempSync(join(tmpdir(),'flybot-recovery-options-')),output=join(directory,'not-created','report.json')
  t.after(()=>rmSync(directory,{recursive:true,force:true}))
  const original=process.stdout.write;let captured=''
  process.stdout.write=value=>{captured+=String(value);return true}
  try {
    assert.equal(runCli(['--list']),true)
    assert.match(JSON.parse(captured).scope,/listing only/)
    assert.throws(()=>runCli(['--scenario','unknown','--output',output]),/Unknown/)
    assert.equal(existsSync(join(directory,'not-created')),false)
    captured=''
    assert.equal(runCli(['--scenario','browser-offline-source']),true)
    assert.equal(JSON.parse(captured).ok,true)
    assert.equal(JSON.parse(captured).scenarios.length,1)
  } finally {process.stdout.write=original}
  const invalid=spawnSync(process.execPath,[resolve(import.meta.dirname,'../service-recovery.mjs'),'--scenario','unknown'],{encoding:'utf8',timeout:5000})
  assert.equal(invalid.status,1);assert.match(invalid.stderr,/Recovery demonstration failed/)
})
