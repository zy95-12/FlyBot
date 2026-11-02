import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChatsIcon, ClockIcon, MicIcon, PaperclipIcon, PeopleIcon, PlusIcon, WaveIcon } from './icons.js'
import { BotMark, markBotForMention } from './mark.js'
import { useLinger } from './motion.js'
import { t } from './i18n.js'

// -------------------------------------------------------------------------
// Composer: dictation mic and the voice-chat button. The shell's send
// button stays the submit path; CSS swaps it with the voice button while the draft is
// empty (the send button is disabled then).

export const speechApi = () => window.SpeechRecognition ?? window.webkitSpeechRecognition
const keepComposerFocus = event => event.preventDefault()

export function useDictation(onText) {
  const [listening, setListening] = useState(false)
  const [note, setNote] = useState('')
  const recognition = useRef(null)
  const latest = useRef(onText)
  latest.current = onText
  useEffect(() => () => recognition.current?.abort(), [])
  useEffect(() => {
    if (!note) return undefined
    const timer = setTimeout(() => setNote(''), 2600)
    return () => clearTimeout(timer)
  }, [note])
  const start = ({ continuous = true, onEnd } = {}) => {
    const Api = speechApi()
    if (!Api) { setNote(t('Dictation is not available in this browser')); return false }
    const engine = new Api()
    engine.lang = navigator.language || 'zh-CN'
    engine.interimResults = true
    engine.continuous = continuous
    engine.onresult = (event) => {
      let interim = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) { if (text.trim()) latest.current(text, true) } else interim += text
      }
      if (interim) latest.current(interim, false)
    }
    engine.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return
      setNote(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? t('Microphone access is blocked') : t("Couldn't hear that"))
    }
    engine.onend = () => { setListening(false); recognition.current = null; onEnd?.() }
    recognition.current = engine
    try { engine.start(); setListening(true); return true } catch { setNote(t("Couldn't start dictation")); return false }
  }
  const stop = () => recognition.current?.stop()
  return { listening, note, start, stop }
}

export function ComposerIdentity({ sessionId, useRoster }) {
  const roster = useRoster(value => value)
  const room = roster.roomsById?.[sessionId]
  const self = roster.self
  const humans = (room?.participants ?? []).filter(p => p.kind === 'human' && p.leftSeq === undefined)
  if (room?.viewerRole === 'invited-owner') {
    return h('span', { className: 'bt-composer-as', title: t('You can remove your Bot from this room') },
      t('Shared room from {name}', { name: room.sharedFrom?.inviterName || t('a friend') }))
  }
  if (!self || !room || humans.length < 2) return null
  return h('span', { className: 'bt-composer-as', title: t('Messages in this room are attributed to you') },
    t('Sending as {name}', { name: self.displayName || self.memberId }))
}

export function ComposerVoice({ sessionId, inputActions, actions, useUi }) {
  const dictation = useDictation((text, final) => {
    if (final && inputActions) inputActions.insertText(text, inputActions.captureInsertion())
  })
  // Reply from a message's hover toolbar quotes it into this composer.
  const quote = useUi(state => (state.quote?.sessionId === sessionId ? state.quote : null))
  useEffect(() => {
    if (!quote || !inputActions) return
    actions.clearQuote(quote.token)
    const excerpt = quote.text.replace(/\s+/g, ' ').trim()
    const line = `> ${excerpt.length > 200 ? `${excerpt.slice(0, 200)}…` : excerpt}\n\n`
    inputActions.insertText(line, inputActions.captureInsertion())
    const box = document.querySelector('[class*="_centerCol"] [role=textbox][contenteditable=true]')
    if (box instanceof HTMLElement) {
      box.focus()
      const selection = window.getSelection()
      selection?.selectAllChildren(box)
      selection?.collapseToEnd()
    }
  }, [quote?.token])
  if (sessionId === undefined) return null
  // With the Voice Input plugin on, its own microphone sits in this composer.
  const pluginMic = actions.speech() !== undefined
  return h(Fragment, null,
    pluginMic ? null : h('button', {
      type: 'button', className: 'bt-mic', 'aria-label': dictation.listening ? t('Stop dictation') : t('Dictate'),
      'aria-pressed': dictation.listening, title: dictation.listening ? t('Stop dictation') : t('Dictate'),
      onMouseDown: keepComposerFocus, onClick: () => (dictation.listening ? dictation.stop() : dictation.start()),
    }, h(MicIcon)),
    h('button', {
      type: 'button', className: 'bt-voice', 'aria-label': t('Start voice chat'), title: t('Voice chat'),
      onMouseDown: keepComposerFocus, onClick: () => actions.openVoice(sessionId),
    }, h(WaveIcon, { size: 18 })),
    dictation.note ? h('span', { className: 'bt-mic-note', role: 'status' }, dictation.note) : null)
}

