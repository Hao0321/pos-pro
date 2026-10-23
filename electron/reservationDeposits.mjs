import {privateDraftDigest} from './privateDrafts.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {reservationId,reservationText,reservationInteger} from './reservationConfig.mjs'
import {reservationParts} from './reservationCalendar.mjs'
import {depositCents,depositError,makeReservationDepositPolicy,quoteReservationDeposit,assertReservationDepositTerms} from './reservationDepositPolicy.mjs'
import {applyReservationDepositAllocation,reservationDepositAllocationMissing} from './reservationDepositAllocation.mjs'

export const RESERVATION_DEPOSIT_PROTOCOL='pos-reservation-deposit/v1'
export const RESERVATION_DEPOSIT_FIELDS={
 'deposit-policy':['policy','reviewed'],
 'deposit-receive':['bookingId','expectedBookingRevision','amountCents','paidCents','method','shiftId','reference','confirmed','reviewed'],
 'deposit-refund':['bookingId','expectedBookingRevision','receiptId','amountCents','shiftId','reference','reason','confirmed','reviewed'],
}
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
export function reservationDepositPolicies(state){return state.events.filter(row=>row.input.action==='deposit-policy').map(row=>structuredClone(row.change.depositPolicy))}
export function bookingDepositTerms(booking,state){
 if(!booking.depositTerms)return null
 const policy=reservationDepositPolicies(state).find(row=>row.version===booking.depositTerms.policyVersion);if(!policy)throw depositError('SOURCE');return assertReservationDepositTerms(booking.depositTerms,policy)
}
export function reservationDepositSummary(state,bookingId){
 const booking=state.bookings.find(row=>row.id===bookingId);if(!booking)throw depositError('SOURCE');const terms=bookingDepositTerms(booking,state),receipts=new Map(),applications=new Map(),ids=new Set();let received=0n,refunded=0n
 for(const source of state.events){const event=source.change.deposit,allocation=source.change.depositApplication||source.change.depositReturn;if(allocation&&(!state.bookings.some(row=>row.id===allocation.bookingId)||source.change.depositApplication&&source.change.depositReturn))throw depositError('SOURCE');if((event||allocation)?.bookingId!==bookingId)continue;if(ids.has(source.id)||event&&allocation)throw depositError('SOURCE');ids.add(source.id)
  if(allocation){applyReservationDepositAllocation(source,receipts,applications,{bookingId,termsHash:terms?.hash,storeId:booking.storeId});continue}depositCents(event.amountCents,{positive:true})
  if(event.protocol!==RESERVATION_DEPOSIT_PROTOCOL||event.id!==source.id||!same(source.input.amountCents,event.amountCents)||event.termsHash!==terms?.hash)throw depositError('SOURCE')
  if(event.action==='receive'){if(receipts.has(event.id)||!['cash','bank'].includes(event.method))throw depositError('SOURCE');receipts.set(event.id,{id:event.id,method:event.method,amountCents:event.amountCents,refundedCents:0,allocatedCents:0,availableCents:event.amountCents});received+=BigInt(event.amountCents)}
  else if(event.action==='refund'){const original=receipts.get(event.receiptId);if(!original||original.method!==event.method||event.amountCents>original.availableCents)throw depositError('SOURCE');original.refundedCents+=event.amountCents;original.availableCents-=event.amountCents;refunded+=BigInt(event.amountCents)}else throw depositError('SOURCE')
 }
 const retained=received-refunded;if(retained<0n||retained>BigInt(terms?.requiredCents||0)||received>BigInt(Number.MAX_SAFE_INTEGER)||refunded>BigInt(Number.MAX_SAFE_INTEGER))throw depositError('SOURCE')
 const allocated=[...receipts.values()].reduce((sum,row)=>sum+BigInt(row.allocatedCents),0n),available=retained-allocated;if(available<0n||allocated<0n)throw depositError('SOURCE')
 return {protocol:RESERVATION_DEPOSIT_PROTOCOL,bookingId,currency:terms?.currency||'TWD',requiredCents:terms?.requiredCents||0,receivedCents:Number(received),refundedCents:Number(refunded),allocatedCents:Number(allocated),availableCents:Number(available),remainingCents:!applications.size&&['confirmed','arrived','seated'].includes(booking.status)?Math.max(0,(terms?.requiredCents||0)-Number(retained)):0,refundDueCents:['cancelled','no-show','completed'].includes(booking.status)?Number(available):0,receipts:[...receipts.values()],...(applications.size?{applications:[...applications.values()]}:{})}
}
export function deriveReservationDeposit(input,state,actor,now){
 if(input.action==='deposit-policy'){if(actor.role!=='owner')throw Error('權限不足');return {depositPolicy:makeReservationDepositPolicy(input.policy,state.revision+1)}}
 const booking=state.bookings.find(row=>row.id===input.bookingId);if(!booking||booking.revision!==input.expectedBookingRevision)throw depositError('STALE');reservationId(input.bookingId);reservationInteger(input.expectedBookingRevision,1,Number.MAX_SAFE_INTEGER);if(input.confirmed!==true)throw depositError('MONEY')
 const summary=reservationDepositSummary(state,booking.id),terms=bookingDepositTerms(booking,state);if(!terms)throw depositError('POLICY');const amount=depositCents(input.amountCents,{positive:true}),date=reservationParts(now,state.config.timeZone).date,reference=reservationText(input.reference,120)
 let method,receiptId,paidCents=amount,changeCents=0,reason=''
 if(input.action==='deposit-receive'){
  if(!['confirmed','arrived','seated'].includes(booking.status)||!['cash','bank'].includes(input.method)||amount>summary.remainingCents)throw depositError('MONEY')
  method=input.method;receiptId=input.id;paidCents=depositCents(input.paidCents,{positive:true});if(method==='cash'?paidCents<amount:paidCents!==amount)throw depositError('MONEY');changeCents=paidCents-amount
 }else if(input.action==='deposit-refund'){
  if(actor.role!=='owner')throw Error('權限不足');reservationId(input.receiptId);const receipt=summary.receipts.find(row=>row.id===input.receiptId);if(!receipt||amount>receipt.availableCents)throw depositError('SOURCE');method=receipt.method;receiptId=receipt.id;reason=reservationText(input.reason,500,true)
 }else throw depositError('SOURCE')
 if(method==='cash')reservationId(input.shiftId);else if(input.shiftId!=='')throw depositError('SHIFT')
 const deposit={protocol:RESERVATION_DEPOSIT_PROTOCOL,id:input.id,bookingId:booking.id,action:input.action==='deposit-receive'?'receive':'refund',receiptId,termsHash:terms.hash,amountCents:amount,paidCents,changeCents,method,shiftId:input.shiftId,reference,reason,date}
 return {booking:{...structuredClone(booking),revision:booking.revision+1,updatedAt:new Date(now).toISOString()},deposit}
}
export function reservationDepositTermsForBooking(state,booking){return state.depositPolicy&&booking.status!=='waiting'?quoteReservationDeposit(state.depositPolicy,booking):null}
export function assertReservationDepositAcceptance(input,terms){if(terms?.requiredCents>0&&input.depositQuoteHash!==terms.hash||Object.hasOwn(input,'depositQuoteHash')&&input.depositQuoteHash!==terms?.hash)throw depositError('REVIEW')}
export function reservationDepositCashLog(event){
 const deposit=event.change.deposit;if(!deposit||deposit.method!=='cash')return null
 return {id:'reservation-deposit-'+privateDraftDigest(event.id).slice(0,48),shiftId:deposit.shiftId,time:event.time,type:deposit.action==='receive'?'in':'out',amount:deposit.amountCents/100,reason:'訂位訂金 · '+deposit.bookingId,cashier:event.actor.username}
}
export function assertReservationDepositShift(input,state,book,now){
 if(!['deposit-receive','deposit-refund'].includes(input.action))return
 const method=input.action==='deposit-receive'?input.method:reservationDepositSummary(state,input.bookingId).receipts.find(row=>row.id===input.receiptId)?.method
 if(method==='cash'&&!(book.shifts||[]).some(row=>row.id===input.shiftId&&row.status==='open'))throw depositError('SHIFT')
 if(method==='cash'&&reservationParts(now,state.config.timeZone).date!==reservationParts(Date.parse(input.time),state.config.timeZone).date)throw depositError('SHIFT')
}
export function reservationDepositMissing(state,book,{strict=false}={}){
 const money=state.events.filter(row=>row.change.deposit),ids=new Set((book.auditLog||[]).map(row=>row.id)),expected=new Map(),missing=[]
 for(const event of money){const cash=reservationDepositCashLog(event);if(cash)expected.set(cash.id,cash);if(!ids.has('reservation:'+event.id)){missing.push(event.id);continue}if(cash){const actual=(book.cashLog||[]).filter(row=>row.id===cash.id);if(actual.length!==1){missing.push(event.id);continue}if(!same(cash,actual[0]))throw depositError('SOURCE')}}
 if(strict&&(book.cashLog||[]).some(row=>String(row.id).startsWith('reservation-deposit-')&&!expected.has(row.id)))throw depositError('SOURCE')
 return [...missing,...reservationDepositAllocationMissing(state,book)]
}
export function assertReservationDepositView(state){
 const used=state.entries.some(row=>Object.hasOwn(RESERVATION_DEPOSIT_FIELDS,row.event.input.action))||state.bookings.some(row=>row.depositTerms)
 if(!used&&state.depositBalances===undefined)return state
 if(!Array.isArray(state.depositBalances))throw depositError('SOURCE')
 const expected=state.bookings.filter(row=>row.depositTerms).map(row=>reservationDepositSummary({events:state.entries.map(row=>row.event),bookings:state.bookings},row.id))
 if(!same(expected,state.depositBalances))throw depositError('SOURCE');return state
}
export function reservationDepositReportEntries(state){if(state.depositRecovery)throw depositError('RECOVERY');if(!Array.isArray(state.entries))throw depositError('SOURCE');return state.entries}
