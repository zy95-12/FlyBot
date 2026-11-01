import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nativeAssetLoader } from '../src/client/workbench/native-assets.js'

function fixture() {
  const nodes = []
  return { nodes, load: nativeAssetLoader({ createElement: tag => ({ tag }), head: { append: node => nodes.push(node) } }, {}) }
}
test('native components wait for CSS even when script arrives first on a slow connection', async () => {
  const { nodes, load } = fixture()
  let mounted = false
  const pending = load().then(() => { mounted = true })
  nodes.find(node => node.tag === 'script').onload()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(mounted, false, 'Do not mount an unstyled native conversation')
  nodes.find(node => node.tag === 'link').onload()
  await pending
  assert.equal(mounted, true)
  assert.equal(nodes.length, 2)
  await load()
  assert.equal(nodes.length, 2)
})
test('native stylesheet failure refuses mounting instead of claiming readiness', async () => {
  const { nodes, load } = fixture()
  const pending = load()
  nodes.find(node => node.tag === 'link').onerror()
  await assert.rejects(pending, /styles/)
})
