// Operator-only metadata check. No credentials, test execution or model requests.
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { preflightRepository } from '../core/src/host/project-repository-policy.js'
try {
  const [file, repository, ownerUserId] = process.argv.slice(2)
  if (!file || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !ownerUserId) throw new Error('Usage: node scripts/check-project-provisioning.mjs CONFIG.json OWNER/REPO OWNER_ID')
  let input
  try { input = JSON.parse(readFileSync(file, 'utf8')) } catch { throw new Error('Cannot read a valid JSON provisioning configuration') }
  if (!input?.config || !isAbsolute(input.home ?? '') || !isAbsolute(input.dshHome ?? '')) throw new Error('Configuration needs absolute home/dshHome and the bot config object')
  await preflightRepository(input, { id: 'operator-preflight', repository, ownerUserId })
  console.log(JSON.stringify({ configured: true, status: 'ready', tests: 'not-run', modelInference: 'not-run' }))
} catch (error) { console.error(error.code === 'bot/repository-config' || error.code === 'bot/delivery' ? error.message : 'Project provisioning check failed: ' + error.message); process.exitCode = 1 }
