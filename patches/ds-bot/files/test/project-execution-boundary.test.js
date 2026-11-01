import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { preflightRepository } from '../src/host/project-repository-policy.js'
async function fixture(t) {
  const home=mkdtempSync(join(tmpdir(),'flybot-trust-')),ctx=fakeContext()
  writeFileSync(join(home,'state.json'),JSON.stringify({version:2,mainBotIds:[],bots:{},rooms:{},members:{'owner-1':{id:'owner-1'},maintainer:{id:'maintainer'},member:{id:'member'}},projects:{p:{id:'p',name:'Trusted private project',ownerUserId:'owner-1',repository:'owner/repo',status:'active',roles:{maintainers:['maintainer'],members:['member']}}},tasks:{t:{id:'t',projectId:'p',requesterId:'member',status:'open',title:'Existing Task'}}}))
  const rt=createRuntime(ctx,{home,projectWorkbench:true,projectResources:{local:{type:'local',root:home,capacity:2,allowedProjectOwnerIds:['owner-1'],harnesses:['codex','claude-agent','flybot']}},projectRepositories:{'owner/repo':{path:home,allowedProjectOwnerIds:['owner-1'],allowedPaths:['core/'],testCommand:[process.execPath,'--version'],github:{credential:'gh-cli',configDir:'/operator/project-credential',login:'project-bot'}}},personalGithub:{'owner-1':{p:{credential:'gh-cli',configDir:'/private/owner',login:'owner-gh'}},member:{p:{credential:'gh-cli',configDir:'/private/member',login:'member-gh'}}}})
  await rt.load();t.after(async()=>{await ctx.dispose();rmSync(home,{recursive:true,force:true})})
  return rt
}
const query=(rt,memberId='owner-1',payload={})=>rt.projectEndpoint('project-development',{version:'project-development/v1',kind:'query',projectId:'p',name:'execution.boundary',payload},{memberId})

test('existing dedicated-account resources report honest trust/capability boundaries without allocating Bot containers',async t=>{
  const rt=await fixture(t),view=(await query(rt)).result
  assert.equal(view.profile.id,'trusted-private-single-host/v1')
  assert.equal(view.profile.hostileCodeIsolation,false)
  assert.equal(view.profile.perBotOsIdentityRequired,false)
  assert.equal(view.resources[0].id,'local')
  assert.equal(view.resources[0].type,'local')
  assert.equal(view.preflight.tests,'not-run')
  assert.equal(Object.keys(rt.state.projectResourceLeases??{}).length,0)
  assert.equal(Object.keys(rt.state.projectHarnessWorkers??{}).length,0)
  assert.equal(JSON.stringify(view).includes('/private/owner'),false)
  assert.equal(JSON.stringify(view).includes('/operator/project-credential'),false)
})

test('Owner/Maintainer/Member rights are current, scoped and separate from personal credentials and private data',async t=>{
  const rt=await fixture(t)
  for(const id of ['owner-1','maintainer','member']){
    const view=(await query(rt,id,{taskId:'t',memberId:'owner-1'})).result
    assert.equal(view.permissions.read,true)
    assert.equal(view.permissions.configure,id!=='member')
    assert.equal(view.permissions.accept,id!=='member')
    assert.equal(view.permissions['task-write'],true)
    assert.equal(view.credentials.personal.login,id==='owner-1'?'owner-gh':id==='member'?'member-gh':null)
    assert.equal(view.credentials.fallback,'none')
    assert.equal(view.memory.contentsRead,false)
    assert.equal(view.memory.inheritedIntoPublicContext,false)
    assert.equal(view.delegation.mode,'safe')
  }
  rt.state.projects.p.roles.maintainers=[];rt.state.projects.p.roles.members.push('maintainer')
  assert.equal((await query(rt,'maintainer')).result.permissions.configure,false)
  rt.state.projects.p.roles.members=[]
  await assert.rejects(query(rt,'member'),/denied/)
  await assert.rejects(query(rt,'maintainer'),/denied/)
})

