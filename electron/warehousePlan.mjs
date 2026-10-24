import {warehouseCommand,warehouseDirectory,warehouseError,warehouseQuantity,warehouseRecord} from './warehouseRules.mjs'
import {planCostCustody,costCustodySummary} from './stockCustody.mjs'
import {stockCostSummary} from './stockCost.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {lotDay,lotError} from './lotRules.mjs'
import {lotPositionParts,selectLotQuantity,lotEligibility} from './lotSelection.mjs'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
export function warehouseLocationUnits(custody,locationId,productId,unit,stage='available'){
 const sources=new Map(custody.sources.map(row=>[row.id,row]));let total=0
 for(const node of custody.positions)if(node.owner.locationId===locationId&&node.owner.stage===stage)for(const part of node.segments){const source=sources.get(part.sourceId);if(source.productId===productId&&source.unit===unit)total+=part.quantityUnits}
 if(!Number.isSafeInteger(total)||total<0||total>1e12)throw warehouseError('HISTORY');return total
}
export function warehouseProductEvidence(previous,products,input){
 if(input.action==='location')return {products:[]}
 const product=products.find(row=>row.id===input.productId);if(!product)throw warehouseError('INPUT')
 const beforeUnits=warehouseLocationUnits(previous.custody,'main',product.id,product.unit)
 if(Math.abs(product.stock-beforeUnits/1000)>1e-10)throw warehouseError('HISTORY')
 return {products:[{id:product.id,unit:product.unit,beforeUnits}]}
}
export function planWarehouse(previous,body){
 if(!previous)throw warehouseError('INACTIVE')
 const input=warehouseCommand(body.input),directory=warehouseDirectory(previous.warehousing)
 if(input.expectedStateDigest!==body.beforeDigest||body.date<previous.journals[0].date)throw warehouseError('STALE')
 if(!['owner','staff'].includes(body.actor?.role)||input.action!=='transfer'&&body.actor.role!=='owner')throw warehouseError('OWNER')
 warehouseRecord(body.evidence,['products']);if(!Array.isArray(body.evidence.products))throw warehouseError('INPUT')
 let custody=previous.custody
 if(input.action==='location'){
  if(body.evidence.products.length||input.locationId==='main'||directory.locations.some(row=>row.id===input.locationId||row.label.toLocaleLowerCase('en-US')===input.label.toLocaleLowerCase('en-US'))||directory.locations.length===64)throw warehouseError('INPUT')
  directory.locations.push({id:input.locationId,label:input.label})
 }else{
  const pairs=body.evidence.products;if(pairs.length!==1)throw warehouseError('INPUT');const product=pairs[0];warehouseRecord(product,['id','unit','beforeUnits'])
  if(product.id!==input.productId||product.beforeUnits!==warehouseLocationUnits(custody,'main',product.id,product.unit))throw warehouseError('HISTORY')
  if(input.action==='set-unit'){
   if(input.unit===product.unit)throw warehouseError('UNIT')
   const row={productId:product.id,productUnit:product.unit,unit:input.unit,quantityUnits:warehouseQuantity(input.baseQuantity)}
   const index=directory.units.findIndex(row=>row.productId===product.id&&row.unit===input.unit)
   if(index<0)directory.units.push(row);else directory.units[index]=row
  }else{
   if(input.fromLocationId===input.toLocationId||[input.fromLocationId,input.toLocationId].some(id=>!directory.locations.some(row=>row.id===id)))throw warehouseError('INPUT')
   const definition=directory.units.find(row=>row.productId===product.id&&row.unit===input.unit),factor=input.unit===product.unit?1000:definition?.productUnit===product.unit?definition.quantityUnits:null
   if(factor===null)throw warehouseError('UNIT')
   const quantityUnits=warehouseQuantity(input.quantity,factor)
   if(warehouseLocationUnits(custody,input.fromLocationId,product.id,product.unit)<quantityUnits)throw warehouseError('STOCK')
   const owner=locationId=>({stage:'available',locationId,referenceId:''}),before=costCustodySummary(custody)
   if(previous.lots&&lotDay(input.time,previous.lots.timeZone)>previous.lots.observedDay)throw lotError('STALE')
   const step=previous.lots?{kind:'move-selected',from:owner(input.fromLocationId),to:owner(input.toLocationId),productId:product.id,unit:product.unit,allocations:selectLotQuantity(lotPositionParts(custody,previous.lots,owner(input.fromLocationId),product.id),quantityUnits,{fefo:true,eligible:row=>lotEligibility(previous.lots,product.id,row.lot,previous.lots.observedDay)==='eligible'}).map(row=>row.segment),restoreMode:'preserve'}:{kind:'relocate',from:owner(input.fromLocationId),to:owner(input.toLocationId),productId:product.id,unit:product.unit,quantityUnits}
   custody=planCostCustody(custody,{expectedSequence:custody.sequence,steps:[step]}).state
   if(!same(before,costCustodySummary(custody)))throw warehouseError('HISTORY')
  }
 }
 warehouseDirectory(directory)
 return {...previous,custody,warehousing:directory}
}
export function warehouseState(state,products,context,{showCosts=true}={}){
 const projection=state.projection,directory=warehouseDirectory(projection?.warehousing),sources=new Map((projection?.custody.sources||[]).map(row=>[row.id,row]))
 const locations=directory.locations.map(location=>({...location,products:products.map(product=>{
  const segments=(projection?.custody.positions||[]).filter(node=>node.owner.stage==='available'&&node.owner.locationId===location.id).flatMap(node=>node.segments).filter(part=>sources.get(part.sourceId)?.productId===product.id)
  return {id:product.id,name:product.name,unit:product.unit,quantityUnits:projection?warehouseLocationUnits(projection.custody,location.id,product.id,product.unit):Math.round(product.stock*1000),reservedUnits:projection?warehouseLocationUnits(projection.custody,location.id,product.id,product.unit,'reserved'):0,cost:projection&&showCosts?stockCostSummary(projection.custody.sources,segments):null}
 })}))
 return {protocol:'pos-warehouse-state/v1',active:!!projection,context:{...context,stateDigest:state.stateDigest},locations,units:directory.units,history:state.entries.filter(row=>row.method==='applyWarehouseOperation').slice(-20).reverse().map(row=>({input:row.input,actor:row.actor,time:row.time,evidence:row.evidence}))}
}
