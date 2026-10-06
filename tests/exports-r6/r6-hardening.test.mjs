import { test } from 'vitest'
import assert from 'node:assert/strict'
import {prepareCheckout} from '../../src/utils/checkoutSafety.mjs'
import {createCheckoutCoordinator,validatePending,CHECKOUT_PROTOCOL as protocol} from '../../src/utils/checkoutCoordinator.mjs'
const product={id:'p1',name:'合成商品',stock:10,price:30}
const plan=prepareCheckout({cart:[{...product,qty:2}],products:[product],members:[],activeMember:null,
 pointsRule:{earn:10,redeem:1},birthdayBonus:100,openShift:{id:'s1',status:'open'},payMethod:'cash',paid:100,
 now:new Date('2026-10-05T04:00:00.000Z'),id:'R6-test-order'})
const env=()=>({version:1,protocol,plan:structuredClone({order:plan.order,stockUpdates:plan.stockUpdates,memberUpdate:null})})
const receipt=()=>({protocol,success:true,found:true,orderId:plan.order.id,order:structuredClone(plan.order),products:[{...product,stock:8}],member:null})
function fixture(extra={}){
 let journal=null,applied=0,sends=0
 const ports={prepare:()=>plan,readPending:()=>journal,writePending:v=>{journal=structuredClone(v)},clearPending:()=>{journal=null},
  persist:async()=>{sends++;return receipt()},lookup:async()=>receipt(),apply:()=>{applied++},...extra}
 const c=createCheckoutCoordinator(ports)
 return {c,get journal(){return journal},get applied(){return applied},get sends(){return sends}}
}
for(const [name,change] of [
 ['NaN total',v=>{v.plan.order.total=NaN}],['null total',v=>{v.plan.order.total=null}],
 ['negative paid',v=>{v.plan.order.paid=-100}],['wrong subtotal',v=>{v.plan.order.subtotal=61}],
 ['duplicate items',v=>{v.plan.order.items.push(structuredClone(v.plan.order.items[0]))}],
 ['wrong stock delta',v=>{v.plan.stockUpdates[0].delta=-1}],
 ['unknown product delta',v=>{v.plan.stockUpdates[0].id='unknown'}],
 ['payment mismatch',v=>{v.plan.order.payments[0].amount=59.99}],
 ['wrong change',v=>{v.plan.order.change=41}],['invalid date',v=>{v.plan.order.time='invalid'}],
 ['empty shift',v=>{v.plan.order.shiftId=''}],['member delta without member',v=>{v.plan.memberUpdate={id:'m1',pointsDelta:1}}],
 ['fractional points',v=>{v.plan.order.pointsUsed=0.1}],['Infinity nested',v=>{v.plan.stockUpdates[0].delta=Infinity}],
]) test(`R6 rejects corrupted journal: ${name}`,()=>{const saved=env();change(saved);assert.throws(()=>validatePending(saved))})
test('R6 submit can be passed as an unbound callback and still restore safely',async()=>{
 const f=fixture();const submit=f.c.submit;await submit({});assert.equal(f.applied,1)
})
test('R6 acknowledgment with changed financial amount must not clear journal',async()=>{
 const ack=receipt();ack.order.total=59
 const f=fixture({persist:async()=>ack});f.c.restore();await assert.rejects(f.c.submit({}));assert.equal(f.applied,0);assert.ok(f.journal)
})
test('R6 acknowledgment with missing stock product must not apply',async()=>{
 const ack=receipt();ack.products=[]
 const f=fixture({persist:async()=>ack});f.c.restore();await assert.rejects(f.c.submit({}));assert.equal(f.applied,0)
})
test('R6 negative acknowledgment for a different order is not proof of rollback',async()=>{
 const f=fixture({persist:async()=>({protocol,success:false,committed:false,orderId:'different'})});f.c.restore()
 await assert.rejects(f.c.submit({}));assert.ok(f.journal);assert.equal(f.c.getState().phase,'uncertain')
})
test('R6 changing journal after restore cannot be silently replaced',async()=>{
 let journal=null
 const f=fixture({readPending:()=>journal});f.c.restore();journal=env()
 await assert.rejects(f.c.submit({}));assert.equal(f.sends,0)
})
test('R6 async clear rejection keeps outcome uncertain',async()=>{
 const f=fixture({clearPending:async()=>{throw new Error('cannot clear')}});f.c.restore()
 await assert.rejects(f.c.submit({}));assert.equal(f.c.getState().phase,'uncertain');assert.ok(f.journal)
})
