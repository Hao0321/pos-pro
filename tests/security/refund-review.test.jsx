// @vitest-environment jsdom
import React from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {render,fireEvent,cleanup,waitFor} from '@testing-library/react'
import {createRequire} from 'node:module'
import fixture from '../fixtures/refund-review-native-v1.json'
import RefundModal from '../../src/components/RefundModal'
import {prepareRefund} from '../../src/utils/refundSafety.mjs'
import {makeRefundPreview,verifyRefundReview,assertReviewedRefundResult} from '../../electron/refundReview.mjs'
import {bookToBrowser} from '../../electron/recoveryRules.mjs'
import {RECORD_KEY,readRecords} from '../../src/utils/browserStorage'
import {getBrowserRefundContext,previewBrowserRefund} from '../../src/utils/browserRefundReview'
import {commitBrowserRefund} from '../../src/utils/browserSales'
import {executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'
import {refundableOrders} from '../../src/pages/RefundPage'
import {parseRefundQuantity,refundDraftKey,saveRefundDraft,readRefundDraft} from '../../src/utils/refundDraft'
const native=createRequire(import.meta.url)('../../electron/refundSafety.cjs')
const order=fixture.book.orders.find(row=>row.id==='mixed-sale')
beforeEach(()=>{localStorage.clear();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name,action)=>action()}})})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();delete window.electronAPI})
it('retains a typed fractional return quantity instead of silently truncating it',async()=>{
  render(<RefundModal order={order} session={fixture.owner} priorRefunds={[]} onClose={()=>{}} onRefund={async()=>true} loadContext={async()=>({storeId:'refund-review-store',epoch:'fixture-epoch',openShift:{id:'shift',status:'open'}})}/>)
  const field=document.querySelector('[data-refund-qty="p"]')||document.querySelector('input[type=number]')
  await waitFor(()=>expect(field.disabled).toBe(false))
  fireEvent.change(field,{target:{value:'0.333'}})
  expect(field.value).toBe('0.333')
})
const selection=()=>{const value=structuredClone(fixture.request);delete value.id;delete value.time;return value}
function seed(active=true){
  const book=structuredClone(fixture.book)
  if(!active){book.stockCostEntries=[];book.stockCostOperations=[];book.settings=book.settings.filter(row=>!['stockCostBookHead','stockCostVersionFence'].includes(row.key))}
  book.settings=book.settings.map(row=>({...row,value:['stockCostVersionFence','stockCostBookHead'].includes(row.key)?row.value:JSON.stringify(row.value)}))
  localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:book.stockCostEntries[0]?.input.epoch||'reference-epoch',data:bookToBrowser(book)}))
}
const source=()=>({storeId:'review',epoch:'epoch',orders:[order],products:fixture.book.products,members:fixture.book.members,shifts:fixture.book.shifts,restaurantEntries:[],now:Date.now()})
it.each(['-1','0.0001','1e0','NaN','Infinity','1.2.3',' 1','4'])('preserves and rejects invalid quantity %s',raw=>{
  expect(()=>parseRefundQuantity(raw,3000)).toThrow()
})
it('supports plain fractional zero and exact thousandths without clamping',()=>{
  expect(()=>parseRefundQuantity('.333',3000)).toThrow()
  expect(parseRefundQuantity('0.333',3000)).toBe(.333)
  expect(parseRefundQuantity('0.000',3000)).toBe(0)
})
it('closes every cent and point over fractional partial refunds',()=>{
  const prior=[];let member=structuredClone(fixture.book.members[0])
  for(const [index,qty]of [.333,.667,1,1].entries()){
    const result=prepareRefund(order,prior,{...fixture.request,id:'step-'+index,items:[{id:'p',qty}]},member)
    prior.push(result.order);member=result.member
  }
  for(const key of ['total','balanceUsed','discount','manualDiscount','pointsUsed','pointsEarned'])expect(Math.round(prior.reduce((sum,row)=>sum-row[key],0)*100)).toBe(Math.round(order[key]*100))
  expect(prior.at(-1).fullRefund).toBe(true)
  expect(member.balance).toBe(50)
})
it('preserves an old half-cent refund and compensates only in the final return',()=>{
  const old=prepareRefund(fixture.half.order,[],fixture.half.request,null).order
  old.total=-.14;old.paid=-.14;old.manualDiscount=-.14;old.subtotal=-.28;old.payments=[{method:'cash',amount:-.14}]
  const saved=JSON.stringify(old),next=prepareRefund(fixture.half.order,[old],{...fixture.half.request,id:'tail',items:[{id:'p',qty:.71}]},null)
  expect(next.order.total).toBe(-.36);expect(JSON.stringify(old)).toBe(saved)
})
it('rejects stale, expired, changed-store and surplus review fields',()=>{
  const data=source(),preview=makeRefundPreview(selection(),data),request={...fixture.request,review:preview.review}
  expect(verifyRefundReview(request,data)).toBeTruthy()
  expect(()=>verifyRefundReview(request,{...data,now:data.now+300001})).toThrow(/過期/)
  expect(()=>verifyRefundReview(request,{...data,epoch:'restored'})).toThrow(/還原/)
  expect(()=>verifyRefundReview({...request,review:{...request.review,role:'owner'}},data)).toThrow(/欄位/)
  expect(()=>verifyRefundReview(request,{...data,members:data.members.map(row=>({...row,points:row.points+1}))})).toThrow(/更新/)
})
it('uses a live owner and preserves the same committed browser refund through lost reply and expiry',async()=>{
  seed();await getBrowserRefundContext(fixture.owner)
  const preview=await previewBrowserRefund(selection(),fixture.owner),input={...preview.input,review:preview.review}
  let actual
  await expect(executeFinancial('refund',input,async request=>{actual=await commitBrowserRefund(request,fixture.owner);return {...actual,order:{...actual.order,total:-99}}})).rejects.toThrow(/金額/)
  const pending=readPendingFinancial(),raw=localStorage.getItem(RECORD_KEY)
  expect(actual.success,actual.error).toBe(true);expect(pending.request.id).toBe(actual.order.id)
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(Date.now()+600001))
  const again=await executeFinancial('refund',input,request=>commitBrowserRefund(request,fixture.owner))
  expect(again.order.id).toBe(pending.request.id);expect(readPendingFinancial()).toBeNull();expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
  expect(again.order.total).toBe(-7.28);expect(again.order.balanceUsed).toBe(-2.36)
  expect(()=>assertReviewedRefundResult(pending.request,{...again,costReceipt:undefined})).toThrow(/成本/)
  await expect(previewBrowserRefund(selection(),{...fixture.owner,username:'forged'})).rejects.toThrow()
})
it('shows the authority amount and submits only the reviewed selection',async()=>{
  const data=source(),ctx={storeId:data.storeId,epoch:data.epoch,openShift:{id:'shift',status:'open'}},submit=vi.fn(async()=>true)
  render(<RefundModal order={order} session={fixture.owner} onClose={()=>{}} onRefund={submit} loadContext={async()=>ctx} requestPreview={async input=>makeRefundPreview(input,data)}/>)
  const field=document.querySelector('[data-refund-qty="p"]');await waitFor(()=>expect(field.disabled).toBe(false));fireEvent.change(field,{target:{value:'1'}})
  fireEvent.click(document.querySelector('.refund-primary'));await waitFor(()=>expect(document.querySelector('[data-refund-summary] strong')?.textContent).toContain('9.64'))
  expect(submit).not.toHaveBeenCalled();fireEvent.click(document.querySelector('input[type=checkbox]'));fireEvent.click(document.querySelector('.refund-primary'))
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce());expect(submit.mock.calls[0][2].review.summary.cashCents).toBe(333)
})
it('finds walk-in receipts beyond the first page and isolates drafts across account/store',()=>{
  const rows=Array.from({length:80},(_,i)=>({...order,id:'receipt-'+i,memberId:null}))
  expect(refundableOrders(rows,'receipt-79')).toHaveLength(1)
  const a=refundDraftKey({storeId:'a'},fixture.owner,order.id),b=refundDraftKey({storeId:'b'},fixture.owner,order.id)
  saveRefundDraft(a,{quantities:{p:'0.333'},reason:'',preview:null});expect(readRefundDraft(a).value.quantities.p).toBe('0.333');expect(readRefundDraft(b).value).toBeNull()
})
it('keeps raw draft values after a quota failure and retries saving those same values',async()=>{
  let full=true;const write=Storage.prototype.setItem
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(full&&key.startsWith('pos_refund_draft_v1:'))throw Error('quota');return write.call(this,key,value)})
  const ctx={storeId:'quota',epoch:'epoch',openShift:{id:'shift',status:'open'}}
  render(<RefundModal order={order} session={fixture.owner} onClose={()=>{}} onRefund={async()=>true} loadContext={async()=>ctx}/>)
  const field=document.querySelector('[data-refund-qty=p]');await waitFor(()=>expect(field.disabled).toBe(false));fireEvent.change(field,{target:{value:'0.333'}})
  await waitFor(()=>expect(document.body.textContent).toContain('退貨草稿尚未保存'))
  full=false;fireEvent.click([...document.querySelectorAll('button')].find(row=>row.textContent==='重試保存草稿'))
  await waitFor(()=>expect(readRefundDraft(refundDraftKey(ctx,fixture.owner,order.id)).value.quantities.p).toBe('0.333'))
  expect(field.value).toBe('0.333')
})
it('keeps corrupt draft bytes instead of overwriting them',async()=>{
  const ctx={storeId:'corrupt',epoch:'epoch',openShift:{id:'shift',status:'open'}},key=refundDraftKey(ctx,fixture.owner,order.id),raw='{broken raw draft'
  localStorage.setItem(key,raw)
  render(<RefundModal order={order} session={fixture.owner} onClose={()=>{}} onRefund={async()=>true} loadContext={async()=>ctx}/>)
  await waitFor(()=>expect(document.body.textContent).toContain('退貨草稿需要核對'));expect(localStorage.getItem(key)).toBe(raw);expect(document.querySelector('[data-refund-qty=p]').disabled).toBe(true)
})
it('does not change the original compatibility signature for a request without review',()=>{
  const expected=JSON.stringify({refundOf:fixture.request.refundOf,items:fixture.request.items,reason:fixture.request.reason,cashier:fixture.request.cashier,shiftId:fixture.request.shiftId})
  expect(native.refundSignature(fixture.request)).toBe(expected)
})
it('keeps the full fractional weight until the final cent allocation',()=>{
  const original={...fixture.half.order,items:[{...fixture.half.order.items[0],price:.03}],subtotal:.03,total:.02,paid:.02,manualDiscount:.01,payments:[{method:'cash',amount:.02}]}
  expect(prepareRefund(original,[],{...fixture.half.request,items:[{id:'p',qty:.24}]},null).order.total).toBe(-0)
})
it('never takes money back from one tender while allocating a later partial refund',()=>{
  const original={...fixture.half.order,total:.03,paid:.03,manualDiscount:.97,payMethod:'mixed',payments:[{method:'cash',amount:.02},{method:'card',amount:.01}]}
  const first=prepareRefund(original,[],{...fixture.half.request,items:[{id:'p',qty:.5}]},null).order
  const second=prepareRefund(original,[first],{...fixture.half.request,id:'later',items:[{id:'p',qty:.25}]},null).order
  expect(second.total).toBe(-0);expect(second.payments.every(row=>row.amount===0)).toBe(true)
})
it('reads back a reference-browser refund after storage throws following persistence',async()=>{
  seed(false);await getBrowserRefundContext(fixture.owner);const preview=await previewBrowserRefund(selection(),fixture.owner),write=Storage.prototype.setItem;let dropped=false
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){write.call(this,key,value);if(key===RECORD_KEY&&!dropped){dropped=true;throw Error('post-persist storage reply loss')}})
  const result=await executeFinancial('refund',{...preview.input,review:preview.review},request=>commitBrowserRefund(request,fixture.owner))
  expect(result.order.total).toBe(-7.28);expect(readPendingFinancial()).toBeNull();expect(readRecords().data.pos2_orders.filter(row=>row.refundOf==='mixed-sale')).toHaveLength(1)
})
it.each([['browser',prepareRefund],['native',native.prepareRefund]])('%s allocates an exact half cent upward from the frozen original',(_name,prepare)=>{
  const result=prepare(fixture.half.order,[],fixture.half.request,null)
  expect(result.order.total).toBe(-.15)
  expect(result.order.manualDiscount).toBe(-.15)
  expect(result.order.payments).toEqual([{method:'cash',amount:-.15}])
})
