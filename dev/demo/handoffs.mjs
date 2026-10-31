// Real Docker↔host Git transport/verification. No model or GitHub credential is used.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, chown, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createProjectResources } from '../../core/src/host/project-resources.js'
import { createResourceWorkspaces } from '../../core/src/host/project-resource-workspaces.js'
const directory = await mkdtemp(join(tmpdir(), 'flybot-m7-handoffs-'))
const repository = join(directory, 'repo'), remoteRoot = join(directory, 'remote'), artifacts = join(directory, 'artifacts')
const name = `flybot-m7-handoff-${randomUUID().slice(0, 8)}`
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })
const git = async (cwd, args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
let created = false
try {
  await mkdir(repository); await mkdir(remoteRoot); await mkdir(artifacts); await chown(remoteRoot, 1000, 1000)
  await git(repository, ['init', '-q', '-b', 'main']); await git(repository, ['config', 'user.name', 'Fixture']); await git(repository, ['config', 'user.email', 'fixture@localhost'])
  await writeFile(join(repository, 'code.mjs'), 'export const add=(a,b)=>a-b;\n')
  await writeFile(join(repository, 'code.test.mjs'), "import assert from 'node:assert/strict';import {add} from './code.mjs';assert.equal(add(2,3),5);assert.equal(add(-4.5,2),-2.5);assert.equal(add(0,0),0);\n")
  await git(repository, ['add', '.']); await git(repository, ['commit', '-qm', 'Fixture base'])
  const baseSha = await git(repository, ['rev-parse', 'HEAD'])
  docker(['run', '-d', '--name', name, '--user', 'node', '-v', `${remoteRoot}:/workspace`, '--entrypoint', 'node', 'flybot:m0-test-tools', '-e', 'setInterval(()=>{},1000)']); created = true
  const rt = { state: {}, save: async () => {}, readProject: () => ({ id: 'p', ownerUserId: 'owner' }), config: { projectResources: { isolated: { type: 'docker', container: name, user: '1000:1000', root: '/workspace', capacity: 3, allowedProjectOwnerIds: ['owner'], harnesses: ['codex', 'claude-agent'] } } } }
  rt.projectResources = createProjectResources(rt)
  const workspaces = createResourceWorkspaces(rt, { hostGit: git, artifacts })
  const attempt = { id: 'attempt-probe', branch: 'flybot/handoff-probe', baseSha }
  const workspace = role => ({ id: `w-${role}`, projectId: 'p', attemptId: attempt.id, role, resourceId: 'isolated', resourceLease: { resourceId: 'isolated' }, repository, path: `/workspace/delivery/${attempt.id}/${role}`, kind: 'resource-clone' })
  const developer = workspace('developer'), reviewer = workspace('reviewer')
  await workspaces.allocate(developer, attempt); await workspaces.allocate(reviewer, attempt)
  await rt.projectResources.command('p', 'isolated', { cwd: developer.path, argv: ['node', '-e', 'require("fs").writeFileSync("code.mjs","export const add=(a,b)=>a+b;\\n")'] })
  await workspaces.git(developer, ['add', '.']); await workspaces.git(developer, ['commit', '-m', 'Seal candidate in actual resource'])
  attempt.candidateSha = await workspaces.git(developer, ['rev-parse', 'HEAD'])
  await workspaces.importCandidate(developer, attempt)
  assert.equal(attempt.publicationRepository, repository)
  await workspaces.checkout(reviewer, attempt)
  assert.equal(await workspaces.git(reviewer, ['rev-parse', 'HEAD']), attempt.candidateSha)
  const verification = join(directory, 'host-verifier')
  await git(repository, ['worktree', 'add', '--detach', verification, attempt.candidateSha])
  const tests = execFileSync(process.execPath, ['--test', 'code.test.mjs'], { cwd: verification, encoding: 'utf8', timeout: 10_000 })
  assert.match(tests, /# fail 0/)
  assert.match(await readFile(join(repository, 'code.mjs'), 'utf8'), /a-b/, 'Host reference worktree remains unchanged')
  const artifact = await workspaces.bundle(repository, attempt.candidateSha, join(artifacts, attempt.id))
  const originalUpload = rt.projectResources.uploadFile
  rt.projectResources.uploadFile = async (...args) => {
    await originalUpload(...args)
    await rt.projectResources.command('p', 'isolated', { cwd: reviewer.path, argv: ['node', '-e', 'const fs=require("fs"),p=process.argv[1],b=fs.readFileSync(p);fs.unlinkSync(p);fs.writeFileSync(p,Buffer.concat([b,Buffer.from("corruption")]))', args[3]] })
  }
  await assert.rejects(workspaces.putBundle(reviewer, artifact), /hash mismatch/)
  rt.projectResources.uploadFile = originalUpload
  await git(repository, ['worktree', 'remove', '--force', verification])
  await workspaces.cleanup(developer); await workspaces.cleanup(reviewer)
  process.stdout.write(JSON.stringify({ runtime: 'actual Docker Git/Node + independent host Git/Node', baseSha, candidateSha: attempt.candidateSha, candidateTransfer: attempt.candidateTransfer,
    checks: ['remote role base checkout', 'remote candidate sealed and imported to host', 'reviewer same exact SHA', 'independent host tests at sealed SHA', 'reference worktree unchanged', 'corrupted bundle refused', 'owned remote/local workspaces cleaned'], notRun: ['real SDK inference', 'browser flow', 'GitHub publication'] }) + '\n')
} finally {
  if (created) docker(['rm', '-f', name])
  await rm(directory, { recursive: true, force: true })
}
