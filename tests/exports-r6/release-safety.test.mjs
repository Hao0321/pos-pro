// Additional RELEASE REQUIREMENTS. Failing cases are retained deliberately;
// they must be repaired before these draft modules are integrated into the POS.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createCheckoutCoordinator, validatePending, CHECKOUT_PROTOCOL as protocol } from '../../src/utils/checkoutCoordinator.mjs'
import { prepareCheckout } from '../../src/utils/checkoutSafety.mjs'
const {prepareDatabaseCheckout}=createRequire(import.meta.url)('../../electron/checkoutContract.cjs')
const product={id:'p1',name:'測試商品',stock:10,price:30}
function prepared(){return prepareCheckout({cart:[{...product,qty:2}],products:[product],members:[],activeMember:null,
 pointsRule:{earn:10,redeem:1},birthdayBonus:100,openShift:{id:'s1',status:'open'},payMethod:'cash',paid:100,
 now:new Date(2026,9,2,12),id:'O-release-test'})}
const plan=prepared()
const envelope=()=>({version:1,protocol,plan:{order:plan.order,stockUpdates:plan.stockUpdates,memberUpdate:null}})
const receipt=()=>({protocol,success:true,found:true,orderId:plan.order.id,order:plan.order,products:[{...product,stock:8}],member:null})
function ports(extra={}) {return {prepare:prepared,readPending:()=>null,writePending:()=>{},clearPending:()=>{},persist:async()=>receipt(),lookup:async()=>receipt(),apply:()=>{},...extra}}
test('RELEASE: corrupted pending monetary value must be rejected',()=>{
 const saved=envelope();saved.plan={...saved.plan,order:{...saved.plan.order,total:'corrupt'}}
 assert.throws(()=>validatePending(saved))
})
test('RELEASE: submit must not overwrite an existing journal when restore was omitted',async()=>{
 let sends=0
 const c=createCheckoutCoordinator(ports({readPending:envelope,persist:async()=>{sends++;return receipt()}}))
 await assert.rejects(c.submit({}))
 assert.equal(sends,0)
})
for(const field of ['discount','manualDiscount','balanceUsed']) test(`RELEASE: reject NaN ${field} at database contract`,()=>{
 const request={...prepared().order,[field]:NaN}
 const reader={product:()=>product,member:()=>null,shift:()=>({id:'s1',status:'open'}),setting:()=>null}
 assert.throws(()=>prepareDatabaseCheckout(request,reader))
})
test('RELEASE: same-ID retry must remain disabled until native storage replay is verified',async()=>{
 let sends=0
 const c=createCheckoutCoordinator(ports({readPending:envelope,persist:async()=>{sends++;return receipt()}}))
 c.restore()
 await assert.rejects(c.retry())
 assert.equal(sends,0)
})
