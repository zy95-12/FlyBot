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
