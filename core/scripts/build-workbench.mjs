import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { SHELL_CSS, CONVERSATION_CSS } from '../src/client/styles.js'
import { MEMBER_CSS } from '../src/client/member-styles.js'
import { SIDEBAR_CSS } from '../src/client/sidebar-styles.js'
const root = resolve(import.meta.dirname, '..')
const result = await build({ absWorkingDir: root, entryPoints: ['src/client/workbench/entry.js'], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', charset: 'utf8', outfile: 'workbench.js', write: false })
// Parser dependencies contain intentional replacement-character literals. Escape
// Unicode in this generated bundle so the repository byte-damage scan stays useful.
const native = await build({ absWorkingDir: root, entryPoints: ['src/client/workbench/native-conversation.js'], bundle: true, format: 'iife', globalName: 'FlyBotNativeConversation', platform: 'browser', target: 'es2022', charset: 'ascii', supported: { 'template-literal': false }, minify: true, define: { 'process.env.NODE_ENV': '"production"' }, outfile: 'workbench-native.js', write: false, assetNames: 'workbench-fonts/[name]-[hash]', publicPath: '/', loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' } })
const cssPath = resolve(root, 'workbench-native.css')
const css = native.outputFiles.find(file => file.path === cssPath)
css.contents = Buffer.from(SHELL_CSS + CONVERSATION_CSS + SIDEBAR_CSS + MEMBER_CSS + css.text)
for (const file of [...result.outputFiles, ...native.outputFiles]) {
  if (process.argv.includes('--check')) {
    if (!(await readFile(file.path).catch(() => Buffer.alloc(0))).equals(Buffer.from(file.contents))) throw new Error('Project workbench assets are stale; run npm run build:workbench in core')
  } else { await mkdir(dirname(file.path), { recursive: true }); await writeFile(file.path, file.contents) }
}