test('safe/watch metadata follows only the current human grant and never elevates their current Project rights',async t=>{
  const rt=await fixture(t),id=rt.projectAgents.privateIdentity('p','member')
  await rt.projectDelegations.mode({projectId:'p',mode:'watch'},{memberId:'member'})
  const watched=(await query(rt,'member')).result
  assert.equal(watched.delegation.mode,'watch');assert.equal(watched.permissions.configure,false)
  assert.equal(watched.delegation.effective,true)
  assert.equal((await query(rt,'owner-1')).result.delegation.mode,'safe')
  await rt.projectDelegations.mode({projectId:'p',mode:'safe'},{memberId:'member'})
  assert.equal((await query(rt,'member')).result.delegation.mode,'safe')
  assert.equal(rt.projectDelegations.forAgent(id),undefined)
})

test('unsupported trust profiles fail resource/admission preflight before work and never claim hostile isolation',async t=>{
  const rt=await fixture(t)
  rt.config.projectExecutionProfile='untrusted-multi-tenant'
  const unsupported=(await query(rt)).result
  assert.equal(unsupported.profile.status,'unsupported')
  assert.equal(unsupported.profile.hostileCodeIsolation,false)
  assert.equal(unsupported.preflight.status,'blocked')
  assert.equal(unsupported.resources.length,0)
  assert.throws(()=>rt.projectResources.setting('p','local'),/trust profile/)
  await assert.rejects(preflightRepository(rt,rt.state.projects.p),/trust profile/)
  await assert.rejects(rt.projectEndpoint('project-development',{version:'project-development/v1',kind:'command',name:'task.run',projectId:'p',requestId:'unsupported-profile',payload:{taskId:'t'}},{memberId:'owner-1'}),/trust profile/)
  assert.equal(Object.keys(rt.state.projectAttempts??{}).length,0)
  rt.config.projectExecutionProfile='trusted-private-single-host/v1'
  assert.equal((await query(rt)).result.profile.defaulted,false)
})

test('cross-Project tasks and revocation during async metadata checks withhold the response',async t=>{
  const rt=await fixture(t)
  rt.state.tasks.other={id:'other',projectId:'foreign'}
  await assert.rejects(query(rt,'owner-1',{taskId:'other'}),/unavailable in this Project/)
  await assert.rejects(rt.projectExecutionBoundary({projectId:'p',taskId:'other'},{memberId:'owner-1'}),/another Project/)
  const original=rt.validateHumanActor
  rt.validateHumanActor=async()=>false
  await assert.rejects(query(rt),/unavailable/)
  let checks=0
  rt.validateHumanActor=async()=>++checks===1
  await assert.rejects(query(rt),/revoked/)
  checks=0;rt.validateHumanActor=async()=>{if(++checks===2)rt.state.projects.p.roles.members=[];return true}
  await assert.rejects(query(rt,'member'),/denied/)
  rt.validateHumanActor=original
})

test('repository/Task changes during metadata reads refuse, and stale watch/configuration is described without granting authority',async t=>{
  const rt=await fixture(t)
  let calls=0
  rt.validateHumanActor=async()=>{if(++calls===2)rt.state.projects.p.repository='owner/changed';return true}
  await assert.rejects(query(rt),/binding changed/)
  rt.state.projects.p.repository='owner/repo';calls=0
  rt.validateHumanActor=async()=>{if(++calls===2)delete rt.state.tasks.t;return true}
  await assert.rejects(query(rt,'owner-1',{taskId:'t'}),/binding changed/)
  rt.validateHumanActor=async()=>true
  await rt.projectDelegations.mode({projectId:'p',mode:'watch'},{memberId:'member'})
  rt.state.members.member.platform={issuer:'platform',subject:'new-human'}
  let view=(await query(rt,'member')).result
  assert.equal(view.delegation.mode,'watch');assert.equal(view.delegation.effective,false)
  assert.match(view.preflight.backgroundPrincipal,/live-session-only/)
  rt.config.controlPlane={principalCheckCommand:['/operator/check']}
  view=(await query(rt,'member')).result
  assert.match(view.preflight.backgroundPrincipal,/configured-checker/)
  assert.equal(view.permissions.configure,false)
})
