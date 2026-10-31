import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectResources } from '../src/host/project-resources.js'

function fixture() {
  const project = { id: 'p1', ownerUserId: 'owner-1' }
  const rt = { state: { bots: {}, projectResourceHealth: { local: { status: 'ready' }, isolated: { status: 'ready' } } }, config: { projectResources: {
    local: { type: 'local', root: '/tmp/flybot-resource-local', capacity: 1, allowedProjectOwnerIds: ['owner-1'], harnesses: ['flybot'] },
    isolated: { type: 'docker', container: 'flybot-m7-unit', user: '1000:1000', root: '/workspace', capacity: 1, allowedProjectOwnerIds: ['owner-1'], harnesses: ['codex'] },
    hidden: { type: 'local', root: '/private', capacity: 1, allowedProjectOwnerIds: ['someone-else'], harnesses: ['flybot'] },
  } }, save: async () => {}, readProject: () => project, projectScheduler: { wake() {} } }
  const resources = createProjectResources(rt)
  return { rt, project, resources }
}

test('resource leases reserve real capacity once and never release an unconfirmed worker', async () => {
  const { resources, rt } = fixture()
  const request = { projectId: 'p1', attemptId: 'a1', role: 'developer', sessionKey: 's1', harness: 'flybot', resourceIds: ['local'] }
  const first = await resources.reserve(request)
  assert.equal((await resources.reserve(request)).id, first.id)
  await assert.rejects(resources.reserve({ ...request, sessionKey: 's2' }), /capacity/)
  await resources.markStarted(first.id, first.generation, { kind: 'native', botId: 'worker' })
  rt.state.bots.worker = { id: 'worker' }
  await resources.release(first.id, first.generation)
  assert.equal(resources.occupied('local'), 1)
  delete rt.state.bots.worker
  await resources.release(first.id, first.generation)
  await resources.release(first.id, first.generation)
  assert.equal(resources.occupied('local'), 0)
  await assert.rejects(resources.markStarted(first.id, first.generation, { kind: 'native', botId: 'late' }), /released/)
})

test('resource pool rejects unauthorized, incompatible and revoked resources without exposing connections', async () => {
  const { resources, rt } = fixture()
  assert.deepEqual(resources.list('p1').map(row => row.id), ['local', 'isolated'])
  assert.equal(JSON.stringify(resources.list('p1')).includes('flybot-m7-unit'), false)
  await assert.rejects(resources.reserve({ projectId: 'p1', attemptId: 'a', role: 'developer', sessionKey: 's', harness: 'flybot', resourceIds: ['hidden'] }), /authorized/)
  await assert.rejects(resources.reserve({ projectId: 'p1', attemptId: 'a', role: 'developer', sessionKey: 's', harness: 'flybot', resourceIds: ['isolated'] }), /compatible/)
  rt.config.projectResources.local.allowedProjectOwnerIds = []
  await assert.rejects(resources.reserve({ projectId: 'p1', attemptId: 'a', role: 'developer', sessionKey: 's', harness: 'flybot', resourceIds: ['local'] }), /authorized/)
})

test('restart retains unknown-process leases until explicit reconciliation confirms release', async () => {
  const { resources, rt } = fixture()
  const lease = await resources.reserve({ projectId: 'p1', attemptId: 'a', role: 'developer', sessionKey: 's', harness: 'flybot', resourceIds: ['local'] })
  await resources.markStarted(lease.id, lease.generation, { kind: 'sdk', handle: 'remote-process' })
  const restarted = createProjectResources(rt)
  await restarted.reconcile()
  assert.equal(restarted.occupied('local'), 1)
  assert.equal(rt.state.projectResourceLeases[lease.id].status, 'unreachable')
  await assert.rejects(restarted.release(lease.id, lease.generation + 1), /generation/)
})


test('concurrent reservations cannot oversubscribe and failed release does not wake a new worker', async () => {
  const { resources } = fixture()
  const base = { projectId: 'p1', attemptId: 'a', role: 'developer', harness: 'flybot', resourceIds: ['local'] }
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => resources.reserve({ ...base, sessionKey: `s${i}` })))
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  assert.equal(resources.occupied('local'), 1)
})

test('missing environment/authentication evidence blocks a resource rather than implying readiness', async () => {
  const { resources, rt } = fixture()
  delete rt.state.projectResourceHealth.local
  await assert.rejects(resources.reserve({ projectId: 'p1', attemptId: 'a', role: 'developer', sessionKey: 's', harness: 'flybot', resourceIds: ['local'] }), /readiness/)
  await assert.rejects(resources.reserve({ projectId: 'p1', attemptId: 'a', role: 'developer', sessionKey: 's', harness: 'codex', resourceIds: ['isolated'] }), /readiness/)
})
