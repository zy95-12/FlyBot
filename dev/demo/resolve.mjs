// Resolve the checkout's DSH peer imports from the installed, pinned harness.
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
const anchor = pathToFileURL(resolve(root, 'core/dev/harness/package.json')).href
const core = pathToFileURL(resolve(root, 'core')).href + '/'
registerHooks({
  resolve(specifier, context, next) {
    return next(specifier, specifier.startsWith('@deepseek-ai/') && context.parentURL?.startsWith(core)
      ? { ...context, parentURL: anchor } : context)
  },
})
