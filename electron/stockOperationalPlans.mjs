import {stockLedgerError} from './stockOpeningPlan.mjs'
import {PHYSICAL_STOCKTAKE,PHYSICAL_MEANING,assertPhysicalStocktakeReceipt} from './physicalStocktake.mjs'
import {planFundedRestaurantStock} from './restaurantFundsStock.mjs'

export function planOperationalStock(c,method){
 const {input,evidence,stockOwner:owner,stockUnits:units,stockLineValue:value}=c
 if(method==='addProduct'){
  const product=c.product(input.id)
  if(product.beforeUnits!==0)throw stockLedgerError('HISTORY')
  if(product.afterUnits)c.acquire(product.id,product.afterUnits,product.referenceUnitCostCents>0?value(product.afterUnits,product.referenceUnitCostCents):null,'3901',product.referenceUnitCostCents>0?'entered-product-reference':'unknown',product.id)
  return
 }
 if(method==='addWaste'){
  const waste=evidence.waste;if(!waste||waste.id!==input.id||waste.productId!==input.productId)throw stockLedgerError('HISTORY')
  c.move(owner('available'),owner('wasted','waste',waste.id),waste.productId,units(waste.qty));c.replace('JW'+waste.id);return
 }
 if(method==='applyRestaurantOperation')return restaurant(c)
 if(input.kind==='stocktake'){
  const physical=input.protocol===PHYSICAL_STOCKTAKE?assertPhysicalStocktakeReceipt(input,evidence.stocktake):null
  if(physical?input.quantityMeaning!==PHYSICAL_MEANING:input.quantityMeaning!=='available')throw stockLedgerError('INPUT')
  for(const count of input.counts){const product=c.product(count.id),delta=product.afterUnits-product.beforeUnits
   const frozen=physical?.rows.find(row=>row.fact.product.id===count.id)
   if(physical?product.beforeUnits!==frozen.fact.availableUnits||product.afterUnits!==frozen.availableAfterUnits:product.beforeUnits!==units(count.expectedStock)||product.afterUnits!==units(count.stock))throw stockLedgerError('HISTORY')
   if(delta>0)c.acquire(product.id,delta,!physical&&product.referenceUnitCostCents>0?value(delta,product.referenceUnitCostCents):null,'4191',physical?'count-unknown':product.referenceUnitCostCents>0?'count-reference':'unknown',product.id)
   else if(delta<0)c.move(owner('available'),owner('wasted','stocktake',input.id),product.id,-delta)
  }return
 }
 const inventory=evidence.inventory
 if(!inventory||!['receive','receive-lots','purchase-return'].includes(input.kind)||inventory.kind!==input.kind||inventory.purchaseId!==input.purchaseId||!Array.isArray(inventory.items))throw stockLedgerError('HISTORY')
 if(['receive','receive-lots'].includes(input.kind)){
  let total=0
  inventory.items.forEach((item,index)=>{
   const count=units(input.quantities[index]);if(!count)return
   const product=c.product(item.productId);if(item.unit&&item.unit!==product.unit)throw stockLedgerError('HISTORY')
   const before=units(inventory.beforeReceived[index]),rate=Math.round(item.unitCost*100),cost=value(before+count,rate)-value(before,rate)
   total+=cost;c.acquire(item.productId,count,inventory.modern||rate>0?cost:null,inventory.modern?'2102':'2291',inventory.modern?'recorded-purchase-receipt':'legacy-receiving-pending-financial-source',index)
  })
  if(inventory.modern){if(Math.round(inventory.event.amount*100)!==total)throw stockLedgerError('HISTORY');c.replace('JP-'+input.id)}
  else c.note({kind:'legacy-receiving-financial-source-pending',purchaseId:input.purchaseId})
 }else{
  const event=inventory.event;if(!event||event.id!==input.id||!Number.isSafeInteger(inventory.creditCents)||inventory.creditCents<0)throw stockLedgerError('HISTORY')
  const destination=owner('supplierReturned','purchase-return',input.id)
  inventory.items.forEach((item,index)=>{const count=units(input.quantities[index]);if(count)c.move(owner('available'),destination,item.productId,count)})
  c.line(event.invoiceId?'2101':'2102',inventory.creditCents,0);c.line('2291',0,inventory.creditCents)
  c.note({kind:'supplier-return-clearing',owner:destination,creditCents:inventory.creditCents,cleared:false});c.replace('JP-'+input.id)
 }
}

function restaurant(c){
 const {input,evidence,stockOwner:owner,stockUnits:units,stockLineValue:value}=c,{beforeEntry:before,entry}=evidence
 if(!entry||!Array.isArray(entry.allocations))throw stockLedgerError('HISTORY')
 if(entry.funds)return planFundedRestaurantStock(c)
 const held=owner('reserved','reservation',entry.id),used=owner('consumed','restaurant',entry.id)
 if(input.action==='create'){
  if(before)throw stockLedgerError('HISTORY')
  for(const row of entry.allocations)c.move(owner('available'),held,row.id,units(row.qty))
 }else if(input.action==='pay'){
  if(!before||before.saleId||!entry.saleId)throw stockLedgerError('HISTORY')
  for(const row of before.allocations)c.move(held,used,row.id,units(row.qty))
  c.replace('J'+entry.saleId+'_cogs')
 }else if(input.action==='cancel'){
  if(!before||entry.status!=='cancelled')throw stockLedgerError('HISTORY')
  before.allocations.forEach((row,index)=>{
   const count=units(row.qty),from=before.saleId?used:held
   if(before.saleId&&!c.hasOrigin(from,row.id)){
    // Outstanding paid reservations from before the cutover have explicit
    // reference evidence; no historical FIFO layer is invented for them.
    if(c.previous.business?.some(b=>b.method==='applyRestaurantOperation'&&b.notes.some(note=>note.kind==='restaurant-paid'&&note.entryId===entry.id)))throw stockLedgerError('HISTORY')
    const rate=Math.round(row.unitCost*100),cost=rate>0?value(count,rate):null
    c.acquire(row.id,count,cost,'5101',cost===null?'unknown-legacy-restaurant':'legacy-paid-reservation-return',index,before.startedAt?owner('wasted','restaurant-cancel',entry.id):owner('available'))
   }else c.move(from,before.startedAt?owner('wasted','restaurant-cancel',entry.id):owner('available'),row.id,count,!!before.saleId&&!before.startedAt)
   if(before.startedAt)c.replace('JW'+'rw-'+input.id+'-'+index)
  })
  if(entry.refundId)c.replace('J'+entry.refundId+'_cogs')
 }else if(input.action!=='advance')throw stockLedgerError('HISTORY')
 if(input.action==='pay')c.note({kind:'restaurant-paid',entryId:entry.id,saleId:entry.saleId})
}