// Character marks for the "@" menu rows. Each Bot keeps one component, so the menu
// does not remount its mark on every keystroke.
export function menuIcons(roster) {
  const marks = new Map()
  return (row) => {
    if (!row.bot) return PeopleIcon
    const id = row.bot.id
    if (!marks.has(id)) marks.set(id, ({ size = 14 }) => h(BotMark, { bot: markBotForMention(row.bot, roster.getSnapshot()), size }))
    return marks.get(id)
  }
}

// The composer's "+" in a Bot's chat or a group chat: add files, reference another
// chat, or set a scheduled task for this chat. It stands in for the shell's command
// menu, whose plan, permission, model and compact rows reach past what DS Bot keeps
// for its Bots; "/" still opens that menu. Files go through the shell's own file
// input beside it.
export function ComposerPlus({ sessionId, inputActions, useRoster, actions }) {
  const roster = useRoster(value => value)
  const [open, setOpen] = useState(null)
  const [shown, leaving] = useLinger(open, 120)
  const button = useRef(null)
  const menu = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => { if (![button.current, menu.current].some(node => node?.contains(event.target))) setOpen(null) }
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(null) } }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true) }
  }, [open])
  const target = roster.byId?.[sessionId]?.id ?? roster.roomsById?.[sessionId]?.id
  if (sessionId === undefined || target === undefined) return null
  const toggle = () => {
    if (open) { setOpen(null); return }
    const rect = button.current.getBoundingClientRect()
    setOpen({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
  }
  const attach = () => {
    setOpen(null)
    button.current?.closest('[data-composer-card]')?.querySelector('input[type=file]')?.click()
  }
  const schedule = () => {
    setOpen(null)
    actions.openSettings('schedules', target)
  }
  // The chats open in the shell's "@" menu at the caret, so the pick lands where the
  // user was typing.
  const reference = () => {
    setOpen(null)
    actions.referenceChat(sessionId, inputActions?.captureInsertion?.())
  }
  const canReference = typeof inputActions?.captureInsertion === 'function' && actions.canReferenceChat()
  return h(Fragment, null,
    h('button', {
      ref: button, type: 'button', className: 'bt-plus', 'aria-label': t('Add'), title: t('Add'),
      'aria-haspopup': 'menu', 'aria-expanded': Boolean(open), onMouseDown: keepComposerFocus, onClick: toggle,
    }, h(PlusIcon)),
    shown ? createPortal(h('div', {
      ref: menu, className: 'bt-menu bt-menu-up bt-plus-menu', role: 'menu', 'aria-label': t('Add'),
      style: { left: shown.left, bottom: shown.bottom }, 'data-leaving': leaving || undefined,
    },
    h('button', { type: 'button', role: 'menuitem', onClick: attach }, h(PaperclipIcon), h('span', { className: 'bt-menu-label' }, t('Add files'))),
    canReference ? h('button', { type: 'button', role: 'menuitem', onMouseDown: keepComposerFocus, onClick: reference }, h(ChatsIcon), h('span', { className: 'bt-menu-label' }, t('Reference a chat'))) : null,
    h('button', { type: 'button', role: 'menuitem', onClick: schedule }, h(ClockIcon), h('span', { className: 'bt-menu-label' }, t('Scheduled task')))), document.body) : null)
}

// The shared entry supplies a captured, authorized chat handle rather than the
// owner shell's global actions. Keep dictation and mention routing shared.
export function ScopedComposer({ chat, mentions = [], initialText = '', attachments = [], initialImages = [], initialIncluded = [], allowImages = false, onIncluded, onImages, onDraft, onError }) {
  const [text, setText] = useState(initialText)
  const [sending, setSending] = useState(false)
  const pending = useRef(false)
  const [included, setIncluded] = useState(initialIncluded)
  const updateIncluded = value => { setIncluded(value); onIncluded?.(value) }
  const [images, setImages] = useState(initialImages)
  const alive = useRef(true), reading = useRef(false)
  const [readingFiles, setReadingFiles] = useState(false)
  useEffect(() => () => { alive.current = false }, [])
  const upload = async event => {
    if (reading.current) return
    reading.current = true; setReadingFiles(true)
    const files = [...event.target.files], win = event.target.ownerDocument.defaultView
    event.target.value = ''
    try {
      if (files.length + images.length > 4 || files.some(file => file.size > 256 * 1024) || files.reduce((size, file) => size + file.size, images.reduce((size, image) => size + image.bytes, 0)) > 512 * 1024) throw new Error('Choose up to four files, at most 256 KiB each and 512 KiB total')
      const encoded = await Promise.all(files.map(file => new Promise((resolve, reject) => {
        const reader = new win.FileReader()
        reader.onerror = () => reject(new Error('Image could not be read'))
        reader.onload = () => resolve({ name: file.name, mediaType: file.type, bytes: file.size, data: String(reader.result).split(',')[1] })
        reader.readAsDataURL(file)
      })))
      if (alive.current) { const next = [...images, ...encoded]; setImages(next); onImages?.(next); setFailure('') }
    } catch (error) { if (alive.current) setFailure(error.message) }
    finally { reading.current = false; if (alive.current) setReadingFiles(false) }
  }
  const [failure, setFailure] = useState('')
  const input = useRef(null)
  const current = useRef(text); current.current = text
  const update = value => { setText(value); onDraft?.(value) }
  const dictation = useDictation((value, final) => { if (final) update(current.current + value) })
  const query = text.match(/(?:^|\s)@([^\s@]*)$/)?.[1]
  const rows = query === undefined ? [] : mentions.filter(row => row.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
  const send = async event => {
    event.preventDefault()
    if (pending.current || reading.current || !text.trim() && !images.length) return
    pending.current = true
    setSending(true); setFailure('')
    try { await chat.send(text, images.length ? { images: images.filter(file => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mediaType)), files: images.filter(file => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mediaType)) } : included.length ? { attachmentIds: included } : undefined); update(''); updateIncluded([]); setImages([]); onImages?.([]) } catch (error) { setFailure(error.message); onError?.(error) }
    finally { pending.current = false; setSending(false) }
  }
  return h('form', { className: 'bt-scoped-composer', onSubmit: send, 'data-composer-card': '' },
    h('textarea', { ref: input, name: 'text', 'aria-label': t('Message'), value: text, disabled: sending,
      onInput: event => update(event.target.value), onKeyDown: event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) send(event)
      } }),
    allowImages ? h('label', null, h(PaperclipIcon), 'Add files', h('input', { type: 'file', multiple: true, disabled: readingFiles || sending, onChange: upload })) : null,
    images.map((image, index) => h('div', { key: index }, image.name, h('button', { type: 'button', onClick: () => { const next = images.filter((_row, i) => i !== index); setImages(next); onImages?.(next) } }, 'Remove'))),
    attachments.length ? h('fieldset', null, h('legend', null, 'Include registered documents'), attachments.map(row => h('label', { key: row.id },
      h('input', { type: 'checkbox', checked: included.includes(row.id), onChange: event => updateIncluded(event.target.checked ? [...included, row.id] : included.filter(id => id !== row.id)) }), row.name))) : null,
    rows.length ? h('div', { role: 'listbox', 'aria-label': t('Bots') }, rows.map(row => h('button', {
      key: row.id, type: 'button', role: 'option', onClick: () => { update(text.slice(0, text.length - query.length) + row.name + ' '); input.current?.focus() },
    }, row.name))) : null,
    h('button', { type: 'button', 'aria-label': dictation.listening ? t('Stop dictation') : t('Dictate'),
      onClick: () => dictation.listening ? dictation.stop() : dictation.start() }, h(MicIcon)),
    h('button', { type: 'submit', disabled: sending || readingFiles || !text.trim() && !images.length }, t('Send')),
    failure ? h('p', { role: 'alert' }, failure) : null,
    dictation.note ? h('p', { role: 'status' }, dictation.note) : null)
}
