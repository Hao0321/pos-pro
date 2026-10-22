import {readReservationBook} from './reservationHistory.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {prepareStockOpening} from './stockOpening.mjs'
import {readExchangeTextSetting} from './businessExchange.mjs'
import {stockCostCommand,stockLedgerError} from './stockOpeningPlan.mjs'
import {projectStockLedger,stockLedgerDigest,stockLedgerAcknowledgement} from './stockLedgerModel.mjs'
import {verifyStockSetupReview} from './stockSetup.mjs'
import {withStockBookHead} from './stockBookAnchor.mjs'
import {salesDate} from './salesRules.mjs'

export function stockSetupOwner(book,actor){
  const user=book.users.find(row=>row.id===actor?.userId)
  if(!user||actor.role!=='owner'||user.role!==actor.role||user.username!==actor.username)throw Error('只有目前店主能核對庫存成本')
  return {userId:user.id,username:user.username,role:user.role}
}
export function prepareBrowserStockOpening(book,epoch){
  const storeId=readExchangeTextSetting(book.settings,'sharedStoreId'),value=prepareStockOpening({storeId,epoch,products:book.products,orders:book.orders,topups:book.memberTopups,wasteLog:book.wasteLog,purchases:book.purchases,salesDocuments:book.salesDocuments,customerEntries:book.customerEntries,supplierEntries:book.supplierEntries,manualJournal:book.manualJournal,restaurantEntries:book.restaurantOrders,reservationEntries:readReservationBook(book).recorded,inventoryAudits:book.auditLog})
  const ids=rows=>rows.map(row=>row.id).sort(),legacyOperationIds={checkout:ids(book.orders.filter(row=>!row.refundOf)),refundOrder:ids(book.orders.filter(row=>row.refundOf)),addProduct:ids(book.products),addWaste:ids(book.wasteLog),applyRestaurantOperation:ids(book.restaurantOperations),applySalesOperation:ids(book.salesOperations),applyInventoryOperation:book.auditLog.filter(row=>row.action==='INVENTORY_OPERATION').map(row=>row.id.slice('stock-operation:'.length)).sort()}
  const material=canonicalSignature({...JSON.parse(value.material),legacyOperationIds})
  return {preview:{...value.preview,snapshotDigest:stockLedgerDigest(material)},material}
}
export function appendBrowserStockSetup(before,after,state,command,runtime){
  if(runtime.stockSetupEnabled!==true)throw Error('成本設定尚未開放新保存，請保留原編號核對')
  if(canonicalSignature(before)!==canonicalSignature(after))throw Error('成本設定不能混入其他資料修改')
  const {request,actor,timestamp}=command||{},who=stockSetupOwner(before,actor),input=stockCostCommand(request)
  if(!input.review)throw Error('請先看成本結果，再確認保存')
  if(!Number.isFinite(Date.parse(timestamp))||Math.abs(Date.now()-Date.parse(timestamp))>300000||Math.abs(Date.now()-Date.parse(input.time))>300000)throw stockLedgerError('STALE')
  const storeId=readExchangeTextSetting(before.settings,'sharedStoreId')
  if(storeId!==input.storeId||runtime.epoch!==input.epoch)throw stockLedgerError('STALE')
  const opening=input.action==='open'?prepareBrowserStockOpening(before,runtime.epoch):null
  if(input.action==='open'&&state.projection)throw stockLedgerError('ACTIVE')
  if(input.action==='price'&&!state.projection)throw stockLedgerError('HISTORY')
  if(opening&&opening.preview.snapshotDigest!==input.snapshotDigest)throw stockLedgerError('STALE')
  if(before.stockCostOperations.some(row=>row.operationId===input.id&&row.method==='applyStockCostOperation'))throw stockLedgerError('HISTORY')
  verifyStockSetupReview(input,{state,preview:opening?.preview,products:before.products,storeId,epoch:runtime.epoch})
  const body={id:'stock-'+crypto.randomUUID(),sequence:state.entries.length+1,previousHash:state.head,beforeDigest:state.stateDigest,input,actor:who,time:timestamp,date:salesDate(new Date(timestamp)),openingMaterial:opening?.material||null}
  const projection=projectStockLedger(state.projection,body);body.afterDigest=stockLedgerDigest(projection)
  const hash=stockLedgerDigest(body),receipt=stockLedgerAcknowledgement(body,hash,projection),operation={id:canonicalSignature(['applyStockCostOperation',input.id]),method:'applyStockCostOperation',operationId:input.id,actorId:who.userId,signature:canonicalSignature(input),receipt}
  const settings=[...before.settings.filter(row=>row.key!=='stockCostVersionFence'),{key:'stockCostVersionFence',value:'1'}]
  return withStockBookHead({...before,settings,stockCostEntries:[...before.stockCostEntries,{...body,hash}],stockCostOperations:[...before.stockCostOperations,operation]},hash)
}
