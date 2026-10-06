import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createCheckoutCoordinator, CHECKOUT_PROTOCOL as protocol } from '../../src/utils/checkoutCoordinator.mjs'
const copy = x => JSON.parse(JSON.stringify(x))
const plan = {order:{id:'O-test-1',items:[{id:'p1',name:'測試商品',price:30,qty:2}],total:60,subtotal:60,discount:0,manualDiscount:0,balanceUsed:0,paid:100,change:40,payMethod:'cash',payments:[{method:'cash',amount:60}],pointsUsed:0,pointsEarned:0,memberId:null,shiftId:'s1',status:'completed',time:'2026-10-05T04:00:00.000Z'},stockUpdates:[{id:'p1',delta:-2}],memberUpdate:null}
const envelope = () => ({version:1,protocol,plan:copy(plan)})
const receipt = () => ({protocol,success:true,found:true,orderId:plan.order.id,order:copy(plan.order),products:[{id:'p1',stock:8}],member:null})
function fixture(overrides = {}, saved = null) {
 let journal = saved, applied = 0, sends = 0, looks = 0
 const events=[]
 const ports={
  prepare:()=>copy(plan), readPending:()=>copy(journal),
  writePending:value=>{events.push('journal');journal=copy(value)},
  clearPending:id=>{assert.equal(id,journal.plan.order.id);events.push('clear');journal=null},
  persist:async value=>{sends++;events.push('persist');assert.equal(value.order.id,plan.order.id);return receipt()},
  lookup:async id=>{looks++;assert.equal(id,plan.order.id);return receipt()},
  apply:async value=>{applied++;events.push('apply');assert.equal(value.orderId,plan.order.id)},
  onState:state=>events.push(state.phase),...overrides,
 }
 const c=createCheckoutCoordinator(ports)
 return {c,ports,events,get journal(){return journal},get applied(){return applied},get sends(){return sends},get looks(){return looks}}
}
const errorCode = code => error => error.code === code
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
test('acknowledged persistence precedes application and journal clearing',async()=>{
 const f=fixture();f.c.restore();const order=await f.c.submit({})
 assert.equal(order.id,plan.order.id);assert.equal(f.applied,1);assert.equal(f.sends,1)
 assert.ok(f.events.indexOf('journal')<f.events.indexOf('persist'))
 assert.ok(f.events.indexOf('persist')<f.events.indexOf('apply'))
 assert.ok(f.events.indexOf('apply')<f.events.indexOf('clear'))
 assert.equal(f.journal,null);assert.equal(f.c.getState().phase,'idle')
})
test('an unresolved write does not publish success or apply stock state',async()=>{
 const d=deferred(), f=fixture({persist:()=>d.promise});f.c.restore()
 const pending=f.c.submit({});assert.equal(f.applied,0);assert.equal(f.c.getState().phase,'saving')
 d.resolve(receipt());await pending;assert.equal(f.applied,1)
})
test('concurrent submissions are rejected rather than creating another request',async()=>{
 const d=deferred(),f=fixture({persist:()=>d.promise});f.c.restore()
 const first=f.c.submit({});await assert.rejects(f.c.submit({}),errorCode('BUSY'))
 d.resolve(receipt());await first
})
test('validation failure sends nothing and leaves state unchanged',async()=>{
 const f=fixture({prepare:()=>{throw new Error('invalid input')}});f.c.restore()
 await assert.rejects(f.c.submit({}),/invalid input/)
 assert.equal(f.sends,0);assert.equal(f.applied,0);assert.equal(f.journal,null)
})
test('journal write failure prevents database submission',async()=>{
 const f=fixture({writePending:()=>{throw new Error('quota')}});f.c.restore()
 await assert.rejects(f.c.submit({}),/quota/);assert.equal(f.sends,0);assert.equal(f.applied,0)
})
test('explicit rollback confirmation keeps financial UI unapplied',async()=>{
 const f=fixture({persist:async()=>({protocol,success:false,committed:false,orderId:plan.order.id,error:'stock changed'})});f.c.restore()
 await assert.rejects(f.c.submit({}),errorCode('NOT_COMMITTED'))
 assert.equal(f.applied,0);assert.equal(f.journal,null);assert.equal(f.c.getState().phase,'idle')
})
test('transport failure retains identity and blocks a new sale',async()=>{
 const f=fixture({persist:async()=>{throw new Error('IPC interrupted')}});f.c.restore()
 await assert.rejects(f.c.submit({}),errorCode('OUTCOME_UNKNOWN'))
 assert.equal(f.journal.plan.order.id,plan.order.id);assert.equal(f.applied,0)
 await assert.rejects(f.c.submit({}),errorCode('OUTCOME_UNKNOWN'))
})
for (const [name,result] of [
 ['undefined response',undefined],['false result without rollback proof',{protocol,success:false}],
 ['wrong protocol',{...receipt(),protocol:'old'}],['wrong orderId',{...receipt(),orderId:'different'}],
 ['wrong receipt identity',{...receipt(),order:{id:'wrong'}}],['missing touched products',{...receipt(),products:null}],
 ['missing member field',Object.fromEntries(Object.entries(receipt()).filter(([k])=>k!=='member'))],
]) test(`invalid acknowledgement: ${name}`,async()=>{
 const f=fixture({persist:async()=>result});f.c.restore()
 await assert.rejects(f.c.submit({}),errorCode('OUTCOME_UNKNOWN'))
 assert.equal(f.applied,0);assert.ok(f.journal);assert.equal(f.c.getState().phase,'uncertain')
})
test('startup restore finds existing journal and refuses a different new submission',async()=>{
 const f=fixture({},envelope());f.c.restore();assert.equal(f.c.getState().phase,'uncertain')
 await assert.rejects(f.c.submit({}),errorCode('OUTCOME_UNKNOWN'));assert.equal(f.sends,0)
})
test('reconciliation retrieves receipt without issuing a write',async()=>{
 const f=fixture({},envelope());f.c.restore();const result=await f.c.reconcile()
 assert.equal(result.id,plan.order.id);assert.equal(f.sends,0);assert.equal(f.looks,1);assert.equal(f.applied,1);assert.equal(f.journal,null)
})
test('a not-found lookup is not treated as proof that it is safe to collect again',async()=>{
 const f=fixture({lookup:async()=>({protocol,success:true,found:false})},envelope());f.c.restore()
 await assert.rejects(f.c.reconcile(),errorCode('OUTCOME_UNKNOWN'));assert.ok(f.journal);assert.equal(f.applied,0)
})
test('lookup transport error leaves pending identity intact',async()=>{
 const f=fixture({lookup:async()=>{throw new Error('offline')}},envelope());f.c.restore()
 await assert.rejects(f.c.reconcile(),errorCode('OUTCOME_UNKNOWN'));assert.ok(f.journal)
})
test('retry explicitly reuses the stored identity, not a newly prepared cart',async()=>{
 const sent=[];const f=fixture({replayVerified:true,persist:async value=>{sent.push(copy(value));return receipt()},prepare:()=>{throw new Error('must not prepare')}},envelope())
 f.c.restore();await f.c.retry();assert.deepEqual(sent,[plan]);assert.equal(f.applied,1)
})
test('mock idempotent host applies storage once when acknowledgement is lost',async()=>{
 const stored=new Map();let attempts=0,writes=0
 const f=fixture({replayVerified:true,persist:async value=>{
   attempts++;if(!stored.has(value.order.id)){stored.set(value.order.id,receipt());writes++}
   if(attempts===1)throw new Error('ack lost')
   return copy(stored.get(value.order.id))
 }})
 f.c.restore();await assert.rejects(f.c.submit({}),errorCode('OUTCOME_UNKNOWN'))
 await f.c.retry();assert.equal(attempts,2);assert.equal(writes,1);assert.equal(f.applied,1)
})
test('application failure retains journal for reconciliation, not another charge',async()=>{
 const f=fixture({apply:async()=>{throw new Error('renderer failed')}});f.c.restore()
 await assert.rejects(f.c.submit({}),errorCode('OUTCOME_UNKNOWN'));assert.ok(f.journal)
})
test('journal clear failure remains visible as uncertain',async()=>{
 const f=fixture({clearPending:()=>{throw new Error('cannot clear journal')}});f.c.restore()
 await assert.rejects(f.c.submit({}),errorCode('OUTCOME_UNKNOWN'))
 assert.equal(f.applied,1);assert.ok(f.journal);assert.equal(f.c.getState().phase,'uncertain')
})
test('reconciliation and retry cannot race within one coordinator instance',async()=>{
 const d=deferred(),f=fixture({lookup:()=>d.promise},envelope());f.c.restore()
 const lookup=f.c.reconcile();await assert.rejects(f.c.retry(),errorCode('BUSY'))
 d.resolve(receipt());await lookup
})
test('corrupted version is rejected during explicit restore',async()=>{
 const f=fixture({}, {...envelope(),version:2})
 assert.throws(()=>f.c.restore(),errorCode('JOURNAL_INVALID'))
 assert.equal(f.c.getState().phase,'blocked');await assert.rejects(f.c.submit({}),errorCode('BLOCKED'))
})
test('pending access returns a copy and cannot mutate the request identity',()=>{
 const f=fixture({},envelope());f.c.restore();const snapshot=f.c.getPending();snapshot.order.id='mutated'
 assert.equal(f.c.getPending().order.id,plan.order.id)
})
test('idle retry and reconcile are read-only no-ops',async()=>{
 const f=fixture();f.c.restore();assert.equal(await f.c.retry(),null);assert.equal(await f.c.reconcile(),null)
 assert.equal(f.sends,0);assert.equal(f.looks,0)
})
test('required ports are enforced',()=>assert.throws(()=>createCheckoutCoordinator({}),/Missing checkout port/))
