import {planReservation} from './reservationModel.mjs'
import {reservationData,projectReservationBook} from './reservationCommit.mjs'
import {planBrowserStockBusiness} from './browserStockPlan.mjs'
import {appendBrowserStockBusiness} from './browserStockCommit.mjs'
import {validateStockCostBook} from './stockBackup.mjs'
import {appendBrowserLots,needsLotExpiry,makeLotExpiryInput} from './browserLots.mjs'
import {reservationError} from './reservationConfig.mjs'
import {privateDraftDigest} from './privateDrafts.mjs'

// Pure postimage, reconstructed again by the existing single-record writer.
// No business lock, storage write, nonce or printer side effect occurs here.
export function projectBrowserReservationDining(before,input,scope,actor,time,known=[],runtime={}){
 const {history,data}=reservationData(before,scope,Date.parse(time),known)
 if(history.byId.has(input.id))return projectReservationBook(before,input,scope,actor,time,known)
 planReservation(input,data,actor)
 if(before.restaurantOperations.some(row=>row.id===input.order.id)||before.restaurantOrders.some(row=>row.id===input.order.id))throw reservationError('HISTORY')
 let book=before,state=validateStockCostBook(book)
 if(needsLotExpiry(state.projection,time)){
  const request=makeLotExpiryInput(state,{...scope,now:time})
  book=appendBrowserLots(book,book,state,{request,timestamp:time,system:true},{epoch:scope.epoch,eventId:'reservation-expiry-'+privateDraftDigest([input.id,request.id]).slice(0,48)})
  state=validateStockCostBook(book)
 }
 const context={...runtime,epoch:scope.epoch,state,timestamp:time},planned=planBrowserStockBusiness(book,context,'applyRestaurantOperation',input.order,actor)
 const child=state.projection?appendBrowserStockBusiness(book,planned.book,state,{method:'applyRestaurantOperation',request:input.order,actor,timestamp:time},{...context,eventId:'reservation-stock-'+privateDraftDigest(input.id).slice(0,48)}):planned.book
 return projectReservationBook(child,input,scope,actor,time,known)
}
