import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { githubPublisher } from '../src/host/project-github.js'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function fixture(t) {
  const path = mkdtempSync(join(tmpdir(), 'flybot-publish-'))
  git(path, 'init', '-b', 'main'); git(path, 'config', 'user.name', 'Fixture'); git(path, 'config', 'user.email', 'fixture@localhost')
  writeFileSync(join(path, 'code.txt'), 'first'); git(path, 'add', '.'); git(path, 'commit', '-m', 'Published candidate')
  const previous = git(path, 'rev-parse', 'HEAD'), remote = join(path, 'remote.git')
  git(path, 'init', '--bare', remote); git(path, 'push', remote, `${previous}:refs/heads/existing`)
  writeFileSync(join(path, 'code.txt'), 'second'); git(path, 'commit', '-am', 'Rework candidate')
  const candidate = git(path, 'rev-parse', 'HEAD')
  const attempt = { candidateSha: candidate, branch: 'new-attempt', taskId: 'same-task', requirement: { title: 'Repair', criteria: 'Keep one PR' }, workspaces: { developer: { path } }, publicationBinding: { number: 48, repository: 'example/demo', branch: 'existing', previousSha: previous } }
  const calls = []; let pushes = 0, creates = 0
  let override = {}, postPushOverride = {}, beforePush = () => {}
  const request = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' })
    if (url.endsWith('/user')) return Response.json({ login: 'automation' })
    if (options.method === 'POST') { creates++; return Response.json({ number: 99, head: { sha: candidate }, html_url: 'https://example.invalid/pr/99' }) }
    if (url.includes('/pulls?')) return Response.json([])
    return Response.json({ number: 48, state: 'open', draft: true, head: { ref: 'existing', repo: { full_name: 'example/demo' }, sha: git(path, '--git-dir', remote, 'rev-parse', 'existing') }, html_url: 'https://example.invalid/pr/48', ...(pushes ? postPushOverride : override) })
  }
  const run = async (command, args, options) => {
    if (command === 'gh') return { stdout: 'fixture-token' }
    if (args.includes('push')) { beforePush(); pushes++; const rewritten = args.map(arg => arg.startsWith('https://github.com/') ? remote : arg); return { stdout: git(options.cwd, ...rewritten) } }
    return { stdout: git(options.cwd, ...args) }
  }
  const publisher = githubPublisher({ credential: 'gh-cli', configDir: '/fixture/explicit-gh', login: 'automation' }, { request, run })
  t.after(() => rmSync(path, { recursive: true, force: true }))
  return { publisher, attempt, previous, candidate, remote, path, calls, counters: () => ({ pushes, creates }), override(value) { override = value }, postPushOverride(value) { postPushOverride = value }, beforePush(value) { beforePush = value } }
}

test('published rework advances the same PR branch and retains the old candidate without creating a PR', async t => {
  const f = fixture(t)
  f.attempt.publicationRepository = f.path
  const result = await f.publisher.publish(f.attempt, { repository: 'example/demo', defaultBranch: 'main' })
  assert.equal(result.number, 48); assert.equal(result.sha, f.candidate)
  assert.equal(git(f.path, '--git-dir', f.remote, 'rev-parse', 'existing'), f.candidate)
  assert.equal(git(f.path, '--git-dir', f.remote, 'merge-base', '--is-ancestor', f.previous, 'existing'), '')
  assert.deepEqual(f.counters(), { pushes: 1, creates: 0 })
  assert(!f.calls.some(call => call.url.includes('/pulls?')))
  assert.equal((await f.publisher.publish(f.attempt, { repository: 'example/demo' })).number, 48, 'response-loss retry reuses the same PR')
  assert.equal(f.counters().creates, 0)
})

test('existing PR binding refuses stale, closed, wrong-repository and wrong-branch records before a push', async t => {
  for (const change of [{ state: 'closed' }, { number: 49 }, { head: { ref: 'other', repo: { full_name: 'example/demo' }, sha: 'f'.repeat(40) } }, { head: { ref: 'existing', repo: { full_name: 'other/repo' }, sha: 'f'.repeat(40) } }, { head: { ref: 'existing', repo: { full_name: 'example/demo' }, sha: 'f'.repeat(40) } }]) {
    const f = fixture(t); f.override(change)
    await assert.rejects(f.publisher.publish(f.attempt, { repository: 'example/demo' }), /changed/)
    assert.deepEqual(f.counters(), { pushes: 0, creates: 0 })
  }
})

test('malformed bindings and candidates that discard published history never publish', async t => {
  for (const change of [{ repository: 'other/repo' }, { number: 0 }, { number: 1.5 }, { branch: null }, { previousSha: 'invalid' }]) {
    const f = fixture(t); Object.assign(f.attempt.publicationBinding, change)
    await assert.rejects(f.publisher.publish(f.attempt, { repository: 'example/demo' }), /binding is invalid/)
    assert.deepEqual(f.counters(), { pushes: 0, creates: 0 })
  }
  const f = fixture(t); f.attempt.candidateSha = git(f.path, 'hash-object', '-w', '--stdin')
  await assert.rejects(f.publisher.publish(f.attempt, { repository: 'example/demo' }), /does not retain/)
  assert.deepEqual(f.counters(), { pushes: 0, creates: 0 })
})

test('publication checks the actual post-push PR head and never falls back to a new PR', async t => {
  for (const change of [{ number: 49 }, { state: 'closed' }, { head: { ref: 'other', repo: { full_name: 'example/demo' }, sha: 'f'.repeat(40) } }, { head: { ref: 'existing', repo: { full_name: 'other/repo' }, sha: 'f'.repeat(40) } }, { head: { ref: 'existing', repo: { full_name: 'example/demo' }, sha: 'f'.repeat(40) } }]) {
    const f = fixture(t); f.postPushOverride(change)
    await assert.rejects(f.publisher.publish(f.attempt, { repository: 'example/demo' }), /changed during publication|does not match/)
    assert.deepEqual(f.counters(), { pushes: 1, creates: 0 })
  }
})

test('a first publication still uses its new Attempt branch', async t => {
  const f = fixture(t); delete f.attempt.publicationBinding
  const pr = await f.publisher.publish(f.attempt, { repository: 'example/demo', defaultBranch: 'main' })
  assert.equal(pr.number, 99); assert.deepEqual(f.counters(), { pushes: 1, creates: 1 })
  assert.equal(git(f.path, '--git-dir', f.remote, 'rev-parse', 'new-attempt'), f.candidate)
})


test('a concurrent remote commit is preserved when the ordinary fast-forward push refuses rework', async t => {
  const f = fixture(t)
  const sibling = git(f.path, 'commit-tree', f.candidate + '^{tree}', '-p', f.previous, '-m', 'Concurrent contributor commit')
  f.beforePush(() => git(f.path, 'push', f.remote, `${sibling}:refs/heads/existing`))
  await assert.rejects(f.publisher.publish(f.attempt, { repository: 'example/demo' }), /could not be pushed/)
  assert.equal(git(f.path, '--git-dir', f.remote, 'rev-parse', 'existing'), sibling)
  assert.equal(f.counters().creates, 0)
})


test('PR reads use the same explicitly selected identity and actual recorded head', async t => {
  const f = fixture(t)
  const read = await f.publisher.read({ repository: 'example/demo', number: 48 })
  assert.equal(read.sha, f.previous); assert.equal(read.state, 'open')
  assert.deepEqual(f.counters(), { pushes: 0, creates: 0 })
})
