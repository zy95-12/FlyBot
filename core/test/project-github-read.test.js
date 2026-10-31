import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectGithubRead } from '../src/host/project-github-read.js'
function setup() {
  const calls = []
  const rt = { state: {}, config: { projectRepositories: { 'owner/repo': { github: { login: 'automation', configDir: '/explicit' } } }, personalGithub: { alice: { p: { login: 'alice-gh' } } } }, requireProjectAccess(actor, id) { if (actor.memberId !== 'alice' || id !== 'p' || rt.revoked) throw new Error('Project denied'); return { id, repository: 'owner/repo' } } }
  const read = createProjectGithubRead(rt, { identity: async settings => ({ login: settings.login, token: 'private-token' }), request: async url => { calls.push(url); return Response.json(url.includes('check-runs') ? { check_runs: [{ name: 'tests-ok', status: 'completed', conclusion: 'success' }] } : /\/pulls\/\d+$/.test(url) ? { number: 1, head: { sha: 'a'.repeat(40) }, base: { ref: 'main' }, html_url: 'https://github.com/owner/repo/pull/1' } : [{ number: 1, title: 'Issue', state: 'open' }]) } })
  return { rt, read, calls }
}
test('GitHub reads bind repository, identity and bounded paths to the current Project', async () => {
  const f = setup(), actor = { memberId: 'alice' }
  const result = await f.read({ projectId: 'p', operation: 'issues', repository: 'victim/private', url: 'https://example.invalid' }, actor)
  assert.equal(result.repository, 'owner/repo'); assert.equal(result.executorLogin, 'automation'); assert.equal(result.pagination, 'bounded-first-page')
  assert.ok(f.calls[0].startsWith('https://api.github.com/repos/owner/repo/issues?'))
  assert.equal(JSON.stringify(result).includes('private-token'), false)
  assert.equal((await f.read({ projectId: 'p', scope: 'personal' }, actor)).executorLogin, 'alice-gh')
  const checks = await f.read({ projectId: 'p', operation: 'checks', number: 1 }, actor)
  assert.equal(checks.data.sha, 'a'.repeat(40)); assert.equal(checks.data.checks[0].conclusion, 'success')
  await assert.rejects(f.read({ projectId: 'p', operation: '../secrets' }, actor), /Unsupported/)
  await assert.rejects(f.read({ projectId: 'p', operation: 'pull', number: '1' }, actor), /Unsupported/)
  await assert.rejects(f.read({ projectId: 'p' }, { memberId: 'bob' }), /denied/)
})
test('revocation while reading withholds data and a revoked platform session prevents external calls', async () => {
  const f = setup(); let external = 0
  f.rt.platformIdentityEnabled = true; f.rt.validatePlatformActor = async () => false
  await assert.rejects(f.read({ projectId: 'p' }, { memberId: 'alice' }), /revoked/); assert.equal(f.calls.length, 0)
  const read = createProjectGithubRead(f.rt, { identity: async () => ({ login: 'automation', token: 'secret' }), request: async () => { external++; f.rt.revoked = true; return Response.json([]) } })
  f.rt.validatePlatformActor = async () => true
  await assert.rejects(read({ projectId: 'p' }, { memberId: 'alice' }), /denied/); assert.equal(external, 1)
})

test('published, queued and started are distinct server-derived states', async () => {
  const { taskExecutionStatus } = await import('../src/host/workbench-state.js')
  const task = { id: 't', projectId: 'p', status: 'open', deliveryAttemptId: 'a' }, state = { projectAttempts: { a: { status: 'running' } } }
  assert.equal(taskExecutionStatus({}, { id: 't', status: 'open' }).phase, 'published')
  task.collaboration = { status: 'queued', botId: 'p:dev' }
  assert.equal(taskExecutionStatus(state, task).phase, 'queued')
  task.collaboration.status = 'claimed'; task.collaboration.claim = { workerId: 'w' }
  assert.equal(taskExecutionStatus(state, task).phase, 'starting')
  state.projectHarnessWorkers = { w: { status: 'running' } }
  assert.equal(taskExecutionStatus(state, task).phase, 'running')
  task.collaboration.status = 'arbitration'
  assert.equal(taskExecutionStatus(state, task).phase, 'awaiting-chief')
})
