import {canonicalSignature} from './operationRules.mjs'
import {units} from './procurementAmounts.mjs'
import {warehouseRecord,warehouseText} from './warehouseRules.mjs'
import {lotError} from './lotRules.mjs'
import {readLotCountKey,lotCountFacts} from './lotCount.mjs'
import {selectLotQuantity} from './lotSelection.mjs'

export const SUPPLIER_LOT_RETURN='purchase-return-lots',SUPPLIER_LOT_RETURN_PROTOCOL='pos-supplier-lot-return/v1'
export const SUPPLIER_LOT_RETURN_FEATURE='stock-supplier-lot-returns-v1',SUPPLIER_LOT_RETURN_SETTING='stockSupplierLotReturnsVersionFence'

// SR1/SR2: the financial document does not identify the physical stock source.
export function supplierLotReturn(request){
 warehouseRecord(request,['kind','purchaseId','expectedPurchase','invoiceId','reason','quantities','lots',...['id','time','supplierContext'].filter(key=>Object.hasOwn(request||{},key))])
 const raw=request?.lots
 warehouseRecord(raw,['protocol','storeId','epoch','expectedStateDigest','allocations','confirmation'])
 if(request.kind!==SUPPLIER_LOT_RETURN||raw.protocol!==SUPPLIER_LOT_RETURN_PROTOCOL||!/^sha256:[a-f0-9]{64}$/.test(raw.expectedStateDigest))throw lotError('INPUT')
 for(const key of ['storeId','epoch'])warehouseText(raw[key])
 warehouseRecord(raw.confirmation,['received','creditAccepted','reference'])
 if(raw.confirmation.received!==true||raw.confirmation.creditAccepted!==true)throw Error('先確認供應商已收貨，並同意本次折抵')
 warehouseText(raw.confirmation.reference,200)
 if(!Array.isArray(request.quantities)||!request.quantities.length||request.quantities.length>10000||!Array.isArray(raw.allocations)||!raw.allocations.length||raw.allocations.length>10000)throw lotError('INPUT')
 const totals=request.quantities.map(()=>0),keys=new Set()
 for(const row of raw.allocations){
  warehouseRecord(row,['lineIndex','key','quantityUnits']);readLotCountKey(row.key)
  const key=canonicalSignature([row.lineIndex,row.key])
  if(!Number.isSafeInteger(row.lineIndex)||row.lineIndex<0||row.lineIndex>=totals.length||!Number.isSafeInteger(row.quantityUnits)||row.quantityUnits<1||row.quantityUnits>1e12||keys.has(key))throw lotError('QUANTITY')
  keys.add(key);totals[row.lineIndex]+=row.quantityUnits
  if(!Number.isSafeInteger(totals[row.lineIndex])||totals[row.lineIndex]>1e12)throw lotError('QUANTITY')
 }
 if(request.quantities.some((quantity,index)=>units(quantity)!==totals[index])||!totals.some(Boolean))throw lotError('QUANTITY')
 return structuredClone(raw)
}

export function supplierLotReturnDeltas(request,items){
 const raw=supplierLotReturn(request),deltas=new Map()
 for(const row of raw.allocations){
  const fact=readLotCountKey(row.key),item=items[row.lineIndex]
  if(!item?.productId||fact.productId!==item.productId)throw Error('退貨批次與原單品項不同，請重新核對')
  const count=fact.kind==='shelf'&&fact.locationId==='main'?row.quantityUnits:0
  deltas.set(item.productId,(deltas.get(item.productId)||0)-count)
 }
 return [...deltas].map(([productId,count])=>({productId,qty:count/1000}))
}

// SR2: physical-count facts already retain held owners, found-stock links and
// original cost intervals. Reuse them instead of creating another stock table.
export function planSupplierLotReturn(previous,body){
 const {input,evidence}=body,raw=supplierLotReturn(input)
 if(!previous.lots||body.actor?.role!=='owner'||raw.expectedStateDigest!==body.beforeDigest)throw lotError('STALE')
 const facts=lotCountFacts(previous,evidence.products.map(row=>({...row,stock:row.beforeUnits/1000})),[],{includeReserved:false}),steps=[],owners=new Map(),used=new Map()
 for(const row of raw.allocations){
  const fact=facts.find(item=>item.key===row.key),item=evidence.inventory?.items[row.lineIndex]
  if(!fact||!item||fact.productId!==item.productId||fact.unit!==item.unit)throw Error('退貨批次、單位或庫存已變更，請重新核對')
  let skip=used.get(row.key)||0
  const selected=selectLotQuantity(fact.parts,skip+row.quantityUnits).flatMap(part=>{const count=Math.min(skip,part.segment.quantityUnits);skip-=count;return count===part.segment.quantityUnits?[]:[{...part,segment:{...part.segment,offsetUnits:part.segment.offsetUnits+count,quantityUnits:part.segment.quantityUnits-count}}]}),groups=new Map()
  used.set(row.key,(used.get(row.key)||0)+row.quantityUnits)
  for(const part of selected){const key=canonicalSignature(part.owner);if(!groups.has(key))groups.set(key,{from:part.owner,allocations:[]});groups.get(key).allocations.push(part.segment)}
  for(const group of groups.values()){
   const to={stage:'supplierReturned',locationId:group.from.locationId,referenceId:canonicalSignature(['purchase-return',input.id])}
   owners.set(canonicalSignature(to),to);steps.push({kind:'move-selected',...group,to,productId:fact.productId,unit:fact.unit,restoreMode:'preserve'})
  }
 }
 return {steps,owners:[...owners.values()]}
}
