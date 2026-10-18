import {warehouseRecord,warehouseText,warehouseDirectory} from './warehouseRules.mjs'
import {lotDate,lotError,lotRegistry} from './lotRules.mjs'

export const RECEIPT_LOT_KIND='receive-lots',RECEIPT_LOT_PROTOCOL='pos-receipt-lots/v1'
export const RECEIPT_LOT_FEATURE='stock-receipt-lots-v1',RECEIPT_LOT_SETTING='stockReceiptLotsVersionFence'
const units=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9||Math.abs(value-Math.round(value*1000)/1000)>1e-7)throw lotError('QUANTITY');return Math.round(value*1000)}

// RL1–RL4: an explicit new command cannot degrade to quantity-only receiving.
export function receiptLots(request){
 warehouseRecord(request,['kind','purchaseId','expectedPurchase','quantities','lots',...['id','time','supplierContext'].filter(key=>Object.hasOwn(request||{},key))])
 const raw=request?.lots
 warehouseRecord(raw,['protocol','storeId','epoch','expectedStateDigest','allocations','newItems'])
 if(request.kind!==RECEIPT_LOT_KIND||raw.protocol!==RECEIPT_LOT_PROTOCOL||!/^sha256:[a-f0-9]{64}$/.test(raw.expectedStateDigest))throw lotError('INPUT')
 for(const key of ['storeId','epoch'])warehouseText(raw[key])
 if(!Array.isArray(request.quantities)||!request.quantities.length||request.quantities.length>10000||!Array.isArray(raw.allocations)||!raw.allocations.length||raw.allocations.length>10000||!Array.isArray(raw.newItems)||raw.newItems.length>request.quantities.length)throw lotError('INPUT')
 const totals=request.quantities.map(()=>0),prices=new Set()
 for(const row of raw.allocations){
  warehouseRecord(row,['lineIndex','quantityUnits','locationId','code','expiryMode','expiryDate'])
  if(!Number.isSafeInteger(row.lineIndex)||row.lineIndex<0||row.lineIndex>=totals.length||!Number.isSafeInteger(row.quantityUnits)||row.quantityUnits<1||row.quantityUnits>1e12)throw lotError('QUANTITY')
  warehouseText(row.locationId);if(typeof row.code!=='string'||row.code!==''&&warehouseText(row.code,128)!==row.code)throw lotError('INPUT')
  if(!['dated','unknown','none'].includes(row.expiryMode)||row.expiryMode!=='dated'&&row.expiryDate!==null)throw lotError('INPUT')
  if(row.expiryMode==='dated')lotDate(row.expiryDate)
  totals[row.lineIndex]+=row.quantityUnits;if(!Number.isSafeInteger(totals[row.lineIndex])||totals[row.lineIndex]>1e12)throw lotError('QUANTITY')
 }
 if(request.quantities.some((value,index)=>units(value)!==totals[index])||!totals.some(Boolean))throw lotError('QUANTITY')
 for(const row of raw.newItems){warehouseRecord(row,['lineIndex','priceCents']);if(!Number.isSafeInteger(row.lineIndex)||row.lineIndex<0||row.lineIndex>=totals.length||!totals[row.lineIndex]||prices.has(row.lineIndex)||!Number.isSafeInteger(row.priceCents)||row.priceCents<0||row.priceCents>1e11)throw lotError('INPUT');prices.add(row.lineIndex)}
 return structuredClone(raw)
}

// RL2/RL3: split original source intervals; owned holds and other locations
// never inflate the main location's sale availability or revalue a source.
export function placeReceiptLots(previous,body,source,productId,lineIndex,queueOrder){
 const registry=lotRegistry(previous.lots,previous.custody),locations=warehouseDirectory(previous.warehousing).locations
 const rows=body.input.lots.allocations.filter(row=>row.lineIndex===lineIndex),steps=[],items=[],main={stage:'available',locationId:'main',referenceId:''}
 let offsetUnits=0,blockedUnits=0
 for(const [index,row] of rows.entries()){
  if(!locations.some(location=>location.id===row.locationId)||row.expiryMode==='none'&&registry.products.some(product=>product.productId===productId&&product.required))throw lotError('INPUT')
  const id='arrival-'+body.id+'-'+lineIndex+'-'+index,segments=[{sourceId:source.id,offsetUnits,quantityUnits:row.quantityUnits,queueOrder}],here={...main,locationId:row.locationId}
  const selected=(from,to)=>steps.push({kind:'move-selected',from,to,productId,unit:source.unit,allocations:segments,restoreMode:'preserve'})
  if(row.locationId!=='main')selected(main,here)
  const held=row.expiryMode==='unknown'||row.expiryDate!==null&&row.expiryDate<registry.observedDay
  if(held)selected(here,{...here,stage:'quarantined',referenceId:'receipt-hold:'+id})
  if(held||row.locationId!=='main')blockedUnits+=row.quantityUnits
  items.push({id,sourceId:source.id,segments:[{offsetUnits,quantityUnits:row.quantityUnits}],code:row.code,expiryDate:row.expiryDate,receivedAt:body.input.time})
  offsetUnits+=row.quantityUnits
 }
 if(offsetUnits!==source.quantityUnits)throw lotError('QUANTITY')
 return {steps,items,blockedUnits}
}
