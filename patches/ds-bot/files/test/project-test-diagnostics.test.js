import assert from 'node:assert/strict'
import {test} from 'node:test'
import {testFailureExcerpt} from '../src/host/project-test-diagnostics.js'

test('failure excerpts keep early failures and totals while bounding every long line and secrets', () => {
  const text = ['not ok 1 - popup layer regression', '  error: missing z-index', 'x'.repeat(2_000_000), 'API abcdefgh12345678 and sk-abcdefghijklmnop', ...Array(500).fill('ok - other check'), '# fail 1'].join('\n')
  const result = testFailureExcerpt(text, {API_KEY: 'abcdefgh12345678', PATH: 'not-secret'})
  assert.ok(result.includes('popup layer regression'))
  assert.ok(result.includes('missing z-index'))
  assert.ok(result.includes('# fail 1'))
  assert.ok(result.length <= 6000)
  assert.ok(Math.max(...result.split('\n').map(line => line.length)) <= 300)
  assert.ok(!result.includes('abcdefgh12345678'))
  assert.ok(!result.includes('sk-abcdefghijklmnop'))
  assert.ok(testFailureExcerpt('plain process error').includes('plain process error'))
  assert.ok(!testFailureExcerpt('x'.repeat(295) + 'abcdefgh12345678', {TOKEN: 'abcdefgh12345678'}).includes('abcde'), 'Redact before cutting a long line')
})
