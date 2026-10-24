import {canonicalSignature} from './operationRules.mjs'
import {assertReservationResult} from './reservationHistory.mjs'
import {assertRestaurantFundsResult} from './restaurantFundsResult.mjs'
import {depositError} from './reservationDepositPolicy.mjs'
import {reservationDepositReturnId,reservationDepositReturnSources,reservationDepositReturnRefundSources,reservationDepositRefundId} from './reservationDepositAllocation.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),bad=()=>{throw depositError('SOURCE')}
// The root state appears once in the normal restaurant acknowledgement. Each
// money original is a compact receipt, never another complete copy of the book.
export function withReservationDepositReturnResult(result,parent){
 const returned=parent.receipt.event.change.depositReturn,state=parent.state
 const refunds=returned.disposition==='refund'?reservationDepositReturnRefundSources(returned).map(source=>{const receipt=state.entries.find(row=>row.id===reservationDepositRefundId(returned.id,source.receiptId));if(!receipt)bad();return {request:structuredClone(receipt.event.input),receipt:structuredClone(receipt)}}):[]
 return {...result,reservationState:state,depositReturn:{protocol:'pos-reservation-deposit-return-result/v1',storeId:parent.storeId,epoch:parent.epoch,request:structuredClone(parent.receipt.event.input),receipt:parent.receipt,refunds}}
}
export function assertReservationDepositReturnResult(request,result){
 const sources=reservationDepositReturnSources(result?.fundsEvent||{})
 if(!sources.length){if(result?.depositReturn!==undefined||result?.reservationState!==undefined)bad();return result}
 const proof=result.depositReturn,state=result.reservationState,input=proof?.request,returned=proof?.receipt?.event?.change.depositReturn
 if(proof?.protocol!=='pos-reservation-deposit-return-result/v1'||proof.storeId!==request.storeId||typeof proof.epoch!=='string'||!state||state.needsRecovery||state.depositRecovery||!input||input.id!==reservationDepositReturnId(request.storeId,request.id)||!same(input.restaurantOperation,request)||!returned||returned.id!==input.id||returned.orderId!==request.entryId||returned.bookingId!==result.entry?.reservationDining?.bookingId||returned.disposition!==request.depositDisposition||!same(returned.sources,sources)||!same(result.fundsEvent.actor,proof.receipt.event.actor)||!Array.isArray(proof.refunds))bad()
 const acknowledge=(original,receipt)=>assertReservationResult(original,{success:true,storeId:proof.storeId,epoch:proof.epoch,receipt,state})
 acknowledge(input,proof.receipt)
 // The complete state was replayed above. Check each compact refund against
 // that exact validated history without replaying the whole book N more times.
 const recorded=new Map(state.entries.map(row=>[row.id,row]))
 const expected=returned.disposition==='refund'?reservationDepositReturnRefundSources(returned):[]
 if(proof.refunds.length!==expected.length)bad()
 for(const [index,source]of expected.entries()){
  const row=proof.refunds[index],refund=row?.request,receipt=row?.receipt,money=receipt?.event?.change.deposit
  if(!refund||refund.id!==reservationDepositRefundId(input.id,source.receiptId)||refund.action!=='deposit-refund'||refund.bookingId!==input.bookingId||refund.receiptId!==source.receiptId||refund.amountCents!==source.amountCents||refund.confirmed!==true||refund.shiftId!==(source.method==='cash'?request.shiftId:'')||refund.time!==input.time||refund.expectedRevision!==proof.receipt.revision+index||refund.expectedBookingRevision!==proof.receipt.event.change.booking.revision+index||money?.method!==source.method||!same(receipt.event.actor,proof.receipt.event.actor)||receipt.event.time!==proof.receipt.event.time)bad()
  if(refund.storeId!==proof.storeId||refund.epoch!==input.epoch||receipt.signature!==canonicalSignature(refund)||!same(recorded.get(refund.id),receipt))bad()
 }
 return result
}
export function assertReservationDepositReturnRootResult(request,result){
 if(request.action!=='deposit-return')return result
 assertReservationResult(request,result)
 const child=withReservationDepositReturnResult(result.restaurantReturn,result)
 assertRestaurantFundsResult(request.restaurantOperation,child)
 return result
}
