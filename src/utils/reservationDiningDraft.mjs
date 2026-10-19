import {draftObject} from '../../electron/privateDrafts.mjs'
import {reservationId,reservationText} from '../../electron/reservationConfig.mjs'
import {reservationDiningOperationId,reservationDiningSchedule} from '../../electron/reservationDining.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'

export function diningDraftSource(context){const booking=context.booking;return {storeId:context.storeId,epoch:context.epoch,bookingId:booking.id,bookingRevision:booking.revision,memberId:booking.memberId||null,customer:structuredClone(booking.customer),tableIds:[...booking.tableIds],tableNames:[...context.tableNames],timeZone:context.timeZone,note:booking.note}}
export function validDiningDraft(value,context,baseValidate,bookingId){try{
 const {dining,...base}=value;draftObject(dining,['storeId','epoch','bookingId','bookingRevision','memberId','customer','tableIds','tableNames','timeZone','note'])
 for(const key of ['storeId','epoch','bookingId'])reservationId(dining[key]);if(dining.memberId!==null)reservationId(dining.memberId)
 if(dining.storeId!==context.storeId||dining.epoch!==context.epoch||dining.bookingId!==bookingId||!Number.isSafeInteger(dining.bookingRevision)||dining.bookingRevision<1||!Array.isArray(dining.tableIds)||!dining.tableIds.length||dining.tableIds.length>10||!Array.isArray(dining.tableNames)||dining.tableNames.length!==dining.tableIds.length)return false
 draftObject(dining.customer,['name','contact']);reservationText(dining.customer.name,100,true);reservationText(dining.customer.contact,100);reservationText(dining.note,500,false,true);for(const id of dining.tableIds)reservationId(id);for(const name of dining.tableNames)reservationText(name,50,true);reservationDiningSchedule(new Date().toISOString(),dining.timeZone)
 return baseValidate(base,context)===true
}catch{return false}}
export function diningForm(source,time){return {channel:'walkin',...reservationDiningSchedule(time,source.timeZone),customer:source.customer.name,contact:source.customer.contact,note:source.note||''}}
export function assertDiningDraftCurrent(source,context){const fresh=diningDraftSource(context),withoutMember=value=>({...value,memberId:null});if(canonicalSignature(withoutMember(source))!==canonicalSignature(withoutMember(fresh))||fresh.memberId&&source.memberId!==fresh.memberId||source.memberId!==null&&!context.members.some(row=>row.id===source.memberId))throw Error('桌位或客人資料已更新，請保留餐點並重新核對。');return context}
export function diningParent(child,revision){return {protocol:'pos-reservation/v1',action:'dine',storeId:child.storeId,epoch:child.epoch,expectedRevision:revision,bookingId:child.reservationDining.bookingId,expectedBookingRevision:child.reservationDining.bookingRevision,memberId:child.reservationDining.memberId,order:child,reviewed:true}}
export function diningPending(pending,bookingId){return pending?.kind==='reservation'&&pending.request.action==='dine'&&pending.request.bookingId===bookingId?{...pending,kind:'restaurant',request:pending.request.order}:pending}
export function diningParentIdentity(child){return {id:reservationDiningOperationId(child.storeId,child.id),time:child.time}}
