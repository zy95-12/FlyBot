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
