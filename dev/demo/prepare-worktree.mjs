// Operator adapter: registered workspaces use one complete release dependency graph.
import { existsSync, mkdirSync, symlinkSync, lstatSync, realpathSync, readdirSync, unlinkSync } from 'node:fs'
import { join, relative, isAbsolute, dirname } from 'node:path'
const stat = path => { try { return lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
export function prepareWorktree(input, { root, release }) {
  const cwd = realpathSync(input), boundary = realpathSync(root), part = relative(boundary, cwd)
  if (!part || part.startsWith('..') || isAbsolute(part)) throw Error('Unregistered verification worktree')
  for (const name of ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']) if (!existsSync(join(release, 'core/node_modules', name, 'package.json'))) throw Error('Release native dependency graph is incomplete')
  const directory = path => {
    let parent = cwd
    for (const item of relative(cwd, path).split('/')) {
      parent = join(parent, item); const row = stat(parent)
      if (row?.isSymbolicLink()) throw Error('Dependency parent is a symlink')
      if (row && !row.isDirectory()) throw Error('Dependency parent is not a directory')
      if (!row) mkdirSync(parent)
    }
  }
  const link = (dest, source) => {
    if (stat(dest)) {
      if (!existsSync(dest) || realpathSync(dest) !== realpathSync(source)) throw Error('Unexpected dependency entry')
      return
    }
    directory(dirname(dest)); symlinkSync(source, dest, 'dir')
  }
  for (const name of ['core/node_modules', 'core/dev/harness/node_modules']) {
    const target = join(release, name), path = join(cwd, name)
    if (stat(path)?.isSymbolicLink()) { if (realpathSync(path) !== realpathSync(target)) throw Error('Unexpected dependency link'); unlinkSync(path) }
    directory(path)
    for (const entry of readdirSync(target)) link(join(path, entry), join(target, entry))
  }
  return { cwd, nativePackages: 3, dependencySource: 'complete-release-graph' }
}
