import {replayStockLedger} from './stockLedgerModel.mjs'
import {assertStockCustodyMatchesBook,stockLedgerError} from './stockOpeningPlan.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {readExchangeTextSetting} from './businessExchange.mjs'
import {STOCK_COMPAT_SETTING} from './stockCompatibility.mjs'
import {PHYSICAL_STOCKTAKE,physicalStocktakeAudits} from './physicalStocktake.mjs'
import {assertStockBusinessCoverage} from './stockBusinessCoverage.mjs'
import {assertStockBookHead} from './stockBookAnchor.mjs'
import {validateFundedRestaurantRecords,fundedRestaurantSnapshot} from './restaurantFundedRecords.mjs'
import {WAREHOUSE_METHOD,WAREHOUSE_SETTING,warehouseDirectory} from './warehouseRules.mjs'
import {LOT_METHOD,LOT_SETTING,lotRegistry} from './lotRules.mjs'

import {LOT_COUNT_SETTING,lotCountGroups,lotCountReservations} from './lotCount.mjs'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const orderFields=['id','subtotal','discount','manualDiscount','balanceUsed','total','payMethod','paid','change','payments','memberId','pointsUsed','pointsEarned','time','source','items','taxId','shiftId','refundOf','cashier','fullRefund','trackingTokenHash','requestSignature','itemCosts','tableNum','note']
const immutableOrder=row=>Object.fromEntries(orderFields.map(key=>[key,row[key]??null]))

