import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { prepareCheckout, cents } from '../../src/utils/checkoutSafety.mjs'
const require=createRequire(import.meta.url)
const {prepareDatabaseCheckout,signature,PROTOCOL}=require('../../electron/checkoutContract.cjs')
const mirror=require('../../electron/checkoutSafety.cjs')
const p={id:'p1',name:'測試商品',price:30,stock:10}
const m={id:'m1',name:'測試會員',points:100,balance:100,totalSpent:50,birthday:'1990-01-01'}
const copy=x=>JSON.parse(JSON.stringify(x))
function fixture(extra={}) {
 const input={cart:[{...p,qty:2}],products:[p],members:[],activeMember:null,
  pointsRule:{earn:10,redeem:1},birthdayBonus:100,openShift:{id:'s1',status:'open'},
  payMethod:'cash',paid:100,now:new Date(2026,9,2,12),id:'O-contract-1',...extra}
 const prepared=prepareCheckout(input)
 const reader={product:id=>input.products.find(p=>p.id===id),member:id=>input.members.find(m=>m.id===id),
  shift:id=>id===input.openShift.id ? input.openShift : null,setting:()=>null}
 return {input,request:copy(prepared.order),reader,prepared}
}
test('contract protocol version is explicit',()=>assert.equal(PROTOCOL,'pos-checkout-v5'))
test('valid cash request recalculates matching totals and stock delta',()=>{
 const f=fixture(),out=prepareDatabaseCheckout(f.request,f.reader)
 assert.deepEqual(out.order,f.prepared.order);assert.deepEqual(out.stockUpdates,[{id:'p1',delta:-2}])
})
test('valid card request does not use a stale cash tender',()=>{
 const f=fixture({payMethod:'card',paid:0});assert.equal(prepareDatabaseCheckout(f.request,f.reader).order.paid,60)
})
test('mixed tender is revalidated against exact cents',()=>{
 const f=fixture({payMethod:'mixed',opts:{payments:[{method:'cash',amount:20},{method:'card',amount:40}]}})
 assert.equal(prepareDatabaseCheckout(f.request,f.reader).order.payMethod,'mixed')
})
test('member deltas are recalculated from reader values',()=>{
 const f=fixture({members:[m],activeMember:m,pointsUsed:10,opts:{balanceUsed:20,manualDiscountAmt:5}})
 const out=prepareDatabaseCheckout(f.request,f.reader)
 assert.equal(out.memberUpdate.pointsDelta,-8);assert.equal(out.memberUpdate.balanceDelta,-20)
})
for (const [name,change] of [
 ['unknown product',f=>{f.reader.product=()=>null}],['insufficient current stock',f=>{f.reader.product=()=>({...p,stock:1})}],
 ['closed shift',f=>{f.reader.shift=()=>({id:'s1',status:'closed'})}],['missing shift',f=>{f.reader.shift=()=>null}],
 ['customer order',f=>{f.request.source='customer'}],['refund as sale',f=>{f.request.refundOf='O-old'}],
 ['pending order',f=>{f.request.status='pending'}],['changed total',f=>{f.request.total=1}],
 ['changed points earned',f=>{f.request.pointsEarned=50}],['negative quantity',f=>{f.request.items[0].qty=-2}],
 ['duplicate items',f=>{f.request.items.push(copy(f.request.items[0]))}],['infinite item price',f=>{f.request.items[0].price=Infinity}],
 ['string total',f=>{f.request.total='60'}],['malformed time',f=>{f.request.time='not a date'}],
 ['wrong paid amount',f=>{f.request.paid=1}],['wrong change',f=>{f.request.change=0}],
 ['wrong payment amount',f=>{f.request.payments[0].amount=50}],['unknown payment method',f=>{f.request.payMethod='other'}],
 ['missing id',f=>{f.request.id=''}],['long id',f=>{f.request.id='x'.repeat(129)}],
]) test(`reject ${name}`,()=>{const f=fixture();change(f);assert.throws(()=>prepareDatabaseCheckout(f.request,f.reader))})
test('current member points are used rather than caller snapshot',()=>{
 const f=fixture({members:[m],activeMember:m,pointsUsed:10});f.reader.member=()=>({...m,points:5})
 assert.throws(()=>prepareDatabaseCheckout(f.request,f.reader),/點數不足/)
})
test('current member balance is used rather than caller snapshot',()=>{
 const f=fixture({members:[m],activeMember:m,opts:{balanceUsed:20}});f.reader.member=()=>({...m,balance:5})
 assert.throws(()=>prepareDatabaseCheckout(f.request,f.reader),/儲值不足/)
})
test('a deleted selected member is rejected',()=>{
 const f=fixture({members:[m],activeMember:m});f.reader.member=()=>null
 assert.throws(()=>prepareDatabaseCheckout(f.request,f.reader),/已不存在/)
})
test('changed earn rule requires a new quote, not silent changed points',()=>{
 const f=fixture({members:[m],activeMember:m});f.reader.setting=k=>k==='pointsEarnRate'?'20':null
 assert.throws(()=>prepareDatabaseCheckout(f.request,f.reader),/不一致/)
})
test('zero birthday bonus is supported by persisted setting adapter',()=>{
 const mm={...m,birthday:'1990-10-01'};const f=fixture({members:[mm],activeMember:mm,birthdayBonus:0})
 f.reader.setting=k=>k==='birthdayBonus'?'0':null
 assert.equal(prepareDatabaseCheckout(f.request,f.reader).order.pointsEarned,6)
})
test('signature is independent of item ordering',()=>{
 const p2={id:'p2',name:'商品二',price:10,stock:5};const f=fixture({cart:[{...p,qty:2},{...p2,qty:1}],products:[p,p2]})
 const reverse=copy(f.request);reverse.items.reverse();assert.equal(signature(reverse),signature(f.request))
})
test('signature is independent of payment ordering',()=>{
 const f=fixture({payMethod:'mixed',opts:{payments:[{method:'cash',amount:20},{method:'card',amount:40}]}})
 const reverse=copy(f.request);reverse.payments.reverse();assert.equal(signature(reverse),signature(f.request))
})
test('signature distinguishes different amounts under the same identity',()=>{
 const f=fixture();const altered=copy(f.request);altered.total=59
 assert.notEqual(signature(altered),signature(f.request))
})
test('core snapshot excludes embedded product images from pending checkout payload',()=>{
 const f=fixture({cart:[{...p,qty:2,imageUrl:'data:image/png;base64,NOT_REAL',note:'unrelated'}]})
 assert.equal('imageUrl' in f.request.items[0],false);assert.equal('note' in f.request.items[0],false)
})
test('contract processing does not mutate request or reader fixtures',()=>{
 const f=fixture(),before=JSON.stringify(f.request);prepareDatabaseCheckout(f.request,f.reader)
 assert.equal(JSON.stringify(f.request),before);assert.equal(p.stock,10)
})
for (const value of [1.005,10.075,0.105,0,999999.995]) test(`cent rounding parity ${value}`,()=>{
 assert.equal(cents(value),Math.round(value*100+1e-7));assert.equal(mirror.cents(value),cents(value))
})
test('generated CommonJS mirror matches ESM source byte-for-byte',()=>{
 const source=readFileSync(new URL('../../src/utils/checkoutSafety.mjs',import.meta.url),'utf8')
 const names=[...source.matchAll(/^export function (\w+)/gm)].map(m=>m[1])
 const expected='// Generated from src/utils/checkoutSafety.mjs; do not edit independently.\n'+source.replace(/^export /gm,'')+'\nmodule.exports = { '+names.join(', ')+' }\n'
 assert.equal(readFileSync(new URL('../../electron/checkoutSafety.cjs',import.meta.url),'utf8'),expected)
})
