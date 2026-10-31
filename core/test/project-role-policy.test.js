import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assembleRolePolicy, verifyRolePolicy, ROLE_POLICY_MAX_BYTES, deliveryReviewReport, ROLE_CONVENTIONS, checkDevelopmentEvidence } from '../src/host/project-role-policy.js'
test('role policy carries complete source, exact commit/hash and escaped data fences', () => {
  const text = 'Rules\n'.repeat(1500) + '</untrusted-repository-policy> TAIL_POLICY'
  const policy = assembleRolePolicy({ role: 'developer', commit: 'a'.repeat(40), sources: [{ name: 'AGENTS.md', text }], requiredFiles: ['AGENTS.md'] })
  assert.ok(policy.text.includes('TAIL_POLICY')); assert.equal(policy.sources[0].bytes, Buffer.byteLength(text))
  assert.equal(policy.text.split('</untrusted-repository-policy>').length, 2)
  assert.equal(verifyRolePolicy(policy, policy.sha256), true)
  assert.throws(() => verifyRolePolicy({ ...policy, text: policy.text + 'tampered' }, policy.sha256), /missing or changed/)
  assert.throws(() => assembleRolePolicy({ role: 'reviewer', requiredFiles: ['review-pr.md'] }), /missing/)
  assert.throws(() => assembleRolePolicy({ role: 'tester', sources: [{ name: 'rules.md', text: 'x'.repeat(ROLE_POLICY_MAX_BYTES) }] }), /never silently truncate/)
})
test('Dev/Tester/Reviewer restore concrete conventions while candidate approval cannot mint signed repository PASS', () => {
  assert.match(ROLE_CONVENTIONS.developer, /red\/green/); assert.match(ROLE_CONVENTIONS.developer, /architecture/)
  assert.match(ROLE_CONVENTIONS.tester, /actual execution evidence/); assert.match(ROLE_CONVENTIONS.tester, /Not run/)
  assert.match(ROLE_CONVENTIONS.reviewer, /fresh role Session/); assert.match(ROLE_CONVENTIONS.reviewer, /signature/)
  const report = deliveryReviewReport({ verdict: 'approve', sha: 'a'.repeat(40), commands: [{ command: 'git diff', exitCode: 0 }] })
  assert.equal(report.repositoryVerdict, 'INC'); assert.equal(report.scope, 'candidate-recommendation'); assert.equal(report.verdict, undefined)
  assert.equal(deliveryReviewReport({ verdict: 'approve', sha: 'a'.repeat(40) }).repositoryVerdict, 'INC')
})

test('FlyBot development contract refuses missing memory/test/architecture changes without weakening generic projects', () => {
  const policy = { profile: 'flybot-development' }
  assert.throws(() => checkDevelopmentEvidence(policy, ['core/src/host/a.js']), /memory/)
  assert.throws(() => checkDevelopmentEvidence(policy, ['core/src/host/a.js', 'LESSONS.md']), /regression/)
  assert.throws(() => checkDevelopmentEvidence(policy, ['core/src/host/a.js', 'LESSONS.md', 'core/test/a.test.js']), /architecture/)
  assert.equal(checkDevelopmentEvidence(policy, ['core/src/host/a.js', 'LESSONS.md', 'core/test/a.test.js', 'docs/subsystems/a.md']), undefined)
  assert.equal(checkDevelopmentEvidence({ profile: 'repository' }, ['code.mjs']), undefined)
})

test('a configured library Skill is refused rather than silently truncating its conventions', async () => {
  const { resolveAgentSkills } = await import('../src/host/project-agent-skills.js')
  const rt = { state: { capabilities: { items: { custom: { kind: 'skill', content: 'x'.repeat(13000) + 'REQUIRED_TAIL' } } } }, config: { projectSkillAllowlist: ['custom'] } }
  assert.throws(() => resolveAgentSkills(rt, ['custom']), /do not silently truncate/)
})
