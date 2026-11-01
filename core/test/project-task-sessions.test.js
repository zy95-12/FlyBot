import assert from 'node:assert/strict'
import {test} from 'node:test'
import {taskSession,taskSessionId,backendBindingKey,resumableBinding,confirmedWorkerExit} from '../src/host/project-task-sessions.js'

test('Task-role identity persists across Attempts and separates projects, tasks and roles', () => {
  const state={tasks:{t:{projectId:'p'},t2:{projectId:'p'}}}
  const session={projectId:'p',taskId:'t',role:'developer'}
  const record=taskSession(state,session)
  assert.equal(taskSession(state,{...session,attemptId:'new'}),record)
  assert.notEqual(taskSession(state,{...session,role:'reviewer'}).id,record.id)
  assert.notEqual(taskSession(state,{...session,taskId:'t2'}).id,record.id)
  assert.notEqual(taskSessionId('other','t','developer'),record.id)
  assert.throws(()=>taskSession(state,{...session,projectId:'other'}),/scope/)
  assert.throws(()=>taskSession(state,{...session,role:'chief'}),/scope/)
  record.role='reviewer'
  assert.throws(()=>taskSession(state,session),/identity/)
})

test('SDK bindings rotate on cwd, principal, resource, profile, model or persona changes', () => {
  const input={harness:'codex',resourceId:'r',principalId:'owner',cwd:'/task',model:'model',profile:{home:'/home',configDir:'/config'},definition:'persona'}
  const key=backendBindingKey(input)
  assert.equal(backendBindingKey(structuredClone(input)),key)
  for(const field of ['harness','resourceId','principalId','cwd','model','definition']) assert.notEqual(backendBindingKey({...input,[field]:'changed'}),key)
  for(const field of ['home','configDir','baseUrl']) assert.notEqual(backendBindingKey({...input,profile:{...input.profile,[field]:'changed'}}),key)
  assert.equal(resumableBinding({}, {bindings:[]},key),null)
})

test('resumption requires same-scope backend identity and confirmed worker and lease exit', () => {
  const record={id:'logical',projectId:'p',taskId:'t',role:'developer',bindings:[{key:'key',workerId:'w',sessionId:'thread'}]}
  const original={projectHarnessWorkers:{w:{projectId:'p',taskId:'t',role:'developer',logicalSessionId:'logical',bindingKey:'key',leaseId:'l',resourceId:'r',generation:2,status:'released',backendSessionId:'thread',releaseProof:{kind:'sdk-stop-ack-and-process-exit',generation:2}}},projectResourceLeases:{l:{projectId:'p',resourceId:'r',generation:2,status:'released'}}}
  assert.equal(resumableBinding(original,record,'key').sessionId,'thread')
  assert.equal(resumableBinding(original,record,'different'),null)
  for(const [target,key,value] of [['worker','projectId','foreign'],['worker','taskId','other'],['worker','role','reviewer'],['worker','logicalSessionId','other'],['worker','bindingKey','other'],['worker','status','unreachable'],['worker','backendSessionId','foreign'],['worker','releaseProof',null],['lease','status','reserved'],['lease','generation',3],['lease','projectId','other'],['lease','resourceId','other']]) {
    const state=structuredClone(original)
    ;(target==='worker'?state.projectHarnessWorkers.w:state.projectResourceLeases.l)[key]=value
    assert.throws(()=>resumableBinding(state,record,'key'),/unconfirmed/)
  }
  assert.throws(()=>resumableBinding({},record,'key'),/unconfirmed/)
})


