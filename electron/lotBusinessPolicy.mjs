import {lotRegistry,lotError,lotDay} from './lotRules.mjs'
import {lotPositionParts,lotEligibility,selectLotQuantity,splitLotSegments} from './lotSelection.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {warehouseLocationUnits} from './warehousePlan.mjs'
export function assertLotBusinessReady(projection,body){
 if(!projection.lots)return
 const registry=lotRegistry(projection.lots,projection.custody),day=lotDay(body.time,registry.timeZone)
 if(day>registry.observedDay)throw lotError('STALE')
 const {input,method,evidence}=body
 if(method==='applyInventoryOperation'&&input.kind==='stocktake'&&input.counts.some(row=>registry.products.some(item=>item.productId===row.id&&item.required)||registry.items.some(item=>projection.custody.sources.find(source=>source.id===item.sourceId)?.productId===row.id)))throw lotError('COUNT')
 if(method==='addWaste'&&registry.items.some(item=>projection.custody.sources.find(source=>source.id===item.sourceId)?.productId===input.productId))throw lotError('DISPOSE')
 if(method==='applyRestaurantOperation'&&['advance','pay','funds-receive'].includes(input.action)&&evidence.beforeEntry){
  const owner={stage:'reserved',locationId:'main',referenceId:evidence.beforeEntry.id},position=projection.custody.positions.find(row=>canonicalSignature(row.owner)===canonicalSignature(owner)),sources=new Map(projection.custody.sources.map(row=>[row.id,row]))
  for(const row of splitLotSegments(projection.custody,registry,position?.segments||[]))if(lotEligibility(registry,sources.get(row.segment.sourceId).productId,row.lot,registry.observedDay)!=='eligible')throw lotError('RESERVED')
 }
}
export function planLotBusinessMove(custody,registry,from,to,productId,unit,quantityUnits,unused=false){
 const parts=lotPositionParts(custody,registry,from,productId),issuing=['reserved','consumed'].includes(to.stage),picked=selectLotQuantity(parts,quantityUnits,{fefo:from.stage==='available',eligible:row=>!issuing||lotEligibility(registry,productId,row.lot,registry.observedDay)==='eligible'}),groups=new Map();let blockedUnits=0
 for(const row of picked){let destination=to;const eligibility=lotEligibility(registry,productId,row.lot,registry.observedDay)
  if(to.stage==='available'&&eligibility!=='eligible'){destination={stage:'quarantined',locationId:to.locationId,referenceId:eligibility==='expired'?'expired:'+row.lot.id:'unknown:'+row.segment.sourceId};if(to.locationId==='main')blockedUnits+=row.segment.quantityUnits}
  const key=canonicalSignature(destination);if(!groups.has(key))groups.set(key,{to:destination,allocations:[]});groups.get(key).allocations.push(row.segment)
 }
 const returning=!unused&&['consumed','wasted','supplierReturned'].includes(from.stage)&&['available','quarantined'].includes(to.stage),steps=[...groups.values()].map(group=>({kind:'move-selected',from,to:group.to,productId,unit,allocations:group.allocations,restoreMode:returning?'return':'preserve'}))
 return {steps,blockedUnits}
}
export function lotAcquireTarget(registry,to,productId,sourceId){return to.stage==='available'&&registry.products.some(row=>row.productId===productId&&row.required)?{stage:'quarantined',locationId:to.locationId,referenceId:'unknown:'+sourceId}:to}
export function materializeLotProducts(products,projection,pairs){
 if(!projection.lots)return products
 const ids=new Set(pairs.map(row=>row.id));return products.map(product=>ids.has(product.id)?{...product,stock:warehouseLocationUnits(projection.custody,'main',product.id,product.unit)/1000}:product)
}
