import {withSalesLock,readRecords,writeRecords,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {getBrowserPrivateDraftContext} from './browserPrivateDrafts'
import {browserProtectionGraph} from './browserProtection'
import {browserToBook,bookToBrowser} from '../../electron/recoveryRules.mjs'
import {privateDraftContext,draftObject} from '../../electron/privateDrafts.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {reservationKnownReceipts,readReservationBook,assertReservationResult,reservationResult} from '../../electron/reservationHistory.mjs'
import {projectReservationBook,reservationView,reservationData} from '../../electron/reservationCommit.mjs'
import {reservationAvailability} from '../../electron/reservationCapacity.mjs'
import {reservationError} from '../../electron/reservationConfig.mjs'
import {projectBrowserReservationDining} from '../../electron/browserReservationDining.mjs'
import {assertReservationDiningResult} from '../../electron/reservationDiningResult.mjs'
import {browserStockBusinessResult} from './browserStockBusiness'
import {browserRestaurantData} from '../../electron/browserStockPlan.mjs'
import {reservationDiningContext} from '../../electron/reservationDiningContext.mjs'
import {reservationDepositFundingInput} from '../../electron/reservationDepositApplication.mjs'
import {assertReservationDepositApplicationResult} from '../../electron/reservationDepositApplicationResult.mjs'
import {assertReservationDepositReturnRootResult} from '../../electron/reservationDepositReturnResult.mjs'

function current(record,actor){const book=browserToBook(record.data),scope=privateDraftContext(readExchangeTextSetting(book.settings,'sharedStoreId'),record.salesEpoch,actor,book.users);return {book,scope,known:reservationKnownReceipts(browserProtectionGraph(record),scope.storeId)}}
export async function getBrowserReservationState(actor){await getBrowserPrivateDraftContext(actor);return withSalesLock(()=>{const {book,scope,known}=current(readRecords(),actor);return reservationView(book,scope,Date.now(),known)})}
export async function getBrowserReservationDiningContext(input,actor){await getBrowserPrivateDraftContext(actor);return withSalesLock(()=>{const {book,scope,known}=current(readRecords(),actor),state=reservationView(book,scope,Date.now(),known),restaurant=browserRestaurantData(book,{epoch:scope.epoch,timestamp:state.now});return reservationDiningContext(input,state,{config:restaurant.config,entries:restaurant.entries},book.products,book.members,restaurant.costMode)})}
export async function getBrowserReservationAvailability(input,actor){
 draftObject(input,['date','partySize','online']);if(typeof input.online!=='boolean')throw reservationError('CONFIG')
 await getBrowserPrivateDraftContext(actor);return withSalesLock(()=>{const {book,scope,known}=current(readRecords(),actor),{history}=reservationData(book,scope,Date.now(),known);return {storeId:scope.storeId,epoch:scope.epoch,revision:history.state.revision,...reservationAvailability(history.state,input.date,input.partySize,Date.now(),{online:input.online})}})
}
function savedResult(input,record,actor){const saved=current(record,actor),history=readReservationBook(saved.book,saved.known),result={...reservationResult(input,history.byId.get(input.id),history,saved.scope,Date.now()),state:reservationView(saved.book,saved.scope,Date.now(),saved.known)};if(input.action==='dine')result.dining=browserStockBusinessResult('applyRestaurantOperation',input.order,record,actor);const application=result.receipt.event.change.depositApplication;if(application)result.depositFunding=browserStockBusinessResult('applyRestaurantOperation',reservationDepositFundingInput(input,application,input.action==='dine'?input.order.costMode:input.costMode),record,actor);if(input.action==='deposit-return')result.restaurantReturn=browserStockBusinessResult('applyRestaurantOperation',input.restaurantOperation,record,actor);return assertReservationDepositReturnRootResult(input,assertReservationDepositApplicationResult(input,assertReservationDiningResult(input,assertReservationResult(input,result))))}
export async function commitBrowserReservation(input,actor){
 await getBrowserPrivateDraftContext(actor)
 return withSalesLock(()=>{
  let writing=false,before=null,checked=false,existing=false
  try{
   const record=readRecords(),{book,scope,known}=current(record,actor),history=readReservationBook(book,known);existing=history.byId.has(input?.id);checked=true
   const time=new Date().toISOString(),planned=['dine','deposit-apply','deposit-return'].includes(input.action)?projectBrowserReservationDining(book,input,scope,actor,time,known,{supplierFence:record.supplierFence}):projectReservationBook(book,input,scope,actor,time,known)
   if(planned.existing)return savedResult(input,record,actor)
   assertOriginalOperationAvailable('applyReservationOperation',input.id,record,input)
   if(input.action==='dine')assertOriginalOperationAvailable('applyRestaurantOperation',input.order.id,record,input.order)
   before=localStorage.getItem(RECORD_KEY);writing=true
   writeRecords(bookToBrowser(planned.book),record.revision,{reservation:{input,actor,time}})
   return savedResult(input,readRecords(),actor)
  }catch(error){
   if(writing)try{if(localStorage.getItem(RECORD_KEY)!==before)return savedResult(input,readRecords(),actor)}catch{return {success:false,committed:null,error:'訂位保存結果尚未確認，請保留原編號再核對。'}}
   return {success:false,committed:!checked||existing?null:false,error:error.message,errorCode:error.code||'RESERVATION_WRITE'}
  }
 })
}
