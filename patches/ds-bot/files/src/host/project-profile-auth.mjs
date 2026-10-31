// Run inside the authorized setup PTY. Hidden input; only the selected profile stores it.
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, open, chmod } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, isAbsolute } from 'node:path'
const directory = process.env.FLYBOT_PROFILE_DIR
const harness = process.env.FLYBOT_SETUP_HARNESS
if (!isAbsolute(directory ?? '') || !['codex', 'claude-agent'].includes(harness) || !process.stdin.isTTY) throw new Error('Open an authorized FlyBot resource terminal first')
execFileSync('stty', ['-echo'], { stdio: ['inherit', 'ignore', 'ignore'] })
let value
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
try {
  process.stdout.write(`${harness} API key (hidden input): `)
  value = await new Promise(resolve => rl.question('', resolve))
} finally {
  rl.close()
  execFileSync('stty', ['echo'], { stdio: ['inherit', 'ignore', 'ignore'] })
}
if (!value.trim() || value.length > 1000) throw new Error('Invalid credential length')
await mkdir(directory, { recursive: true, mode: 0o700 })
await chmod(directory, 0o700)
const file = await open(join(directory, 'flybot-credentials.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
try { await file.chmod(0o600); await file.writeFile(JSON.stringify({ [harness === 'codex' ? 'CODEX_API_KEY' : 'ANTHROPIC_API_KEY']: value.trim() })) }
finally { await file.close() }
process.stdout.write('\nSaved to this authorized resource/profile. Close the terminal to recheck.\n')
