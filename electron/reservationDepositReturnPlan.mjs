import {canonicalSignature} from './operationRules.mjs'
import {reservationActor,planReservation} from './reservationModel.mjs'
import {assertRestaurantFundsScope} from './restaurantFundedPlan.mjs'
import {planRestaurantFundsEvent} from './restaurantFunds.mjs'
import {salesDate} from './salesRules.mjs'
import {depositError} from './reservationDepositPolicy.mjs'
import {reservationDepositReturnSources,reservationDepositReturnId,reservationDepositReturnRefundSources,reservationDepositRefundId} from './reservationDepositAllocation.mjs'

// Preview and commit share this exact source selection. No balance, cash event,
// stock mutation or acknowledgement is persisted by this function.
export function prepareReservationDepositReturn(request,data,entry,actor){
 const who=reservationActor(actor,data.users)
 assertRestaurantFundsScope(request,data)
 if(!entry?.funds||!['funds-refund','cancel','cancel-part'].includes(request.action)||entry.id!==request.entryId||entry.version!==request.expectedVersion)throw depositError('STALE')
 const plannedEvent=planRestaurantFundsEvent(entry.funds,request,{entryId:entry.id,version:entry.version+1,date:salesDate(new Date(data.now)),prepared:!!entry.startedAt,actor:who}).event
 const returnSources=reservationDepositReturnSources(plannedEvent)
 if(!returnSources.length)return null
 const booking=data.state.bookings.find(row=>row.id===entry.reservationDining?.bookingId)
 if(!booking)throw depositError('SOURCE')
 const input={protocol:'pos-reservation/v1',id:reservationDepositReturnId(data.storeId,request.id),action:'deposit-return',storeId:data.storeId,epoch:data.epoch,expectedRevision:data.state.revision,time:request.time,bookingId:booking.id,expectedBookingRevision:booking.revision,orderId:entry.id,restaurantOperation:structuredClone(request),returnSources,disposition:request.depositDisposition,reviewed:true}
 const parent=planReservation(input,data,who),refundInputs=[]
 let state=parent.state
 if(input.disposition==='refund')for(const source of reservationDepositReturnRefundSources(parent.event.change.depositReturn)){
  const refund={protocol:'pos-reservation/v1',id:reservationDepositRefundId(input.id,source.receiptId),action:'deposit-refund',storeId:input.storeId,epoch:input.epoch,expectedRevision:state.revision,time:input.time,bookingId:booking.id,expectedBookingRevision:state.bookings.find(row=>row.id===booking.id).revision,receiptId:source.receiptId,amountCents:source.amountCents,shiftId:source.method==='cash'?request.shiftId:'',reference:request.id.slice(0,120),reason:'依原餐點取消或退款紀錄核對退回訂金',confirmed:true,reviewed:true}
  state=planReservation(refund,{...data,state},who).state;refundInputs.push(refund)
 }
 return {input,parent,plannedEvent,refundInputs,actor:who}
}
export function verifyReservationDepositReturnPlan(input,data,entry,actor){
 const planned=prepareReservationDepositReturn(input.restaurantOperation,data,entry,actor)
 if(!planned||canonicalSignature(planned.input)!==canonicalSignature(input))throw depositError('SOURCE')
 return planned
}
