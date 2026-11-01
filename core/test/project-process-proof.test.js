import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureProcessScope, priorScopeExited } from '../src/host/project-process-proof.js'
const invocation = 'a'.repeat(32), changed = 'b'.repeat(32)
const fixture = id => ({ pid: 123, environment: { INVOCATION_ID: id }, readText: async path => path.endsWith('boot_id') ? 'same-boot' : path.endsWith('cgroup') ? '0::/system.slice/flybot-test.service\n' : '123 (node) S 1 123 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 900 0', inspectManager: async () => `InvocationID=${id}\nKillMode=control-group\nControlGroup=/system.slice/flybot-test.service\n` })
test('a changed supervised invocation with the same control-group kill boundary proves prior exit', async () => {
  const original = await captureProcessScope(fixture(invocation))
  assert.equal(original.kind, 'systemd-control-group')
  assert.equal(await priorScopeExited(original, fixture(invocation)), false)
  assert.equal(await priorScopeExited(original, fixture(changed)), true)
})
test('PID disappearance, changed host boot, remote resources or changed kill policy cannot fabricate exit proof', async () => {
  const original = await captureProcessScope(fixture(invocation))
  assert.equal(await priorScopeExited({ kind: 'unmanaged-process', hostPid: 999999 }), false)
  assert.equal(await priorScopeExited(original, { ...fixture(changed), inspectManager: async () => `InvocationID=${changed}\nKillMode=process\nControlGroup=/system.slice/flybot-test.service` }), false)
  assert.equal(await priorScopeExited(original, { ...fixture(changed), readText: async path => path.endsWith('boot_id') ? 'different-boot' : fixture(changed).readText(path) }), false)
  assert.equal(await priorScopeExited({ kind: 'remote-resource' }, fixture(changed)), false)
})
