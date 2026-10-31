// Human Project membership policy; AI role labels confer no human authority.
// #1828: a Project's roles. The record stores only `roles: { maintainers, members }`; the owner
// is read from `ownerUserIds`, never stored twice, so the two cannot disagree. A record written
// before this slice carries no `roles` and derives to owner-only — no migration pass.
export const PROJECT_ROLE_RANKS = { member: 1, maintainer: 2, owner: 3 }
const roleList = value => (Array.isArray(value) ? [...new Set(value.map(id => text(id)).filter(id => id !== ''))] : [])
export function rolesOf(project) {
  const owner = roleList(project?.ownerUserIds)
  const primary = text(project?.ownerUserId)
  if (primary !== '' && !owner.includes(primary)) owner.unshift(primary)
  const stored = project?.roles !== null && typeof project?.roles === 'object' ? project.roles : {}
  const maintainers = roleList(stored.maintainers).filter(id => !owner.includes(id))
  const members = roleList(stored.members).filter(id => !owner.includes(id) && !maintainers.includes(id))
  return { owner, maintainers, members }
}
export function roleOf(project, memberId) {
  const id = text(memberId)
  if (id === '') return null
  const roles = rolesOf(project)
  if (roles.owner.includes(id)) return 'owner'
  if (roles.maintainers.includes(id)) return 'maintainer'
  if (roles.members.includes(id)) return 'member'
  return null
}
// The roles a caller may switch a target to: the current one is not repeated, and the Owner rank
// is never an assignment (transfer is a separate slice). A Member sees nothing, a Maintainer
// sees only Member, and an Owner acting on anyone else sees the two assignable ranks.
export function roleChoices(project, actorId, targetId = actorId) {
  const actor = roleOf(project, actorId)
  const self = text(targetId) === text(actorId)
  const target = self ? actor : roleOf(project, targetId)
  const choices = []
  // The Owner of a Project never drops its own rank here: the menu shows only the current item.
  if (self && actor === 'owner') return choices
  for (const role of ['maintainer', 'member']) {
    if (role === target) continue
    if (actor === 'owner') choices.push(role)
    else if (self && actor !== null && PROJECT_ROLE_RANKS[role] < PROJECT_ROLE_RANKS[actor]) choices.push(role)
  }
  return choices
}
// The policy Chief's matrix (2026-10-30) fixes, in one place the endpoint and the menu both read:
// only an Owner re-roles someone else, nobody promotes themselves, and a Project always keeps its
// Owner. Returns the next stored roles on success and a machine-readable reason on refusal; the
// caller's record is untouched either way.
export function changeRole(project, { actorId, targetId, role } = {}) {
  const actor = roleOf(project, actorId)
  const self = text(targetId) === '' || text(targetId) === text(actorId)
  const target = self ? text(actorId) : text(targetId)
  const wanted = text(role)
  const current = rolesOf(project)
  // #1838: a plain object answers for names it inherits, so `toString` used to read as a rank and
  // fall through to the demote path. Only an own key of the table is a role.
  if (!Object.hasOwn(PROJECT_ROLE_RANKS, wanted)) return { ok: false, reason: 'unknown-role' }
  if (wanted === 'owner') return { ok: false, reason: 'owner-not-assignable' }
  if (actor === null) return { ok: false, reason: 'not-owner' }
  if (self) {
    if (actor === 'owner') return { ok: false, reason: 'last-owner' }
    if (PROJECT_ROLE_RANKS[wanted] > PROJECT_ROLE_RANKS[actor]) return { ok: false, reason: 'cannot-self-promote' }
  } else if (actor !== 'owner') {
    return { ok: false, reason: 'not-owner' }
  } else if (current.owner.includes(target)) {
    return { ok: false, reason: 'last-owner' }
  }
  const maintainers = current.maintainers.filter(id => id !== target)
  const members = current.members.filter(id => id !== target)
  if (wanted === 'maintainer') maintainers.push(target)
  else members.push(target)
  return { ok: true, roles: { maintainers, members } }
}

const text = value => (typeof value === 'string' ? value.trim() : '')

