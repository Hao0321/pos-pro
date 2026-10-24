import {draftObject,privateDraftDigest} from './privateDrafts.mjs'
import {reservationError,reservationId,reservationInteger,reservationText} from './reservationConfig.mjs'
import {reservationBookingId} from './reservationModel.mjs'

export const GUEST_RESERVATION_PROTOCOL='pos-reservation-guest/v1'
export const RESERVATION_PUBLIC_FENCE='reservationPublicVersionFence'
export function guestReservationRequest(value){
 const fields={book:['configVersion','date','slot','partySize','customer','note','accessHash'],move:['configVersion','bookingId','expectedBookingRevision','date','slot','partySize'],cancel:['bookingId','expectedBookingRevision']}
 if(!Object.hasOwn(fields,value?.action))throw reservationError('CONFIG')
 const quote=value.action==='book'&&Object.hasOwn(value,'depositQuoteHash')?['depositQuoteHash']:[]
 draftObject(value,['protocol','requestId','storeId','action',...fields[value.action],...quote]);if(quote.length&&(typeof value.depositQuoteHash!=='string'||!/^[a-f0-9]{64}$/.test(value.depositQuoteHash)))throw reservationError('CONFIG')
 if(value.protocol!==GUEST_RESERVATION_PROTOCOL||typeof value.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.requestId))throw reservationError('CONFIG')
 reservationId(value.storeId)
 if(value.action!=='book'){reservationId(value.bookingId);reservationInteger(value.expectedBookingRevision,1,Number.MAX_SAFE_INTEGER-1)}
 if(value.action!=='cancel'){reservationInteger(value.configVersion,1,Number.MAX_SAFE_INTEGER-1);reservationInteger(value.partySize,1,100);if(typeof value.date!=='string'||typeof value.slot!=='string')throw reservationError('TIME')}
 if(value.action==='book'){
  draftObject(value.customer,['name','contact']);reservationText(value.customer.name,100,true);reservationText(value.customer.contact,100,true);reservationText(value.note,1000,false,true)
  if(typeof value.accessHash!=='string'||!/^sha256:[a-f0-9]{64}$/.test(value.accessHash))throw reservationError('CONFIG')
 }
 return value
}
export const guestReservationOperationId=request=>'guest-reservation:'+request.requestId
export function guestReservationOriginal(state,bookingId){return state.events.find(event=>event.input.action==='guest'&&event.input.request.action==='book'&&event.change.booking.id===bookingId)}
export function guestReservationActor(input){
 const request=guestReservationRequest(input.request),bookingId=request.action==='book'?reservationBookingId(input.storeId,input.id):request.bookingId
 return {userId:'guest-'+privateDraftDigest([input.storeId,bookingId]).slice(0,48),username:'線上訂位客人',role:'guest'}
}
export function assertGuestReservationOwner(state,bookingId,accessHash){
 const original=guestReservationOriginal(state,bookingId)
 if(!original||original.input.request.accessHash!==accessHash)throw reservationError('STATUS')
 return original
}
