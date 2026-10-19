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

function current(record,actor){const book=browserToBook(record.data),scope=privateDraftContext(readExchangeTextSetting(book.settings,'sharedStoreId'),record.salesEpoch,actor,book.users);return {book,scope,known:reservationKnownReceipts(browserProtectionGraph(record),scope.storeId)}}
export async function getBrowserReservationState(actor){await getBrowserPrivateDraftContext(actor);return withSalesLock(()=>{const {book,scope,known}=current(readRecords(),actor);return reservationView(book,scope,Date.now(),known)})}
export async function getBrowserReservationAvailability(input,actor){
 draftObject(input,['date','partySize','online']);if(typeof input.online!=='boolean')throw reservationError('CONFIG')
 await getBrowserPrivateDraftContext(actor);return withSalesLock(()=>{const {book,scope,known}=current(readRecords(),actor),{history}=reservationData(book,scope,Date.now(),known);return {storeId:scope.storeId,epoch:scope.epoch,revision:history.state.revision,...reservationAvailability(history.state,input.date,input.partySize,Date.now(),{online:input.online})}})
}
export async function commitBrowserReservation(input,actor){
 await getBrowserPrivateDraftContext(actor)
 return withSalesLock(()=>{
  let writing=false,before=null,checked=false,existing=false
  try{
   const record=readRecords(),{book,scope,known}=current(record,actor),history=readReservationBook(book,known);existing=history.byId.has(input?.id);checked=true
   const time=new Date().toISOString(),planned=projectReservationBook(book,input,scope,actor,time,known)
   if(planned.existing)return assertReservationResult(input,planned.result)
   assertOriginalOperationAvailable('applyReservationOperation',input.id,record,input)
   before=localStorage.getItem(RECORD_KEY);writing=true
   writeRecords(bookToBrowser(planned.book),record.revision,{reservation:{input,actor,time}})
   const saved=current(readRecords(),actor),actual=readReservationBook(saved.book,saved.known),receipt=actual.byId.get(input.id)
   return assertReservationResult(input,{...reservationResult(input,receipt,actual,saved.scope,Date.now()),state:reservationView(saved.book,saved.scope,Date.now(),saved.known)})
  }catch(error){
   if(writing)try{if(localStorage.getItem(RECORD_KEY)!==before){const saved=current(readRecords(),actor),history=readReservationBook(saved.book,saved.known);return assertReservationResult(input,{...reservationResult(input,history.byId.get(input.id),history,saved.scope,Date.now()),state:reservationView(saved.book,saved.scope,Date.now(),saved.known)})}}catch{return {success:false,committed:null,error:'訂位保存結果尚未確認，請保留原編號再核對。'}}
   return {success:false,committed:!checked||existing?null:false,error:error.message,errorCode:error.code||'RESERVATION_WRITE'}
  }
 })
}
