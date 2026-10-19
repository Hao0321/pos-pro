import {canonicalSignature} from './operationRules.mjs'
import {readExchangeTextSetting} from './businessExchange.mjs'
import {readRestaurantConfig} from './restaurantRules.mjs'
import {planReservation,reservationActor,reservationStaffView,reservationCommand} from './reservationModel.mjs'
import {readReservationBook,reservationAudit,reservationResult} from './reservationHistory.mjs'
import {RESERVATION_FENCE,RESERVATION_HEAD,reservationError} from './reservationConfig.mjs'
import {reservationOccupies} from './reservationCapacity.mjs'
import {makeReservationBarrier as makeActivation} from './reservationBarrier.mjs'
import {RESERVATION_PUBLIC_FENCE} from './reservationGuest.mjs'

export function reservationOrderingTables(book){return readRestaurantConfig(readExchangeTextSetting(book.settings||[],'restaurantConfig'),book.products||[]).tableOrdering?.tables||[]}
export function reservationData(book,scope,now,known=[]){
 const history=readReservationBook(book,known)
 return {history,data:{storeId:scope.storeId,epoch:scope.epoch,now,users:book.users,state:history.state,orderingTables:reservationOrderingTables(book)}}
}
export function reservationView(book,scope,now,known=[]){const {history,data}=reservationData(book,scope,now,known);return {storeId:scope.storeId,epoch:scope.epoch,...reservationStaffView(history.state,now),entries:history.receipts.map(row=>structuredClone(row)),orderingTables:structuredClone(data.orderingTables)}}
export function projectReservationBook(book,input,scope,actor,time,known=[],{allowGuest=false}={}){
 if(input?.action==='guest'&&!allowGuest)throw Error('權限不足')
 if(!allowGuest||input?.action!=='guest')reservationActor(actor,book.users);reservationCommand(input);const now=Date.parse(time),{history,data}=reservationData(book,scope,now,known),existing=history.byId.get(input.id)
 if(['configure','recover','publish'].includes(input?.action)&&actor.role!=='owner')throw Error('權限不足')
 if(existing)return {book,history,receipt:existing,result:reservationResult(input,existing,history,scope,now,data.orderingTables),existing:true}
 const planned=planReservation(input,data,actor,{allowGuest}),next=structuredClone(book),all=[...history.receipts,planned.receipt]
 if(input.action==='configure'&&data.orderingTables.length&&planned.event.change.config.tables.some(row=>!data.orderingTables.some(table=>table.id===row.id)))throw reservationError('CONFIG')
 next.auditLog=[...(next.auditLog||[]),...history.missing.map(reservationAudit),reservationAudit(planned.receipt)]
 if(!history.recorded.length)next.restaurantOperations=[...(next.restaurantOperations||[]),history.activation||makeActivation(planned.receipt)]
 const settings=new Map((next.settings||[]).map(row=>[row.key,row]));for(const key of ['agentMasterMigrationVersionFence','agentTabularMigrationVersionFence','agentWorkbookMigrationVersionFence','stockOpeningMigrationVersionFence','openingCutoverVersionFence',RESERVATION_FENCE])settings.set(key,{key,value:'1'});settings.set(RESERVATION_HEAD,{key:RESERVATION_HEAD,value:JSON.stringify(planned.event.hash)});next.settings=[...settings.values()]
 if(['guest','publish'].includes(input.action)){settings.set(RESERVATION_PUBLIC_FENCE,{key:RESERVATION_PUBLIC_FENCE,value:'1'});next.settings=[...settings.values()]}
 const saved=readReservationBook(next,known)
 if(saved.state.needsRecovery||canonicalSignature(saved.receipts)!==canonicalSignature(all))throw reservationError('HISTORY')
 return {book:next,history:saved,receipt:planned.receipt,event:planned.event,missing:history.missing,activation:!history.recorded.length?(history.activation||makeActivation(planned.receipt)):null,result:reservationResult(input,planned.receipt,saved,scope,now,data.orderingTables),existing:false}
}
export function assertReservationTableChange(before,after,now,known=[]){
 if(canonicalSignature(before.settings?.find(row=>row.key==='restaurantConfig'))===canonicalSignature(after.settings?.find(row=>row.key==='restaurantConfig')))return
 const history=readReservationBook(before,known),tables=reservationOrderingTables(after)
 if(history.state.needsRecovery)throw reservationError('RECOVERY')
 if(tables.length)for(const booking of history.state.bookings)if(reservationOccupies(booking)&&(booking.busyUntilMs>now||booking.status==='seated')&&booking.tableIds.some(id=>!tables.some(table=>table.id===id)))throw reservationError('CONFIG')
}
