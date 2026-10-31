// Bounded, repository-scoped GitHub reads. Never hand credentials or arbitrary URLs to models.
import { ownEntry } from './store.js'
import { resolveGithubIdentity } from './project-github.js'
const refuse = message => Object.assign(new Error(message), { code: 'bot/forbidden' })
const bounded = value => typeof value === 'string' ? value.slice(0, 1200) : null
export function createProjectGithubRead(rt, { identity = resolveGithubIdentity, request = fetch } = {}) {
  return async function read(body, actor) {
    const project = rt.requireProjectAccess(actor, String(body.projectId ?? ''))
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(project.repository ?? '')) throw refuse('Project repository is unavailable')
    if (body.scope !== undefined && !['personal', 'project'].includes(body.scope)) throw refuse('Unknown GitHub read scope')
    if (rt.platformIdentityEnabled && !await (rt.validateHumanActor ? rt.validateHumanActor(actor) : rt.validatePlatformActor(actor))) throw refuse('Human platform session was revoked')
    const operation = body.operation ?? 'issues'
    const number = body.number
    if (!['issues', 'pulls', 'pull', 'reviews', 'checks'].includes(operation) || ['pull', 'reviews', 'checks'].includes(operation) && (!Number.isSafeInteger(number) || number < 1)) throw refuse('Unsupported bounded GitHub read')
    // Explicit automation identity is appropriate for shared Project reads. Personal reads
    // require an explicit personal selection; there is no ambient-token fallback.
    const scope = body.scope === 'personal' ? 'personal' : 'project'
    const settings = scope === 'personal' ? ownEntry(ownEntry(rt.config.personalGithub ?? {}, actor.memberId) ?? {}, project.id) : ownEntry(rt.config.projectRepositories ?? {}, project.repository)?.github
    if (!settings?.login) throw refuse('Selected scoped GitHub read identity is not configured')
    const selected = await identity(settings)
    if (selected.login.toLowerCase() !== settings.login.toLowerCase()) throw refuse('Scoped GitHub read identity mismatch')
    const validate = async () => {
      if (rt.platformIdentityEnabled && !await (rt.validateHumanActor ? rt.validateHumanActor(actor) : rt.validatePlatformActor(actor))) throw refuse('Human platform session was revoked')
      rt.requireProjectAccess(actor, project.id)
      if (rt.readProject?.(project.id)?.repository && rt.readProject(project.id).repository !== project.repository) throw refuse('Project repository changed during the read')
    }
    await validate()
    const get = async suffix => {
      const response = await request(`https://api.github.com/repos/${project.repository}${suffix}`, { redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${selected.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } })
      if (!response.ok) throw new Error(`Scoped GitHub read failed (${response.status})`)
      const text = await response.text()
      if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Scoped GitHub response exceeds its byte budget')
      await validate()
      return JSON.parse(text)
    }
    let data
    const summary = row => ({ number: row.number, title: bounded(row.title), state: row.state, url: row.html_url, updatedAt: row.updated_at, isPullRequest: Boolean(row.pull_request) })
    if (operation === 'issues' || operation === 'pulls') data = (await get(`/${operation}?state=open&per_page=20&sort=updated&direction=desc`)).slice(0, 20).map(summary)
    else if (operation === 'reviews') data = (await get(`/pulls/${number}/reviews?per_page=20`)).slice(0, 20).map(row => ({ id: row.id, state: row.state, commit: row.commit_id, author: row.user?.login, url: row.html_url, body: bounded(row.body) }))
    else {
      const pr = await get(`/pulls/${number}`)
      if (!/^[a-f0-9]{40}$/.test(pr.head?.sha ?? '')) throw refuse('GitHub did not return a full candidate SHA')
      data = { ...summary(pr), sha: pr.head.sha, base: pr.base?.ref, draft: pr.draft, merged: pr.merged }
      if (operation === 'checks') {
        const checks = await get(`/commits/${pr.head.sha}/check-runs?per_page=20`)
        data.checks = (checks.check_runs ?? []).slice(0, 20).map(row => ({ name: row.name, status: row.status, conclusion: row.conclusion, url: row.html_url }))
      }
    }
    return { repository: project.repository, operation, scope, executorLogin: selected.login, at: Date.now(), limit: 20, pagination: 'bounded-first-page', data }
  }
}
export function install(rt) { rt.projectGithubRead = createProjectGithubRead(rt) }
