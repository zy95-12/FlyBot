import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createProjectDelegations, principalChecker } from '../src/host/project-delegations.js'
test('persistent grants have no browser proof, revalidate accounts/roles and revoke by generation', async () => {
  let active = true, allowed = true
  const rt = { state: { members: { a: { id: 'a', platform: { issuer: 'https://platform.example', subject: 'subject-a' } } } }, config: {}, save: async () => {}, requireProjectAccess(actor, projectId) { if (!allowed || actor.memberId !== 'a' || projectId !== 'p') throw new Error('Current Project access denied') }, projectAgents: { privateIdentity: () => 'private-a' } }
  const service = createProjectDelegations(rt, { principal: async () => active })
  const granted = await service.mode({ projectId: 'p', mode: 'watch' }, { memberId: 'a', sessionId: 'browser-cookie-reference' })
  const actor = await service.actorFor('private-a')
  assert.equal(actor.sessionId, undefined); assert.equal(actor.watchGrantId, granted.grant.id)
  assert.equal(JSON.stringify(rt.state).includes('browser-cookie-reference'), false)
  allowed = false; await assert.rejects(service.validateActor(actor), /Current Project/); allowed = true
  const restarted = createProjectDelegations(rt, { principal: async () => active })
  assert.equal((await restarted.actorFor('private-a')).watchGrantId, actor.watchGrantId)
  await service.mode({ projectId: 'p', mode: 'safe' }, { memberId: 'a' })
  await assert.rejects(service.validateActor(actor), /revoked/)
  assert.equal(service.view('private-a').mode, 'safe')
  await assert.rejects(service.mode({ projectId: 'p', mode: 'watch' }, actor), /signed-in human/)
  await service.mode({ projectId: 'p', mode: 'watch' }, { memberId: 'a' }); active = false
  await assert.rejects(service.actorFor('private-a'), /disabled/)
  assert.equal(service.view('private-a').mode, 'safe')
})
test('principal command rejects forged identity/nonce and missing platform setup without borrowing cookies', async () => {
  const member = { id: 'a', platform: { subject: 'subject-a' } }
  await assert.rejects(principalChecker({ config: {} })(member), /operator-configured/)
  const rt = { config: { controlPlane: { principalCheckCommand: ['/fixed/operator-check'] } } }
  const checker = principalChecker(rt, { run: async (_argv, input) => JSON.stringify({ ...JSON.parse(input), status: 'active' }) })
  assert.equal(await checker(member), true)
  const forged = principalChecker(rt, { run: async () => JSON.stringify({ version: 'platform-principal/v1', subject: 'subject-a', nonce: 'forged', status: 'active' }) })
  assert.equal(await forged(member), false)
})
test('operator SQLite projection reads fresh WAL status and never returns passwords or changes account data', t => {
  const dir = mkdtempSync(join(tmpdir(), 'flybot-principal-')), db = join(dir, 'platform.sqlite')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  execFileSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]);c.execute("CREATE TABLE users(id TEXT, status TEXT, password_hash TEXT)");c.execute("INSERT INTO users VALUES(?,?,?)",("human","active","NEVER_RETURN_HASH"));c.commit()', db])
  const script = new URL('../../dev/demo/platform-principal.py', import.meta.url).pathname
  const read = subject => JSON.parse(execFileSync('python3', [script, '--db', db], { input: JSON.stringify({ version: 'platform-principal/v1', subject, nonce: 'fresh' }), encoding: 'utf8' }))
  assert.equal(read('human').status, 'active')
  assert.equal(read("human' OR 1=1 --").status, 'unavailable')
  assert.equal(JSON.stringify(read('human')).includes('NEVER_RETURN_HASH'), false)
  execFileSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]);c.execute("PRAGMA journal_mode=WAL");c.execute("UPDATE users SET status=? WHERE id=?",("disabled","human"));c.commit()', db])
  assert.equal(read('human').status, 'unavailable')
  const walRead = execFileSync('python3', ['-c', 'import sqlite3,subprocess,sys,json,os;c=sqlite3.connect(sys.argv[1]);c.execute("PRAGMA journal_mode=WAL");c.execute("PRAGMA wal_autocheckpoint=0");c.execute("UPDATE users SET status=? WHERE id=?",("active","human"));c.commit();c.execute("UPDATE users SET status=? WHERE id=?",("disabled","human"));c.commit();assert os.path.exists(sys.argv[1]+"-wal");print(subprocess.check_output([sys.executable,sys.argv[2],"--db",sys.argv[1]],input=json.dumps({"version":"platform-principal/v1","subject":"human","nonce":"wal-fresh"}).encode()).decode());c.close()', db, script], { encoding: 'utf8' })
  assert.equal(JSON.parse(walRead).status, 'unavailable')
  assert.equal(execFileSync('python3', ['-c', 'import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("SELECT password_hash FROM users").fetchone()[0])', db], { encoding: 'utf8' }).trim(), 'NEVER_RETURN_HASH')
})
