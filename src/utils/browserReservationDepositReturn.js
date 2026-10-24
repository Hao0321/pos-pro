import {withSalesLock,readRecords,assertOriginalOperationAvailable} from './browserStorage'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {browserProtectionGraph} from './browserProtection'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {reservationKnownReceipts} from '../../electron/reservationHistory.mjs'
import {reservationData} from '../../electron/reservationCommit.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {reservationDepositReturnId} from '../../electron/reservationDepositAllocation.mjs'
import {prepareReservationDepositReturn} from '../../electron/reservationDepositReturnPlan.mjs'
import {withReservationDepositReturnResult,assertReservationDepositReturnRootResult} from '../../electron/reservationDepositReturnResult.mjs'
import {commitBrowserReservation} from './browserReservations'

export async function commitBrowserReservationDepositReturn(request,actor){
 if(!['funds-refund','cancel','cancel-part'].includes(request?.action))return null
 // Select under the ordinary lock, then release it before invoking the existing
 // reservation writer. Its exact root/meal revisions reject intervening edits.
 let checked=false,existing=false
 try{
  const input=await withSalesLock(()=>{
   const record=readRecords(),book=browserToBook(record.data),entry=book.restaurantOrders.find(row=>row.id===request.entryId)
   if(!entry?.funds?.events.some(event=>event.input.action==='funds-deposit-apply'))return null
   const scope=privateDraftContext(readExchangeTextSetting(book.settings,'sharedStoreId'),record.salesEpoch,actor,book.users),known=reservationKnownReceipts(browserProtectionGraph(record),scope.storeId),{history,data}=reservationData(book,scope,Date.now(),known),old=history.byId.get(reservationDepositReturnId(scope.storeId,request.id))
   checked=true;existing=!!old
   if(old){if(canonicalSignature(old.event.input.restaurantOperation)!==canonicalSignature(request))throw Error('原編號內容不符，請核對原單');return old.event.input}
   assertOriginalOperationAvailable('applyRestaurantOperation',request.id,record,request)
   return prepareReservationDepositReturn(request,data,entry,actor)?.input||null
  })
  if(!input)return null
  const parent=await commitBrowserReservation(input,actor)
  if(parent.success!==true)return parent
  assertReservationDepositReturnRootResult(input,parent)
  return withReservationDepositReturnResult(parent.restaurantReturn,parent)
 }catch(error){return {success:false,committed:!checked||existing||error.historyUncertain?null:false,error:error.message}}
}