export function validateStockCostBook(book,validatedState=null){
 try{
  const physicalAudits=physicalStocktakeAudits(book.auditLog||[])
  if((book.settings||[]).some(row=>row.key===STOCK_COMPAT_SETTING&&row.value!=='1'))throw stockLedgerError('HISTORY')
  const hasEntries=Object.hasOwn(book,'stockCostEntries'),hasOperations=Object.hasOwn(book,'stockCostOperations')
  if(hasEntries!==hasOperations)throw stockLedgerError('HISTORY')
  if(!hasEntries&&(book.settings||[]).some(row=>row.key===STOCK_COMPAT_SETTING&&row.value==='1'))throw stockLedgerError('HISTORY')
  if(hasEntries&&(!Array.isArray(book.stockCostEntries)||!Array.isArray(book.stockCostOperations)))throw stockLedgerError('HISTORY')
  const state=validatedState||replayStockLedger(book.stockCostEntries||[],book.stockCostOperations||[])
  assertStockBookHead(book,state)
  const warehouseFlag=(book.settings||[]).find(row=>row.key===WAREHOUSE_SETTING)
  if(warehouseFlag&&warehouseFlag.value!=='1'||state.projection?.warehousing&&!warehouseFlag)throw stockLedgerError('HISTORY')
  const lotFlag=(book.settings||[]).find(row=>row.key===LOT_SETTING)
  if(lotFlag&&lotFlag.value!=='1'||state.projection?.lots&&!lotFlag||state.projection?.custody.version===2&&!state.projection.lots)throw stockLedgerError('HISTORY')
  const countFlag=(book.settings||[]).find(row=>row.key===LOT_COUNT_SETTING)
  if(countFlag&&countFlag.value!=='1'||state.projection?.lotCountVersion===1&&!countFlag)throw stockLedgerError('HISTORY')
  if(state.projection?.lots)lotCountGroups(state.projection)
  if(state.projection?.lotCountVersion===1&&!same(state.projection.lotCountReservations,lotCountReservations(state.projection.custody,book.restaurantOrders||[])))throw stockLedgerError('HISTORY')
  if(!state.projection){if(physicalAudits.some(row=>row.request.context.costMode==='active'))throw stockLedgerError('HISTORY');return state}
  validateFundedRestaurantRecords(book.restaurantOrders||[],book.restaurantOperations||[],book.orders||[],book.products||[],{cashLogs:book.cashLog,waste:book.wasteLog,storeId:readExchangeTextSetting(book.settings||[],'sharedStoreId'),menuReceiptKey:readExchangeTextSetting(book.settings||[],'orderReceiptSecret')})
  for(const row of physicalAudits.filter(row=>row.request.context.costMode==='active')){const event=state.entries.find(event=>event.method==='applyInventoryOperation'&&event.input.id===row.request.id);if(!event||!same(event.input,row.request)||!same(event.evidence?.stocktake,row.receipt))throw stockLedgerError('HISTORY')}
  if(state.entries[0].input.storeId!==readExchangeTextSetting(book.settings||[],'sharedStoreId'))throw stockLedgerError('HISTORY')
  if(state.projection.warehousing){const directory=warehouseDirectory(state.projection.warehousing);for(const row of directory.units)if(!book.products.some(product=>product.id===row.productId&&product.unit===row.productUnit))throw stockLedgerError('HISTORY')}
  if(state.projection.lots){const lots=lotRegistry(state.projection.lots,state.projection.custody);for(const row of lots.products)if(!book.products.some(product=>product.id===row.productId))throw stockLedgerError('HISTORY')}
  assertStockCustodyMatchesBook(state.projection.custody,book.products||[],book.restaurantOrders||[],state.projection.warehousing)
  assertStockBusinessCoverage(book,state)
  const orders=new Map((book.orders||[]).map(row=>[row.id,row])),restaurant=new Map((book.restaurantOrders||[]).map(row=>[row.id,row]))
  const receipt=(rows,id,input)=>{const row=(rows||[]).find(row=>row.id===id);if(!row||row.signature!==canonicalSignature(input))throw stockLedgerError('HISTORY')}
  for(const body of state.entries){
   const {method,input,evidence}=body
   if(!method||method==='applyStockCostOperation')continue
   if(method===WAREHOUSE_METHOD){if(input.storeId!==state.entries[0].input.storeId)throw stockLedgerError('HISTORY');continue}
   if(method===LOT_METHOD){if(input.storeId!==state.entries[0].input.storeId||input.action==='dispose'&&!same((book.wasteLog||[]).find(row=>row.id===evidence.waste.id),evidence.waste))throw stockLedgerError('HISTORY');continue}
   if(method==='checkout'||method==='refundOrder'){
    const order=orders.get(evidence.order.id)
    if(!order||!same(immutableOrder(order),immutableOrder(evidence.order)))throw stockLedgerError('HISTORY')
   }else if(method==='applyRestaurantOperation'){
    receipt(book.restaurantOperations,input.id,input)
    const entry=restaurant.get(evidence.entry.id)
    if(entry?.funds){
      const source=book.restaurantOperations.find(row=>row.id===input.id)
      if(source.entityId!==entry.id||source.entityVersion!==evidence.entry.version||!same(source.actor,body.actor)||!same(evidence.entry,fundedRestaurantSnapshot(entry,book.restaurantOperations,source.entityVersion))||!same(evidence.beforeEntry,source.entityVersion===1?null:fundedRestaurantSnapshot(entry,book.restaurantOperations,source.entityVersion-1)))throw stockLedgerError('HISTORY')
    }else if(!entry||!same(entry.items,evidence.entry.items)||!same(entry.allocations,evidence.entry.allocations)||evidence.entry.saleId&&entry.saleId!==evidence.entry.saleId||evidence.entry.refundId&&entry.refundId!==evidence.entry.refundId)throw stockLedgerError('HISTORY')
   }else if(method==='applySalesOperation'){
    receipt(book.salesOperations,input.id,input)
    const doc=(book.salesDocuments||[]).find(row=>row.id===evidence.document.id),event=doc?.[input.action==='deliver'?'deliveries':'returns']?.find(row=>row.id===input.id)
    if(!doc||!same(doc.items,evidence.document.items)||!same(event,evidence.event))throw stockLedgerError('HISTORY')
   }else if(method==='applyInventoryOperation'){
    const audit=(book.auditLog||[]).find(row=>row.id==='stock-operation:'+input.id),saved=audit&&(typeof audit.detail==='string'?JSON.parse(audit.detail):audit.detail)
    if(!saved||saved.signature!==canonicalSignature(input))throw stockLedgerError('HISTORY')
    if(input.protocol===PHYSICAL_STOCKTAKE&&!same(saved.stocktake,evidence.stocktake))throw stockLedgerError('HISTORY')
    if(evidence.inventory?.modern){const purchase=(book.purchases||[]).find(row=>row.id===input.purchaseId),event=purchase?.procurement?.[input.kind==='receive'?'receipts':'returns']?.find(row=>row.id===input.id);if(!same(event,evidence.inventory.event))throw stockLedgerError('HISTORY')}
   }else if(method==='addWaste'){
    if(!same((book.wasteLog||[]).find(row=>row.id===input.id),evidence.waste))throw stockLedgerError('HISTORY')
   }else if(method==='addProduct'){
    const product=(book.products||[]).find(row=>row.id===input.id)
    if(!product||product.unit!==evidence.products.find(row=>row.id===input.id)?.unit)throw stockLedgerError('HISTORY')
   }
  }
  return state
 }catch(error){if(error.code==='STOCK_LEDGER_HISTORY')throw error;throw stockLedgerError('HISTORY')}
}
