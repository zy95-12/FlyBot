import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareWorktree } from '../prepare-worktree.mjs'
function fixture(t) {
  const home=mkdtempSync(join(tmpdir(),'flybot-prepare-')),root=join(home,'resources'),release=join(home,'release'),cwd=join(root,'task')
  mkdirSync(cwd,{recursive:true});mkdirSync(join(release,'core/dev/harness/node_modules'),{recursive:true})
  for(const name of ['react','react-dom','@deepseek-ai/dsh-client-ui-primitives']){const p=join(release,'core/node_modules',name);mkdirSync(p,{recursive:true});writeFileSync(join(p,'package.json'),JSON.stringify({name,version:'fixture'}))}
  t.after(()=>rmSync(home,{recursive:true,force:true}));return {home,root,release,cwd}
}
test('complete release graph prepares both fresh and compatible whole-link workspaces without mixing an old native cache',t=>{
  const f=fixture(t)
  assert.equal(prepareWorktree(f.cwd,f).dependencySource,'complete-release-graph')
  for(const name of ['react','react-dom','@deepseek-ai/dsh-client-ui-primitives'])assert.equal(realpathSync(join(f.cwd,'core/node_modules',name)),realpathSync(join(f.release,'core/node_modules',name)))
  assert.equal(prepareWorktree(f.cwd,f).cwd,f.cwd)
  const second=join(f.root,'second');mkdirSync(join(second,'core'),{recursive:true});symlinkSync(join(f.release,'core/node_modules'),join(second,'core/node_modules'),'dir')
  prepareWorktree(second,f);assert.equal(lstatSync(join(second,'core/node_modules')).isDirectory(),true)
})
test('unknown existing dependency and symlinked parents are refused without deleting their content',t=>{
  const f=fixture(t),unknown=join(f.home,'unknown');mkdirSync(unknown);writeFileSync(join(unknown,'keep'),'preserved')
  mkdirSync(join(f.cwd,'core/node_modules'),{recursive:true});symlinkSync(unknown,join(f.cwd,'core/node_modules/react'),'dir')
  assert.throws(()=>prepareWorktree(f.cwd,f),/Unexpected/);assert.equal(readFileSync(join(unknown,'keep'),'utf8'),'preserved')
  const second=join(f.root,'second');mkdirSync(second);symlinkSync(unknown,join(second,'core'),'dir')
  assert.throws(()=>prepareWorktree(second,f),/symlink/)
})
test('outside/root paths and incomplete release provisioning cannot initialize a workspace',t=>{
  const f=fixture(t)
  assert.throws(()=>prepareWorktree(f.home,f),/Unregistered/)
  assert.throws(()=>prepareWorktree(f.root,f),/Unregistered/)
  rmSync(join(f.release,'core/node_modules/react'),{recursive:true})
  assert.throws(()=>prepareWorktree(f.cwd,f),/incomplete/)
})
