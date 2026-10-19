import {canonicalSignature} from './operationRules.mjs'
import {readExchangeTextSetting} from './businessExchange.mjs'
import {readRestaurantConfig,validateRestaurantRecords} from './restaurantRules.mjs'
import {planReservation,reservationActor,reservationStaffView,reservationCommand} from './reservationModel.mjs'
import {readReservationBook,reservationAudit,reservationResult} from './reservationHistory.mjs'
import {RESERVATION_FENCE,RESERVATION_HEAD,reservationError} from './reservationConfig.mjs'
import {reservationOccupies} from './reservationCapacity.mjs'
import {makeReservationBarrier as makeActivation} from './reservationBarrier.mjs'
import {RESERVATION_PUBLIC_FENCE} from './reservationGuest.mjs'
import {RESERVATION_SERVICE_FENCE} from './reservationService.mjs'
import {reservationReception,assertReservationReception} from './reservationReception.mjs'

export function reservationOrderingTables(book){return readRestaurantConfig(readExchangeTextSetting(book.settings||[],'restaurantConfig'),book.products||[]).tableOrdering?.tables||[]}
export function reservationData(book,scope,now,known=[],options={}){
 const history=readReservationBook(book,known)
 return {history,data:{storeId:scope.storeId,epoch:scope.epoch,now,users:book.users,members:book.members||[],costMode:options.costMode||(book.stockCostEntries?.length?'active':'reference'),state:history.state,orderingTables:reservationOrderingTables(book)}}
}
export function reservationView(book,scope,now,known=[]){const {history,data}=reservationData(book,scope,now,known),state={storeId:scope.storeId,epoch:scope.epoch,...reservationStaffView(history.state,now),entries:history.receipts.map(row=>structuredClone(row)),orderingTables:structuredClone(data.orderingTables)};if(Array.isArray(book.restaurantOrders)){if(Array.isArray(book.orders))validateRestaurantRecords(book.restaurantOrders,book.restaurantOperations,book.orders,book.products,{cashLogs:book.cashLog,waste:book.wasteLog,storeId:scope.storeId,config:readRestaurantConfig(readExchangeTextSetting(book.settings,'restaurantConfig'),book.products),menuConfigurationId:readExchangeTextSetting(book.settings,'restaurantMenuConfigurationId'),menuReceiptKey:readExchangeTextSetting(book.settings,'orderReceiptSecret')});state.reception=reservationReception(history.state,book.restaurantOrders,history.diningMissing)}return assertReservationReception(state)}
export function assertReservationMemberRemoval(before,after,known=[]){const retained=new Set((after.members||[]).map(row=>row.id)),removed=new Set((before.members||[]).filter(row=>!retained.has(row.id)).map(row=>row.id));if(removed.size&&readReservationBook(before,known).state.bookings.some(row=>removed.has(row.memberId)))throw Error('會員已有訂位與餐飲紀錄，請保留會員資料。')}
export function projectReservationBook(book,input,scope,actor,time,known=[],{allowGuest=false,costMode}={}){
 if(input?.action==='guest'&&!allowGuest)throw Error('權限不足')
 if(!allowGuest||input?.action!=='guest')reservationActor(actor,book.users);reservationCommand(input);const now=Date.parse(time),{history,data}=reservationData(book,scope,now,known,{costMode}),existing=history.byId.get(input.id)
 if(['configure','recover','publish','protect','access'].includes(input?.action)&&actor.role!=='owner')throw Error('權限不足')
 if(existing)return {book,history,receipt:existing,result:reservationResult(input,existing,history,scope,now,data.orderingTables),existing:true}
 if(input.action==='recover'&&history.diningMissing?.length)throw reservationError('DINING_RECOVERY')
 const planned=planReservation(input,data,actor,{allowGuest}),next=structuredClone(book),all=[...history.receipts,planned.receipt]
 if(input.action==='configure'&&data.orderingTables.length&&planned.event.change.config.tables.some(row=>!data.orderingTables.some(table=>table.id===row.id)))throw reservationError('CONFIG')
 next.auditLog=[...(next.auditLog||[]),...history.missing.map(reservationAudit),reservationAudit(planned.receipt)]
 if(!history.recorded.length)next.restaurantOperations=[...(next.restaurantOperations||[]),history.activation||makeActivation(planned.receipt)]
 const settings=new Map((next.settings||[]).map(row=>[row.key,row]));for(const key of ['agentMasterMigrationVersionFence','agentTabularMigrationVersionFence','agentWorkbookMigrationVersionFence','stockOpeningMigrationVersionFence','openingCutoverVersionFence',RESERVATION_FENCE])settings.set(key,{key,value:'1'});settings.set(RESERVATION_HEAD,{key:RESERVATION_HEAD,value:JSON.stringify(planned.event.hash)});next.settings=[...settings.values()]
 if(['guest','publish','protect','access','dine'].includes(input.action)){settings.set(RESERVATION_PUBLIC_FENCE,{key:RESERVATION_PUBLIC_FENCE,value:'1'});next.settings=[...settings.values()]}
 if(['protect','access','dine'].includes(input.action)){settings.set(RESERVATION_SERVICE_FENCE,{key:RESERVATION_SERVICE_FENCE,value:'1'});next.settings=[...settings.values()]}
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
