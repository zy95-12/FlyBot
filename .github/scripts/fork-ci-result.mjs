import {fileURLToPath} from 'node:url'
export function forkCiPassed({test,plugins,package:pack,extended=false}) {
  return test==='success' && (extended ? plugins==='success' && pack==='success' : plugins==='skipped' && pack==='skipped')
}
if(process.argv[1]===fileURLToPath(import.meta.url)) process.exitCode=forkCiPassed({test:process.env.TEST,plugins:process.env.PLUGINS,package:process.env.PACKAGE,extended:process.env.EXTENDED==='true'})?0:1
