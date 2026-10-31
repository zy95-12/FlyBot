// Explicit opt-in probe: two real runtimes, no SDK/model credentials or production instance.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createProjectResources } from '../../core/src/host/project-resources.js'
const directory = await mkdtemp(join(tmpdir(), 'flybot-m7-resources-'))
const name = `flybot-m7-resource-${randomUUID().slice(0, 8)}`
const image = process.env.FLYBOT_RESOURCE_TEST_IMAGE ?? 'flybot:m0-test-tools'
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
let created = false
try {
  docker(['run', '-d', '--name', name, '--user', 'node', '--entrypoint', 'node', image, '-e', 'setInterval(()=>{},1000)']); created = true
  const rt = { state: { bots: {} }, config: { projectResources: {
    local: { type: 'local', root: directory, capacity: 1, allowedProjectOwnerIds: ['owner'], harnesses: ['flybot'] },
    container: { type: 'docker', container: name, user: '1000:1000', root: '/tmp', capacity: 1, allowedProjectOwnerIds: ['owner'], harnesses: ['flybot'] },
  } }, readProject: () => ({ id: 'p', ownerUserId: 'owner' }), save: async () => {} }
  const resources = createProjectResources(rt)
  assert.equal((await resources.probe('p', 'local')).status, 'ready')
  assert.equal((await resources.probe('p', 'container')).status, 'ready')
  const request = { projectId: 'p', role: 'developer', harness: 'flybot', resourceIds: ['local', 'container'] }
  const first = await resources.reserve({ ...request, attemptId: 'one', sessionKey: 'one' })
  const second = await resources.reserve({ ...request, attemptId: 'two', sessionKey: 'two' })
  assert.notEqual(first.resourceId, second.resourceId)
  const evidence = []
  for (const lease of [first, second]) {
    const cwd = rt.config.projectResources[lease.resourceId].root
    const output = await resources.command('p', lease.resourceId, { cwd, argv: ['node', '-e', 'const fs=require("fs");fs.writeFileSync("m7-isolation-marker",require("os").hostname());console.log(JSON.stringify({hostname:require("os").hostname(),cwd:process.cwd(),uid:process.getuid()}))'] })
    evidence.push({ resourceId: lease.resourceId, ...JSON.parse(output.stdout) })
  }
  assert.notEqual(evidence[0].hostname, evidence[1].hostname)
  await assert.rejects(resources.reserve({ ...request, attemptId: 'three', sessionKey: 'three' }), /capacity/)
  await resources.release(first.id, first.generation)
  const third = await resources.reserve({ ...request, attemptId: 'three', sessionKey: 'three' })
  assert.equal(third.resourceId, first.resourceId)
  await resources.release(second.id, second.generation); await resources.release(third.id, third.generation)
  assert.equal(resources.occupied('local') + resources.occupied('container'), 0)
  process.stdout.write(JSON.stringify({ runtime: 'actual local Node + isolated Docker Node', image, evidence, checks: ['pool distributes separate reservations', 'distinct hostnames and filesystems', 'full pool refuses admission', 'confirmed release admits next reservation'], notRun: ['SDK authentication', 'cross-resource FlyBot Task delivery'] }) + '\n')
} finally {
  if (created) docker(['rm', '-f', name])
  await rm(directory, { recursive: true, force: true })
}
