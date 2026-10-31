// Opt-in actual Docker PTY check. Uses an owned container/profile, no paid model calls.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, chown, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createProjectResources } from '../../core/src/host/project-resources.js'
import { createProjectHarness } from '../../core/src/host/project-harness.js'
import { createProjectRuntimeSetup } from '../../core/src/host/project-runtime-setup.js'
const root = await mkdtemp(join(tmpdir(), 'flybot-m7-pty-'))
const name = `flybot-m7-pty-${randomUUID().slice(0, 8)}`
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })
const actor = { memberId: 'owner', sessionId: 'session' }
let created = false, setup
try {
  await chown(root, 1000, 1000)
  docker(['run', '-d', '--name', name, '--user', 'node', '-v', `${root}:/workspace`, '-v', `${resolve(import.meta.dirname, '../../core')}:/opt/flybot:ro`, '--entrypoint', 'node', 'flybot:m0-test-tools', '-e', 'setInterval(()=>{},1000)']); created = true
  const rt = { home: root, state: { bots: {}, authSessions: { session: { memberId: 'owner' } } }, config: { projectResources: { isolated: { type: 'docker', container: name, user: '1000:1000', root: '/workspace', profileRoot: '/workspace/profiles', runtimeDir: '/opt/flybot', capacity: 2, allowedProjectOwnerIds: ['owner'], adminMemberIds: ['owner'], harnesses: ['codex'] } } },
    save: async () => {}, readProject: () => ({ id: 'p', ownerUserId: 'owner' }), requireProjectAccess: () => ({ id: 'p', ownerUserId: 'owner' }), projectAgents: { deliveryDefinitions: () => ({ roles: [] }) } }
  rt.projectResources = createProjectResources(rt); rt.projectHarness = createProjectHarness(rt); setup = createProjectRuntimeSetup(rt)
  const opened = await setup.endpoint('project-terminal-open', { projectId: 'p', resourceId: 'isolated', harness: 'codex' }, actor)
  await setup.endpoint('project-terminal-input', { terminalId: opened.terminalId, text: "node -p '\"PTY_UID_\"+process.getuid()'\n" }, actor)
  let output = ''
  for (let n = 0; n < 80; n++) {
    const poll = await setup.endpoint('project-terminal-poll', { terminalId: opened.terminalId }, actor)
    output = poll.output.map(row => row.text).join(''); if (output.includes('PTY_UID_1000')) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(output.includes('PTY_UID_1000'))
  assert.equal((await setup.endpoint('project-terminal-close', { terminalId: opened.terminalId }, actor)).released, true)
  assert.equal(JSON.stringify(rt.state.projectTerminalAudit).includes('PTY_UID_1000'), false)
  process.stdout.write(JSON.stringify({ transport: 'actual Docker Python PTY + browser API contract', runtimeUid: 1000, target: 'new owned Docker resource', checks: ['explicit resource admin grant', 'same configured profile/UID', 'actual target Node command', 'confirmed PTY cleanup', 'audit metadata excludes raw screen'], notRun: ['browser UI', 'authenticated SDK inference'] }) + '\n')
} finally {
  if (setup) await setup.dispose()
  if (created) docker(['rm', '-f', name])
  await rm(root, { recursive: true, force: true })
}
