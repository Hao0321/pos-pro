import {canonicalSignature} from './operationRules.mjs'
import {draftObject,privateDraftDigest} from './privateDrafts.mjs'
import {replayReservationReceipts} from './reservationModel.mjs'
import {reservationError} from './reservationConfig.mjs'

export const RESERVATION_BARRIER='reservation-read-barrier/v1'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
export function makeReservationBarrier(first){
 const id='reservation-barrier-'+privateDraftDigest([first.event.storeId,first.id]).slice(0,40)
 return {id,kind:RESERVATION_BARRIER,action:'reservation-activate',signature:canonicalSignature({id,time:first.event.time,protocol:RESERVATION_BARRIER,sourceId:first.id,sourceHash:first.event.hash}),source:structuredClone(first)}
}
export function readReservationBarrier(row){
 try{draftObject(row,['id','kind','action','signature','source']);const source=row.source;if(source.event.input.action!=='configure'||source.revision!==1)throw reservationError('HISTORY');replayReservationReceipts([source],source.event.storeId);if(!same(row,makeReservationBarrier(source)))throw reservationError('HISTORY');return source}catch{throw reservationError('HISTORY')}
}
export function ordinaryRestaurantOperations(operations){
 if(!Array.isArray(operations))throw reservationError('HISTORY')
 const barriers=operations.filter(row=>row?.kind===RESERVATION_BARRIER||String(row?.id).startsWith('reservation-barrier-'))
 if(barriers.length>1)throw reservationError('HISTORY');barriers.forEach(readReservationBarrier)
 return operations.filter(row=>!barriers.includes(row))
}
