import {canonicalSignature,moneyValue,quantityValue} from './operationRules.mjs'
import {automaticBusinessJournal} from './businessJournal.mjs'
import {STOCK_COST_ERRORS} from './stockCost.mjs'

// This is a reference-only preview, not activation or authoritative valuation.
// The native/browser adapter owns hashing and must keep `material` private.
const MAX=BigInt(Number.MAX_SAFE_INTEGER)
const units=value=>Math.round(quantityValue(value,'庫存')*1000)
const cents=value=>Math.round(moneyValue(value,'成本')*100)
function referenceValue(rate,count){const value=(BigInt(rate)*BigInt(count)+500n)/1000n;return value>MAX?null:Number(value)}
function total(values){if(values.some(value=>value===null))return null;const sum=values.reduce((n,value)=>n+BigInt(value),0n);return sum>MAX?null:Number(sum)}
function fail(){throw Error(STOCK_COST_ERRORS.SOURCE)}
export function prepareStockOpening(data){
  const collections=['products','orders','topups','wasteLog','purchases','salesDocuments','customerEntries','supplierEntries','manualJournal','restaurantEntries']
  if(!data||typeof data.storeId!=='string'||!data.storeId||typeof data.epoch!=='string'||!data.epoch||collections.some(key=>!Array.isArray(data[key])))fail()
  const products=new Map(),rows=[],flags=new Set(),unpaid=[],paid=[]
  for(const product of data.products){
    if(typeof product.id!=='string'||!product.id||products.has(product.id))fail()
    const quantityUnits=units(product.stock),rate=cents(product.cost??0),referenceValueCents=referenceValue(rate,quantityUnits),unit=product.unit??'個'
    if(typeof unit!=='string')fail()
    if(!unit.trim()||unit!==unit.trim()||unit.normalize('NFC')!==unit||/[\p{Cc}\p{Cf}]/u.test(unit))flags.add('product-unit-needs-review')
    const row={productId:product.id,name:product.name||'',unit,availableUnits:quantityUnits,referenceUnitCostCents:rate,referenceValueCents,zeroCostNeedsReview:quantityUnits>0&&rate===0}
    if(row.zeroCostNeedsReview)flags.add('opening-zero-cost-needs-review')
    if(referenceValueCents===null)flags.add('reference-value-out-of-range')
    products.set(product.id,row);rows.push(row)
  }
  for(const entry of data.restaurantEntries){
    if(entry.status==='cancelled')continue
    if(entry.saleId&&entry.status==='completed'){paid.push({entryId:entry.id,version:entry.version,status:entry.status,saleId:entry.saleId});continue}
    if(!Array.isArray(entry.allocations))fail()
    const allocations=entry.allocations.map(item=>{
      const product=products.get(item.id);if(!product)fail()
      const quantityUnits=units(item.qty),rate=cents(item.unitCost??0)
      if(!quantityUnits)fail()
      if(!rate)flags.add('reserved-zero-cost-needs-review')
      return {productId:item.id,name:item.name||product.name,unit:product.unit,quantityUnits,referenceUnitCostCents:rate,referenceValueCents:referenceValue(rate,quantityUnits),unitEvidence:'current-product-unit-reference'}
    })
    flags.add('legacy-reservation-unit-needs-review')
    if(entry.saleId){paid.push({entryId:entry.id,version:entry.version,status:entry.status,saleId:entry.saleId,prepared:!!entry.startedAt,allocations});continue}
    unpaid.push({entryId:entry.id,version:entry.version,status:entry.status,prepared:!!entry.startedAt,allocations})
  }
  const legacyCostReviews=[]
  for(const order of data.orders){
    if(order.source==='customer'||order.payMethod==='pending'||order.status&&!['completed','refunded'].includes(order.status))continue
    for(const item of order.items||[]){
      const product=products.get(item.id),quantityUnits=units(Math.abs(item.qty))*Math.sign(item.qty),recorded=Object.hasOwn(order.itemCosts||{},item.id),rate=recorded?cents(order.itemCosts[item.id]):product?.referenceUnitCostCents??null
      if(!recorded||rate===0){legacyCostReviews.push({orderId:order.id,productId:item.id,quantityUnits,referenceUnitCostCents:rate,basis:recorded?'recorded-zero':'missing-snapshot'});flags.add(recorded?'legacy-zero-cost-recorded':'legacy-order-cost-missing')}
    }
  }
  const automatic=automaticBusinessJournal(data),journals=[...automatic,...data.manualJournal],inventoryRows=[]
  let legacyBalance=0
  for(const journal of journals){
    if(!Array.isArray(journal.lines))fail()
    for(const line of journal.lines.filter(line=>line.account==='1211')){
      const debit=line.debit??0,credit=line.credit??0
      if(typeof debit!=='number'||!Number.isFinite(debit)||typeof credit!=='number'||!Number.isFinite(credit))fail()
      legacyBalance+=debit-credit;inventoryRows.push({journalId:journal.id,date:journal.date,type:journal.type,debit,credit})
      if([debit,credit].some(value=>Math.abs(value*100-Math.round(value*100))>1e-7))flags.add('legacy-subcent-cost-needs-review')
    }
  }
  const referenceInventoryBalanceCents=Math.round(legacyBalance*100),safeBalance=Number.isSafeInteger(referenceInventoryBalanceCents)?referenceInventoryBalanceCents:null
  if(safeBalance===null)flags.add('legacy-reference-value-out-of-range')
  const referenceAvailableValueCents=total(rows.map(row=>row.referenceValueCents)),referenceReservedValueCents=total(unpaid.flatMap(entry=>entry.allocations.map(row=>row.referenceValueCents))),referenceOwnedValueCents=total([referenceAvailableValueCents,referenceReservedValueCents])
  if(referenceOwnedValueCents===null||referenceOwnedValueCents!==safeBalance)flags.add('inventory-reference-reconciliation-needed')
  const preview={version:1,status:'reference-only-not-activated',authoritativeValuation:false,storeId:data.storeId,epoch:data.epoch,currency:'TWD',products:rows,unpaidReservations:unpaid,paidLegacyReservations:paid,legacyCostReviews,referenceAvailableValueCents,referenceReservedValueCents,referenceOwnedValueCents,referenceInventoryBalanceCents:safeBalance,reviewFlags:[...flags].sort()}
  const material=canonicalSignature({profile:'pos-stock-opening-preview/v1',preview,legacyJournal:journals,inventoryRows})
  return {preview,material}
}
