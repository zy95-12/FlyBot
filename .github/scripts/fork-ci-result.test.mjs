import assert from 'node:assert/strict'
import{test}from'node:test'
import{forkCiPassed}from'./fork-ci-result.mjs'
test('basic validates its active job and only accepts deliberately omitted extended jobs',()=>{
 const basic={test:'success',plugins:'skipped',package:'skipped'};assert(forkCiPassed(basic));for(const value of ['failure','cancelled','skipped',''])assert.equal(forkCiPassed({...basic,test:value}),false);assert.equal(forkCiPassed({...basic,package:'cancelled'}),false)
})
test('explicit extended validation requires every extended job to pass',()=>{
 const full={test:'success',plugins:'success',package:'success',extended:true};assert(forkCiPassed(full));for(const key of ['test','plugins','package'])for(const value of ['failure','cancelled','skipped'])assert.equal(forkCiPassed({...full,[key]:value}),false)
})
