// FlyBot BFF for the existing control-plane auth API. Passwords and platform cookies
// never enter state.json. Every request revalidates the upstream session (no positive cache).
import { createHash, randomBytes } from 'node:crypto'
import { ownEntry, setEntry } from './store.js'
import { hashToken } from './member-auth.js'

const digest = value => createHash('sha256').update(value).digest('hex')
const unavailable = () => Object.assign(new Error('Platform authentication unavailable or expired'), { code: 'bot/unauthorized' })

export function install(rt) {
  const settings = rt.config.controlPlane
  if (!settings?.origin) return
  const origin = new URL(settings.origin)
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
    !(origin.protocol === 'https:' || origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))) throw new Error('controlPlane.origin must be HTTPS or loopback HTTP, with no path or credentials')
  if (typeof settings.ownerSubject !== 'string' || !settings.ownerSubject.trim()) throw new Error('controlPlane.ownerSubject must explicitly identify the instance owner')
  const issuer = origin.origin
  const fetchPlatform = settings.fetch ?? globalThis.fetch
  const proofs = new Map()
  const { state } = rt
  let tail = Promise.resolve()
  const serial = fn => {
    const result = tail.then(fn, fn)
    tail = result.then(() => {}, () => {})
    return result
  }
  const sessionOf = token => typeof token === 'string' ? Object.values(state.authSessions ?? {}).find(row => row.tokenHash === hashToken(token)) : undefined
  async function request(path, { method = 'GET', body, proof } = {}) {
    let response
    try {
      response = await fetchPlatform(`${issuer}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json', ...(proof ? { cookie: proof.cookie, 'x-csrf-token': proof.csrf ?? '' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) })
    } catch { throw unavailable() }
    if (!response.ok) throw unavailable()
    const data = await response.json().catch(() => { throw unavailable() })
    const cookiePairs = new Map((proof?.cookie ?? '').split('; ').filter(Boolean).map(pair => [pair.slice(0, pair.indexOf('=')), pair]))
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]
      const name = pair.slice(0, pair.indexOf('='))
      if (['__Host-flybot_session', 'flybot_session', '__Host-flybot_csrf', 'flybot_csrf'].includes(name)) cookiePairs.set(name, pair)
    }
    return { data, cookie: [...cookiePairs.values()].join('; '), csrf: data.csrf_token ?? proof?.csrf }
  }
  function validatedUser(data) {
    const user = data?.user
    if (!user || typeof user.id !== 'string' || !user.id || user.id.length > 200 || user.status !== 'active') throw unavailable()
    return user
  }
  rt.platformLogin = body => serial(async () => {
    if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.email.length > 320 || body.password.length > 1024) throw unavailable()
    const response = await request('/api/auth/login', { method: 'POST', body: { email: body.email, password: body.password } })
    const user = validatedUser(response.data)
    if (!response.cookie) throw unavailable()
    const key = digest(`${issuer}\n${user.id}`)
    state.platformSubjects ??= {}
    let memberId = ownEntry(state.platformSubjects, key)
    if (!memberId) {
      memberId = user.id === settings.ownerSubject ? 'owner-1' : `platform-${key.slice(0, 32)}`
      const existing = ownEntry(state.members, memberId)
      if (existing?.platform && (existing.platform.subject !== user.id || existing.platform.issuer !== issuer)) throw unavailable()
      setEntry(state.members, memberId, { ...existing, id: memberId, createdAt: existing?.createdAt ?? Date.now(),
        displayName: String(user.display_name ?? user.email ?? memberId).slice(0, 200), platform: { issuer, subject: user.id } })
      setEntry(state.platformSubjects, key, memberId)
    }
    const token = randomBytes(32).toString('base64url')
    const id = `platform-session-${randomBytes(12).toString('hex')}`
    setEntry(state.authSessions, id, { id, memberId, tokenHash: hashToken(token), provider: 'control-plane', createdAt: Date.now(), revokedAt: null })
    proofs.set(id, { cookie: response.cookie, csrf: response.csrf, subject: user.id })
    await rt.save()
    return { sessionToken: token, memberId, displayName: ownEntry(state.members, memberId).displayName }
  })
  const localAuthenticate = rt.authenticate
  rt.authenticate = async token => {
    const session = sessionOf(token)
    if (!session || session.revokedAt || session.provider !== 'control-plane') return null
    const proof = proofs.get(session.id)
    if (!proof) return null // A process restart deliberately signs BFF sessions out.
    try {
      const response = await request('/api/auth/session', { proof })
      const user = validatedUser(response.data)
      if (user.id !== proof.subject) return null
      proofs.set(session.id, { ...proof, cookie: response.cookie, csrf: response.csrf })
      return await localAuthenticate(token)
    } catch { return null }
  }
  const localRevoke = rt.revokeSession
  rt.revokeSession = async token => {
    const session = sessionOf(token)
    const proof = session && proofs.get(session.id)
    if (proof) {
      try { await request('/api/auth/logout', { method: 'POST', proof }) } catch { /* Revoke locally even when the platform is down. */ }
      proofs.delete(session.id)
    }
    return localRevoke(token)
  }
  rt.platformIdentityEnabled = true
  rt.ctx.effect(() => () => { proofs.clear() }, 'ds-bot: platform credentials')
}
