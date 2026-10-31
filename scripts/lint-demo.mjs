import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const harness = process.env.DSH_HARNESS || join(root, 'core/dev/harness')
const result = spawnSync(process.execPath, [join(harness, 'node_modules/oxlint/bin/oxlint'),
  '-c', 'core/.oxlintrc.json', 'dev/demo', 'scripts/lint-demo.mjs'], { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