test('supervisor-confirmed prior invocation permits same Task-role resumption with exact lease proof', () => {
  const proof={kind:'systemd-prior-invocation-exited',previousInvocationId:'a'.repeat(32),at:123}
  const record={id:'logical',projectId:'p',taskId:'t',role:'developer',bindings:[{key:'key',workerId:'w',sessionId:'thread'}]}
  const original={projectHarnessWorkers:{w:{id:'w',projectId:'p',taskId:'t',attemptId:'a',role:'developer',logicalSessionId:'logical',bindingKey:'key',leaseId:'l',resourceId:'r',generation:2,status:'released',backendSessionId:'thread',releaseProof:proof}},projectResourceLeases:{l:{id:'l',projectId:'p',attemptId:'a',role:'developer',resourceId:'r',generation:2,status:'released',worker:{kind:'sdk',handle:'w'},processScope:{kind:'systemd-control-group',killMode:'control-group',invocationId:'a'.repeat(32)},releaseProof:proof}}}
  assert.equal(resumableBinding(original,record,'key').sessionId,'thread')
  const mutations=[
    s=>{s.projectResourceLeases.l.releaseProof=null},
    s=>{s.projectResourceLeases.l.releaseProof.previousInvocationId='b'.repeat(32)},
    s=>{s.projectResourceLeases.l.processScope.invocationId='b'.repeat(32)},
    s=>{s.projectResourceLeases.l.processScope.kind='unmanaged-process'},
    s=>{s.projectResourceLeases.l.processScope.killMode='process'},
    s=>{s.projectResourceLeases.l.worker.handle='other'},
    s=>{s.projectResourceLeases.l.worker.kind='native'},
    s=>{s.projectResourceLeases.l.attemptId='other'},
    s=>{s.projectResourceLeases.l.role='reviewer'},
    s=>{s.projectResourceLeases.l.generation=3},
    s=>{s.projectResourceLeases.l.status='unreachable'},
    s=>{s.projectHarnessWorkers.w.releaseProof={...proof,previousInvocationId:''}},
    s=>{s.projectHarnessWorkers.w.status='unreachable'},
  ]
  for(const mutate of mutations){const s=JSON.parse(JSON.stringify(original));mutate(s);assert.throws(()=>resumableBinding(s,record,'key'),/unconfirmed/)}
})


test('exit proof guards reject missing workers, unconfirmed generations and unbound supervisor claims', () => {
  assert.equal(confirmedWorkerExit({}, null), false)
  assert.equal(confirmedWorkerExit({}, {status:'released',generation:2}), false)
  assert.equal(confirmedWorkerExit({}, {status:'released',releaseProof:{kind:'sdk-stop-ack-and-process-exit'}}), false)
  assert.equal(confirmedWorkerExit({}, {status:'released',generation:0}), false)
  assert.equal(confirmedWorkerExit({}, {status:'released',generation:2,releaseProof:{kind:'sdk-stop-ack-and-process-exit',generation:1}}), false)
  assert.equal(confirmedWorkerExit({}, {status:'released',generation:2,releaseProof:{kind:'systemd-prior-invocation-exited'}}), false)
  assert.equal(confirmedWorkerExit({}, {status:'released',generation:2,leaseId:'absent',releaseProof:{kind:'systemd-prior-invocation-exited',previousInvocationId:'a'.repeat(32)}}), false)
})

test('late callback failure cannot erase a fully fenced SDK stop and lease exit proof', () => {
  const proof={kind:'sdk-stop-ack-and-process-exit',workerId:'w',generation:2,at:123}
  const worker={id:'w',projectId:'p',taskId:'t',attemptId:'a',role:'chief',resourceId:'r',leaseId:'l',generation:2,status:'failed',releasedAt:123,exit:{code:0,signal:null},releaseProof:proof}
  const lease={projectId:'p',attemptId:'a',role:'chief',resourceId:'r',generation:2,status:'released',worker:{kind:'sdk',handle:'w'},releaseProof:proof}
  const state={projectResourceLeases:{l:lease}}
  assert.equal(confirmedWorkerExit(state,worker),true)
  for(const mutate of [w=>{w.releaseProof=null},w=>{w.releaseProof.workerId='other'},w=>{w.releaseProof.generation=3},w=>{w.exit.code=null},w=>{w.status='unreachable'},w=>{w.releasedAt=null},w=>{w.attemptId='other'}]) {
    const w=structuredClone(worker);mutate(w);assert.equal(confirmedWorkerExit(state,w),false)
  }
  for(const mutate of [l=>{l.status='unreachable'},l=>{l.releaseProof=null},l=>{l.worker.handle='other'},l=>{l.generation=3},l=>{l.role='developer'}]) {
    const l=structuredClone(lease);mutate(l);assert.equal(confirmedWorkerExit({projectResourceLeases:{l}},worker),false)
  }
})
