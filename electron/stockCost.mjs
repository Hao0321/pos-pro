// Pure cost-source/interval primitives. These are not an authoritative ledger.
// Adapters must bind source documents, authenticated actors, complete custody
// partitions and durable receipts in the same transaction before using them.
export const STOCK_COST_ERRORS=Object.freeze({
  SOURCE:'庫存成本來源格式不正確',
  SOURCE_ID:'庫存成本來源不存在或重複',
  SEGMENT:'庫存成本分配資料不正確',
  OVERLAP:'同一份庫存成本被重複引用，請保留原資料核對',
  PARTITION:'庫存成本來源數量與分配不符',
  AMOUNT:'庫存成本來源金額超過可核對範圍',
  SCOPE:'庫存成本品項或單位不一致',
  INSUFFICIENT:'庫存成本對應的可用數量不足，請重新核對',
  QUEUE:'退回庫存的入庫次序不正確，請保留原資料核對',
  PRICED:'原成本已確認，請保留原紀錄核對',
  STATES:'庫存成本紀錄不完整，請保留原資料核對',
  QUANTITY:'庫存成本數量超過可核對範圍',
})
export const STOCK_COST_STATES=Object.freeze(['available','reserved','consumed','wasted','supplierReturned'])
const MAX_UNITS=1_000_000_000_000,MAX=BigInt(Number.MAX_SAFE_INTEGER)
function fail(code){throw Object.assign(Error(STOCK_COST_ERRORS[code]),{code:'STOCK_COST_'+code})}
function shape(value,keys,code){
  if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(code)
  const own=Reflect.ownKeys(value)
  if(own.length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||own.some(key=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return typeof key!=='string'||!keys.includes(key)||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')}))fail(code)
}
function text(value,max,code){if(typeof value!=='string'||!value||value.length>max||value.trim()!==value||value.normalize('NFC')!==value||/[\p{Cc}\p{Cf}]/u.test(value))fail(code);return value}
function integer(value,min,max,code){if(!Number.isSafeInteger(value)||value<min||value>max)fail(code);return value}
function safe(value,code='AMOUNT'){if(value<0n||value>MAX)fail(code);return Number(value)}
function sum(values,code='AMOUNT'){return safe(values.reduce((total,value)=>total+BigInt(value),0n),code)}
const ordinal=(a,b)=>a<b?-1:a>b?1:0

export function costSource(input){
  shape(input,['id','productId','unit','currency','quantityUnits','valueCents'],'SOURCE')
  text(input.id,256,'SOURCE');text(input.productId,256,'SOURCE');text(input.unit,30,'SOURCE')
  if(input.currency!=='TWD')fail('SOURCE')
  integer(input.quantityUnits,1,MAX_UNITS,'QUANTITY')
  if(input.valueCents!==null)integer(input.valueCents,0,Number.MAX_SAFE_INTEGER,'AMOUNT')
  return {...input}
}
function sourcesById(sources){
  if(!Array.isArray(sources))fail('SOURCE')
  const result=new Map()
  for(const row of sources){const source=costSource(row);if(result.has(source.id))fail('SOURCE_ID');result.set(source.id,source)}
  return result
}
function segment(input,sources){
  shape(input,['sourceId','offsetUnits','quantityUnits','queueOrder'],'SEGMENT')
  const source=sources.get(input.sourceId);if(!source)fail('SOURCE_ID')
  integer(input.offsetUnits,0,MAX_UNITS,'SEGMENT');integer(input.quantityUnits,1,MAX_UNITS,'SEGMENT');integer(input.queueOrder,0,Number.MAX_SAFE_INTEGER,'QUEUE')
  if(input.offsetUnits+input.quantityUnits>source.quantityUnits)fail('SEGMENT')
  return {...input}
}
function noOverlap(rows){
  const groups=new Map()
  for(const row of rows){if(!groups.has(row.sourceId))groups.set(row.sourceId,[]);groups.get(row.sourceId).push(row)}
  for(const group of groups.values()){
    const ordered=group.slice().sort((a,b)=>a.offsetUnits-b.offsetUnits)
    for(let index=1;index<ordered.length;index++)if(ordered[index-1].offsetUnits+ordered[index-1].quantityUnits>ordered[index].offsetUnits)fail('OVERLAP')
  }
  return groups
}
function segments(rows,sources){if(!Array.isArray(rows))fail('SEGMENT');const result=rows.map(row=>segment(row,sources));noOverlap(result);return result}
function queue(rows){
  const ordered=rows.slice().sort((a,b)=>a.queueOrder-b.queueOrder||ordinal(a.sourceId,b.sourceId)||a.offsetUnits-b.offsetUnits),result=[]
  for(const row of ordered){const last=result.at(-1);if(last&&last.sourceId===row.sourceId&&last.queueOrder===row.queueOrder&&last.offsetUnits+last.quantityUnits===row.offsetUnits)last.quantityUnits+=row.quantityUnits;else result.push({...row})}
  return result
}
function prefix(value,units,total){return (2n*BigInt(value)*BigInt(units)+BigInt(total))/(2n*BigInt(total))}
function intervalValue(source,offsetUnits,quantityUnits){
  if(source.valueCents===null)return null
  return safe(prefix(source.valueCents,offsetUnits+quantityUnits,source.quantityUnits)-prefix(source.valueCents,offsetUnits,source.quantityUnits))
}
export function costSegmentValue(input,offsetUnits,quantityUnits){
  const source=costSource(input)
  integer(offsetUnits,0,MAX_UNITS,'SEGMENT');integer(quantityUnits,1,MAX_UNITS,'SEGMENT')
  if(offsetUnits+quantityUnits>source.quantityUnits)fail('SEGMENT')
  return intervalValue(source,offsetUnits,quantityUnits)
}
function summary(rows,sources){
  const values=[],unknown=new Map()
  for(const row of rows){
    const source=sources.get(row.sourceId),value=intervalValue(source,row.offsetUnits,row.quantityUnits)
    if(value!==null){values.push(value);continue}
    const previous=unknown.get(row.sourceId)
    unknown.set(row.sourceId,{sourceId:source.id,productId:source.productId,unit:source.unit,quantityUnits:sum([previous?.quantityUnits||0,row.quantityUnits],'QUANTITY')})
  }
  const knownValueCents=sum(values),unvalued=[...unknown.values()].sort((a,b)=>ordinal(a.sourceId,b.sourceId))
  return {complete:!unvalued.length,knownValueCents,valueCents:unvalued.length?null:knownValueCents,unvalued}
}
export function stockCostSummary(sources,rows){const catalog=sourcesById(sources);return summary(segments(rows,catalog),catalog)}
export function normalizeCostSegments(sources,rows){const catalog=sourcesById(sources);return queue(segments(rows,catalog))}

export function splitCostSegment(input,row,quantityUnits){
  const source=costSource(input),original=segment(row,new Map([[source.id,source]]))
  integer(quantityUnits,1,original.quantityUnits,'QUANTITY')
  return {taken:{...original,quantityUnits},remainder:quantityUnits===original.quantityUnits?null:{...original,offsetUnits:original.offsetUnits+quantityUnits,quantityUnits:original.quantityUnits-quantityUnits}}
}

export function takeFifoSegments(sources,available,request){
  shape(request,['productId','unit','quantityUnits'],'SCOPE');text(request.productId,256,'SCOPE');text(request.unit,30,'SCOPE');integer(request.quantityUnits,1,MAX_UNITS,'QUANTITY')
  const catalog=sourcesById(sources),ordered=queue(segments(available,catalog))
  for(const row of ordered){const source=catalog.get(row.sourceId);if(source.productId!==request.productId||source.unit!==request.unit)fail('SCOPE')}
  if(sum(ordered.map(row=>row.quantityUnits),'QUANTITY')<request.quantityUnits)fail('INSUFFICIENT')
  let needed=request.quantityUnits;const allocations=[],remaining=[]
  for(const row of ordered){
    if(!needed){remaining.push(row);continue}
    const count=Math.min(needed,row.quantityUnits),parts=splitCostSegment(catalog.get(row.sourceId),row,count)
    allocations.push(parts.taken);if(parts.remainder)remaining.push(parts.remainder);needed-=count
  }
  return {allocations,remaining,cost:summary(allocations,catalog)}
}

export function restoreCostSegments(sources,available,returning,options){
  const hasOrder=Object.hasOwn(options??{},'queueOrder')
  shape(options,hasOrder?['kind','queueOrder']:['kind'],'QUEUE')
  if(!['release-reservation','customer-return'].includes(options.kind)||hasOrder!==(options.kind==='customer-return'))fail('QUEUE')
  const catalog=sourcesById(sources),current=segments(available,catalog),restored=queue(segments(returning,catalog))
  if(!restored.length)fail('SEGMENT')
  if(options.kind==='customer-return'){
    integer(options.queueOrder,0,Number.MAX_SAFE_INTEGER,'QUEUE')
    if([...current,...restored].some(row=>row.queueOrder>=options.queueOrder))fail('QUEUE')
    // One actual return can contain several original cost sources. Preserve
    // their issued order within this new arrival instead of sorting source IDs.
    safe(BigInt(options.queueOrder)+BigInt(restored.length)-1n,'QUEUE')
    restored.forEach((row,index)=>{row.queueOrder=options.queueOrder+index})
  }
  noOverlap([...current,...restored]);return queue([...current,...restored])
}

export function priceUnvaluedCostSource(input,valueCents){
  const source=costSource(input);if(source.valueCents!==null)fail('PRICED')
  integer(valueCents,0,Number.MAX_SAFE_INTEGER,'AMOUNT');return {...source,valueCents}
}

export function assertCostPartition(sources,positions){
  shape(positions,STOCK_COST_STATES,'STATES')
  const catalog=sourcesById(sources),all=[],categories={}
  for(const state of STOCK_COST_STATES){const rows=segments(positions[state],catalog);all.push(...rows);categories[state]=summary(rows,catalog)}
  const groups=noOverlap(all)
  for(const source of catalog.values()){
    const rows=(groups.get(source.id)||[]).slice().sort((a,b)=>a.offsetUnits-b.offsetUnits);let offset=0
    for(const row of rows){if(row.offsetUnits!==offset)fail('PARTITION');offset+=row.quantityUnits}
    if(offset!==source.quantityUnits)fail('PARTITION')
  }
  const knownSourceValueCents=sum([...catalog.values()].flatMap(source=>source.valueCents===null?[]:[source.valueCents]))
  if(sum(Object.values(categories).map(row=>row.knownValueCents))!==knownSourceValueCents)fail('PARTITION')
  const complete=Object.values(categories).every(row=>row.complete),ownedKnownValueCents=sum([categories.available.knownValueCents,categories.reserved.knownValueCents])
  return {complete,categories,knownSourceValueCents,totalSourceValueCents:complete?knownSourceValueCents:null,ownedKnownValueCents,ownedValueCents:categories.available.complete&&categories.reserved.complete?ownedKnownValueCents:null}
}
