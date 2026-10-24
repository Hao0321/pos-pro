import {draftObject,privateDraftDigest} from './privateDrafts.mjs'
import {canonicalSignature,operationHeader} from './operationRules.mjs'
import {reservationError,reservationId,reservationText} from './reservationConfig.mjs'
import {reservationParts} from './reservationCalendar.mjs'

export const RESERVATION_DINING_PROTOCOL='pos-reservation-dining/v1'
export const RESERVATION_DINING_FIELDS=['bookingId','expectedBookingRevision','memberId','order','reviewed']
export const reservationDiningOperationId=(storeId,orderId)=>'reservation-dining-'+privateDraftDigest([storeId,orderId]).slice(0,48)
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
export function reservationDiningSchedule(time,timeZone){const part=reservationParts(Date.parse(time),timeZone),[hour,minute]=part.slot.split(':');return {day:part.date,slot:hour+':'+String(Math.floor(Number(minute)/15)*15).padStart(2,'0')}}
export function reservationDiningMetadata(input,state){
 const booking=state.bookings.find(row=>row.id===input.bookingId)
 if(!booking||booking.revision!==input.expectedBookingRevision||booking.status!=='seated')throw reservationError('STALE')
 if(input.memberId!==null)reservationId(input.memberId)
 if(booking.memberId&&booking.memberId!==input.memberId)throw reservationError('CONFIG')
 const tableIds=[...booking.tableIds],tableNames=tableIds.map(id=>state.config.tables.find(row=>row.id===id)?.name)
 if(!tableIds.length||tableNames.some(name=>typeof name!=='string'))throw reservationError('CONFIG')
 return {protocol:RESERVATION_DINING_PROTOCOL,parentId:input.id,bookingId:booking.id,bookingRevision:booking.revision,tableIds,tableNames,memberId:input.memberId}
}
export function assertReservationDiningMetadata(value){
 draftObject(value,['protocol','parentId','bookingId','bookingRevision','tableIds','tableNames','memberId'])
 if(value.protocol!==RESERVATION_DINING_PROTOCOL||!Number.isSafeInteger(value.bookingRevision)||value.bookingRevision<1||!Array.isArray(value.tableIds)||!value.tableIds.length||value.tableIds.length>10||new Set(value.tableIds).size!==value.tableIds.length||!Array.isArray(value.tableNames)||value.tableNames.length!==value.tableIds.length)throw reservationError('HISTORY')
 reservationId(value.parentId);reservationId(value.bookingId);for(const id of value.tableIds)reservationId(id);for(const name of value.tableNames)reservationText(name,50,true);if(value.memberId!==null)reservationId(value.memberId)
 return value
}
export function deriveReservationDining(input,state,now){
 if(!Number.isFinite(now))throw reservationError('HISTORY')
 const metadata=reservationDiningMetadata(input,state),booking=state.bookings.find(row=>row.id===input.bookingId),order=input.order
 operationHeader(order);assertReservationDiningMetadata(order.reservationDining)
 if(input.id!==reservationDiningOperationId(input.storeId,order.id)||order.kind!=='restaurant'||order.action!=='create'||order.channel!=='walkin'||order.storeId!==input.storeId||order.epoch!==input.epoch||order.customer!==booking.customer.name||order.contact!==booking.customer.contact||!same(order.reservationDining,metadata)||Math.abs(now-Date.parse(order.time))>300000)throw reservationError('HISTORY')
 const schedule=reservationDiningSchedule(order.time,state.config.timeZone)
 if(order.day!==schedule.day||order.slot!==schedule.slot)throw reservationError('TIME')
 const ids=booking.restaurantOrderIds||[];if(ids.includes(order.id)||ids.length>=100)throw reservationError('STATUS')
 const link={...metadata,orderId:order.id,requestSignature:canonicalSignature(order),createdAt:new Date(now).toISOString()}
 return {booking:{...structuredClone(booking),revision:booking.revision+1,updatedAt:new Date(now).toISOString(),memberId:input.memberId,restaurantOrderIds:[...ids,order.id]},diningLink:link}
}
export function reservationDiningLinks(state){return state.events.filter(event=>event.input.action==='dine').map(event=>structuredClone(event.change.diningLink))}
export function assertReservationDiningOrder(request,state,scope,now){
 const metadata=assertReservationDiningMetadata(request.reservationDining),input={id:metadata.parentId,bookingId:metadata.bookingId,expectedBookingRevision:metadata.bookingRevision,memberId:metadata.memberId,order:request,...scope}
 deriveReservationDining(input,state,now)
 return metadata
}
export function validateReservationDiningEntry(entry,created){
 if(!entry.reservationDining&&!created.reservationDining)return
 const metadata=assertReservationDiningMetadata(created.reservationDining)
 if(!same(entry.reservationDining,metadata)||entry.id!==created.id||metadata.parentId!==reservationDiningOperationId(created.storeId,created.id)||entry.tableNum!==metadata.tableNames.join(' + ')||!same(entry.tableIds,metadata.tableIds)||entry.tableId!==(metadata.tableIds.length===1?metadata.tableIds[0]:''))throw reservationError('HISTORY')
}
export function reservationDiningMissing(state,book,{strict=false}={}){
 const links=reservationDiningLinks(state)
 if(strict&&Array.isArray(book.restaurantOrders)&&book.restaurantOrders.some(entry=>entry.reservationDining&&!links.some(link=>link.orderId===entry.id)))throw reservationError('HISTORY')
 if(!links.length)return []
 if(!Array.isArray(book.restaurantOrders)||!Array.isArray(book.restaurantOperations)){if(strict)throw reservationError('HISTORY');return []}
 const missing=[]
 for(const link of links){const entry=book.restaurantOrders.find(row=>row.id===link.orderId),receipt=book.restaurantOperations.find(row=>row.id===link.orderId);if(!entry||!receipt){missing.push(link.orderId);continue}const created=JSON.parse(receipt.signature);if(receipt.signature!==link.requestSignature||!same(created.reservationDining,Object.fromEntries(['protocol','parentId','bookingId','bookingRevision','tableIds','tableNames','memberId'].map(key=>[key,link[key]]))))throw reservationError('HISTORY');validateReservationDiningEntry(entry,created)}
 return missing
}
