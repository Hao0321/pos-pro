import {planReservation,reservationActor} from './reservationModel.mjs'
import {reservationData,projectReservationBook} from './reservationCommit.mjs'
import {planBrowserStockBusiness,browserRestaurantData} from './browserStockPlan.mjs'
import {appendBrowserStockBusiness} from './browserStockCommit.mjs'
import {validateStockCostBook} from './stockBackup.mjs'
import {appendBrowserLots,needsLotExpiry,makeLotExpiryInput} from './browserLots.mjs'
import {reservationError} from './reservationConfig.mjs'
import {privateDraftDigest} from './privateDrafts.mjs'
import {reservationDepositFundingRequest} from './reservationDepositApplication.mjs'
import {planRestaurantFundsEvent} from './restaurantFunds.mjs'
import {withReservationDepositTransition} from './reservationDepositTransition.mjs'
import {projectBrowserReservationDepositReturn} from './browserReservationDepositReturn.mjs'

// Pure postimage, reconstructed again by the existing single-record writer.
// No business lock, storage write, nonce or printer side effect occurs here.
export function projectBrowserReservationDining(before,input,scope,actor,time,known=[],runtime={}){
 if(input.action==='deposit-return')return projectBrowserReservationDepositReturn(before,input,scope,actor,time,known,runtime)
 const {history,data}=reservationData(before,scope,Date.parse(time),known)
 if(history.byId.has(input.id))return projectReservationBook(before,input,scope,actor,time,known)
 const parent=planReservation(input,data,actor),dine=input.action==='dine'
 if(dine&&(before.restaurantOperations.some(row=>row.id===input.order.id)||before.restaurantOrders.some(row=>row.id===input.order.id)))throw reservationError('HISTORY')
 let book=before,state=validateStockCostBook(book)
 if(needsLotExpiry(state.projection,time)){
  const request=makeLotExpiryInput(state,{...scope,now:time})
  book=appendBrowserLots(book,book,state,{request,timestamp:time,system:true},{epoch:scope.epoch,eventId:'reservation-expiry-'+privateDraftDigest([input.id,request.id]).slice(0,48)})
  state=validateStockCostBook(book)
 }
 const context={...runtime,epoch:scope.epoch,state,timestamp:time}
 let child=book
 if(dine){const planned=planBrowserStockBusiness(book,context,'applyRestaurantOperation',input.order,actor);child=state.projection?appendBrowserStockBusiness(book,planned.book,state,{method:'applyRestaurantOperation',request:input.order,actor,timestamp:time},{...context,eventId:'reservation-stock-'+privateDraftDigest(input.id).slice(0,48)}):planned.book}
 const entry=child.restaurantOrders.find(row=>row.id===(dine?input.order.id:input.orderId)),booking=data.state.bookings.find(row=>row.id===input.bookingId)
 if(!entry)throw reservationError('HISTORY')
 const request=booking?.depositTerms?reservationDepositFundingRequest(input,data.state,entry,{costMode:data.costMode}):null
 if(!request)return projectReservationBook(child,input,scope,actor,time,known)
 const who=reservationActor(actor,data.users),restaurant=browserRestaurantData(child,context),event=planRestaurantFundsEvent(entry.funds,request,{entryId:entry.id,version:entry.version+1,date:restaurant.date,prepared:!!entry.startedAt,actor:who}).event
 return withReservationDepositTransition({request,actor:who,plannedEvent:event,parentReceipt:parent.receipt},()=>{
  const current=validateStockCostBook(child),fundingContext={...context,state:current},planned=planBrowserStockBusiness(child,fundingContext,'applyRestaurantOperation',request,actor)
  const funded=current.projection?appendBrowserStockBusiness(child,planned.book,current,{method:'applyRestaurantOperation',request,actor,timestamp:time},{...fundingContext,eventId:'reservation-deposit-stock-'+privateDraftDigest(input.id).slice(0,48)}):planned.book
  return projectReservationBook(funded,input,scope,actor,time,known)
 })
}
