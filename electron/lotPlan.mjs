import {lotCommand,lotRegistry,lotError,lotDay} from './lotRules.mjs'
import {lotEffectiveDay,splitLotSegments,lotEligibility,unassignedLotIntervals,selectLotQuantity} from './lotSelection.mjs'
import {enableLotCustody,planCostCustody,costCustodySummary} from './stockCustody.mjs'
import {warehouseRecord,warehouseText} from './warehouseRules.mjs'
import {warehouseDirectory} from './warehouseRules.mjs'
import {warehouseLocationUnits} from './warehousePlan.mjs'
import {canonicalSignature} from './operationRules.mjs'
export const LOT_SYSTEM_ACTOR=Object.freeze({userId:'system:lot-expiry',username:'系統',role:'system'})
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const sum=rows=>{const value=rows.reduce((total,row)=>total+BigInt(row),0n);if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<0n)throw lotError('HISTORY');return Number(value)}
export function lotProductIds(projection,input){
 if(input.action==='activate')return []
 if(input.action==='track')return [input.productId]
 if(input.action==='expire')return [...new Set(projection.custody.sources.map(row=>row.productId))]
 const sourceId=input.action==='label'?input.sourceId:projection.lots?.items.find(row=>row.id===input.lotId)?.sourceId,source=projection.custody.sources.find(row=>row.id===sourceId);if(!source)throw lotError('INPUT');return [source.productId]
}
export function lotEvidence(projection,products,input,actor){
 const ids=lotProductIds(projection,input),rows=ids.map(id=>{const product=products.find(row=>row.id===id);if(!product)throw lotError('INPUT');const beforeUnits=warehouseLocationUnits(projection.custody,'main',id,product.unit);if(Math.abs(product.stock-beforeUnits/1000)>1e-10)throw lotError('HISTORY');return {id,name:product.name,unit:product.unit,beforeUnits,referenceUnitCostCents:Math.round(product.cost*100)}}),evidence={products:rows}
 if(input.action==='dispose'){const product=rows[0];evidence.waste={id:'lot-waste-'+input.id,productId:product.id,productName:product.name,qty:input.quantityUnits/1000,reason:input.reason,cost:product.referenceUnitCostCents/100,time:input.time,cashier:actor.username}}
 return evidence
}
export function planLotOperation(previous,body){
 if(!previous)throw lotError('HISTORY')
 const input=lotCommand(body.input),system=input.action==='expire'
 if(system?!same(body.actor,LOT_SYSTEM_ACTOR):!['owner',...(input.action==='dispose'?['staff']:[])].includes(body.actor?.role))throw lotError('AUTHORITY')
 if(input.expectedStateDigest!==body.beforeDigest||!Number.isFinite(Date.parse(body.time)))throw lotError('STALE')
 warehouseRecord(body.evidence,['products',...(input.action==='dispose'?['waste']:[])]);if(!Array.isArray(body.evidence.products))throw lotError('HISTORY')
 const products=new Map();for(const row of body.evidence.products){warehouseRecord(row,['id','name','unit','beforeUnits','referenceUnitCostCents']);warehouseText(row.id,256);warehouseText(row.unit,30);if(typeof row.name!=='string'||products.has(row.id)||!Number.isSafeInteger(row.referenceUnitCostCents)||row.referenceUnitCostCents<0||row.beforeUnits!==warehouseLocationUnits(previous.custody,'main',row.id,row.unit))throw lotError('HISTORY');products.set(row.id,row)}
 if(!same([...products.keys()].sort(),lotProductIds(previous,input).sort()))throw lotError('HISTORY')
 let custody=previous.custody,registry
 if(input.action==='activate'){
  if(previous.lots||custody.version!==1)throw lotError('INPUT')
  custody=enableLotCustody(custody);registry={version:1,timeZone:input.timeZone,observedDay:lotDay(input.time,input.timeZone),products:[],items:[]}
 }else{
  registry=lotRegistry(previous.lots,custody);registry.observedDay=lotEffectiveDay(registry,input.time)
  if(input.action==='track'){const index=registry.products.findIndex(row=>row.productId===input.productId),row={productId:input.productId,required:input.required};if(index<0)registry.products.push(row);else registry.products[index]=row}
  else if(input.action==='label'){
   const available=unassignedLotIntervals(custody,registry,input.sourceId),ordered=available.slice().sort((a,b)=>a.segment.offsetUnits-b.segment.offsetUnits),segments=[];let needed=input.quantityUnits
   for(const row of ordered){if(!needed)break;const count=Math.min(needed,row.segment.quantityUnits);segments.push({offsetUnits:row.segment.offsetUnits,quantityUnits:count});needed-=count}if(needed)throw lotError('QUANTITY')
   registry.items.push({id:'lot-'+body.id,sourceId:input.sourceId,segments,code:input.code,expiryDate:input.expiryDate,receivedAt:input.receivedAt})
  }else if(input.action==='correct'){const index=registry.items.findIndex(row=>row.id===input.lotId);if(index<0)throw lotError('INPUT');registry.items[index]={...registry.items[index],code:input.code,expiryDate:input.expiryDate,receivedAt:input.receivedAt}}
  else if(system&&input.day!==registry.observedDay)throw lotError('CLOCK')
 }
 lotRegistry(registry,custody)
 const day=registry.observedDay,sources=new Map(custody.sources.map(row=>[row.id,row])),steps=[],scope=new Set(products.keys()),locations=warehouseDirectory(previous.warehousing).locations
 const add=(from,to,productId,parts,restoreMode='preserve')=>{if(!parts.length)return;const source=parts[0].segment||parts[0],unit=sources.get(source.sourceId)?.unit;if(!unit)throw lotError('HISTORY');steps.push({kind:'move-selected',from:{...from},to:{...to},productId,unit,allocations:parts.map(row=>({... (row.segment||row)})),restoreMode})}
 let disposalCost=null
 if(['release','dispose'].includes(input.action)){
  const lot=registry.items.find(row=>row.id===input.lotId),source=sources.get(lot?.sourceId);if(!lot||!locations.some(row=>row.id===input.locationId))throw lotError('INPUT')
  if(input.action==='release'&&lotEligibility(registry,source.productId,lot,day)!=='eligible')throw lotError('EXPIRED')
  const choices=custody.positions.filter(node=>(node.owner.stage==='quarantined'||input.action==='dispose'&&node.owner.stage==='available')&&node.owner.locationId===input.locationId).flatMap(node=>splitLotSegments(custody,registry,node.segments).filter(row=>row.lot?.id===lot.id).map(row=>({...row,owner:node.owner}))),selected=selectLotQuantity(choices,input.quantityUnits),owners=new Map()
  for(const row of selected){const key=canonicalSignature(row.owner);if(!owners.has(key))owners.set(key,[]);owners.get(key).push(row)}
  for(const parts of owners.values())add(parts[0].owner,input.action==='release'?{stage:'available',locationId:input.locationId,referenceId:''}:{stage:'wasted',locationId:input.locationId,referenceId:'lot-dispose:'+input.id},source.productId,parts)
 }
 const sweepCustody=steps.length?planCostCustody(custody,{expectedSequence:custody.sequence,steps}).state:custody
 if(input.action!=='activate')for(const node of sweepCustody.positions){
  if(node.owner.stage==='available'){
   const groups=new Map();for(const row of splitLotSegments(custody,registry,node.segments)){const source=sources.get(row.segment.sourceId);if(!scope.has(source.productId))continue;const status=lotEligibility(registry,source.productId,row.lot,day);if(status==='eligible')continue;const referenceId=status==='expired'?'expired:'+row.lot.id:'unknown:'+source.id,key=canonicalSignature([source.productId,referenceId]);if(!groups.has(key))groups.set(key,{productId:source.productId,referenceId,parts:[]});groups.get(key).parts.push(row)}
   for(const group of groups.values())add(node.owner,{stage:'quarantined',locationId:node.owner.locationId,referenceId:group.referenceId},group.productId,group.parts)
  }else if(node.owner.stage==='quarantined'&&node.owner.referenceId.startsWith('unknown:')&&['label','correct','track'].includes(input.action)){
   const groups=new Map();for(const row of splitLotSegments(custody,registry,node.segments)){const source=sources.get(row.segment.sourceId);if(!scope.has(source.productId))continue;const status=lotEligibility(registry,source.productId,row.lot,day);if(status==='unknown')continue;const to={stage:status==='expired'?'quarantined':'available',locationId:node.owner.locationId,referenceId:status==='expired'?'expired:'+row.lot.id:''},key=canonicalSignature([source.productId,to]);if(!groups.has(key))groups.set(key,{productId:source.productId,to,parts:[]});groups.get(key).parts.push(row)}for(const group of groups.values())add(node.owner,group.to,group.productId,group.parts)
  }
 }
 const plan=steps.length?planCostCustody(custody,{expectedSequence:custody.sequence,steps}):{state:custody,effects:[],valuation:costCustodySummary(custody)}
 const lines=[];if(input.action==='dispose'){
  const waste=body.evidence.waste,product=products.values().next().value,expected={id:'lot-waste-'+input.id,productId:product.id,productName:product.name,qty:input.quantityUnits/1000,reason:input.reason,cost:product.referenceUnitCostCents/100,time:input.time,cashier:body.actor.username};if(!same(waste,expected))throw lotError('HISTORY')
  const effects=plan.effects.filter(row=>row.to.stage==='wasted');if(sum(effects.map(row=>row.quantityUnits))!==input.quantityUnits)throw lotError('HISTORY');disposalCost=sum(effects.map(row=>row.cost.knownValueCents));if(disposalCost)lines.push({account:'5208',debitCents:disposalCost,creditCents:0},{account:'1211',debitCents:0,creditCents:disposalCost})
 }
 const journal=input.action==='dispose'?{id:'stock-lot:'+input.id,date:body.date,type:'stock-cost',amountUnit:'cents',description:'批次報廢',costComplete:plan.effects.every(row=>row.cost.complete),lines}:null
 const lotEvent={eventId:body.id,id:input.id,action:input.action,time:body.time,day,actor:body.actor,effects:plan.effects,journalId:journal?.id||null,wasteId:body.evidence.waste?.id||null}
 const next={...previous,custody:plan.state,lots:registry,lotEvents:[...(previous.lotEvents||[]),lotEvent],...(journal?{journals:[...previous.journals,journal],business:[...(previous.business||[]),{method:'applyLotOperation',id:input.id,eventId:body.id,effects:plan.effects,journalId:journal.id,replacedJournalIds:['JW'+body.evidence.waste.id],notes:[]}]}:{})}
 lotRegistry(next.lots,next.custody);return next
}
