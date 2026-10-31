// Explicit operator-selected GitHub automation. Its credential never enters a Bot's environment.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function githubPublisher(settings = {}) {
  async function credential() {
    if (settings.credential !== 'gh-cli') throw new Error('Project GitHub automation credential is not configured')
    const { stdout } = await exec('gh', ['auth', 'token', '--hostname', 'github.com'], { timeout: 10_000, maxBuffer: 8192,
      env: { ...process.env, ...(settings.configDir ? { GH_CONFIG_DIR: settings.configDir } : {}) } })
    const token = stdout.trim()
    if (!token) throw new Error('Project GitHub automation credential is unavailable')
    return token
  }
  async function api(repository, path, token, body) {
    if (!repositoryName.test(repository)) throw new Error('Invalid Project repository')
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new Error(`GitHub operation failed (${response.status})`)
    return response.json()
  }
  return {
    async publish(attempt, project) {
      const token = await credential()
      const repository = project.repository
      if (!repositoryName.test(repository)) throw new Error('Invalid Project repository')
      const authorization = Buffer.from(`x-access-token:${token}`).toString('base64')
      // A fixed URL avoids inheriting a model-edited remote; the credential is environment-only.
      try {
        await exec('git', ['-c', 'core.hooksPath=/dev/null', 'push', `https://github.com/${repository}.git`, `${attempt.candidateSha}:refs/heads/${attempt.branch}`], {
          cwd: attempt.workspaces.developer.path, timeout: 120_000, maxBuffer: 64 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}` },
        })
      } catch { throw new Error('Project branch could not be pushed') }
      const existing = await api(repository, `/pulls?state=open&head=${encodeURIComponent(repository.split('/')[0] + ':' + attempt.branch)}`, token)
      const pr = existing[0] ?? await api(repository, '/pulls', token, { title: attempt.requirement.title.slice(0, 120), head: attempt.branch,
        base: project.defaultBranch ?? 'main', draft: true,
        body: `Project delivery artifact.\n\nTask: ${attempt.taskId}\nAttempt: ${attempt.id}\nCommit: ${attempt.candidateSha}\nTests: passed at this commit\nReview: approved at this commit\n\n${attempt.requirement.criteria ?? ''}\n\nGenerated for human acceptance; no automatic merge.` })
      if (pr.head?.sha !== attempt.candidateSha) throw new Error('PR head does not match the tested candidate')
      return { number: pr.number, url: pr.html_url, sha: pr.head.sha, repository }
    },
    async read(pr) {
      const token = await credential()
      const data = await api(pr.repository, `/pulls/${pr.number}`, token)
      return { sha: data.head?.sha, state: data.state, url: data.html_url }
    },
  }
}
