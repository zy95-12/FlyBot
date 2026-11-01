import assert from 'node:assert/strict'
import {test} from 'node:test'
import {roleContext,contextHash,ROLE_CONTEXT_LIMIT} from '../src/host/project-role-context.js'
import {assembleRolePolicy,roleExecutionPrompt} from '../src/host/project-role-policy.js'

test('complete pinned policy replaces duplicate previews without losing rules or knowledge', () => {
  const text='Complete public repository rules.\n'.repeat(2000),commit='a'.repeat(40)
  const policy=assembleRolePolicy({role:'developer',commit,sources:[{name:'AGENTS.md',commit,text}],requiredFiles:['AGENTS.md']})
  const repository=[{name:'AGENTS.md',commit,sha256:contextHash(text.trim()),text:text.trim().slice(0,6000),truncated:true}]
  const knowledge=[{id:'fact',text:'Current public facts. '.repeat(2000)}]
  const input={projectId:'p',role:'developer',revision:1,definition:{instructions:'Use the scoped role'},policy,repository,knowledge}
  const result=roleContext(input),data=JSON.parse(result.text.split('<untrusted-role-context>\n')[1].split('\n</untrusted-role-context>')[0])
  assert.equal(data.repository[0].representation,'complete-policy-reference')
  assert.equal(data.repository[0].text,undefined)
  assert.deepEqual(data.knowledge,knowledge)
  assert(result.text.length<=ROLE_CONTEXT_LIMIT)
  const prompt=roleExecutionPrompt('Work',{policy,context:result})
  assert(prompt.includes(policy.text))
  assert.equal(JSON.parse(policy.text.split('<untrusted-repository-policy>\n')[1].split('\n</untrusted-repository-policy>')[0]).sources[0].text,text)
  assert(prompt.includes('Current public facts.'))
  assert.equal(policy.text,assembleRolePolicy({role:'developer',commit,sources:[{name:'AGENTS.md',commit,text}],requiredFiles:['AGENTS.md']}).text)
  assert.throws(()=>roleContext({...input,repository:[{...repository[0],sha256:'wrong'}]}),/exceeds/)
  assert.throws(()=>roleContext({...input,repository:[{...repository[0],commit:'b'.repeat(40)}]}),/exceeds/)
  assert.throws(()=>roleContext({...input,policy:{...policy,text:policy.text+'tampered'}}),/exceeds/)
})

test('explicit verified knowledge checkpoints retain history provenance and newer facts under the same cap', () => {
  const history = Array.from({length: 12}, (_, i) => ({id: `fact-${i}`, text: 'Old verified facts '.repeat(350), createdBy: 'owner', at: i}))
  const checkpoint = {id: 'current', text: 'Current decision: preserve native UI and all permissions.', checkpoint: {version: 'project-knowledge-checkpoint/v1', supersedes: history.map(row => ({id: row.id, sha256: contextHash(JSON.stringify(row))}))}}
  const knowledge = [...history, checkpoint, {id: 'delta', text: 'New frontend failure requires repair.'}]
  const before = structuredClone(knowledge)
  for (const role of ['developer', 'chief']) {
    const input = {projectId: 'p', role, definition: {instructions: 'Keep the role contract'}, knowledge, requirement: {criteria: 'All original acceptance criteria'}}
    const result = roleContext(input)
    const data = JSON.parse(result.text.split('<untrusted-role-context>\n')[1].split('\n</untrusted-role-context>')[0])
    assert.equal(data.knowledge.length, 2)
    assert.equal(data.knowledge[0].text, checkpoint.text)
    assert.equal(data.knowledge[0].checkpoint.sourceCount, 12)
    assert.equal(data.knowledge[0].checkpoint.sourceSha256, contextHash(JSON.stringify(checkpoint.checkpoint.supersedes)))
    assert.deepEqual(data.knowledge[1], knowledge.at(-1))
    assert.equal(data.knowledgeHistory.count, 12)
    assert.equal(data.knowledgeHistory.retained, true)
    assert.equal(data.requirement.criteria, input.requirement.criteria)
    assert.equal(result.sources.knowledge.length, 14)
    assert.ok(result.text.length < ROLE_CONTEXT_LIMIT)
    const tampered = structuredClone(knowledge); tampered[0].text += 'changed'
    assert.throws(() => roleContext({...input, knowledge: tampered}), /exceeds/)
  }
  assert.deepEqual(knowledge, before)
})

test('unknown, duplicate or forward checkpoint references never hide knowledge', () => {
  const old = {id: 'old', text: 'Must remain visible'}
  const ref = {id: old.id, sha256: contextHash(JSON.stringify(old))}
  for (const supersedes of [[{...ref, id: 'foreign'}], [ref, ref], [{...ref, sha256: 'wrong'}], [null], [], 'invalid']) {
    const checkpoint = {id: 'summary', text: 'Summary', checkpoint: {version: 'project-knowledge-checkpoint/v1', supersedes}}
    const result = roleContext({projectId: 'p', role: 'chief', definition: {instructions: ''}, knowledge: [old, checkpoint]})
    assert.ok(result.text.includes('Must remain visible'))
  }
  const forward = {id: 'forward', checkpoint: {version: 'project-knowledge-checkpoint/v1', supersedes: [ref]}}
  assert.ok(roleContext({projectId: 'p', role: 'chief', definition: {instructions: ''}, knowledge: [forward, old]}).text.includes('Must remain visible'))
})
