import {canonicalSignature} from './operationRules.mjs'
import {depositError} from './reservationDepositPolicy.mjs'

// Connection/process-local synchronous authority. Transport input cannot set
// this value. A coordinator enters it only after authenticating and planning
// both originals under the ordinary business transaction/lock.
let active=null
const same=(left,right)=>canonicalSignature(left)===canonicalSignature(right)
export function withReservationDepositTransition(authority,work){
 if(active||typeof work!=='function'||work.constructor?.name==='AsyncFunction'||!authority?.request||!authority?.actor||!authority?.parentReceipt||!authority?.plannedEvent)throw depositError('SOURCE')
 active=structuredClone(authority)
 try{const value=work();if(value&&typeof value.then==='function')throw depositError('SOURCE');return value}finally{active=null}
}
export function assertReservationDepositTransition(request,actor,event){
 if(!active||!same(active.request,request)||!same(active.actor,{userId:actor.userId,username:actor.username,role:actor.role})||!same(active.plannedEvent,event))throw depositError('SOURCE')
 return structuredClone(active.parentReceipt)
}
export function pendingReservationDepositEvent(entryId,event){return !!active&&active.request.entryId===entryId&&same(active.plannedEvent,event)}
export function pendingReservationDepositParent(event){return !!active&&same(active.parentReceipt.event,event)}
