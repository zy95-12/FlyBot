// Explicit operator-selected GitHub automation. Its credential never enters a Bot's environment.
import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export async function resolveGithubIdentity(settings = {}, { run = exec, request = fetch } = {}) {
  if (settings.credential !== 'gh-cli' || !isAbsolute(settings.configDir ?? '')) throw new Error('Project GitHub automation credential is not explicitly configured')
  const env = { ...process.env, GH_CONFIG_DIR: settings.configDir }
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[key]
  let stdout
  try { ({ stdout } = await run('gh', ['auth', 'token', '--hostname', 'github.com'], { timeout: 10_000, maxBuffer: 8192, env })) }
  catch { throw new Error('Selected GitHub credential is unavailable') }
  const token = stdout.trim()
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('Selected GitHub credential is unavailable')
  const response = await request('https://api.github.com/user', { redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } })
  if (!response.ok) throw new Error('Selected GitHub identity could not be verified')
  const user = await response.json()
  if (typeof user.login !== 'string' || !user.login || settings.login && user.login.toLowerCase() !== settings.login.toLowerCase()) throw new Error('Selected GitHub identity does not match the configured login')
  return { token, login: user.login }
}

export function githubPublisher(settings = {}, { run = exec, request = fetch } = {}) {
  async function api(repository, path, token, body) {
    if (!repositoryName.test(repository)) throw new Error('Invalid Project repository')
    const response = await request(`https://api.github.com/repos/${repository}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new Error(`GitHub operation failed (${response.status})`)
    return response.json()
  }
  async function upstreamOf(repository, data, token) {
    if (data.base?.repo?.full_name !== repository || typeof data.base?.ref !== 'string' || !data.base.ref) throw new Error('Existing PR upstream is unavailable')
    const ref = await api(repository, `/git/ref/heads/${encodeURIComponent(data.base.ref)}`, token)
    if (ref.object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(ref.object?.sha ?? '')) throw new Error('Existing PR upstream is unavailable')
    return { baseRef: data.base.ref, baseSha: ref.object.sha }
  }
  return {
    async publish(attempt, project) {
      const identity = await resolveGithubIdentity(settings, { run, request })
      const token = identity.token
      const repository = project.repository
      if (!repositoryName.test(repository)) throw new Error('Invalid Project repository')
      const binding = attempt.publicationBinding
      if (binding) {
        if (binding.repository !== repository || !Number.isSafeInteger(binding.number) || binding.number < 1 || typeof binding.branch !== 'string' || !/^[a-f0-9]{40}$/.test(binding.previousSha)) throw new Error('Existing delivery PR binding is invalid')
        const bound = await api(repository, `/pulls/${binding.number}`, token)
        if (bound.state !== 'open' || bound.number !== binding.number || bound.head?.repo?.full_name !== repository || bound.head?.ref !== binding.branch || ![binding.previousSha, attempt.candidateSha].includes(bound.head?.sha)) throw new Error('Existing delivery PR changed; reconcile before publication')
        if (!/^[a-f0-9]{40}$/.test(binding.upstreamSha ?? '') || typeof binding.upstreamRef !== 'string') throw new Error('Existing PR upstream binding is missing')
        const upstream = await upstreamOf(repository, bound, token)
        if (upstream.baseSha !== binding.upstreamSha || upstream.baseRef !== binding.upstreamRef) throw new Error('Existing PR upstream changed; integrate and verify the new target')
        // Keep prior candidates reachable; never overwrite unrelated or rebased history.
        try { for (const parent of [binding.previousSha, binding.upstreamSha]) await run('git', ['merge-base', '--is-ancestor', parent, attempt.candidateSha], { cwd: attempt.publicationRepository ?? attempt.workspaces.developer.path, timeout: 10_000, maxBuffer: 8192 }) }
        catch { throw new Error('Rework candidate does not retain the previous published candidate and trusted upstream') }
      }
      const publicationBranch = binding?.branch ?? attempt.branch
      const authorization = Buffer.from(`x-access-token:${token}`).toString('base64')
      // A fixed URL avoids inheriting a model-edited remote; the credential is environment-only.
      try {
        await run('git', ['-c', 'core.hooksPath=/dev/null', 'push', `https://github.com/${repository}.git`, `${attempt.candidateSha}:refs/heads/${publicationBranch}`], {
          cwd: attempt.publicationRepository ?? attempt.workspaces.developer.path, timeout: 120_000, maxBuffer: 64 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '2',
            GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: '',
            GIT_CONFIG_KEY_1: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${authorization}` },
        })
      } catch { throw new Error('Project branch could not be pushed') }
      const existing = binding ? [] : await api(repository, `/pulls?state=open&head=${encodeURIComponent(repository.split('/')[0] + ':' + publicationBranch)}`, token)
      const pr = binding ? await api(repository, `/pulls/${binding.number}`, token) : existing[0] ?? await api(repository, '/pulls', token, { title: attempt.requirement.title.slice(0, 120), head: attempt.branch,
        base: project.defaultBranch ?? 'main', draft: true,
        body: `Project delivery artifact.\n\nTask: ${attempt.taskId}\nAttempt: ${attempt.id}\nCommit: ${attempt.candidateSha}\nTests: passed at this commit\nReview: approved at this commit\n\n${attempt.requirement.criteria ?? ''}\n\nGenerated for human acceptance; no automatic merge.` })
      if (binding && (pr.number !== binding.number || pr.state !== 'open' || pr.head?.ref !== publicationBranch || pr.head?.repo?.full_name !== repository)) throw new Error('Existing delivery PR changed during publication')
      if (binding) { const upstream = await upstreamOf(repository, pr, token); if (upstream.baseSha !== binding.upstreamSha || upstream.baseRef !== binding.upstreamRef) throw new Error('Existing PR upstream changed during publication') }
      if (pr.head?.sha !== attempt.candidateSha) throw new Error('PR head does not match the tested candidate')
      return { number: pr.number, url: pr.html_url, sha: pr.head.sha, repository, executorLogin: identity.login, credentialScope: 'project-automation' }
    },
    async read(pr, { includeBase = false } = {}) {
      const identity = await resolveGithubIdentity(settings, { run, request })
      const token = identity.token
      const data = await api(pr.repository, `/pulls/${pr.number}`, token)
      return { sha: data.head?.sha, state: data.state, url: data.html_url, ...(includeBase ? await upstreamOf(pr.repository, data, token) : {}) }
    },
  }
}
