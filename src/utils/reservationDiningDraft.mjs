import {draftObject} from '../../electron/privateDrafts.mjs'
import {reservationId,reservationText} from '../../electron/reservationConfig.mjs'
import {reservationDiningOperationId,reservationDiningSchedule} from '../../electron/reservationDining.mjs'
import {canonicalSignature,moneyValue} from '../../electron/operationRules.mjs'
import {quoteReservationDepositApplication} from '../../electron/reservationDepositAllocation.mjs'

export function diningDraftSource(context){const booking=context.booking,balance=context.depositBalance;return {storeId:context.storeId,epoch:context.epoch,bookingId:booking.id,bookingRevision:booking.revision,memberId:booking.memberId||null,customer:structuredClone(booking.customer),tableIds:[...booking.tableIds],tableNames:[...context.tableNames],timeZone:context.timeZone,note:booking.note,...(balance?{deposit:{termsHash:booking.depositTerms.hash,balance:{bookingId:balance.bookingId,availableCents:balance.availableCents,receipts:balance.receipts.map(({id,method,amountCents,refundedCents,allocatedCents,availableCents})=>({id,method,amountCents,refundedCents,allocatedCents,availableCents}))}}}:{})}}
export function validDiningDraft(value,context,baseValidate,bookingId){try{
 const {dining,...base}=value;draftObject(dining,['storeId','epoch','bookingId','bookingRevision','memberId','customer','tableIds','tableNames','timeZone','note',...(Object.hasOwn(dining||{},'deposit')?['deposit']:[])])
 for(const key of ['storeId','epoch','bookingId'])reservationId(dining[key]);if(dining.memberId!==null)reservationId(dining.memberId)
 if(dining.storeId!==context.storeId||dining.epoch!==context.epoch||dining.bookingId!==bookingId||!Number.isSafeInteger(dining.bookingRevision)||dining.bookingRevision<1||!Array.isArray(dining.tableIds)||!dining.tableIds.length||dining.tableIds.length>10||!Array.isArray(dining.tableNames)||dining.tableNames.length!==dining.tableIds.length)return false
 draftObject(dining.customer,['name','contact']);reservationText(dining.customer.name,100,true);reservationText(dining.customer.contact,100);reservationText(dining.note,500,false,true);for(const id of dining.tableIds)reservationId(id);for(const name of dining.tableNames)reservationText(name,50,true);reservationDiningSchedule(new Date().toISOString(),dining.timeZone)
 if(Object.hasOwn(dining,'deposit')){draftObject(dining.deposit,['termsHash','balance']);draftObject(dining.deposit.balance,['bookingId','availableCents','receipts']);diningDepositAmounts(dining,0)}
 return baseValidate(base,context)===true
}catch{return false}}
export function diningForm(source,time){return {channel:'walkin',...reservationDiningSchedule(time,source.timeZone),customer:source.customer.name,contact:source.customer.contact,note:source.note||''}}
export function assertDiningDraftCurrent(source,context){const fresh=diningDraftSource(context),withoutMember=value=>({...value,memberId:null});if(canonicalSignature(withoutMember(source))!==canonicalSignature(withoutMember(fresh))||fresh.memberId&&source.memberId!==fresh.memberId||source.memberId!==null&&!context.members.some(row=>row.id===source.memberId))throw Error('桌位或客人資料已更新，請保留餐點並重新核對。');return context}
export function diningParent(child,revision,depositReview){return {protocol:'pos-reservation/v1',action:'dine',storeId:child.storeId,epoch:child.epoch,expectedRevision:revision,bookingId:child.reservationDining.bookingId,expectedBookingRevision:child.reservationDining.bookingRevision,memberId:child.reservationDining.memberId,order:child,...(depositReview?{depositReview}:{}),reviewed:true}}
// This quote is display-only; the saved review below always names the real meal.
export function diningDepositAmounts(source,totalCents){if(!source.deposit)return null;return quoteReservationDepositApplication({scope:source,booking:{id:source.bookingId,storeId:source.storeId,revision:source.bookingRevision,depositTerms:{hash:source.deposit.termsHash}},balance:source.deposit.balance,orderId:'dining-deposit-preview',restaurantVersion:1,totalCents,dueCents:totalCents})}
export function diningDepositReview(child,context){
 if(child.storeId!==context.storeId||child.epoch!==context.epoch||child.reservationDining?.bookingId!==context.booking.id||child.reservationDining.bookingRevision!==context.booking.revision)throw Error('桌位或客人資料已更新，請保留餐點並重新核對。')
 if(!context.depositBalance)return null
 let totalCents=child.menuReview?.quote.totalCents
 if(totalCents===undefined){let total=0n;for(const row of child.items||[]){if(!Number.isSafeInteger(row.qty)||row.qty<1||row.qty>100000)throw Error('請核對餐點與份數');total+=BigInt(Math.round(moneyValue(row.price,'餐點金額')*100))*BigInt(row.qty)}if(total>100000000000n)throw Error('金額超過支援範圍。');totalCents=Number(total)}
 const review=quoteReservationDepositApplication({scope:context,booking:context.booking,balance:context.depositBalance,orderId:child.id,restaurantVersion:1,totalCents,dueCents:totalCents})
 return review.appliedCents?review:null
}
export function diningPending(pending,bookingId){return pending?.kind==='reservation'&&pending.request.action==='dine'&&pending.request.bookingId===bookingId?{...pending,kind:'restaurant',request:pending.request.order}:pending}
export function diningParentIdentity(child){return {id:reservationDiningOperationId(child.storeId,child.id),time:child.time}}
