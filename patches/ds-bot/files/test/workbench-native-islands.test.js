import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createNativeIslands } from '../src/client/workbench/native-islands.js'
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS, 'package.json'))('jsdom')

test('retired native lazy mounts cannot attach after a scope change or disposal', async () => {
  const dom = new JSDOM('<div id="app"></div>')
  const root = dom.window.document.getElementById('app'), mounted = []
  let finish
  const loading = new Promise(resolve => { finish = resolve })
  const islands = createNativeIslands(root, () => loading, error => { throw error })
  const view = (key, identity) => {
    const shell = dom.window.document.createElement('main'), target = dom.window.document.createElement('div')
    shell.append(target)
    islands.begin()
    islands.register(target, key, identity, () => { mounted.push(key); return () => {} }, {})
    islands.commit(shell)
    return target
  }
  try {
    const old = view('private-a', {})
    view('private-b', {})
    finish(); await Promise.resolve(); await Promise.resolve()
    assert.deepEqual(mounted, ['private-b'])
    assert.equal(old.isConnected, false)
    view('pending-c', {})
    islands.dispose()
    await Promise.resolve(); await Promise.resolve()
    assert.deepEqual(mounted, ['private-b'])
  } finally { islands.dispose(); dom.window.close() }
})
