import {canonicalSignature} from './operationRules.mjs'
import {stockLedgerError} from './stockOpeningPlan.mjs'
import {expectedRestaurantFundedPostings,restaurantFundsWaste} from './restaurantFundedPlan.mjs'

// A valid event prefix alone is insufficient: a full refund or a zero-effect
// change can leave today's quantities unchanged after its cost tail is lost.
export function assertStockBusinessCoverage(book,state){
  const legacy=state.projection.legacyOperationIds
  if(!legacy)return // Older model-only snapshots have no frozen source index.
  const methods=['checkout','refundOrder','addProduct','addWaste','applyInventoryOperation','applyRestaurantOperation','applySalesOperation']
  if(methods.some(method=>!Array.isArray(legacy[method])))throw stockLedgerError('HISTORY')
  const events=new Map(state.entries.filter(row=>row.method).map(row=>[canonicalSignature([row.method,row.input.id]),row]))
  const original=(method,id)=>legacy[method].includes(id)||events.has(canonicalSignature([method,id]))
  const restaurants=state.entries.filter(row=>row.method==='applyRestaurantOperation')
  for(const order of book.orders||[]){
    if(order.source==='customer')continue
    const method=order.refundOf?'refundOrder':'checkout'
    if(original(method,order.id))continue
    if(!restaurants.some(row=>row.evidence.entry.funds?expectedRestaurantFundedPostings(row.evidence.entry).some(posting=>posting.eventId===row.input.id&&posting.order.id===order.id):row.input.action==='pay'&&row.evidence.entry.saleId===order.id||row.input.action==='cancel'&&row.evidence.entry.refundId===order.id))throw stockLedgerError('HISTORY')
  }
  for(const product of book.products||[]){
    if(original('addProduct',product.id))continue
    if(!state.entries.some(row=>row.method==='applyInventoryOperation'&&row.input.kind==='receive'&&row.evidence.products.some(pair=>pair.id===product.id&&pair.beforeUnits===0&&pair.afterUnits>0)))throw stockLedgerError('HISTORY')
  }
  for(const waste of book.wasteLog||[]){
    if(original('addWaste',waste.id))continue
    if(restaurants.some(row=>row.evidence.entry.funds&&row.evidence.entry.funds.events.filter(event=>event.id===row.input.id).flatMap(restaurantFundsWaste).some(expected=>canonicalSignature(expected)===canonicalSignature(waste))))continue
    const cancellation=restaurants.find(row=>row.input.action==='cancel'&&row.evidence.beforeEntry?.startedAt&&row.evidence.beforeEntry.allocations.some((allocation,index)=>{
      const expected={id:'rw-'+row.input.id+'-'+index,productId:allocation.id,productName:allocation.name,qty:allocation.qty,reason:'預訂取消：'+row.input.reason.trim(),cost:allocation.unitCost,time:row.input.time,cashier:row.actor.username||''}
      return Object.entries(expected).every(([key,value])=>waste[key]===value)
    }))
    if(!cancellation)throw stockLedgerError('HISTORY')
  }
  for(const audit of book.auditLog||[]){
    if(audit.action!=='INVENTORY_OPERATION'||!audit.id.startsWith('stock-operation:'))continue
    if(legacy.applyInventoryOperation.includes(audit.id.slice('stock-operation:'.length)))continue
    const detail=typeof audit.detail==='string'?JSON.parse(audit.detail):audit.detail,input=JSON.parse(detail.signature)
    if(['receive','purchase-return','stocktake'].includes(input.kind)&&!original('applyInventoryOperation',input.id))throw stockLedgerError('HISTORY')
  }
  for(const receipt of book.restaurantOperations||[])if(receipt.action!=='configure'&&!original('applyRestaurantOperation',receipt.id))throw stockLedgerError('HISTORY')
  for(const receipt of book.salesOperations||[])if(['deliver','return'].includes(receipt.action)&&!original('applySalesOperation',receipt.id))throw stockLedgerError('HISTORY')
  return true
}
