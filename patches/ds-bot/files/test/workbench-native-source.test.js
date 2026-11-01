import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createScopedConversation } from '../src/client/workbench/native-source.js'

test('scoped conversation discards old responses and clears content on revocation', async () => {
  let finish
  let revoked = false
  const calls = []
  const source = createScopedConversation({ async call(endpoint, payload) {
    calls.push({ endpoint, payload })
    if (payload.projectId === 'a') return new Promise(resolve => { finish = resolve })
    if (revoked) throw new Error('Membership revoked')
    return { messages: [{ kind: 'human', text: 'Current member' }] }
  } })
  const old = source.open({ projectId: 'a', visibility: 'private' })
  await source.open({ projectId: 'b', visibility: 'public' })
  finish({ messages: [{ text: 'Other private history' }] }); await old
  assert.equal(source.getSnapshot().messages[0].text, 'Current member')
  revoked = true
  await assert.rejects(source.refresh(), /Membership revoked/)
  assert.deepEqual(source.getSnapshot().messages, [])
  assert.deepEqual(calls.map(row => row.endpoint), Array(3).fill('project-agent-history'))
  source.dispose()
})

test('room and private bindings cannot be ambiguously combined; disposed callbacks stay empty', async () => {
  let finish
  const source = createScopedConversation({ call: async () => new Promise(resolve => { finish = resolve }) })
  await assert.rejects(source.open({ projectId: 'a', roomId: 'r', visibility: 'private' }), /exactly one/)
  const pending = source.open({ projectId: 'a', roomId: 'r' })
  source.dispose()
  finish({ messages: [{ text: 'Late room reply' }] }); await pending
  assert.deepEqual(source.getSnapshot().messages, [])
})


test('conversation sends use only captured scope and retired composers cannot send', async () => {
  const calls = []
  const source = createScopedConversation({ async call(endpoint, payload) {
    calls.push({ endpoint, payload }); return { messages: [] }
  } })
  await source.open({ projectId: 'a', visibility: 'private' })
  const oldChat = source.chat()
  await oldChat.send('hello')
  assert.deepEqual(calls.at(-2), { endpoint: 'project-agent-message', payload: { projectId: 'a', visibility: 'private', text: 'hello' } })
  await source.open({ personalId: 'original-chief', personalPart: 'old-part' })
  await assert.rejects(oldChat.send('stale'), /retired/)
  await assert.rejects(source.chat().send('history edit'), /historical/)
  await source.open({ personalId: 'original-chief' })
  const personal = source.chat()
  await personal.send('original identity')
  assert.deepEqual(calls.at(-2), { endpoint: 'personal-space', payload: { operation: 'send', id: 'original-chief', text: 'original identity' } })
  source.dispose()
  await assert.rejects(personal.send('logged out'), /retired/)
})

test('personal history pages prepend once and survive refresh without crossing bindings', async () => {
  const calls = []
  const source = createScopedConversation({ async call(endpoint, payload) {
    calls.push(payload)
    return payload.beforeSeq === 100
      ? { messages: [{ id: 'old', text: 'Older' }], hasMore: false, beforeSeq: 1 }
      : { messages: [{ id: 'new', text: 'Latest' }], hasMore: true, beforeSeq: 100 }
  } })
  await source.open({ personalId: 'chief', personalPart: 'part-1' })
  await source.loadEarlier()
  assert.deepEqual(calls[1], { operation: 'read', id: 'chief', partId: 'part-1', beforeSeq: 100 })
  assert.deepEqual(source.getSnapshot().messages.map(m => m.id), ['old', 'new'])
  await source.refresh()
  assert.deepEqual(source.getSnapshot().messages.map(m => m.id), ['old', 'new'])
  assert.equal(source.getSnapshot().hasMore, false)
  await source.loadEarlier()
  assert.equal(calls.length, 3)
  await source.open({ personalId: 'other' })
  assert.deepEqual(source.getSnapshot().messages.map(m => m.id), ['new'])
})

test('an earlier personal page cannot leak after navigation or revocation', async () => {
  let finish, revoked = false
  const source = createScopedConversation({ async call(endpoint, payload) {
    if (revoked) throw new Error('Revoked')
    if (payload.beforeSeq) return new Promise(resolve => { finish = resolve })
    return { messages: [{ id: payload.id, text: payload.id }], hasMore: true, beforeSeq: 5 }
  } })
  await source.open({ personalId: 'chief' })
  const page = source.loadEarlier()
  await source.open({ personalId: 'other' })
  finish({ messages: [{ id: 'secret', text: 'Old private page' }], hasMore: false, beforeSeq: 1 })
  await page
  assert.deepEqual(source.getSnapshot().messages.map(m => m.id), ['other'])
  revoked = true
  await assert.rejects(source.loadEarlier(), /Revoked/)
  assert.deepEqual(source.getSnapshot().messages, [])
})
