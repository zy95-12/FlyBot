import { ownEntry } from './store.js'

const refused = () => Object.assign(new Error('You cannot access that personal conversation'), { code: 'bot/forbidden' })
const personalBot = bot => bot && !bot.projectAgent && !bot.ephemeral && !bot.projectId && !bot.remote
export function personalRoster(rt, actor) {
  if (!actor?.memberId) throw refused()
  const bots = Object.values(rt.state.bots).filter(bot => personalBot(bot) && rt.botOwnedBy(actor, bot.id))
  const rooms = Object.values(rt.state.rooms).filter(room => !room.projectId && !room.face && (rt.roomMemberOf(actor, room.id) || rt.roomOwnedBy(actor, room.id)) && (room.members ?? []).every(id => personalBot(ownEntry(rt.state.bots, id))))
  return { bots: bots.map(({ id, name, role, instructions, model, color, avatar, parentId, sessionId }) => ({ id, name, role, instructions, model, color, avatar, parentId, sessionId: rt.chatOf?.(id) ?? sessionId ?? id, parts: (rt.partsOf?.(id) ?? []).map(part => ({ sessionId: part.sessionId, number: part.number })) })), rooms: rooms.map(({ id, name, members, participants, mode }) => ({ id, name, members, participants: (participants ?? []).map(({ id, kind, displayName, role, joinedSeq, leftSeq }) => ({ id, kind, displayName, role, joinedSeq, leftSeq })), mode })), mainBotIds: rt.state.mainBotIds.filter(id => bots.some(bot => bot.id === id)) }
}
export function requirePersonalSession(rt, actor, id) {
  const roster = personalRoster(rt, actor)
  const bot = rt.botOf(id)
  if (bot && roster.bots.some(row => row.id === bot.id)) return bot.sessionId ?? bot.id
  if (roster.rooms.some(row => row.id === id)) return id
  throw refused()
}
