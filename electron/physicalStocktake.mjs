import {canonicalSignature,operationHeader,quantityValue} from './operationRules.mjs'
import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js'

export const PHYSICAL_STOCKTAKE='pos-physical-stocktake/v1'
export const PHYSICAL_MEANING='physical-shelf'
const fingerprint=value=>'sha256:'+bytesToHex(sha256(utf8ToBytes(canonicalSignature(value))))
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const invalid=()=>Error('盤點資料需要核對，原數量已保留')
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw invalid()}
const text=value=>{if(typeof value!=='string'||!value||value.length>500)throw invalid();return value}
const validUnits=value=>{if(!Number.isSafeInteger(value)||value<0||value>1e12)throw invalid();return value}
const units=value=>validUnits(Math.round(quantityValue(value,'數量')*1000))
export function physicalQuantityUnits(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9||Math.round(value*1000)/1000!==value)throw Error('請填零以上的數量，最多三位小數');return validUnits(Math.round(value*1000))}
function context(value){exact(value,['storeId','epoch','costMode']);text(value.storeId);text(value.epoch);if(!['active','reference'].includes(value.costMode))throw invalid();return value}
function factReference(current,fact){return fingerprint({protocol:PHYSICAL_STOCKTAKE,context:current,fact})}
function totals(fact){
 exact(fact,['product','availableUnits','reservations']);exact(fact.product,['id','name','unit','barcode','category']);text(fact.product.id);text(fact.product.name);text(fact.product.unit);if(typeof fact.product.barcode!=='string'||typeof fact.product.category!=='string'||!Array.isArray(fact.reservations))throw invalid();validUnits(fact.availableUnits)
 const seen=new Set();let reservedUnits=0,preparingUnits=0
 for(const row of fact.reservations){exact(row,['id','version','status','startedAt','saleId','quantityUnits']);text(row.id);if(seen.has(row.id)||!Number.isSafeInteger(row.version)||row.version<1||!['reserved','cooking','ready','dispatched'].includes(row.status)||typeof row.startedAt!=='string'||typeof row.saleId!=='string'||row.startedAt&&!Number.isFinite(Date.parse(row.startedAt))||!row.startedAt&&row.status!=='reserved'||validUnits(row.quantityUnits)===0)throw invalid();seen.add(row.id);if(row.startedAt)preparingUnits=validUnits(preparingUnits+row.quantityUnits);else reservedUnits=validUnits(reservedUnits+row.quantityUnits)}
 return {reservedUnits,preparingUnits,shelfUnits:validUnits(fact.availableUnits+reservedUnits)}
}
export function physicalStocktakeFacts(data){
 if(!Array.isArray(data.products)||!Array.isArray(data.restaurantEntries))throw invalid()
 const products=new Map(data.products.map(p=>[p.id,p]));if(products.size!==data.products.length)throw invalid()
 const reservations=new Map(),ids=new Set()
 for(const entry of data.restaurantEntries){
  if(ids.has(entry.id)||!['reserved','cooking','ready','dispatched','completed','cancelled'].includes(entry.status))throw invalid();ids.add(entry.id)
  if(['cancelled','completed'].includes(entry.status))continue
  if(!Array.isArray(entry.allocations)||!entry.allocations.length)throw invalid()
  const allocated=new Set()
  for(const item of entry.allocations){if(!products.has(item.id)||allocated.has(item.id))throw invalid();allocated.add(item.id);const list=reservations.get(item.id)||[];list.push({id:entry.id,version:entry.version,status:entry.status,startedAt:entry.startedAt,saleId:entry.saleId,quantityUnits:units(item.qty)});reservations.set(item.id,list)}
 }
 return data.products.map(p=>{const fact={product:{id:p.id,name:p.name,unit:p.unit,barcode:p.barcode||'',category:p.category||''},availableUnits:units(p.stock),reservations:(reservations.get(p.id)||[]).sort((a,b)=>a.id.localeCompare(b.id))};totals(fact);return fact})
}
export function physicalStocktakeState(data){
 const current=context({storeId:data.storeId,epoch:data.epoch,costMode:data.costMode}),facts=physicalStocktakeFacts(data),rows=facts.map(fact=>({...fact.product,availableUnits:fact.availableUnits,...totals(fact),reference:factReference(current,fact)})).sort((a,b)=>a.id.localeCompare(b.id))
 return {protocol:PHYSICAL_STOCKTAKE,context:current,reviewId:fingerprint({context:current,rows:rows.map(row=>[row.id,row.reference])}),rows}
}
export function assertPhysicalStocktakeState(state){
 exact(state,['protocol','context','reviewId','rows']);context(state.context)
 if(state.protocol!==PHYSICAL_STOCKTAKE||!Array.isArray(state.rows))throw invalid()
 const ids=new Set();for(const row of state.rows){exact(row,['id','name','unit','barcode','category','availableUnits','reservedUnits','preparingUnits','shelfUnits','reference']);text(row.id);text(row.name);text(row.unit);if(ids.has(row.id)||typeof row.barcode!=='string'||typeof row.category!=='string'||!/^sha256:[a-f0-9]{64}$/.test(row.reference))throw invalid();ids.add(row.id);for(const key of ['availableUnits','reservedUnits','preparingUnits','shelfUnits'])validUnits(row[key]);if(row.shelfUnits!==row.availableUnits+row.reservedUnits)throw invalid()}
 if(state.reviewId!==fingerprint({context:state.context,rows:state.rows.map(row=>[row.id,row.reference])}))throw invalid();return state
}
function requestShape(request){
 exact(request,['id','time','kind','protocol','quantityMeaning','context','counts']);operationHeader(request);context(request.context)
 if(request.kind!=='stocktake'||request.protocol!==PHYSICAL_STOCKTAKE||request.quantityMeaning!==PHYSICAL_MEANING||!Array.isArray(request.counts)||!request.counts.length||request.counts.length>10000)throw invalid()
 const ids=new Set();for(const row of request.counts){exact(row,['id','quantity','reference']);text(row.id);text(row.reference);physicalQuantityUnits(row.quantity);if(ids.has(row.id))throw invalid();ids.add(row.id)}
}
export function validatePhysicalStocktakeCommand(request){requestShape(request);return structuredClone(request)}
function resultRows(request,facts){
 requestShape(request);const byId=new Map(facts.map(fact=>[fact.product.id,fact]))
 return request.counts.map(row=>{
  const fact=byId.get(row.id);if(!fact||factReference(request.context,fact)!==row.reference)throw Error('盤點期間資料已變更，請重新核對 '+(fact?.product.name||row.id))
  const quantityUnits=physicalQuantityUnits(row.quantity),held=totals(fact)
  if(quantityUnits<held.reservedUnits)throw Error('架上數量少於已預留量，請先核對預訂 '+fact.product.name)
  const availableAfterUnits=quantityUnits-held.reservedUnits,differenceUnits=availableAfterUnits-fact.availableUnits
  return {fact:structuredClone(fact),reference:row.reference,quantityUnits,...held,availableAfterUnits,differenceUnits,costStatus:differenceUnits>0?'unknown-new-source':'unchanged'}
 })
}
export function planPhysicalStocktake(request,data){
 requestShape(request);const current=context({storeId:data.storeId,epoch:data.epoch,costMode:data.costMode})
 if(request.context.storeId!==current.storeId||request.context.epoch!==current.epoch)throw Object.assign(Error('盤點屬於另一間店或還原前資料，請以原編號核對'),{historyUncertain:true})
 if(request.context.costMode!==current.costMode)throw Error('盤點資料已更新，請重新核對')
 if(Math.abs((data.now??Date.now())-Date.parse(request.time))>300000)throw Error('盤點時間已過期，請重新核對')
 return {protocol:PHYSICAL_STOCKTAKE,context:structuredClone(current),rows:resultRows(request,physicalStocktakeFacts(data))}
}
export function assertPhysicalStocktakeReceipt(request,receipt){
 exact(receipt,['protocol','context','rows']);if(receipt.protocol!==PHYSICAL_STOCKTAKE||!same(receipt.context,request.context)||!Array.isArray(receipt.rows)||receipt.rows.length!==request.counts.length)throw invalid()
 const expected={protocol:PHYSICAL_STOCKTAKE,context:request.context,rows:resultRows(request,receipt.rows.map(row=>row.fact))}
 if(!same(receipt,expected))throw invalid();return receipt
}
export function assertPhysicalStocktakeResult(request,result){
 assertPhysicalStocktakeReceipt(request,result.receipt?.stocktake)
 if(request.context.costMode==='active'){
  const cost=result.costReceipt
  if(cost?.protocol!=='pos-stock-cost/v1'||cost.success!==true||cost.id!==request.id||cost.sourceMethod!=='applyInventoryOperation'||!Number.isSafeInteger(cost.sequence)||cost.sequence<1||typeof cost.eventId!=='string'||!/^sha256:[a-f0-9]{64}$/.test(cost.eventHash)||!/^sha256:[a-f0-9]{64}$/.test(cost.stateDigest))throw Error('盤點成本回覆尚未確認，請保留原編號核對')
 }
 return result
}
export function physicalStocktakeAudits(audits=[]){
 const results=[]
 for(const audit of audits){
  if(audit.action!=='INVENTORY_OPERATION')continue
  let saved;try{saved=typeof audit.detail==='string'?JSON.parse(audit.detail):audit.detail}catch{continue}
  if(!saved||typeof saved!=='object')continue
  let request;try{request=JSON.parse(saved.signature)}catch{if(saved.stocktake)throw invalid();continue}
  if(!request||typeof request!=='object'||Array.isArray(request)){if(saved.stocktake)throw invalid();continue}
  if(request.protocol!==PHYSICAL_STOCKTAKE&&request.quantityMeaning!==PHYSICAL_MEANING&&!saved.stocktake)continue
  if(audit.id!=='stock-operation:'+request.id||saved.id!==request.id||saved.signature!==canonicalSignature(request)||!['owner','staff'].includes(audit.role)||typeof audit.userId!=='string'||!audit.userId)throw invalid()
  assertPhysicalStocktakeReceipt(request,saved.stocktake);results.push({request,receipt:saved.stocktake})
 }
 return results
}
