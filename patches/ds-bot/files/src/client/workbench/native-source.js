import { createSource } from '../observable-source.js'

// This is a projection over authenticated Project APIs, not a Harness service.
// No arbitrary Session id, endpoint or owner credential can enter this binding.
export function createScopedConversation(api) {
  const state = createSource({ messages: [], live: null, binding: null })
  let binding, generation = 0, disposed = false, pending
  const clear = () => state.set({ messages: [], live: null, binding: null })
  async function refresh() {
    if (disposed || !binding) return
    if (pending) return pending
    const captured = generation, selected = binding
    const request = (async () => {
      try {
        const value = await api.call(selected.personalId ? 'personal-space' : selected.roomId ? 'project-room-read' : 'project-agent-history', selected.personalId ? { operation: 'read', id: selected.personalId, ...(selected.personalPart ? { partId: selected.personalPart } : {}) } : selected)
        if (disposed || captured !== generation) return
        state.set({ ...value, messages: Array.isArray(value.messages) ? value.messages : [], binding: selected })
      } catch (error) {
        if (!disposed && captured === generation) { clear(); throw error }
      }
    })()
    pending = request
    try { return await request } finally { if (pending === request) pending = undefined }
  }
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    async open(value) {
      if (disposed) throw new Error('Conversation is disposed')
      if (value?.personalId && (typeof value.personalId !== 'string' || value.projectId || value.roomId || value.visibility)) throw new Error('Personal and Project bindings must be separate')
      if (!value?.personalId && (!value?.projectId || Boolean(value.roomId) === Boolean(value.visibility) || value.visibility && !['private', 'public'].includes(value.visibility))) throw new Error('Conversation requires a Project and exactly one room or visibility')
      binding = Object.freeze(value.personalId ? { personalId: value.personalId, ...(value.personalPart ? { personalPart: String(value.personalPart) } : {}) } : value.roomId ? { projectId: value.projectId, roomId: value.roomId } : { projectId: value.projectId, visibility: value.visibility })
      generation++; pending = undefined; clear()
      return refresh()
    },
    // Like the native uiConversation target, this handle belongs to one opened
    // Session. A retained composer must never retarget itself after navigation.
    chat() {
      const selected = binding, captured = generation
      return {
        async send(text) {
          if (disposed || !selected || captured !== generation) throw new Error('Conversation handle is retired')
          if (selected.personalPart) throw new Error('Cannot send to a historical conversation part')
          if (typeof text !== 'string' || !text.trim()) throw new Error('Message is empty')
          const endpoint = selected.personalId ? 'personal-space' : selected.roomId ? 'project-room-message' : 'project-agent-message'
          const payload = selected.personalId ? { operation: 'send', id: selected.personalId, text } : { ...selected, text }
          await api.call(endpoint, payload)
          if (!disposed && captured === generation) await refresh()
        },
      }
    },
    refresh,
    dispose() { disposed = true; generation++; binding = undefined; pending = undefined; clear() },
  }
}
