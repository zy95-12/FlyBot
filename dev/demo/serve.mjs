import { once } from 'node:events'
import { createWorkbenchGateway } from '../../core/src/host/workbench-gateway.js'
export async function serveWorkbench({ port, cookie, platformOrigin, realModel, signal }) {
  const gateway = createWorkbenchGateway({ upstreamOrigin: `http://127.0.0.1:${port}`, upstreamCookie: cookie })
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening')
  process.stdout.write(`Shared Project workbench: http://127.0.0.1:${gateway.address().port}/\nExisting control-plane: ${platformOrigin}/dashboard/console.html\nAccounts: alice@example.com and bob@example.com (passwords entered at startup)\nModel: ${realModel ? 'configured real provider; acceptance still requires inspecting evidence' : 'deterministic fixture; not real-model acceptance'}\nTemporary data is deleted on clean exit. Press Ctrl-C to stop.\n`)
  try {
    if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
  } finally { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)) }
}
