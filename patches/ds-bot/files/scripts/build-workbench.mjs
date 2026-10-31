import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const result = await build({ absWorkingDir: root, entryPoints: ['src/client/workbench/entry.js'], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', charset: 'utf8', outfile: 'workbench.js', write: false })
for (const file of result.outputFiles) {
  if (process.argv.includes('--check')) {
    if (await readFile(file.path, 'utf8').catch(() => null) !== file.text) throw new Error('Project workbench assets are stale; run npm run build:workbench in core')
  } else await writeFile(file.path, file.contents)
}
