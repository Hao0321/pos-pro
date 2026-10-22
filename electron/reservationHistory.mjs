import {reservationParts} from './reservationCalendar.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {replayReservationReceipts,reservationReceipt,reservationCommand,reservationStaffView} from './reservationModel.mjs'
import {makeReservationBarrier,readReservationBarrier,RESERVATION_BARRIER} from './reservationBarrier.mjs'
import {RESERVATION_ACTION,RESERVATION_HEAD,RESERVATION_FENCE,RESERVATION_METHOD,reservationError} from './reservationConfig.mjs'
import {readExchangeTextSetting} from './businessExchange.mjs'
import {RESERVATION_PUBLIC_FENCE} from './reservationGuest.mjs'
import {RESERVATION_SERVICE_FENCE} from './reservationService.mjs'
import {reservationDiningMissing,reservationDiningLinks} from './reservationDining.mjs'
import {assertReservationReception} from './reservationReception.mjs'
import {RESERVATION_DEPOSIT_FENCE} from './reservationDepositPolicy.mjs'
import {RESERVATION_DEPOSIT_FIELDS,reservationDepositMissing,assertReservationDepositView} from './reservationDeposits.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),clone=value=>structuredClone(value)
const bad=()=>{throw reservationError('HISTORY')}
export function reservationAudit(receipt){const event=receipt.event;return {id:'reservation:'+receipt.id,action:RESERVATION_ACTION,level:'info',label:'訂位操作紀錄',userId:event.actor.userId,username:event.actor.username,role:event.actor.role,timestamp:event.time,detail:JSON.stringify(receipt)}}
function readAudit(row){const receipt=typeof row.detail==='string'?JSON.parse(row.detail):row.detail,expected=reservationAudit(receipt);if(!same({...row,detail:JSON.stringify(receipt)},expected))bad();return receipt}
export function reservationKnownReceipts(graph,storeId){
 const snapshots=new Map((graph?.snapshots||[]).map(row=>[row.id,row])),books=new Map((graph?.books||[]).map(row=>[row.id,row])),parsed=new Map(),known=new Map()
 for(const row of graph?.originalIds||[]){if(row[0]!==RESERVATION_METHOD)continue;const snapshot=snapshots.get(row[2]),source=snapshot&&books.get(snapshot.bookId);if(!source)bad();let book=parsed.get(source.id);if(!book){book=JSON.parse(source.data);parsed.set(source.id,book)}
  const audit=(book.auditLog||book.pos_audit_log||[]).find(item=>item.id==='reservation:'+row[1]);if(!audit)bad();const receipt=readAudit(audit);if(receipt.id!==row[1])bad();if(receipt.event.storeId!==storeId)continue
  const prior=known.get(receipt.id);if(prior&&!same(prior,receipt))bad();known.set(receipt.id,receipt)
 }
 return [...known.values()].sort((a,b)=>a.revision-b.revision)
}
export function readReservationBook(book,known=[],options={}){
 try{return inspect(book,known,options)}catch(cause){throw Object.assign(reservationError('HISTORY'),{cause})}
}
function inspect(book,known,options){
 const settings=book.settings||[],setting=key=>{const rows=settings.filter(row=>row.key===key);if(rows.length>1)bad();return rows[0]?.value},storeId=readExchangeTextSetting(settings,'sharedStoreId'),flag=setting(RESERVATION_FENCE),rawHead=setting(RESERVATION_HEAD),head=rawHead===undefined?null:JSON.parse(rawHead)
 if(flag!==undefined&&flag!=='1')bad()
 const recorded=(book.auditLog||[]).filter(row=>row.action===RESERVATION_ACTION||String(row.id).startsWith('reservation:')).map(readAudit).sort((a,b)=>a.revision-b.revision),rows=new Map()
 for(const receipt of [...recorded,...known]){if(receipt.event.storeId!==storeId)bad();const prior=rows.get(receipt.id);if(prior&&!same(prior,receipt))bad();rows.set(receipt.id,receipt)}
 const all=[...rows.values()].sort((a,b)=>a.revision-b.revision)
 const publicFlag=setting(RESERVATION_PUBLIC_FENCE)
 if(publicFlag!==undefined&&publicFlag!=='1'||all.some(row=>['publish','guest'].includes(row.event.input.action))&&publicFlag!=='1')bad()
 const serviceFlag=setting(RESERVATION_SERVICE_FENCE)
 if(serviceFlag!==undefined&&(serviceFlag!=='1'||publicFlag!=='1')||all.some(row=>['protect','access','dine'].includes(row.event.input.action))&&serviceFlag!=='1')bad()
 const depositFlag=setting(RESERVATION_DEPOSIT_FENCE)
 if(depositFlag!==undefined&&(depositFlag!=='1'||serviceFlag!=='1')||all.some(row=>Object.hasOwn(RESERVATION_DEPOSIT_FIELDS,row.event.input.action))&&depositFlag!=='1')bad()
 if(all.length&&(flag!=='1'||all[0].event.input.action!=='configure'))bad()
 const stored=replayReservationReceipts(recorded,storeId),state=replayReservationReceipts(all,storeId)
 if(head!==stored.head)bad()
 for(const [index,receipt]of recorded.entries())if(!same(receipt,all[index]))bad()
 const barriers=(book.restaurantOperations||[]).filter(row=>row.kind===RESERVATION_BARRIER||String(row.id).startsWith('reservation-barrier-'))
 if(recorded.length){if(barriers.length!==1||!same(readReservationBarrier(barriers[0]),recorded[0]))bad()}else if(barriers.length)bad()
 if(reservationDiningMissing(stored,book).length)bad()
 const diningMissing=reservationDiningMissing(state,book,{strict:options.strictDining===true})
 if(reservationDepositMissing(stored,book,{strict:true}).length)bad()
 const depositMissing=reservationDepositMissing(state,book);state.depositRecovery=depositMissing.length>0
 state.needsRecovery=recorded.length<all.length||diningMissing.length>0||depositMissing.length>0
 return {state,receipts:all,recorded,diningMissing,depositMissing,missing:all.filter(row=>!recorded.some(saved=>saved.id===row.id)),activation:all.length?makeReservationBarrier(all[0]):null,storedHead:stored.head,byId:new Map(all.map(row=>[row.id,row]))}
}
export function reservationResult(request,receipt,history,scope,now,orderingTables=[]){
 reservationCommand(request)
 if(receipt?.signature!==canonicalSignature(request)||receipt.id!==request.id||receipt.event.storeId!==scope.storeId)throw Object.assign(reservationError('HISTORY'),{operationConflict:true})
 return {success:true,receipt:clone(receipt),storeId:scope.storeId,epoch:scope.epoch,state:{storeId:scope.storeId,epoch:scope.epoch,...reservationStaffView(history.state,now),entries:history.receipts.map(clone),orderingTables:clone(orderingTables)}}
}
export function assertReservationResult(request,result){
 if(result?.success!==true||result.storeId!==request.storeId||typeof result.epoch!=='string'||!result.state||result.state.storeId!==result.storeId||result.state.epoch!==result.epoch||!Array.isArray(result.state.orderingTables)||!Array.isArray(result.state.entries))bad()
 if(typeof result.state.now!=='string'||!Number.isFinite(Date.parse(result.state.now))||reservationParts(Date.parse(result.state.now),result.state.config?.timeZone).date!==result.state.today)bad()
 const replay=replayReservationReceipts(result.state.entries,result.storeId),receipt=result.state.entries.find(row=>row.id===request.id)
 if(!same(receipt,result.receipt)||receipt.signature!==canonicalSignature(request)||!same(receipt,reservationReceipt(receipt.event)))bad()
 if(!same(replay.config,result.state.config)||!same(replay.bookings,result.state.bookings)||!same(replay.guestLinkPolicy,result.state.guestLinkPolicy)||!same(reservationDiningLinks(replay),result.state.diningLinks)||replay.revision!==result.state.revision||replay.configVersion!==result.state.configVersion||replay.publicEnabled!==result.state.publicEnabled||replay.head!==result.state.head||typeof result.state.needsRecovery!=='boolean')bad()
 // Ordinary format17 responses predate deposit fields. Accept their absence
 // only while the replayed original history contains no deposit feature.
 if(!same(replay.depositPolicy,result.state.depositPolicy===undefined?null:result.state.depositPolicy)||replay.depositPolicy&&typeof result.state.depositRecovery!=='boolean'||!replay.depositPolicy&&result.state.depositRecovery===true||result.state.depositRecovery!==undefined&&typeof result.state.depositRecovery!=='boolean')bad();assertReservationDepositView(result.state);assertReservationReception(result.state);return result
}
