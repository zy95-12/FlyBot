// Personal GitHub writes are selected by authenticated human AND Project, never by a
// caller-supplied credential reference or by falling back to Project automation.
import { createHash, randomUUID } from 'node:crypto'
import { ownEntry, setEntry } from './store.js'
import { resolveGithubIdentity } from './project-github.js'
const refused = message => Object.assign(new Error(message), { code: 'bot/forbidden' })

export function createProjectCredentials(rt, { identity = resolveGithubIdentity, request = fetch } = {}) {
  const personal = (actor, projectId) => ownEntry(ownEntry(rt.config.personalGithub ?? {}, actor.memberId) ?? {}, projectId)
  return {
    async endpoint(endpoint, body, actor) {
      const projectId = String(body.projectId ?? '')
      const project = rt.requireProjectAccess(actor, projectId, endpoint === 'project-credential-status' ? 'read' : 'create')
      const settings = personal(actor, projectId)
      if (endpoint === 'project-credential-status') return {
        personal: { configured: Boolean(settings?.credential && settings.configDir && settings.login), login: settings?.login ?? null },
        automation: { configured: Boolean(ownEntry(rt.config.projectRepositories ?? {}, project.repository)?.github?.credential && ownEntry(rt.config.projectRepositories ?? {}, project.repository)?.github?.configDir) },
      }
      if (body.scope !== undefined && body.scope !== 'personal') throw refused('This endpoint only uses your own personal GitHub identity')
      if (!settings?.login) throw refused('Personal GitHub credential is not configured for this human and Project')
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(project.repository ?? '')) throw refused('Project repository is unavailable')
      if (!Number.isSafeInteger(body.issueNumber) || body.issueNumber < 1 || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 10_000) throw refused('A GitHub comment needs an issue number and bounded text')
      const selected = await identity(settings)
      if (selected.login.toLowerCase() !== settings.login.toLowerCase()) throw refused('Personal GitHub identity mismatch')
      if (rt.platformIdentityEnabled && !(await (rt.validateHumanActor ? rt.validateHumanActor(actor) : rt.validatePlatformActor(actor)))) throw refused('Human platform session was revoked')
      rt.requireProjectAccess(actor, projectId, 'create')
      const response = await request(`https://api.github.com/repos/${project.repository}/issues/${body.issueNumber}/comments`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: {
          authorization: `Bearer ${selected.token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28',
        }, body: JSON.stringify({ body: body.text.trim() }),
      })
      if (!response.ok) throw new Error(`GitHub comment failed (${response.status})`)
      const comment = await response.json()
      const audit = { id: `github-write-${randomUUID()}`, projectId, initiatedBy: actor.memberId, executorLogin: comment.user?.login ?? selected.login, selectedLogin: selected.login,
        scope: 'personal', agentId: actor.agentId ?? null, grantId: actor.watchGrantId ?? null, operation: 'issue-comment', identityVerified: comment.user?.login?.toLowerCase() === selected.login.toLowerCase(), url: comment.html_url, at: Date.now(),
        bodySha256: createHash('sha256').update(body.text.trim()).digest('hex') }
      rt.state.projectGithubWrites ??= {}
      setEntry(rt.state.projectGithubWrites, audit.id, audit)
      await rt.save()
      if (!audit.identityVerified) throw refused('GitHub response identity mismatch; the write requires reconciliation')
      return { audit }
    },
  }
}
export function install(rt) { rt.projectCredentials = createProjectCredentials(rt) }
