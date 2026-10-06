import { test } from 'vitest'
import assert from 'node:assert/strict'
import { prepareCheckout, cents, localDate, transactionId } from '../../src/utils/checkoutSafety.mjs'
const product={id:'p1',name:'測試商品',stock:10,price:30,cost:10}
function fixture(extra={}) {
  return {cart:[{...product,qty:2}],products:[product],members:[],activeMember:null,
    pointsRule:{earn:10,redeem:1},birthdayBonus:100,openShift:{id:'s1',status:'open'},
    payMethod:'cash',paid:100,now:new Date(2026,9,2,12,0,0),id:'test-order',...extra}
}
const member={id:'m1',name:'測試會員',points:100,balance:100,totalSpent:50,birthday:'1990-01-01'}
function memberFixture(extra={}) {return fixture({members:[member],activeMember:member,...extra})}
test('cash tendered, net payment and change are distinct',()=>{
 const {order}=prepareCheckout(fixture())
 assert.equal(order.subtotal,60);assert.equal(order.total,60)
 assert.equal(order.paid,100);assert.equal(order.change,40)
 assert.equal(order.payments[0].amount,60);assert.equal(order.pointsEarned,0)
})
test('member discounts, balance and deltas remain balanced',()=>{
 const r=prepareCheckout(memberFixture({pointsUsed:10,opts:{manualDiscountAmt:5,balanceUsed:20}}))
 assert.equal(r.order.total,25);assert.equal(r.memberUpdate.pointsDelta,-8)
 assert.equal(r.memberUpdate.balanceDelta,-20);assert.equal(r.memberUpdate.spentDelta,25)
 assert.equal(r.order.total+r.order.discount+r.order.balanceUsed+r.order.manualDiscount,r.order.subtotal)
})
test('card payment does not depend on stale cash input',()=>{
 const {order}=prepareCheckout(fixture({payMethod:'card',paid:0}))
 assert.equal(order.paid,60);assert.equal(order.change,0)
})
test('mixed tender totals are exact',()=>{
 const {order}=prepareCheckout(fixture({payMethod:'mixed',opts:{payments:[{method:'cash',amount:10},{method:'card',amount:50}]}}))
 assert.equal(order.payMethod,'mixed');assert.equal(order.paid,60);assert.equal(order.change,0)
})
test('duplicate payment methods are combined',()=>{
 const {order}=prepareCheckout(fixture({payMethod:'mixed',opts:{payments:[{method:'cash',amount:20},{method:'cash',amount:40}]}}))
 assert.deepEqual(order.payments,[{method:'cash',amount:60}]);assert.equal(order.payMethod,'cash')
})
test('zero-total sale can use an empty split list',()=>{
 const {order}=prepareCheckout(fixture({opts:{manualDiscountAmt:60,payments:[]}}))
 assert.equal(order.total,0);assert.equal(order.payments[0].amount,0)
})
for (const [name,extra] of [
 ['empty cart',{cart:[]}],['missing open shift',{openShift:null}],['closed shift',{openShift:{id:'s1',status:'closed'}}],
 ['insufficient cash',{paid:59}],['negative cash',{paid:-1}],['infinite cash',{paid:Infinity}],
 ['over discount',{opts:{manualDiscountAmt:61}}],['negative discount',{opts:{manualDiscountAmt:-1}}],
 ['points without member',{pointsUsed:1}],['wallet without member',{opts:{balanceUsed:1}}],
 ['wrong split sum',{opts:{payments:[{method:'cash',amount:59}]}}],
 ['negative split amount',{opts:{payments:[{method:'cash',amount:-1},{method:'card',amount:61}]}}],
 ['unknown method',{payMethod:'unknown'}],['zero points rate',{pointsRule:{earn:0,redeem:1}}],
 ['fractional bonus',{birthdayBonus:0.5}],['negative bonus',{birthdayBonus:-1}],
]) test('reject '+name,()=>assert.throws(()=>prepareCheckout(fixture(extra))))
for (const qty of [0,-1,NaN,Infinity,'2',0.0001,11])
 test('reject invalid quantity '+String(qty),()=>assert.throws(()=>prepareCheckout(fixture({cart:[{...product,qty}]}))))
for (const price of [-1,NaN,Infinity,'30'])
 test('reject invalid price '+String(price),()=>assert.throws(()=>prepareCheckout(fixture({cart:[{...product,qty:2,price}]}))))
test('reject duplicate product IDs',()=>assert.throws(()=>prepareCheckout(fixture({cart:[{...product,qty:1},{...product,qty:1}]}))))
test('reject deleted product',()=>assert.throws(()=>prepareCheckout(fixture({products:[]}))))
test('reject deleted member',()=>assert.throws(()=>prepareCheckout(memberFixture({members:[]}))))
test('check current member points, not the selected stale object',()=>assert.throws(()=>prepareCheckout(memberFixture({members:[{...member,points:1}],pointsUsed:10}))))
test('check current member wallet',()=>assert.throws(()=>prepareCheckout(memberFixture({members:[{...member,balance:1}],opts:{balanceUsed:10}}))))
test('fractional redemption points are rejected',()=>assert.throws(()=>prepareCheckout(memberFixture({pointsUsed:0.5}))))
test('zero birthday bonus is supported',()=>{
 const born={...member,birthday:'1990-10-01'}
 const r=prepareCheckout(memberFixture({members:[born],activeMember:born,birthdayBonus:0}))
 assert.equal(r.order.pointsEarned,6);assert.equal(r.memberUpdate.lastBirthdayBonus,undefined)
})
test('birthday bonus records local calendar date once',()=>{
 const born={...member,birthday:'1990-10-01'}
 const first=prepareCheckout(memberFixture({members:[born],activeMember:born}))
 assert.equal(first.order.pointsEarned,106);assert.equal(first.memberUpdate.lastBirthdayBonus,'2026-10-02')
 const updated={...born,lastBirthdayBonus:first.memberUpdate.lastBirthdayBonus}
 const second=prepareCheckout(memberFixture({members:[updated],activeMember:born}))
 assert.equal(second.order.pointsEarned,6)
})
test('weighted quantities and cent rounding',()=>{
 const r=prepareCheckout(fixture({cart:[{...product,price:10,qty:0.333}]}))
 assert.equal(r.order.subtotal,3.33);assert.equal(r.stockUpdates[0].delta,-0.333)
 assert.equal(cents(1.005),101)
})
test('pure preparation does not mutate the provided state',()=>{
 const f=memberFixture();const before=JSON.stringify(f)
 prepareCheckout(f);assert.equal(JSON.stringify(f),before)
})
test('IDs vary and local date format is stable',()=>{
 assert.notEqual(transactionId(),transactionId());assert.equal(localDate(new Date(2026,9,2)),'2026-10-02')
})
