import {STOCK_COST_ERRORS,STOCK_COST_STATES,costSource,normalizeCostSegments,takeFifoSegments,restoreCostSegments,stockCostSummary,priceUnvaluedCostSource,assertCostPartition} from './stockCost.mjs'

// Pure custody projection only. A domain adapter must validate the original
// documents and actor, look up original receipts before planning, and commit
// this projection together with stock, business documents and the receipt.
function fail(code){throw Object.assign(Error(STOCK_COST_ERRORS[code]),{code:'STOCK_COST_'+code})}
function record(value,keys){
  if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('STATES')
  const own=Reflect.ownKeys(value)
  if(own.length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||own.some(key=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return typeof key!=='string'||!keys.includes(key)||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')}))fail('STATES')
}
function text(value,max,empty=false){if(typeof value!=='string'||!empty&&!value||value.length>max||value.trim()!==value||value.normalize('NFC')!==value||/[\p{Cc}\p{Cf}]/u.test(value))fail('STATES')}
function counter(value,min=0){if(!Number.isSafeInteger(value)||value<min)fail('QUEUE');return value}
function increment(value){return counter(value+1,1)}
const ordinal=(a,b)=>a<b?-1:a>b?1:0

export function costOwner(input){
  record(input,['stage','locationId','referenceId'])
  if(!STOCK_COST_STATES.includes(input.stage))fail('STATES')
  text(input.locationId,128);text(input.referenceId,512,input.stage==='available')
  if(input.stage==='available'&&input.referenceId!=='')fail('STATES')
  return {...input}
}
const key=owner=>JSON.stringify([owner.stage,owner.locationId,owner.referenceId])
function normalizedPositions(sources,positions){
  if(!Array.isArray(positions))fail('STATES')
  const seen=new Set(),rows=[]
  for(const input of positions){
    record(input,['owner','segments']);const owner=costOwner(input.owner),id=key(owner)
    if(seen.has(id))fail('STATES');seen.add(id)
    const segments=normalizeCostSegments(sources,input.segments)
    if(segments.length)rows.push({owner,segments})
  }
  return rows.sort((a,b)=>ordinal(key(a.owner),key(b.owner)))
}
function grouped(positions){
  const groups=Object.fromEntries(STOCK_COST_STATES.map(stage=>[stage,[]]))
  for(const position of positions)groups[position.owner.stage].push(...position.segments)
  return groups
}
function greatestQueue(positions){let value=0;for(const node of positions)for(const segment of node.segments)value=Math.max(value,segment.queueOrder);return value}
function state(input){
  record(input,['version','sequence','nextQueueOrder','sources','positions'])
  if(input.version!==1||!Array.isArray(input.sources))fail('STATES')
  counter(input.sequence);counter(input.nextQueueOrder,1)
  const sources=input.sources.map(costSource),positions=normalizedPositions(sources,input.positions)
  assertCostPartition(sources,grouped(positions))
  if(greatestQueue(positions)>=input.nextQueueOrder)fail('QUEUE')
  return {version:1,sequence:input.sequence,nextQueueOrder:input.nextQueueOrder,sources,positions}
}
export function createCostCustody(sources,positions){
  if(!Array.isArray(sources))fail('SOURCE')
  const copied=sources.map(costSource),nodes=normalizedPositions(copied,positions)
  return state({version:1,sequence:0,nextQueueOrder:increment(greatestQueue(nodes)),sources:copied,positions:nodes})
}
export function costCustodySummary(input){const current=state(input);return assertCostPartition(current.sources,grouped(current.positions))}
function node(current,owner,create=false){
  const id=key(owner),found=current.positions.find(row=>key(row.owner)===id)
  if(found||!create)return found
  const made={owner:{...owner},segments:[]};current.positions.push(made);return made
}
function costForSource(current,sourceId){
  return Object.fromEntries(STOCK_COST_STATES.map(stage=>[stage,stockCostSummary(current.sources,current.positions.filter(row=>row.owner.stage===stage).flatMap(row=>row.segments.filter(segment=>segment.sourceId===sourceId)))]))
}
function acquire(current,step,discarded=false){
  record(step,['kind','sources','to']);const to=costOwner(step.to)
  if(to.stage!==(discarded?'wasted':'available')||!Array.isArray(step.sources)||!step.sources.length)fail('STATES')
  const existing=new Set(current.sources.map(row=>row.id)),added=[]
  for(const input of step.sources){const source=costSource(input);if(existing.has(source.id))fail('SOURCE_ID');existing.add(source.id);current.sources.push(source);added.push({sourceId:source.id,offsetUnits:0,quantityUnits:source.quantityUnits,queueOrder:current.nextQueueOrder});current.nextQueueOrder=increment(current.nextQueueOrder)}
  const destination=node(current,to,true);destination.segments=normalizeCostSegments(current.sources,[...destination.segments,...added])
  return {kind:discarded?'acquire-disposed':'acquire',to,segments:added,cost:stockCostSummary(current.sources,added)}
}
const EDGES=new Set(['available:reserved','available:consumed','available:wasted','available:supplierReturned','reserved:available','reserved:consumed','reserved:wasted','consumed:available','consumed:wasted','wasted:available','supplierReturned:available'])
function move(current,step,unused=false,relocate=false){
  record(step,['kind','from','to','productId','unit','quantityUnits']);const from=costOwner(step.from),to=costOwner(step.to),transfer=from.stage==='available'&&to.stage==='available'&&from.locationId!==to.locationId
  if(key(from)===key(to)||!transfer&&!EDGES.has(from.stage+':'+to.stage))fail('STATES')
  if(relocate&&!transfer)fail('STATES')
  if(unused&&(from.stage!=='consumed'||to.stage!=='available'||from.locationId!==to.locationId))fail('STATES')
  if((to.stage!=='available'||from.stage==='reserved')&&from.locationId!==to.locationId)fail('STATES')
  const origin=node(current,from);if(!origin)fail('INSUFFICIENT')
  const sources=new Map(current.sources.map(row=>[row.id,row])),selected=origin.segments.filter(row=>sources.get(row.sourceId).productId===step.productId),other=origin.segments.filter(row=>sources.get(row.sourceId).productId!==step.productId)
  const taken=takeFifoSegments(current.sources,selected,{productId:step.productId,unit:step.unit,quantityUnits:step.quantityUnits})
  origin.segments=normalizeCostSegments(current.sources,[...other,...taken.remaining]);const destination=node(current,to,true)
  if(to.stage==='available'){
    const released=from.stage==='reserved'||unused||relocate
    destination.segments=restoreCostSegments(current.sources,destination.segments,taken.allocations,released?{kind:'release-reservation'}:{kind:'customer-return',queueOrder:current.nextQueueOrder})
    if(!released)current.nextQueueOrder=increment(greatestQueue(current.positions))
  }else destination.segments=normalizeCostSegments(current.sources,[...destination.segments,...taken.allocations])
  return {kind:relocate?'relocate':unused?'release-unused':'move',from,to,productId:step.productId,unit:step.unit,quantityUnits:step.quantityUnits,segments:taken.allocations,cost:taken.cost}
}
function price(current,step){
  record(step,['kind','sourceId','valueCents']);const index=current.sources.findIndex(source=>source.id===step.sourceId)
  if(index<0)fail('SOURCE_ID')
  const before=costForSource(current,step.sourceId);current.sources[index]=priceUnvaluedCostSource(current.sources[index],step.valueCents);const after=costForSource(current,step.sourceId)
  return {kind:'price',sourceId:step.sourceId,confirmedValueCents:step.valueCents,byState:Object.fromEntries(STOCK_COST_STATES.map(stage=>[stage,{previousValueCents:before[stage].valueCents,confirmedValueCents:after[stage].valueCents}]))}
}
export function planCostCustody(input,command){
  const current=state(input);record(command,['expectedSequence','steps'])
  counter(command.expectedSequence)
  if(command.expectedSequence!==current.sequence||!Array.isArray(command.steps))fail('STATES')
  const effects=[]
  for(const step of command.steps){
    const descriptor=step&&Object.getOwnPropertyDescriptor(step,'kind')
    if(!descriptor||!Object.hasOwn(descriptor,'value'))fail('STATES')
    if(step.kind==='acquire')effects.push(acquire(current,step))
    else if(step.kind==='acquire-disposed')effects.push(acquire(current,step,true))
    else if(step.kind==='move')effects.push(move(current,step))
    else if(step.kind==='release-unused')effects.push(move(current,step,true))
    else if(step.kind==='relocate')effects.push(move(current,step,false,true))
    else if(step.kind==='price')effects.push(price(current,step))
    else fail('STATES')
  }
  current.sequence=increment(current.sequence)
  const next=state(current)
  return {state:next,effects,valuation:costCustodySummary(next)}
}
