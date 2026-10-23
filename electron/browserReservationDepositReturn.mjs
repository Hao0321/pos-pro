import {reservationData,projectReservationBook} from './reservationCommit.mjs'
import {verifyReservationDepositReturnPlan} from './reservationDepositReturnPlan.mjs'
import {withReservationDepositTransition} from './reservationDepositTransition.mjs'
import {planBrowserStockBusiness} from './browserStockPlan.mjs'
import {appendBrowserStockBusiness} from './browserStockCommit.mjs'
import {validateStockCostBook} from './stockBackup.mjs'
import {privateDraftDigest} from './privateDrafts.mjs'

export function projectBrowserReservationDepositReturn(before,input,scope,actor,time,known=[],runtime={}){
 const {history,data}=reservationData(before,scope,Date.parse(time),known)
 if(history.byId.has(input.id))return projectReservationBook(before,input,scope,actor,time,known)
 const planned=verifyReservationDepositReturnPlan(input,data,before.restaurantOrders.find(row=>row.id===input.orderId),actor)
 const final=withReservationDepositTransition({request:input.restaurantOperation,actor:planned.actor,plannedEvent:planned.plannedEvent,parentReceipt:planned.parent.receipt},()=>{
  const state=validateStockCostBook(before),context={...runtime,epoch:scope.epoch,state,timestamp:time},request=input.restaurantOperation
  const child=planBrowserStockBusiness(before,context,'applyRestaurantOperation',request,actor)
  const funded=state.projection?appendBrowserStockBusiness(before,child.book,state,{method:'applyRestaurantOperation',request,actor,timestamp:time},{...context,eventId:'reservation-return-stock-'+privateDraftDigest(input.id).slice(0,48)}):child.book
  let parent=projectReservationBook(funded,input,scope,actor,time,known),book=parent.book
  for(const refund of planned.refundInputs)book=projectReservationBook(book,refund,scope,actor,time,known).book
  return {...parent,book}
 })
 // Temporary custody exists only inside the synchronous common transition.
 // Persisting a parent without all actual refund originals is never admitted.
 validateStockCostBook(final.book)
 return final
}
