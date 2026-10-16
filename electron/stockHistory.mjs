import {canonicalSignature} from './operationRules.mjs'
import {stockLedgerDigest} from './stockLedgerModel.mjs'
import {stockCostSummary,STOCK_COST_STATES} from './stockCost.mjs'
import {planStockOpening,stockLedgerError} from './stockOpeningPlan.mjs'
import {readExchangeTextSetting} from './businessExchange.mjs'

export const STOCK_HISTORY_QUERY='pos-stock-history-query/v1',STOCK_HISTORY='pos-stock-history/v1',STOCK_HISTORY_PAGE_SIZE=20
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw Error('庫存查詢需要重新核對')}
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max
const sum=values=>{const n=values.reduce((total,value)=>total+BigInt(value),0n);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw stockLedgerError('HISTORY');return Number(n)}
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const brief=(sources,segments)=>{const {complete,knownValueCents,valueCents}=stockCostSummary(sources,segments);return {complete,knownValueCents,valueCents}}
export const newStockHistoryQuery=()=>({protocol:STOCK_HISTORY_QUERY,context:null,productId:null,sourceId:null,search:'',cursor:0})
export function stockHistoryQuery(raw){
 exact(raw,['protocol','context','productId','sourceId','search','cursor'])
 if(raw.protocol!==STOCK_HISTORY_QUERY||raw.productId!==null&&!text(raw.productId,1024)||raw.sourceId!==null&&(!text(raw.sourceId,1024)||!raw.productId)||typeof raw.search!=='string'||raw.search.length>200||!Number.isSafeInteger(raw.cursor)||raw.cursor<0||raw.cursor&&!raw.context)throw Error('庫存查詢需要重新核對')
 if(raw.context!==null){exact(raw.context,['storeId','epoch','historyId']);if(raw.context.storeId!==null&&!text(raw.context.storeId,1024)||raw.context.epoch!==null&&!text(raw.context.epoch,1024)||!/^sha256:[a-f0-9]{64}$/.test(raw.context.historyId))throw Error('庫存查詢需要重新核對')}
 return structuredClone(raw)
}
export function stockHistoryContext({book,state,epoch}){
 return {storeId:readExchangeTextSetting(book.settings||[],'sharedStoreId')||null,epoch:epoch||null,historyId:stockLedgerDigest({stateDigest:state.stateDigest,products:(book.products||[]).map(p=>({id:p.id,name:p.name,unit:p.unit,stock:p.stock,barcode:p.barcode||''})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)})}
}
export function assertStockHistoryResult(value,raw){
 const query=stockHistoryQuery(raw),fail=()=>{throw Error('庫存紀錄回覆需要重新核對')},number=n=>Number.isSafeInteger(n)&&n>=0,amount=row=>row&&typeof row.complete==='boolean'&&number(row.knownValueCents)&&row.valueCents===(row.complete?row.knownValueCents:null),mode=query.sourceId?'source':query.productId?'events':'products'
 if(!value||value.protocol!==STOCK_HISTORY||value.mode!==mode||!['active','reference-only-not-activated'].includes(value.status)||value.cursor!==query.cursor||!number(value.total)||value.cursor>value.total||!Array.isArray(value.rows)||value.rows.length!==Math.min(STOCK_HISTORY_PAGE_SIZE,value.total-value.cursor)||value.nextCursor!==(value.cursor+value.rows.length<value.total?value.cursor+value.rows.length:null))fail()
 try{stockHistoryQuery({...query,context:value.context});if(!value.context||query.context&&!same(value.context,query.context))fail()}catch{fail()}
 const product=row=>{if(!row||!text(row.id,1024)||typeof row.name!=='string'||!text(row.unit,1024)||!row.states||STOCK_COST_STATES.some(stage=>!number(row.states[stage]?.quantityUnits)||!amount(row.states[stage]))||!amount(row.heldCost))fail()}
 if(value.status==='reference-only-not-activated'){if(value.total||value.product!==null||value.source!==null)fail();return value}
 if(mode==='products'){if(value.product!==null||value.source!==null)fail();value.rows.forEach(product);return value}
 product(value.product);if(value.product.id!==query.productId)fail()
 let previous=Infinity;const ids=new Set()
 for(const row of value.rows){
  if(!text(row.eventId,1024)||ids.has(row.eventId)||!number(row.sequence)||row.sequence<1||row.sequence>=previous||!text(row.operationId,1024)||!text(row.kind,256)||!Number.isFinite(Date.parse(row.time))||!row.actor||typeof row.actor.username!=='string'||!Array.isArray(row.parts)||!Array.isArray(row.journals))fail();ids.add(row.eventId);previous=row.sequence
  for(const part of row.parts){if(!amount(part.original)||!amount(part.current)||!Array.isArray(part.segments))fail();if(part.kind==='price'){if(part.quantityUnits!==null||!text(part.sourceId,1024)||part.segments.length||query.sourceId&&part.sourceId!==query.sourceId)fail()}else{if(!number(part.quantityUnits)||!part.quantityUnits||part.from!==null&&!STOCK_COST_STATES.includes(part.from)||!STOCK_COST_STATES.includes(part.to)||part.segments.some(s=>!text(s.sourceId,1024)||!number(s.quantityUnits)||!s.quantityUnits||!number(s.offsetUnits)||query.sourceId&&s.sourceId!==query.sourceId)||sum(part.segments.map(s=>s.quantityUnits))!==part.quantityUnits)fail()}}
  for(const journal of row.journals){if(journal.amountUnit!=='cents'||typeof journal.description!=='string'||!Array.isArray(journal.lines)||journal.lines.some(line=>!text(line.account,32)||!number(line.debitCents)||!number(line.creditCents))||journal.lines.reduce((total,line)=>total+BigInt(line.debitCents)-BigInt(line.creditCents),0n)!==0n)fail()}
 }
 if(mode==='source'){const s=value.source;if(!s||s.id!==query.sourceId||s.productId!==query.productId||s.unit!==value.product.unit||!number(s.quantityUnits)||!s.quantityUnits||s.valueCents!==null&&!number(s.valueCents)||s.originalValueCents!==null&&!number(s.originalValueCents)||!s.origin||!Number.isFinite(Date.parse(s.origin.time))||!text(s.origin.operationId,1024)||s.confirmation!==null&&(!Number.isFinite(Date.parse(s.confirmation.time))||!text(s.confirmation.operationId,1024))||!Array.isArray(s.positions)||s.positions.some(p=>!STOCK_COST_STATES.includes(p.owner?.stage)||!number(p.quantityUnits)||!amount(p))||sum(s.positions.map(p=>p.quantityUnits))!==s.quantityUnits||!s.states||STOCK_COST_STATES.some(stage=>!number(s.states[stage]?.quantityUnits)||!amount(s.states[stage]))||sum(STOCK_COST_STATES.map(stage=>s.states[stage].quantityUnits))!==s.quantityUnits)fail()}else if(value.source!==null)fail()
 return value
}
function groupedPositions(custody,productId,sourceId=null){
 const sourceMap=new Map(custody.sources.map(s=>[s.id,s])),nodes=custody.positions.map(node=>({...node,segments:node.segments.filter(segment=>sourceMap.get(segment.sourceId)?.productId===productId&&(!sourceId||segment.sourceId===sourceId))})).filter(node=>node.segments.length)
 const states=Object.fromEntries(STOCK_COST_STATES.map(stage=>{const segments=nodes.filter(node=>node.owner.stage===stage).flatMap(node=>node.segments);return [stage,{quantityUnits:sum(segments.map(s=>s.quantityUnits)),...brief(custody.sources,segments)}]}))
 return {states,nodes}
}
function productSummary(product,custody){
 const {states}=groupedPositions(custody,product.id),held=['available','reserved'].map(stage=>states[stage]),complete=held.every(row=>row.complete),knownValueCents=sum(held.map(row=>row.knownValueCents))
 return {id:product.id,name:product.name,unit:product.unit,states,heldCost:{complete,knownValueCents,valueCents:complete?knownValueCents:null}}
}
function originalOpening(state){const first=state.entries[0];return planStockOpening(JSON.parse(first.openingMaterial).preview,first.input,first.date).custody}
function eventKind(entry){const method=entry.method||'applyStockCostOperation';return method==='applyStockCostOperation'?entry.input.action:method==='applyInventoryOperation'?entry.input.kind:method==='applyRestaurantOperation'||method==='applySalesOperation'?method+':'+entry.input.action:method}
const entryIdentity=entry=>({eventId:entry.id,operationId:entry.input.id,sequence:entry.sequence,time:entry.time,date:entry.date,actor:structuredClone(entry.actor),method:entry.method||'applyStockCostOperation',kind:eventKind(entry)})

