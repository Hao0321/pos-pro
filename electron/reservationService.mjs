import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex} from '@noble/hashes/utils.js'
import {reservationError,reservationText} from './reservationConfig.mjs'
import {guestReservationOriginal} from './reservationGuest.mjs'

export const RESERVATION_SERVICE_FEATURE='reservation-service-v1',RESERVATION_SERVICE_FENCE='reservationServiceVersionFence'
export const RESERVATION_SERVICE_FIELDS={protect:['enabled','reviewed'],access:['bookingId','expectedBookingRevision','accessHash','reason','reviewed']}
export const hashGuestCapability=token=>{if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw reservationError('ACCESS');return 'sha256:'+bytesToHex(sha256(new TextEncoder().encode(token)))}
export function reservationGuestAccess(state,booking,now){
 const original=guestReservationOriginal(state,booking.id)
 if(!original)return null
 const saved=booking.guestAccess,hash=saved?saved.hash:original.input.request.accessHash,expiresAt=saved?saved.expiresAt:state.guestLinkPolicy?new Date(booking.endMs+state.guestLinkPolicy.graceDays*86400000).toISOString():null
 return {hash,expiresAt,active:!!hash&&(!expiresAt||now<Date.parse(expiresAt))}
}
export function deriveReservationService(input,state,actor,now){
 if(actor.role!=='owner')throw Error('權限不足')
 if(input.action==='protect'){
  if(typeof input.enabled!=='boolean'||input.enabled&&(!state.config.enabled||!state.config.tables.some(row=>row.online)))throw reservationError('CONFIG')
  return {publicEnabled:input.enabled,guestLinkPolicy:{graceDays:7}}
 }
 if(!state.guestLinkPolicy)throw reservationError('CONFIG')
 const booking=state.bookings.find(row=>row.id===input.bookingId)
 if(!booking||booking.revision!==input.expectedBookingRevision||!guestReservationOriginal(state,booking.id))throw reservationError('STALE')
 if(input.accessHash!==null&&(typeof input.accessHash!=='string'||!/^sha256:[a-f0-9]{64}$/.test(input.accessHash)))throw reservationError('CONFIG')
 const reason=reservationText(input.reason,500,true),expiresAt=new Date(input.accessHash?Math.max(now,booking.endMs)+7*86400000:now).toISOString()
 return {booking:{...structuredClone(booking),revision:booking.revision+1,updatedAt:new Date(now).toISOString(),guestAccess:{hash:input.accessHash,expiresAt}},reason}
}
