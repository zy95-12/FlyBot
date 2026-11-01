import { cleanText } from './diagnostics.js'
import { textOf } from './text.js'
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

// Only calls present on this authorized page may acquire a result. Never expose
// arguments, non-text content or outputs of hidden Bot-to-Bot turns.
export function personalToolRows(records, hidden, redact) {
  const calls = new Map()
  for (const { event } of records) {
    if (hidden.has(event.data?.turn)) continue
    if (event.type === 'tool/call' && event.data?.callId && event.data.name !== 'ask_user') {
      calls.set(event.data.callId, { id: event.data.callId, tool: cleanText(event.data.name, { redact }).slice(0, 100), status: 'started', text: '' })
    }
    if (event.type === 'tool/result') {
      const message = event.data?.message
      const call = calls.get(message?.toolCallId ?? event.data?.callId)
      if (!call) continue
      call.status = message?.isError ? 'failed' : 'completed'
      call.text = cleanText(textOf(message?.content), { redact }).slice(0, 2000)
    }
  }
  let remaining = 16000
  return [...calls.values()].slice(-20).map(row => {
    const text = row.text.slice(0, remaining); remaining -= text.length
    return { ...row, text }
  })
}

export function createPersonalStreams(rt) {
  const streams = new Map()
  const stream = (sessionId, next) => {
    const bot = rt.botOf(rt.selfOf?.(sessionId))
    if (!personalBot(bot) || rt.chatOf(bot.id) !== sessionId) return next()
    const entry = { text: '', turn: rt.live?.get(sessionId)?.turn }
    streams.set(sessionId, entry)
    return (async function* () {
      try {
        for await (const chunk of next()) {
          if (chunk.type === 'text-delta' && entry.text.length < 64000) entry.text = (entry.text + chunk.text).slice(0, 64000)
          yield chunk
        }
      } finally { if (streams.get(sessionId) === entry) streams.delete(sessionId) }
    })()
  }
  const read = sessionId => {
    const entry = streams.get(sessionId), turn = rt.live?.get(sessionId)?.turn
    if (!entry || turn === undefined || entry.turn !== turn || (rt.state.exchangeTurns[sessionId] ?? []).includes(turn)) return null
    const bot = rt.botOf(rt.selfOf(sessionId))
    return personalBot(bot) && rt.chatOf(bot.id) === sessionId ? { text: cleanText(entry.text, { redact: rt.redactSecrets }), speaker: bot.name, botId: bot.id } : null
  }
  return { stream, read }
}

export function personalQuestion(rt, sessionId, actor) {
  const question = rt.state.questions[sessionId]
  if (!question) return null
  const bot = rt.botOf(sessionId)
  if (!(bot && rt.botOwnedBy(actor, bot.id)) && !rt.botOwnedBy(actor, question.botId) && !rt.roomOwnedBy(actor, sessionId)) return null
  const { id, header, question: text, detail, options, multiSelect, allowCustom } = question
  return { id, header, question: text, detail, options, multiSelect, allowCustom }
}