// SH2-SH3: consumers supply the result of the complete ledger/book validation,
// plus primitive journal spans observed during that very same replay.
export function makeStockHistory(raw,data){
 const query=stockHistoryQuery(raw),{book,state,spans}=data,context=stockHistoryContext(data),mode=query.sourceId?'source':query.productId?'events':'products'
 if(query.context&&!same(query.context,context))throw Error('庫存紀錄已更新，請重新核對')
 const result={protocol:STOCK_HISTORY,context,status:state.projection?'active':'reference-only-not-activated',mode,product:null,source:null,rows:[],total:0,nextCursor:null,cursor:query.cursor}
 if(!state.projection){if(query.cursor)throw Error('庫存查詢需要重新核對');return result}
 if(!Array.isArray(spans)||spans.length!==state.entries.length||spans.some((row,i)=>row.sequence!==i+1||row.start!==(i?spans[i-1].end:0)||!Number.isSafeInteger(row.end)||row.end<row.start)||spans.at(-1).end!==state.projection.journals.length)throw stockLedgerError('HISTORY')
 const custody=state.projection.custody,products=book.products||[],search=query.search.trim().toLocaleLowerCase('en-US'),page=(rows,project)=>{if(query.cursor>rows.length)throw Error('庫存查詢需要重新核對');result.total=rows.length;result.rows=rows.slice(query.cursor,query.cursor+STOCK_HISTORY_PAGE_SIZE).map(project);result.nextCursor=query.cursor+result.rows.length<rows.length?query.cursor+result.rows.length:null;return result}
 if(mode==='products')return page(products.filter(p=>(p.name+' '+p.id+' '+(p.barcode||'')).toLocaleLowerCase('en-US').includes(search)).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:a.id<b.id?-1:a.id>b.id?1:0),p=>productSummary(p,custody))
 const product=products.find(p=>p.id===query.productId);if(!product)throw Error('找不到這個商品，請重新核對')
 result.product=productSummary(product,custody)
 const sources=custody.sources,sourceMap=new Map(sources.map(s=>[s.id,s])),sourceIds=new Set(sources.filter(s=>s.productId===product.id).map(s=>s.id)),prices=new Map(state.entries.filter(e=>(!e.method||e.method==='applyStockCostOperation')&&e.input.action==='price').map(e=>[e.input.sourceId,e])),business=new Map((state.projection.business||[]).map(row=>[row.eventId,row])),opening=originalOpening(state)
 if(query.sourceId&&!sourceIds.has(query.sourceId))throw Error('找不到這批成本來源，請重新核對')
 const select=segments=>segments.filter(s=>sourceIds.has(s.sourceId)&&(!query.sourceId||s.sourceId===query.sourceId)),atSequence=sequence=>sources.map(source=>prices.get(source.id)?.sequence>sequence?{...source,valueCents:null}:source)
 const part=(kind,segments,sequence,from,to)=>{const rows=select(segments);return rows.length?{kind,from:from||null,to:to||null,quantityUnits:sum(rows.map(s=>s.quantityUnits)),original:brief(atSequence(sequence),rows),current:brief(sources,rows),segments:structuredClone(rows)}:null}
 const openingParts=()=>opening.positions.map(node=>part('opening',node.segments,1,null,node.owner.stage)).filter(Boolean)
 const touches=entry=>{
  const method=entry.method||'applyStockCostOperation'
  if(method==='applyStockCostOperation')return entry.input.action==='open'?openingParts().length>0:sourceIds.has(entry.input.sourceId)&&(!query.sourceId||query.sourceId===entry.input.sourceId)
  const effects=business.get(entry.id)?.effects||[]
  return effects.some(effect=>select(effect.segments||[]).length)||!query.sourceId&&(entry.evidence?.products||[]).some(p=>p.id===product.id)
 }
 const entries=state.entries.filter(touches).slice().reverse(),selected=entries.slice(query.cursor,query.cursor+STOCK_HISTORY_PAGE_SIZE)
 if(query.cursor>entries.length)throw Error('庫存查詢需要重新核對')
 result.total=entries.length;result.nextCursor=query.cursor+selected.length<entries.length?query.cursor+selected.length:null
 result.rows=selected.map(entry=>{
  const method=entry.method||'applyStockCostOperation',span=spans[entry.sequence-1]
  let parts
  if(method==='applyStockCostOperation'&&entry.input.action==='open')parts=openingParts()
  else if(method==='applyStockCostOperation'){const source=sourceMap.get(entry.input.sourceId);parts=[{kind:'price',from:null,to:null,quantityUnits:null,original:{complete:false,knownValueCents:0,valueCents:null},current:{complete:true,knownValueCents:source.valueCents,valueCents:source.valueCents},segments:[],sourceId:source.id}]}
  else parts=(business.get(entry.id)?.effects||[]).map(effect=>part(effect.kind,effect.segments||[],entry.sequence,effect.from?.stage,effect.to?.stage)).filter(Boolean)
  return {...entryIdentity(entry),documentId:entry.evidence?.order?.id||entry.evidence?.entry?.id||entry.input.purchaseId||entry.input.orderId||null,parts,journals:structuredClone(state.projection.journals.slice(span.start,span.end))}
 })
 if(query.sourceId){
  const source=sourceMap.get(query.sourceId),price=prices.get(source.id),origin=state.entries.find(entry=>entry.sequence===1?opening.sources.some(s=>s.id===source.id):(business.get(entry.id)?.effects||[]).some(effect=>['acquire','acquire-disposed'].includes(effect.kind)&&(effect.segments||[]).some(s=>s.sourceId===source.id))),{nodes,states}=groupedPositions(custody,product.id,source.id)
  if(!origin)throw stockLedgerError('HISTORY')
  result.source={...structuredClone(source),originalValueCents:price?null:source.valueCents,confirmation:price?entryIdentity(price):null,origin:entryIdentity(origin),states,positions:nodes.map(node=>({owner:structuredClone(node.owner),quantityUnits:sum(node.segments.map(s=>s.quantityUnits)),...brief(sources,node.segments)}))}
 }
 return result
}
