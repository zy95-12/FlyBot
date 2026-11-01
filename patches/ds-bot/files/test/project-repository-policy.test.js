import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { repositorySettings, preflightRepository, repositoryReadiness } from '../src/host/project-repository-policy.js'
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'flybot-preflight-')), path = join(root, 'repo')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path)
  const git = args => execFileSync('git', args, { cwd: path, stdio: 'pipe' })
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@localhost'])
  writeFileSync(join(path, 'code.mjs'), 'export const value = 1\n'); git(['add', '.']); git(['commit', '-m', 'Fixture'])
  const project = { id: 'p1', ownerUserId: 'owner-1', repository: 'example/repo' }
  const settings = { path, allowedPaths: ['code.mjs'], testCommand: [process.execPath, '--test'] }
  return { root, path, project, settings, rt: { home: root, config: { projectRepositories: { 'example/repo': settings }, projectWorkspaceRoot: join(root, 'workspaces') } } }
}
test('workspace preparation is operator argv, validated but never executed by readiness', async t => {
  const { rt, project, settings } = fixture(t)
  for (const invalid of [[], 'npm ci', [null], [''], ['node', '\0']]) {
    settings.workspacePrepareCommand = invalid
    assert.throws(() => repositorySettings(rt, project), /workspacePrepareCommand/)
  }
  settings.workspacePrepareCommand = [process.execPath, '-e', 'process.exit(51)']
  assert.equal(await preflightRepository(rt, project), settings)
})
test('repository readiness uses actual Git/command/dependency metadata and never runs the test command', async t => {
  const { rt, project, settings, root } = fixture(t)
  const sentinel = join(root, 'test-executed')
  settings.testCommand = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran')`]
  assert.equal(await preflightRepository(rt, project), settings)
  assert.deepEqual(await repositoryReadiness(rt, project), { configured: true, status: 'ready', name: 'example/repo', model: null, tests: 'not-run' })
  assert.equal((await import('node:fs')).existsSync(sentinel), false)
  settings.testDependencies = ['missing-dependency']
  await assert.rejects(preflightRepository(rt, project), /testDependencies/)
  const health = await repositoryReadiness(rt, project)
  assert.equal(health.configured, false); assert.equal(health.field, 'testDependencies')
  assert.equal(JSON.stringify(health).includes(root), false, 'Public status must not expose operator paths')
})
test('malformed path allowlists and argv are refused before Git/model/resource execution', t => {
  const { rt, project, settings } = fixture(t)
  for (const allowedPaths of [undefined, [], [''], ['.'], ['../escape'], ['core/../escape'], ['/absolute'], ['C:\\escape'], ['core/*'], ['core\nsecret']]) {
    settings.allowedPaths = allowedPaths
    assert.throws(() => repositorySettings(rt, project), /allowedPaths/)
  }
  settings.allowedPaths = ['core/', '.github']
  assert.equal(repositorySettings(rt, project), settings)
  for (const testCommand of [[], [''], ['node', 2], ['node', 'bad\0argument']]) {
    settings.testCommand = testCommand; assert.throws(() => repositorySettings(rt, project), /testCommand/)
  }
})
test('invalid Git roots, unborn repositories, unavailable executables and workspace parents are blocked', async t => {
  const { rt, project, settings, path, root } = fixture(t)
  settings.path = join(root, 'missing'); await assert.rejects(preflightRepository(rt, project), /path/)
  settings.path = root; await assert.rejects(preflightRepository(rt, project), /git/)
  settings.path = join(path, 'nested'); mkdirSync(settings.path); await assert.rejects(preflightRepository(rt, project), /git/)
  const unborn = join(root, 'unborn'); mkdirSync(unborn); execFileSync('git', ['init', unborn], { stdio: 'pipe' })
  settings.path = unborn; await assert.rejects(preflightRepository(rt, project), /git/)
  settings.path = path; settings.testCommand = ['flybot-nonexistent-runtime']; await assert.rejects(preflightRepository(rt, project), /testCommand/)
  settings.testCommand = [process.execPath]; const file = join(root, 'not-a-directory'); writeFileSync(file, 'file'); rt.config.projectWorkspaceRoot = file
  await assert.rejects(preflightRepository(rt, project), /workspace/)
})
test('provisioning authorization is checked before exposing readiness and configuration changes invalidate cached observations', async t => {
  const { rt, project, settings } = fixture(t)
  assert.equal((await repositoryReadiness(rt, project)).configured, true)
  delete settings.allowedPaths
  assert.equal((await repositoryReadiness(rt, project)).field, 'allowedPaths')
  const denied = await repositoryReadiness(rt, { ...project, ownerUserId: 'outsider' })
  assert.equal(denied.configured, false); assert.match(denied.reason, /not provisioned/)
})

test('operator provisioning CLI checks the exact deployment input without executing it', t => {
  const { rt, project, settings, root } = fixture(t)
  const file = join(root, 'config.json')
  const input = { ...rt, dshHome: root }
  writeFileSync(file, JSON.stringify(input))
  const cli = new URL('../../scripts/check-project-provisioning.mjs', import.meta.url)
  const result = execFileSync(process.execPath, [cli.pathname, file, project.repository, project.ownerUserId], { encoding: 'utf8' })
  assert.equal(JSON.parse(result).tests, 'not-run')
  delete settings.allowedPaths; writeFileSync(file, JSON.stringify(input))
  assert.throws(() => execFileSync(process.execPath, [cli.pathname, file, project.repository, project.ownerUserId], { stdio: 'pipe' }), error => /allowedPaths/.test(error.stderr.toString()))
})
