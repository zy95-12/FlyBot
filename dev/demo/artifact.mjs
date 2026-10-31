// Check effects independently of the model's completion text or the tool's exit code.
import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function verifyArtifact(directory) {
  const cwd = realpathSync(directory)
  const proof = JSON.parse(readFileSync(join(cwd, 'proof.json'), 'utf8'))
  assert.equal(proof.cwd, cwd, 'The tool must execute in the assigned directory')
  assert.equal(proof.test, 'passed', 'The tool must report its executed test')
  assert.equal(proof.sum, 5, 'The recorded result must match the probe input')
  const { add } = await import(pathToFileURL(join(cwd, 'probe.mjs')).href)
  assert.equal(typeof add, 'function', 'The code artifact must export add')
  for (const [a, b, expected] of [[7, -2, 5], [0, 0, 0], [10, 4, 14], [-8, 3, -5]]) {
    assert.equal(add(a, b), expected, `Independent case add(${a}, ${b})`)
  }
  return proof
}
