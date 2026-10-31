import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectResources } from '../src/host/project-resources.js'
import { createProjectHarness } from '../src/host/project-harness.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'flybot-harness-contract-'))
  const runtimeDir = join(root, 'runtime'), cwd = join(root, 'work')
  await mkdir(join(runtimeDir, 'src/host'), { recursive: true }); await mkdir(cwd)
  await writeFile(join(runtimeDir, 'src/host/project-harness-worker.mjs'), `
import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin});
const write=value=>process.stdout.write(JSON.stringify(value)+'\\n');
write({type:'ready'});
lines.on('line',line=>{const m=JSON.parse(line);
 if(m.type==='stop'){write({type:'stopped',released:true});setTimeout(()=>process.exit(0),20);}
 if(m.type==='start') {
  write({type:'sdk-event',event:{type:'thread.started',thread_id:'bound-thread'}});
  write({type:'sdk-event',event:{type:'debug',value:m.settings.env.OPENAI_API_KEY}});
  write({type:'completed',sessionId:'bound-thread',text:'OUTPUT implementation: actual contract worker output',usage:{input_tokens:1}});
 }
});`)
  const session = { id: 's', projectId: 'p', taskId: 't', attemptId: 'a', role: 'developer', execution: { harness: 'codex' }, context: { text: 'Frozen criteria and role memory' }, resourceLease: { id: 'l', resourceId: 'r', generation: 1 } }
  const workspace = { id: 'w', projectId: 'p', attemptId: 'a', role: 'developer', path: cwd }
  const rt = { home: root, state: { tasks: { t: { id: 't', projectId: 'p' } }, projectResourceLeases: { l: { id: 'l', resourceId: 'r', projectId: 'p', attemptId: 'a', generation: 1, status: 'reserved' } } },
    config: { projectResources: { r: { type: 'local', root, capacity: 1, runtimeDir, allowedProjectOwnerIds: ['owner'], profiles: { owner: { codex: { home: join(root, 'profile'), configDir: join(root, 'profile/codex'), model: 'test-model', envRefs: { OPENAI_API_KEY: 'FLYBOT_TEST_HARNESS_SECRET' } } } } } } },
    save: async () => {}, warn() {}, readProject: () => ({ id: 'p', ownerUserId: 'owner' }), requireProjectAccess(actor) { if (actor.memberId !== 'owner') throw new Error('Access denied') },
    projectDelivery: { ownsWorkspace: (projectId, path) => projectId === 'p' && path === cwd ? workspace : null, sessionFor: () => session,
      bindSession: async (_workspace, bot) => rt.projectResources.markStarted('l', 1, { kind: 'sdk', handle: bot.id }), releaseSession: async () => {} } }
  process.env.FLYBOT_TEST_HARNESS_SECRET = 'unit-credential-opaque-value'
  rt.projectResources = createProjectResources(rt)
  const harness = createProjectHarness(rt)
  t.after(async () => { for (const id of Object.keys(rt.state.projectHarnessWorkers ?? {})) await harness.release(id); delete process.env.FLYBOT_TEST_HARNESS_SECRET; await rm(root, { recursive: true, force: true }) })
  return { rt, harness, cwd }
}

test('SDK process contract preserves evidence, redacts credentials and confirms release before freeing capacity', async t => {
  const { rt, harness, cwd } = await fixture(t)
  const id = await harness.spawn({ executionProjectId: 'p', executionWorkDir: cwd, prompt: 'Do the assigned Task' })
  const result = new Promise(resolve => harness.onResult(resolve))
  await harness.dispatch({ botId: id, taskId: 't', brief: 'Frozen requirement', outputs: [{ name: 'implementation' }] })
  assert.equal((await result).ok, true)
  const row = rt.state.projectHarnessWorkers[id]
  assert.equal(row.backendSessionId, 'bound-thread')
  const evidence = await readFile(row.eventLog, 'utf8')
  assert.match(evidence, /REDACTED/)
  assert.equal(evidence.includes(process.env.FLYBOT_TEST_HARNESS_SECRET), false)
  assert.equal(rt.projectResources.occupied('r'), 1)
  await harness.release(id)
  assert.equal(rt.projectResources.occupied('r'), 0)
  assert.equal(row.status, 'released')
  assert.equal(await harness.release(id), true)
  await assert.rejects(harness.dispatch({ botId: id }), /unavailable/)
})

test('SDK workers reject unregistered Workspaces and missing explicit profiles', async t => {
  const { harness, rt, cwd } = await fixture(t)
  await assert.rejects(harness.spawn({ executionProjectId: 'p', executionWorkDir: '/foreign' }), /registered/)
  delete rt.config.projectResources.r.profiles
  await assert.rejects(harness.spawn({ executionProjectId: 'p', executionWorkDir: cwd }), /explicitly authorized/)
})

test('Workflow result callback can await the same SDK worker release without blocking stop acknowledgement', async t => {
  const { rt, harness, cwd } = await fixture(t)
  const id = await harness.spawn({ executionProjectId: 'p', executionWorkDir: cwd, prompt: 'Implement Task' })
  let finish, fail
  const completed = new Promise((resolve, reject) => { finish = resolve; fail = reject })
  harness.onResult(async () => { try { await harness.release(id); finish() } catch (error) { fail(error) } })
  await harness.dispatch({ botId: id, taskId: 't', brief: 'Frozen requirement', outputs: [{ name: 'implementation' }] })
  await completed
  assert.equal(rt.state.projectHarnessWorkers[id].status, 'released')
  assert.equal(rt.projectResources.occupied('r'), 0)
})
