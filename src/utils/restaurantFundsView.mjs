import {canonicalSignature,moneyValue} from '../../electron/operationRules.mjs'
import {summarizeRestaurantFunds,planRestaurantFundsEvent,RESTAURANT_FUNDS_PROTOCOL} from '../../electron/restaurantFunds.mjs'

export function parseFundsAmount(raw){
 if(typeof raw!=='string'||raw.length>32||! /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(raw))throw Error('請輸入金額，最多兩位小數。')
 const [whole,fraction='']=raw.split('.'),value=BigInt(whole||'0')*100n+BigInt(fraction.padEnd(2,'0'))
 if(value>100000000000n)throw Error('金額超過支援範圍。')
 return Number(value)
}
export function fundsAmountText(value){
 if(!Number.isSafeInteger(value)||value<0)throw Error('款項資料需要核對。')
 return String(Math.floor(value/100))+(value%100?'.'+String(value%100).padStart(2,'0'):'')
}
export function parseCancelledCount(raw,max){
 if(typeof raw!=='string'||raw.length>16||!/^\d+$/.test(raw)||!Number.isSafeInteger(max)||max<0)throw Error('請填寫要取消的份數。')
 const value=BigInt(raw);if(value>BigInt(max))throw Error('取消份數超過剩餘餐點。')
 return Number(value)
}
export function restaurantFundingView(entry,role){
 const funded=Object.hasOwn(entry,'funds'),summary=funded?summarizeRestaurantFunds(entry.funds):null,totalCents=summary?.totalCents??Math.round(moneyValue(entry.total,'訂單金額')*100),retainedCents=summary?.retainedCents??(entry.saleId?totalCents:0),dueCents=totalCents-retainedCents
 return {funded,summary,totalCents,retainedCents,dueCents,canComplete:funded?dueCents===0:!!entry.saleId,canReceive:entry.status!=='cancelled'&&(funded?!summary.fulfilled&&dueCents>0:!entry.saleId),canCancel:entry.status!=='cancelled'&&(role==='owner'||(funded?!retainedCents&&!summary.fulfilled:!entry.saleId)),canRefund:funded&&role==='owner'&&!summary.fulfilled&&retainedCents>0&&entry.status!=='cancelled'}
}
export function restaurantFundsReview(entry){
 if(!entry?.funds)throw Error('請核對原工作單。')
 const summary=summarizeRestaurantFunds(entry.funds)
 return {entryId:entry.id,entryVersion:entry.version,status:entry.status,pickupNumber:entry.pickupNumber||0,customer:entry.customer||'',prepared:!!entry.startedAt,fulfilled:summary.fulfilled,totalCents:summary.totalCents,retainedCents:summary.retainedCents,dueCents:summary.dueCents,items:summary.items.map(({id,name,qty,price})=>({id,name,qty,price}))}
}
export function previewRestaurantFundsForm(entry,form,{state,actor,shiftId='',reason=''}={}){
 if(!entry||canonicalSignature(restaurantFundsReview(entry))!==canonicalSignature(form.review))throw Error('工作單已更新，請重新核對目前餐點。')
 if(!state?.storeId||!state.epoch||!['active','reference'].includes(state.costMode)||!state.now||!state.today)throw Error('店面資料尚未準備好，請保留輸入。')
 const fields=form.fields,base={kind:'restaurant',entryId:entry.id,expectedVersion:entry.version,storeId:state.storeId,epoch:state.epoch,costMode:state.costMode,fundsProtocol:RESTAURANT_FUNDS_PROTOCOL};let input
 if(form.mode==='receive'){
  const amount=parseFundsAmount(fields.amount),paid=fields.method==='cash'&&fields.customPaid?parseFundsAmount(fields.paid):amount
  input={...base,action:'funds-receive',amount:amount/100,paid:paid/100,payMethod:fields.method,shiftId}
 }else if(form.mode==='refund')input={...base,action:'funds-refund',amount:parseFundsAmount(fields.amount)/100,reason,shiftId}
 else if(form.mode==='cancel'){
  const quantities=fields.all?[]:fields.quantities.map(row=>({id:row.id,qty:parseCancelledCount(row.qty,form.review.items.find(item=>item.id===row.id)?.qty)})).filter(row=>row.qty>0)
  if(!fields.all&&!quantities.length)throw Error('請選擇至少一份餐點。')
  input={...base,action:fields.all?'cancel':'cancel-part',...(fields.all?{}:{quantities}),reason,shiftId}
 }else throw Error('請核對保留的輸入。')
 let id='funds-preview';for(let index=1;entry.funds.events.some(event=>event.id===id);index++)id='funds-preview-'+index
 // A placeholder is used only to calculate a read-only preview when no shift is
 // open. It is never included in the returned command or sent to persistence.
 const calculation={...input,id,time:state.now,shiftId:shiftId||'preview-shift'},planned=planRestaurantFundsEvent(entry.funds,calculation,{entryId:entry.id,version:entry.version+1,date:state.today,prepared:!!entry.startedAt,actor:{userId:actor.userId,username:actor.username,role:actor.role}})
 return {input,event:planned.event,summary:planned.summary,needsShift:form.mode!=='cancel'||planned.event.amountCents>0}
}
