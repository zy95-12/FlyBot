import { ScopedComposer } from '../composer.js'
import { createElement as h, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { AssistantCell, workText } from '../cells.js'
import { BotMark, PersonMark } from '../mark.js'
import { ScopedChatList, SIDEBAR_CSS } from '../sidebar.js'
import { SHELL_CSS, CONVERSATION_CSS } from '../styles.js'

// Reuse the original reply component without installing the owner-shell plugin.
// Its data and navigation capabilities come only from this scoped projection.
function Conversation({ source, roster, openBot, onQuote }) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const ui = { reactions: {} }
  const reply = (row, key, streaming = false) => {
    const bot = roster.bots.find(bot => bot.id === row.botId || bot.role === row.speaker)
    return h('article', { key, 'data-native-message': row.kind ?? 'assistant' },
      h('header', null, bot ? h(BotMark, { bot, size: 28 }) : h(PersonMark, { name: row.speaker }), row.speaker ?? (row.kind === 'human' ? 'You' : 'Bot')),
      row.kind === 'human'
        // UserMessageCell requires the shell's projectUserText projection, absent
        // in the pinned primitives release. Do not invent that provider.
        ? h('p', { style: { whiteSpace: 'pre-wrap' } }, row.text)
        : h(AssistantCell, {
          node: { key: key, data: { turn: 0, step: 0, status: streaming ? 'running' : 'done', blocks: [{ kind: 'text', text: String(row.text ?? '') }] } },
          sessionId: bot?.id,
          useRoster: select => select(roster), useUi: select => select(ui), useTurnSteps: () => [], useTurnContext: () => [],
          actions: { noteLive() {}, quote: (_id, text) => { onQuote?.(text) },
            openSession: id => { if (roster.bots.some(bot => bot.id === id)) openBot?.(id) } },
        }))
  }
  return h('div', { className: 'bt-native-conversation', role: 'log' },
    snapshot.messages.map((row, index) => reply(row, row.id ?? index)),
    snapshot.live?.tool ? h('p', { role: 'status', 'data-native-tool': '' }, workText(snapshot.live.tool)) : null,
    (snapshot.sessions ?? []).filter(session => session.live?.tool).map(session => h('p', { key: `tool:${session.role}`, role: 'status', 'data-native-tool': '' }, `${session.role}: ${workText(session.live.tool)}`)),
    snapshot.live?.text ? reply({ ...snapshot.live, speaker: snapshot.live.speaker ?? 'Bot' }, 'live', true) : null,
    (snapshot.sessions ?? []).filter(session => session.live?.text).map(session =>
      reply({ ...session.live, speaker: session.role }, `live:${session.role}`, true)))
}

export function mountNativeConversation(node, { source, bots = [], openBot, onQuote }) {
  const root = createRoot(node)
  // Use only explicit member-visible identities. Never consult the global roster.
  const scopedBots = bots.map(({ id, name, role }) => ({ id, name, role }))
  const roster = { roomsById: {}, exchangeTurns: {}, remoteTypedTurns: {}, bots: scopedBots, byId: Object.fromEntries(scopedBots.map(bot => [bot.id, bot])) }
  root.render(h(Conversation, { source, roster, openBot, onQuote }))
  return () => root.unmount()
}
export const nativeConversationCss = SHELL_CSS + CONVERSATION_CSS + SIDEBAR_CSS

export function mountNativeChatList(node, { bots = [], rooms = [], mainBotIds = [], selectedId, openSession, openDetails }) {
  const root = createRoot(node)
  bots = bots.map(bot => ({ ...bot, sessionId: bot.sessionId ?? bot.id }))
  const roster = { bots, rooms, mainBotIds, mainBotId: mainBotIds[0],
    byId: Object.fromEntries(bots.map(bot => [bot.id, bot])),
    roomsById: Object.fromEntries(rooms.map(room => [room.id, room])),
    exchangeTurns: {}, remoteTypedTurns: {}, questions: {} }
  root.render(h(ScopedChatList, { roster, selectedId, openSession, openDetails }))
  return () => root.unmount()
}

export function mountNativeComposer(node, options) {
  const root = createRoot(node)
  root.render(h(ScopedComposer, options))
  return () => root.unmount()
}
