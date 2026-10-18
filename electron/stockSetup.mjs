import {canonicalSignature} from './operationRules.mjs'
import {stockOpeningKey,planStockOpening,planOpeningCostPrice,STOCK_LEDGER_PROTOCOL} from './stockOpeningPlan.mjs'
import {costCustodySummary} from './stockCustody.mjs'
import {STOCK_SETUP_REVIEW,STOCK_SETUP_REVIEW_V2,stockSetupSummary,assertStockSetupReview,stockSetupJournalLines} from './stockSetupReview.mjs'
import {clearStockReturnSuspense} from './stockBusinessPlan.mjs'
export const STOCK_SETUP_STATE='pos-stock-setup-state/v1',STOCK_SETUP_PREVIEW='pos-stock-setup-preview/v1'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(key=>!Object.hasOwn(v,key)))throw Error('請核對成本選項與原始金額')}
export function stockSetupAmount(raw,mode,quantityUnits){
  if(!['unit','total'].includes(mode)||typeof raw!=='string'||!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(raw))throw Error('成本請填完整金額，最多兩位小數')
  const [whole,fraction='']=raw.split('.'),cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))
  if(!cents)throw Error('免費的貨請選「確定免費」')
  if(!Number.isSafeInteger(quantityUnits)||quantityUnits<=0)throw Error('原庫存數量需要核對')
  const value=mode==='unit'?(cents*BigInt(quantityUnits)+500n)/1000n:cents
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('成本金額超過可核對範圍')
  return Number(value)
}
export function stockOpeningRows(preview){
  const rows=[],add=(stage,row,quantityUnits,entryId,preparing=false)=>{if(quantityUnits)rows.push({key:stockOpeningKey(stage,row.productId,entryId),productId:row.productId,name:row.name,unit:row.unit,quantityUnits,stage,preparing,entryId:entryId||'',referenceValueCents:row.referenceValueCents,referenceAllowed:row.referenceUnitCostCents>0&&row.referenceValueCents!==null&&!row.countCostNeedsReview})}
  for(const entry of preview.unpaidReservations)for(const row of entry.allocations)add('reserved',row,row.quantityUnits,entry.entryId,entry.prepared)
  for(const entry of preview.paidLegacyReservations||[])for(const row of entry.allocations||[])add('consumed',row,row.quantityUnits,entry.entryId,entry.prepared)
  for(const row of preview.products)add('available',row,row.availableUnits)
  return rows
}
export function makeStockSetupState(data){
  const {state,preview,products,storeId,epoch}=data,active=!!state.projection
  const rows=active?state.projection.custody.sources.filter(row=>row.valueCents===null).map(source=>{
    const quantities={};for(const node of state.projection.custody.positions)for(const part of node.segments)if(part.sourceId===source.id)quantities[node.owner.stage]=(quantities[node.owner.stage]||0)+part.quantityUnits
    return {key:JSON.stringify(['source',source.id]),sourceId:source.id,productId:source.productId,name:products.find(p=>p.id===source.productId)?.name||source.productId,unit:source.unit,quantityUnits:source.quantityUnits,stage:'source',referenceAllowed:false,referenceValueCents:null,quantities}
  }):stockOpeningRows(preview)
  return {protocol:STOCK_SETUP_STATE,mode:active?'pricing':'opening',context:{storeId,epoch,reviewId:active?state.stateDigest:preview.snapshotDigest,now:new Date(data.now??Date.now()).toISOString()},rows,summary:active?stockSetupSummary(state.valuation):null,blocked:!active&&!Number.isSafeInteger(preview.referenceInventoryBalanceCents),referenceInventoryBalanceCents:active?null:preview.referenceInventoryBalanceCents}
}
export function stockSetupChoice(row,entry){
  exact(entry,['key','mode','raw'])
  if(entry.key!==row.key||typeof entry.raw!=='string'||entry.raw.length>32)throw Error('請核對成本選項與原始金額')
  if(entry.mode==='reference'){if(!row.referenceAllowed||entry.raw!=='')throw Error('這批成本需要重新填寫，不能直接沿用');return row.referenceValueCents}
  if(entry.mode==='unknown'){if(entry.raw!=='')throw Error('待確認成本請保留空白');return null}
  if(entry.mode==='free'){if(entry.raw!=='')throw Error('免費選項不需要填金額');return 0}
  return stockSetupAmount(entry.raw,entry.mode,row.quantityUnits)
}
export function previewStockSetup(raw,data){
  const current=makeStockSetupState(data);exact(raw,['context','entries','useReferences']);exact(raw.context,['storeId','epoch','reviewId'])
  const {now,...context}=current.context
  if(!same(raw.context,context))throw Error('庫存或成本已更新，請保留輸入重新核對')
  if(typeof raw.useReferences!=='boolean'||!Array.isArray(raw.entries)||raw.entries.length>10000)throw Error('請核對成本選項與原始金額')
  const choices=new Map(),rows=new Map(current.rows.map(row=>[row.key,row]))
  for(const entry of raw.entries){if(!rows.has(entry.key)||choices.has(entry.key))throw Error('成本批次不存在或重複');choices.set(entry.key,stockSetupChoice(rows.get(entry.key),entry))}
  let input,plan,journalLines
  const common={protocol:STOCK_LEDGER_PROTOCOL,id:'stock-setup-preview',time:now,storeId:context.storeId,epoch:context.epoch,reviewed:true}
  if(current.mode==='opening'){
    if(current.blocked)throw Error('舊存貨帳金額需要先核對，請保留草稿')
    const overrides=current.rows.flatMap(row=>{const value=choices.has(row.key)?choices.get(row.key):raw.useReferences&&row.referenceAllowed?row.referenceValueCents:null;return [{key:row.key,valueCents:value}]})
    input={...common,action:'open',snapshotDigest:context.reviewId,overrides};plan=planStockOpening(data.preview,input,now.slice(0,10));journalLines=plan.journal.lines
  }else{
    if(raw.entries.length!==1||raw.useReferences||choices.values().next().value===null)throw Error('請一次選一批並填寫確認成本')
    const row=rows.get(raw.entries[0].key),previous=data.state.projection;input={...common,action:'price',sourceId:row.sourceId,valueCents:choices.get(row.key),expectedSequence:previous.custody.sequence};plan=planOpeningCostPrice(previous,input,now.slice(0,10))
    const projection=clearStockReturnSuspense({...previous,custody:plan.state,journals:[...previous.journals,plan.journal]},now.slice(0,10),input.id);journalLines=stockSetupJournalLines(projection,previous)
  }
  const target=current.mode==='pricing'?rows.get(raw.entries[0].key):null,subject=target?{sourceId:target.sourceId,productId:target.productId,name:target.name,unit:target.unit,quantityUnits:target.quantityUnits}:null
  const review={protocol:Object.hasOwn(plan.valuation.categories,'quarantined')?STOCK_SETUP_REVIEW_V2:STOCK_SETUP_REVIEW,sourceDigest:context.reviewId,issuedAt:now,summary:stockSetupSummary(plan.valuation),journalLines,selection:{entries:structuredClone(raw.entries),useReferences:raw.useReferences},subject};assertStockSetupReview(review)
  delete input.id;delete input.time
  return {protocol:STOCK_SETUP_PREVIEW,success:true,input:{...input,review},summary:review.summary}
}
export function verifyStockSetupReview(input,data){
  if(input.review===undefined)return
  const review=assertStockSetupReview(input.review)
  if(Math.abs((data.now??Date.now())-Date.parse(review.issuedAt))>300000)throw Error('成本預覽已過期，請重新看結果')
  if(review.sourceDigest!==(input.action==='open'?data.preview.snapshotDigest:data.state.stateDigest))throw Error('庫存或成本已更新，請保留輸入重新核對')
  const expected=previewStockSetup({context:{storeId:data.storeId,epoch:data.epoch,reviewId:review.sourceDigest},...review.selection},{...data,now:Date.parse(review.issuedAt)})
  const saved={...input};delete saved.id;delete saved.time
  if(!same(expected.input,saved))throw Error('庫存成本預覽需要重新核對')
}
