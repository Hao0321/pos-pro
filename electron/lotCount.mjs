import {canonicalSignature} from './operationRules.mjs'
import {lotError,lotRegistry,lotDay,LOT_METHOD} from './lotRules.mjs'
import {splitLotSegments,lotEligibility,selectLotQuantity} from './lotSelection.mjs'
import {planCostCustody} from './stockCustody.mjs'
import {warehouseDirectory,warehouseRecord} from './warehouseRules.mjs'

export const LOT_COUNT_FEATURE='stock-lot-count-v1',LOT_COUNT_SETTING='stockLotCountVersionFence'
const sum=values=>{const total=values.reduce((n,v)=>n+BigInt(v),0n);if(total<0n||total>1000000000000n)throw lotError('QUANTITY');return Number(total)}
const reservedIds=custody=>[...new Set(custody.positions.filter(row=>row.owner.stage==='reserved'&&row.segments.length).map(row=>row.owner.referenceId))].sort()
function reservation(row){
 const value={id:row.id,version:row.version,status:row.status,startedAt:row.startedAt??''}
 if(typeof value.id!=='string'||!value.id||!Number.isSafeInteger(value.version)||value.version<1||!['reserved','cooking','ready','dispatched'].includes(value.status)||typeof value.startedAt!=='string'||value.startedAt&&!Number.isFinite(Date.parse(value.startedAt))||!value.startedAt&&value.status!=='reserved')throw lotError('HISTORY')
 return value
}
export function assertLotCountReservations(custody,rows){
 if(!Array.isArray(rows)||rows.length>10000)throw lotError('HISTORY')
 const ids=reservedIds(custody)
 for(const row of rows){warehouseRecord(row,['id','version','status','startedAt']);reservation(row)}
 if(new Set(rows.map(row=>row.id)).size!==rows.length||canonicalSignature(rows.map(row=>row.id))!==canonicalSignature(ids))throw lotError('HISTORY')
 return structuredClone(rows)
}
export function lotCountReservations(custody,entries){
 if(!Array.isArray(entries))throw lotError('HISTORY');const byId=new Map(entries.map(row=>[row.id,row]));if(byId.size!==entries.length)throw lotError('HISTORY')
 const rows=reservedIds(custody).map(id=>{const row=byId.get(id);if(!row)throw lotError('HISTORY');return reservation(row)})
 return assertLotCountReservations(custody,rows)
}
export function updateLotCountReservations(previous,custody,entry){
 const ids=reservedIds(custody),rows=new Map(previous.lotCountReservations.map(row=>[row.id,row]));if(entry){if(ids.includes(entry.id))rows.set(entry.id,reservation(entry));else rows.delete(entry.id)}
 // Completed/cancelled entries have no remaining reserved custody and are not
 // part of this slice. Normalize only rows still owned in reserved positions.
 return lotCountReservations(custody,[...rows.values()].filter(row=>ids.includes(row.id)))
}
export function lotCountKey(productId,locationId,lotId,kind){return canonicalSignature([productId,locationId,lotId,kind])}
export function readLotCountKey(key){
 let row;try{row=JSON.parse(key)}catch{throw lotError('INPUT')}
 if(!Array.isArray(row)||row.length!==4||row.slice(0,2).some(v=>typeof v!=='string'||!v||v.length>256)||row[2]!==null&&(typeof row[2]!=='string'||!row[2]||row[2].length>128)||!['shelf','quarantined'].includes(row[3])||canonicalSignature(row)!==key)throw lotError('INPUT')
 return {productId:row[0],locationId:row[1],lotId:row[2],kind:row[3]}
}
// A physical batch may gain separately unvalued found stock. Its cost source
// stays distinct while these explicit links keep one physical batch to count.
export function lotCountGroups(projection){
 const registry=lotRegistry(projection.lots,projection.custody),items=new Map(registry.items.map(row=>[row.id,row])),sources=new Map(projection.custody.sources.map(row=>[row.id,row])),groups=new Map(registry.items.map(row=>[row.id,row.id])),links=projection.lotCountLinks||[]
 if(!Array.isArray(links)||links.length>100000||projection.lotCountVersion!==undefined&&projection.lotCountVersion!==1||links.length&&!projection.lotCountVersion)throw lotError('HISTORY')
 const children=new Set(links.map(row=>row.lotId))
 if(projection.lotCountVersion===1&&!Array.isArray(projection.lotCountLinks)||projection.lotCountVersion===undefined&&(Object.hasOwn(projection,'lotCountLinks')||Object.hasOwn(projection,'lotCountReservations')))throw lotError('HISTORY')
 if(projection.lotCountVersion===1)assertLotCountReservations(projection.custody,projection.lotCountReservations)
 if(children.size!==links.length)throw lotError('HISTORY')
 for(const row of links){warehouseRecord(row,['lotId','parentLotId']);const child=items.get(row.lotId),parent=items.get(row.parentLotId);if(!child||!parent||children.has(row.parentLotId)||child.id===parent.id||sources.get(child.sourceId).productId!==sources.get(parent.sourceId).productId||child.code!==parent.code||child.expiryDate!==parent.expiryDate)throw lotError('HISTORY');groups.set(child.id,parent.id)}
 return groups
}
export function lotCountFacts(projection,products,reservations=projection.lotCountReservations||[]){
 const groups=lotCountGroups(projection),registry=projection.lots,sources=new Map(projection.custody.sources.map(row=>[row.id,row])),byProduct=new Map(products.map(row=>[row.id,row])),rows=new Map()
 const reserved=new Map(assertLotCountReservations(projection.custody,reservations).map(row=>[row.id,row]))
 if(projection.lotCountVersion===1&&canonicalSignature(reservations)!==canonicalSignature(projection.lotCountReservations))throw lotError('HISTORY')
 for(const position of projection.custody.positions){
  if(!['available','reserved','quarantined'].includes(position.owner.stage))continue
  if(position.owner.stage==='reserved'&&position.segments.length&&reserved.get(position.owner.referenceId).startedAt)continue
  for(const part of splitLotSegments(projection.custody,registry,position.segments)){
   const source=sources.get(part.segment.sourceId),product=byProduct.get(source.productId);if(!product)continue
   if(source.unit!==product.unit)throw lotError('HISTORY')
   const lotId=part.lot?groups.get(part.lot.id):null,lot=registry.items.find(row=>row.id===lotId),kind=position.owner.stage==='quarantined'?'quarantined':'shelf',key=lotCountKey(product.id,position.owner.locationId,lotId,kind)
   if(!rows.has(key))rows.set(key,{key,productId:product.id,name:product.name,unit:product.unit,locationId:position.owner.locationId,lotId,code:lot?.code||'',expiryDate:lot?.expiryDate||null,kind,availableUnits:0,reservedUnits:0,expectedUnits:0,parts:[]})
   const row=rows.get(key),count=part.segment.quantityUnits;row.expectedUnits=sum([row.expectedUnits,count]);if(position.owner.stage==='reserved')row.reservedUnits=sum([row.reservedUnits,count]);else{row.availableUnits=sum([row.availableUnits,count]);row.parts.push({...part,owner:position.owner})}
  }
 }
 return [...rows.values()].sort((a,b)=>a.key.localeCompare(b.key))
}
export const publicLotCountRows=(projection,products,reservations)=>lotCountFacts(projection,products,reservations).map(({parts,...row})=>row)
export function lotCountChoices(state,productId,locationId,kind){
 if(!['shelf','quarantined'].includes(kind)||!state.locations.some(row=>row.id===locationId))throw lotError('INPUT')
 const product=state.products.find(row=>row.id===productId);if(!product)throw lotError('INPUT')
 const candidates=[{id:null,code:'',expiryDate:null},...state.lots.filter(row=>row.productId===productId)]
 return candidates.map(lot=>{const key=lotCountKey(productId,locationId,lot.id,kind),existing=state.counting.rows.find(row=>row.key===key);return existing||{key,productId,name:product.name,unit:product.unit,locationId,lotId:lot.id,code:lot.code,expiryDate:lot.expiryDate,kind,availableUnits:0,reservedUnits:0,expectedUnits:0}})
}
function countFact(previous,products,key,locationId,facts){
 const identity=readLotCountKey(key),product=products.find(row=>row.id===identity.productId),groups=lotCountGroups(previous),lot=previous.lots.items.find(row=>row.id===identity.lotId),source=previous.custody.sources.find(row=>row.id===lot?.sourceId)
 if(identity.locationId!==locationId||!product||!warehouseDirectory(previous.warehousing).locations.some(row=>row.id===locationId)||identity.lotId&&(!lot||groups.get(lot.id)!==lot.id||source.productId!==product.id))throw lotError('INPUT')
 return facts.find(row=>row.key===key)||{...identity,key,name:product.name,unit:product.unit,code:lot?.code||'',expiryDate:lot?.expiryDate||null,expectedUnits:0,availableUnits:0,reservedUnits:0,parts:[]}
}
export function planLotCount(previous,body){
 const {input,evidence}=body,registry=lotRegistry(previous.lots,previous.custody),products=evidence.products,reservations=assertLotCountReservations(previous.custody,evidence.reservations),facts=lotCountFacts(previous,products,reservations),steps=[],sourceEvidence=[],links=[...(previous.lotCountLinks||[])],review=[]
 if(previous.lotCountVersion===1&&canonicalSignature(reservations)!==canonicalSignature(previous.lotCountReservations))throw lotError('HISTORY')
 if(lotDay(input.time,registry.timeZone)>registry.observedDay)throw lotError('STALE')
 for(const [index,count]of input.counts.entries()){
  const row=countFact(previous,products,count.key,input.locationId,facts),differenceUnits=count.quantityUnits-row.expectedUnits
  if(count.quantityUnits<row.reservedUnits)throw Object.assign(Error('架上數量少於已預留量，請先核對預訂 '+row.name),{code:'STOCK_LOT_RESERVED'})
  review.push({key:row.key,beforeUnits:row.expectedUnits,quantityUnits:count.quantityUnits,differenceUnits,reservedUnits:row.reservedUnits})
  if(differenceUnits<0){
   const selected=selectLotQuantity(row.parts,-differenceUnits),owners=new Map()
   for(const part of selected){const key=canonicalSignature(part.owner);if(!owners.has(key))owners.set(key,{owner:part.owner,allocations:[]});owners.get(key).allocations.push(part.segment)}
   for(const {owner,allocations}of owners.values())steps.push({kind:'move-selected',from:owner,to:{stage:'wasted',locationId:input.locationId,referenceId:'lot-count:'+input.id},productId:row.productId,unit:row.unit,allocations,restoreMode:'preserve'})
  }else if(differenceUnits>0){
   const sourceId='business:'+body.id+':count:'+index,lotId=row.lotId?'lot-count-'+body.id+'-'+index:null,original=registry.items.find(item=>item.id===row.lotId)
   if(original){registry.items.push({id:lotId,sourceId,segments:[{offsetUnits:0,quantityUnits:differenceUnits}],code:original.code,expiryDate:original.expiryDate,receivedAt:null});links.push({lotId,parentLotId:row.lotId})}
   const status=lotEligibility(registry,row.productId,original,registry.observedDay),held=row.kind==='quarantined'||status!=='eligible',referenceId=row.kind==='quarantined'?'count-held:'+input.id+':'+index:status==='expired'?'expired:'+lotId:'unknown:'+sourceId,to={stage:held?'quarantined':'available',locationId:input.locationId,referenceId:held?referenceId:''}
   steps.push({kind:held?'acquire-quarantined':'acquire',to,sources:[{id:sourceId,productId:row.productId,unit:row.unit,currency:'TWD',quantityUnits:differenceUnits,valueCents:null}]})
   sourceEvidence.push({sourceId,key:canonicalSignature([LOT_METHOD,input.id,count.key]),basis:'count-unknown',creditAccount:'4191'})
  }
 }
 const plan=steps.length?planCostCustody(previous.custody,{expectedSequence:previous.custody.sequence,steps}):{state:previous.custody,effects:[]},known=plan.effects.filter(row=>row.to.stage==='wasted').reduce((n,row)=>n+BigInt(row.cost.knownValueCents),0n)
 if(known>BigInt(Number.MAX_SAFE_INTEGER))throw lotError('HISTORY')
 const loss=Number(known),journal={id:'stock-lot-count:'+input.id,date:body.date,type:'stock-cost',amountUnit:'cents',description:'批次盤點',costComplete:plan.effects.every(row=>row.cost.complete),lines:loss?[{account:'5208',debitCents:loss,creditCents:0},{account:'1211',debitCents:0,creditCents:loss}]:[]},lotEvent={eventId:body.id,id:input.id,action:'count',time:body.time,day:registry.observedDay,actor:body.actor,effects:plan.effects,journalId:journal.id,wasteId:null}
 const next={...previous,custody:plan.state,lots:registry,lotCountVersion:1,lotCountLinks:links,lotCountReservations:reservations,lotEvents:[...(previous.lotEvents||[]),lotEvent],sourceEvidence:[...previous.sourceEvidence,...sourceEvidence],journals:[...previous.journals,journal],business:[...(previous.business||[]),{method:LOT_METHOD,id:input.id,eventId:body.id,effects:plan.effects,journalId:journal.id,replacedJournalIds:[],notes:[{kind:'lot-count',rows:review}]}]}
 lotCountGroups(next);return next
}
