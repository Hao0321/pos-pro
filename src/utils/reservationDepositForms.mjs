import {canonicalSignature} from '../../electron/operationRules.mjs'
import {draftObject,privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {defaultReservationDepositPolicy,normalizeReservationDepositPolicy,assertReservationDepositPolicy,MAX_DEPOSIT_CENTS,depositError} from '../../electron/reservationDepositPolicy.mjs'
import {assertReservationDepositView} from '../../electron/reservationDeposits.mjs'
import {parseFundsAmount,fundsAmountText} from './restaurantFundsView.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),id=value=>typeof value==='string'&&/^[-A-Za-z0-9_:]{1,128}$/.test(value),raw=(value,max)=>typeof value==='string'&&value.length<=max
const reviewFields=['storeId','epoch','bookingId','bookingRevision','termsHash','status','requiredCents','receivedCents','refundedCents','allocatedCents','availableCents','remainingCents','refundDueCents','sourcesHash']
export function reservationDepositPolicyDraft(state,id){
 const base=structuredClone(state.depositPolicy?.config||defaultReservationDepositPolicy())
 return {id,action:'deposit-policy',policyVersion:state.depositPolicy?.version||0,policyHash:state.depositPolicy?.hash||null,base,enabled:base.enabled,basis:base.basis==='none'&&!base.enabled?'per-booking':base.basis,amount:base.amountCents?fundsAmountText(base.amountCents):''}
}
export function reservationDepositPolicyFields(value){
 if(value?.action!=='deposit-policy'||!validateReservationDepositForm(value))throw depositError('SOURCE')
 const amountCents=value.basis==='none'||!value.enabled&&value.amount===''?0:parseFundsAmount(value.amount),basis=amountCents?value.basis:'none'
 if(value.enabled&&value.basis!=='none'&&!amountCents)throw depositError('POLICY')
 return {policy:normalizeReservationDepositPolicy({...value.base,enabled:value.enabled,basis,amountCents})}
}
export function assertCurrentDepositPolicyDraft(state,value){
 if(state.needsRecovery||state.depositRecovery)throw depositError('RECOVERY')
 if((state.depositPolicy?.version||0)!==value.policyVersion||(state.depositPolicy?.hash||null)!==value.policyHash)throw depositError('STALE')
 return reservationDepositPolicyFields(value)
}
export function reservationDepositMoneyContext(state,bookingId){
 if(state.needsRecovery||state.depositRecovery)throw depositError('RECOVERY');assertReservationDepositView(state)
 const booking=state.bookings.find(row=>row.id===bookingId),balance=state.depositBalances?.find(row=>row.bookingId===bookingId)
 if(!booking?.depositTerms||!balance)throw depositError('SOURCE')
 const review={storeId:state.storeId,epoch:state.epoch,bookingId,bookingRevision:booking.revision,termsHash:booking.depositTerms.hash,status:booking.status}
 for(const key of ['requiredCents','receivedCents','refundedCents','allocatedCents','availableCents','remainingCents','refundDueCents'])review[key]=balance[key]
 review.sourcesHash=privateDraftDigest(balance.receipts)
 const events=new Map(state.entries.filter(row=>row.event.change.deposit?.action==='receive').map(row=>[row.id,row.event]))
 return {review,sources:balance.receipts.map(row=>({...row,time:events.get(row.id)?.time||'',reference:events.get(row.id)?.change.deposit.reference||''})),booking}
}
export function reservationDepositMoneyDraft(context,action,id){
 const source=action==='deposit-refund'?context.sources.find(row=>row.availableCents>0):null,amount=action==='deposit-receive'?context.review.remainingCents:source?.availableCents||0
 return {id,action,bookingId:context.review.bookingId,review:structuredClone(context.review),method:source?.method||'cash',amount:amount?fundsAmountText(amount):'',paid:'',customPaid:false,receiptId:source?.id||'',reference:'',reason:action==='deposit-refund'?'退回未使用訂金':'',confirmed:false}
}
export function validateReservationDepositForm(value){
 try{
  if(value?.action==='deposit-policy'){
   draftObject(value,['id','action','policyVersion','policyHash','base','enabled','basis','amount']);if(!/^reservation-[-a-z0-9]+$/.test(value.id)||typeof value.enabled!=='boolean'||!['none','per-booking','per-guest'].includes(value.basis)||!raw(value.amount,32)||!Number.isSafeInteger(value.policyVersion)||value.policyVersion<0)return false
   if(value.policyVersion===0)return value.policyHash===null&&same(value.base,defaultReservationDepositPolicy())
   assertReservationDepositPolicy({protocol:'pos-reservation-deposit-policy/v1',version:value.policyVersion,config:value.base,hash:value.policyHash});return true
  }
  draftObject(value,['id','action','bookingId','review','method','amount','paid','customPaid','receiptId','reference','reason','confirmed']);draftObject(value.review,reviewFields)
  if(!/^reservation-[-a-z0-9]+$/.test(value.id)||!['deposit-receive','deposit-refund'].includes(value.action)||!/^booking-[a-f0-9]{48}$/.test(value.bookingId)||value.review.bookingId!==value.bookingId||!id(value.review.storeId)||!id(value.review.epoch)||!hash(value.review.termsHash)||!hash(value.review.sourcesHash)||!Number.isSafeInteger(value.review.bookingRevision)||value.review.bookingRevision<1||!['confirmed','arrived','seated','completed','cancelled','no-show'].includes(value.review.status)||!['cash','bank'].includes(value.method)||!raw(value.amount,32)||!raw(value.paid,32)||!raw(value.reference,120)||!raw(value.reason,500)||typeof value.customPaid!=='boolean'||typeof value.confirmed!=='boolean')return false
  for(const key of ['requiredCents','receivedCents','refundedCents','allocatedCents','availableCents','remainingCents','refundDueCents'])if(!Number.isSafeInteger(value.review[key])||value.review[key]<0||!['receivedCents','refundedCents'].includes(key)&&value.review[key]>MAX_DEPOSIT_CENTS)return false
  if(value.review.receivedCents-value.review.refundedCents!==value.review.allocatedCents+value.review.availableCents||value.review.allocatedCents+value.review.availableCents>value.review.requiredCents)return false
  return value.action==='deposit-receive'?value.receiptId===''&&value.reason===''&&(value.customPaid?value.method==='cash':value.paid===''):(value.receiptId===''||id(value.receiptId))&&!value.customPaid&&value.paid===''
 }catch{return false}
}
export function reservationDepositFormFields(value,{shiftId}={}){
 if(!validateReservationDepositForm(value))throw depositError('SOURCE')
 if(value.action==='deposit-policy')return reservationDepositPolicyFields(value)
 if(!value.confirmed)throw depositError('MONEY')
 const amountCents=parseFundsAmount(value.amount);if(!amountCents)throw depositError('MONEY')
 return {bookingId:value.bookingId,expectedBookingRevision:value.review.bookingRevision,amountCents,reference:value.reference.trim(),confirmed:true,...(shiftId===undefined?{}:{shiftId}),...(value.action==='deposit-receive'?{method:value.method,paidCents:value.method==='cash'&&value.customPaid?parseFundsAmount(value.paid):amountCents}:{receiptId:value.receiptId,reason:value.reason.trim()})}
}
export function previewReservationDepositMoney(value,context,role,shiftId=''){
 if(!validateReservationDepositForm(value)||!same(value.review,context.review))throw depositError('STALE')
 if(!['owner','staff'].includes(role)||value.action==='deposit-refund'&&role!=='owner')throw Error('權限不足')
 const amountCents=parseFundsAmount(value.amount),source=context.sources.find(row=>row.id===value.receiptId),receiving=value.action==='deposit-receive',maximumCents=receiving?context.review.remainingCents:source?.availableCents||0
 if(!receiving&&(!source||source.method!==value.method))throw depositError('SOURCE')
 if(!receiving&&!value.reason.trim())throw Error('請填寫退款原因。')
 if(amountCents>maximumCents)throw Error(receiving?'這次實收超過尚可收訂金。':'這次退款超過原收款可退金額。')
 if(!amountCents||receiving&&!['confirmed','arrived','seated'].includes(context.review.status))throw depositError('MONEY')
 const paidCents=receiving&&value.method==='cash'&&value.customPaid?parseFundsAmount(value.paid):amountCents;if(paidCents<amountCents)throw Error('客人支付金額不足，請核對。')
 const needsShift=value.method==='cash';if(needsShift&&!id(shiftId))throw depositError('SHIFT')
 return {amountCents,paidCents,changeCents:paidCents-amountCents,maximumCents,method:value.method,needsShift,shiftId:needsShift?shiftId:'',remainingSourceCents:maximumCents-amountCents}
}
