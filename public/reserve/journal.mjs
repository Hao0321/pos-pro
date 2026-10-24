import {assertGuestDepositReceipt} from './deposit.mjs'
export const guestJournalKey=storeId=>'pos_guest_reservation_v1:'+storeId
const originalPrefix=storeId=>'pos_guest_reservation_original_v1:'+storeId+':'
const originalKey=(storeId,pending)=>originalPrefix(storeId)+pending.request.requestId
const validPending=(value,storeId)=>value&&value.request?.storeId===storeId&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.request.requestId)&&/^[a-f0-9]{64}$/.test(value.token)
export function guestRandom(bytes=32){return [...crypto.getRandomValues(new Uint8Array(bytes))].map(value=>value.toString(16).padStart(2,'0')).join('')}
export function guestRequestId(){const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=bytes[6]&15|64;bytes[8]=bytes[8]&63|128;const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)}
export function readGuestJournal(storage,storeId){
 const raw=storage.getItem(guestJournalKey(storeId)),value=raw?JSON.parse(raw):{version:1,storeId,draft:null,pending:null,receipt:null}
 if(value?.version!==1||value.storeId!==storeId||value.pending&&!validPending(value.pending,storeId))throw Error('journal')
 const pending=[]
 for(let index=0;index<storage.length;index++){const key=storage.key(index);if(!key?.startsWith(originalPrefix(storeId)))continue;const original=JSON.parse(storage.getItem(key));if(original?.status==='resolved')continue;if(original?.status!=='pending'||!validPending(original.pending,storeId)||key!==originalKey(storeId,original.pending))throw Error('journal');pending.push(original.pending)}
 if(pending.length>1)throw Error('multiple originals')
 if(pending.length)return {...value,pending:pending[0]}
 return value
}
export function saveGuestJournal(storage,storeId,value,expected){
 if(value.storeId!==storeId)throw Error('journal')
 const previous=readGuestJournal(storage,storeId)
 if(expected&&JSON.stringify(previous)!==JSON.stringify(expected)||previous.pending&&!value.pending&&!expected||previous.pending&&value.pending&&JSON.stringify(previous.pending)!==JSON.stringify(value.pending))throw Error('pending')
 // A separate original survives stale drafts and a failure between the two
 // writes. Each nonce has its own slot; simultaneous originals stop intake
 // instead of erasing either unresolved external commitment.
 if(value.pending){if(!validPending(value.pending,storeId))throw Error('journal');const key=originalKey(storeId,value.pending),original=JSON.stringify({status:'pending',pending:value.pending});storage.setItem(key,original);if(storage.getItem(key)!==original)throw Error('journal');readGuestJournal(storage,storeId)}
 const raw=JSON.stringify(value);storage.setItem(guestJournalKey(storeId),raw);if(storage.getItem(guestJournalKey(storeId))!==raw)throw Error('journal')
 if(previous.pending&&!value.pending){const key=originalKey(storeId,previous.pending),resolved=JSON.stringify({status:'resolved'});storage.setItem(key,resolved);if(storage.getItem(key)!==resolved)throw Error('journal')}
 if(JSON.stringify(readGuestJournal(storage,storeId))!==raw)throw Error('journal')
 return value
}
export function assertGuestReceipt(value,storeId,{request=null,bookingId=null}={}){
 const row=value?.booking
 if(value?.linkExpiresAt!==undefined&&value.linkExpiresAt!==null&&(typeof value.linkExpiresAt!=='string'||!Number.isFinite(Date.parse(value.linkExpiresAt))||new Date(value.linkExpiresAt).toISOString()!==value.linkExpiresAt))throw Error('receipt')
 if(value?.protocol!=='pos-reservation-guest-receipt/v1'||value.success!==true||value.storeId!==storeId||typeof value.needsRecovery!=='boolean'||typeof value.canCancel!=='boolean'||typeof value.canMove!=='boolean'||typeof value.originalRequestId!=='string'||!row||typeof row.id!=='string'||!/^booking-[a-f0-9]{48}$/.test(row.id)||!Number.isSafeInteger(row.revision)||row.revision<1||!['confirmed','arrived','seated','completed','cancelled','no-show'].includes(row.status)||typeof row.customer?.name!=='string'||typeof row.customer?.contact!=='string'||typeof row.note!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!/^\d{2}:\d{2}$/.test(row.slot)||!Number.isSafeInteger(row.partySize)||row.partySize<1||row.partySize>100||typeof row.timeZone!=='string'||bookingId&&row.id!==bookingId)throw Error('receipt')
 if(request&&(value.requestId!==request.requestId||request.action==='book'&&value.originalRequestId!==request.requestId||request.action!=='book'&&(row.id!==request.bookingId||row.revision<=request.expectedBookingRevision)))throw Error('receipt')
 if(value.deposit!==undefined){assertGuestDepositReceipt(value.deposit,row);if(value.needsRecovery&&!value.deposit.uncertain)throw Error('receipt')}
 if(request?.action==='book'&&request.depositQuoteHash!==undefined&&(value.deposit?.terms.hash!==request.depositQuoteHash||['date','slot','partySize'].some(key=>value.deposit.terms[key]!==request[key])))throw Error('receipt')
 return value
}
