import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createWorkflowService } from '../src/service.js'

function setup(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'flybot-project-workflow-'))
  const reports = []
  const config = { dir, readProject: id => ({ id, status: 'active' }),
    projectContext: (taskId, projectId) => {
      if (projectId && projectId !== 'p1') throw new Error('Run and Task must belong to the same Project')
      return { taskId, projectId: 'p1' }
    },
    bindRun: (id, projectId, details) => { reports.push({ id, projectId, ...details }) }, ...options }
  const svc = createWorkflowService(config)
  const item = svc.define({ name: 'Project test', nodes: [{ id: 'dev', name: 'Dev', prompt: 'Implement' }], edges: [] }).workflows.find(row => row.name === 'Project test')
  t.after(async () => { await svc.dispose(); rmSync(dir, { recursive: true, force: true }) })
  return { svc, item, config, reports }
}

test('Run projectId survives graph rebinding and service restart; terminal reports keep it', async t => {
  const { svc, item, config, reports } = setup(t)
  const result = svc.assign({ workflowId: item.id, taskId: 't1', title: 'Stable' })
  const run = result.workflows.find(row => row.id === item.id).run
  assert.equal(run.projectId, 'p1')
  assert.equal(svc.saveGraph({ workflowId: item.id, nodes: item.nodes, edges: item.edges, projectId: 'p2' }).ok, true)
  assert.equal(svc.state().workflows.find(row => row.id === item.id).run.projectId, 'p1')
  const restarted = createWorkflowService(config)
  t.after(() => restarted.dispose())
  assert.equal(restarted.state().workflows.find(row => row.id === item.id).run.projectId, 'p1')
  restarted.advance({ workflowId: item.id, runId: run.id, nodeId: 'dev', result: 'ok' })
  assert.ok(reports.some(row => row.id === run.id && row.projectId === 'p1' && row.status === 'done'))
})

test('a foreign or archived Project is refused before any ephemeral Bot is spawned', async t => {
  let spawns = 0
  const { svc, item } = setup(t, { spawn: async () => { spawns++; return 'unexpected' } })
  const result = await svc.assign({ workflowId: item.id, taskId: 't1', title: 'Foreign', projectId: 'p2' })
  assert.equal(result.ok, false)
  assert.match(result.error, /same Project/)
  assert.equal(spawns, 0)
  const archived = setup(t, { projectContext: () => { throw new Error('Project is archived') }, spawn: async () => { spawns++; return 'unexpected' } })
  const denied = await archived.svc.assign({ workflowId: archived.item.id, taskId: 't1', title: 'Archived' })
  assert.equal(denied.ok, false)
  assert.match(denied.error, /archived/)
  assert.equal(spawns, 0)
})
