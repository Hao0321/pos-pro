import {canonicalSignature,operationHeader} from './operationRules.mjs'
import {createCostCustody,costCustodySummary,planCostCustody} from './stockCustody.mjs'
import {costSource} from './stockCost.mjs'
import {assertStockSetupReview} from './stockSetupReview.mjs'

export const STOCK_LEDGER_PROTOCOL='pos-stock-cost/v1'
export const STOCK_LEDGER_ERRORS={
 INPUT:'庫存成本操作格式不正確',
 REVIEW:'請先核對庫存與成本，再確認保存',
 STALE:'庫存或帳務已更新，請保留輸入並重新核對',
 ACTIVE:'庫存成本帳已啟用，請查看原開帳紀錄',
 HISTORY:'庫存成本回執需要核對，請保留原編號與資料',
 FLOW:'此庫存流程尚未接上成本帳，原資料已保留',
 BALANCE:'原存貨帳金額需要先核對，尚未啟用成本帳',
 ADJUST:'庫存數量請用盤點調整，商品資料可以直接修改',
 RETAIN:'商品已有交易或成本紀錄，請保留商品與原單位以供核對',
}
export function stockLedgerError(code){return Object.assign(Error(STOCK_LEDGER_ERRORS[code]),{code:'STOCK_LEDGER_'+code})}
function shape(value,keys){
 if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw stockLedgerError('INPUT')
 const own=Reflect.ownKeys(value)
 if(own.length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||own.some(key=>{const d=Object.getOwnPropertyDescriptor(value,key);return typeof key!=='string'||!keys.includes(key)||!d.enumerable||!Object.hasOwn(d,'value')}))throw stockLedgerError('INPUT')
}
function text(value){if(typeof value!=='string'||!value||value.length>256||value.trim()!==value||value.normalize('NFC')!==value||/[\p{Cc}\p{Cf}]/u.test(value))throw stockLedgerError('INPUT')}
function amount(value){if(value!==null&&(!Number.isSafeInteger(value)||value<0))throw stockLedgerError('INPUT')}
export function stockCostCommand(input){
 const kind=input&&Object.getOwnPropertyDescriptor(input,'action')
 if(!kind||!Object.hasOwn(kind,'value')||!['open','price'].includes(kind.value))throw stockLedgerError('INPUT')
 shape(input,['protocol','id','action','time','storeId','epoch','reviewed',...(input.action==='open'?['snapshotDigest','overrides']:['expectedSequence','sourceId','valueCents']),...(Object.hasOwn(input,'review')?['review']:[])])
 operationHeader(input);text(input.storeId);text(input.epoch)
 if(input.protocol!==STOCK_LEDGER_PROTOCOL||typeof input.time!=='string'||new Date(input.time).toISOString()!==input.time)throw stockLedgerError('INPUT')
 if(input.reviewed!==true)throw stockLedgerError('REVIEW')
 if(Object.hasOwn(input,'review'))assertStockSetupReview(input.review)
 if(input.action==='open'){
  if(typeof input.snapshotDigest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(input.snapshotDigest)||!Array.isArray(input.overrides))throw stockLedgerError('INPUT')
  const seen=new Set()
  for(const row of input.overrides){shape(row,['key','valueCents']);if(typeof row.key!=='string'||seen.has(row.key))throw stockLedgerError('INPUT');seen.add(row.key);amount(row.valueCents)}
 }else{if(!Number.isSafeInteger(input.expectedSequence)||input.expectedSequence<0)throw stockLedgerError('INPUT');text(input.sourceId);amount(input.valueCents);if(input.valueCents===null)throw stockLedgerError('INPUT')}
 return structuredClone(input)
}

const available={stage:'available',locationId:'main',referenceId:''}
export const stockOpeningKey=(stage,productId,entryId)=>JSON.stringify(stage==='available'?[stage,productId]:[stage,entryId,productId])
function journal(id,date,description,difference,complete){
 if(!Number.isSafeInteger(difference))throw stockLedgerError('BALANCE')
 const value=Math.abs(difference)
 return {id,date,type:'stock-cost',amountUnit:'cents',description,costComplete:complete,lines:difference===0?[]:[{account:'1211',debitCents:difference>0?value:0,creditCents:difference<0?value:0},{account:'3901',debitCents:difference<0?value:0,creditCents:difference>0?value:0}]}
}
export function planStockOpening(preview,input,date){
 const request=stockCostCommand(input)
 if(request.action!=='open'||preview.status!=='reference-only-not-activated'||preview.storeId!==request.storeId||preview.epoch!==request.epoch)throw stockLedgerError('INPUT')
 if(!Number.isSafeInteger(preview.referenceInventoryBalanceCents))throw stockLedgerError('BALANCE')
 const overrides=new Map(request.overrides.map(row=>[row.key,row.valueCents])),sources=[],positions=[],sourceEvidence=[],keys=new Set()
 const add=(key,row,quantityUnits,owner)=>{
  if(keys.has(key))throw stockLedgerError('INPUT');keys.add(key)
  if(!quantityUnits)return
  const explicit=overrides.has(key),valueCents=explicit?overrides.get(key):!row.countCostNeedsReview&&row.referenceUnitCostCents>0?row.referenceValueCents:null
  const source=costSource({id:'opening:'+request.id+':'+sources.length,productId:row.productId,unit:row.unit,currency:'TWD',quantityUnits,valueCents}),queueOrder=sources.length+1
  sources.push(source);sourceEvidence.push({sourceId:source.id,key,basis:valueCents===null?'unknown':explicit?'confirmed':'legacy-reference-snapshot'})
  let node=positions.find(node=>canonicalSignature(node.owner)===canonicalSignature(owner))
  if(!node){node={owner,segments:[]};positions.push(node)}
  node.segments.push({sourceId:source.id,offsetUnits:0,quantityUnits,queueOrder})
 }
 // The cutover establishes a new queue, not a reconstruction of historical FIFO.
 // Existing holds keep priority over the available snapshot when later released.
 for(const reservation of preview.unpaidReservations)for(const row of reservation.allocations)add(stockOpeningKey('reserved',row.productId,reservation.entryId),row,row.quantityUnits,{stage:'reserved',locationId:'main',referenceId:reservation.entryId})
 for(const reservation of preview.paidLegacyReservations||[])for(const row of reservation.allocations||[])add(stockOpeningKey('consumed',row.productId,reservation.entryId),row,row.quantityUnits,{stage:'consumed',locationId:'main',referenceId:canonicalSignature(['restaurant',reservation.entryId])})
 for(const row of preview.products)add(stockOpeningKey('available',row.productId),row,row.availableUnits,available)
 if([...overrides.keys()].some(key=>!keys.has(key)||!sourceEvidence.some(row=>row.key===key)))throw stockLedgerError('INPUT')
 const custody=createCostCustody(sources,positions),valuation=costCustodySummary(custody)
 const bridge=BigInt(valuation.ownedKnownValueCents)-BigInt(preview.referenceInventoryBalanceCents)
 if(bridge>BigInt(Number.MAX_SAFE_INTEGER)||bridge<BigInt(-Number.MAX_SAFE_INTEGER))throw stockLedgerError('BALANCE')
 const opening=journal('stock-opening:'+request.id,date,'庫存成本開帳差額',Number(bridge),valuation.ownedValueCents!==null)
 for(const reservation of preview.paidLegacyReservations||[])for(const row of reservation.allocations||[]){
  const key=stockOpeningKey('consumed',row.productId,reservation.entryId),evidence=sourceEvidence.find(source=>source.key===key),source=sources.find(source=>source.id===evidence?.sourceId)
  if(!source)throw stockLedgerError('HISTORY')
  const delta=BigInt(source.valueCents??0)-BigInt(row.referenceValueCents??0),value=Number(delta<0n?-delta:delta)
  if(!Number.isSafeInteger(value))throw stockLedgerError('BALANCE')
  if(source.valueCents===null)opening.costComplete=false
  if(value)opening.lines.push({account:'5101',debitCents:delta>0n?value:0,creditCents:delta<0n?value:0},{account:'3901',debitCents:delta<0n?value:0,creditCents:delta>0n?value:0})
 }
 return {custody,sourceEvidence,valuation,journal:opening}
}

export function planOpeningCostPrice(projection,input,date){
 const request=stockCostCommand(input)
 if(request.action!=='price'||!projection.sourceEvidence.some(row=>row.sourceId===request.sourceId))throw stockLedgerError('INPUT')
 const plan=planCostCustody(projection.custody,{expectedSequence:request.expectedSequence,steps:[{kind:'price',sourceId:request.sourceId,valueCents:request.valueCents}]})
 const effect=plan.effects[0],asset=effect.byState.available.confirmedValueCents+effect.byState.reserved.confirmedValueCents
 const values=[['1211',asset],['5101',effect.byState.consumed.confirmedValueCents],['5208',effect.byState.wasted.confirmedValueCents],['5204',effect.byState.supplierReturned.confirmedValueCents]]
 const lines=values.filter(([,value])=>value>0).map(([account,value])=>({account,debitCents:value,creditCents:0})),creditAccount=projection.sourceEvidence.find(row=>row.sourceId===request.sourceId).creditAccount||'3901'
 if(!['3901','4191','5101','2102','2291'].includes(creditAccount))throw stockLedgerError('HISTORY')
 if(request.valueCents>0)lines.push({account:creditAccount,debitCents:0,creditCents:request.valueCents})
 return {...plan,journal:{id:'stock-price:'+request.id,date,type:'stock-cost',amountUnit:'cents',description:'期初庫存成本補登',costComplete:plan.valuation.ownedValueCents!==null,lines}}
}

export function assertStockCustodyMatchesBook(custody,products,reservations,warehousing){
 const sources=new Map(custody.sources.map(source=>[source.id,source])),totals=new Map(),expected=new Map()
 const key=(owner,productId,unit)=>canonicalSignature([owner,productId,unit])
 const locations=new Set(warehousing?.locations?.map(row=>row.id)||['main'])
 for(const node of custody.positions){
  if(!locations.has(node.owner.locationId)||node.owner.stage!=='available'&&node.owner.locationId!=='main')throw stockLedgerError('HISTORY')
  if(node.owner.stage==='available'&&node.owner.locationId!=='main')continue
  if(['available','reserved'].includes(node.owner.stage))for(const segment of node.segments){const source=sources.get(segment.sourceId),id=key(node.owner,source.productId,source.unit);totals.set(id,(totals.get(id)||0)+segment.quantityUnits)}
 }
 const units=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*1000))||Math.abs(value-Math.round(value*1000)/1000)>1e-7)throw stockLedgerError('HISTORY');return Math.round(value*1000)}
 const productMap=new Map(products.map(product=>[product.id,product]))
 for(const product of products){const count=units(product.stock);if(count)expected.set(key(available,product.id,product.unit),count)}
 for(const entry of reservations.filter(entry=>!entry.saleId&&entry.status!=='cancelled'))for(const row of entry.allocations){const product=productMap.get(row.id);if(!product)throw stockLedgerError('HISTORY');const id=key({stage:'reserved',locationId:'main',referenceId:entry.id},row.id,product.unit);expected.set(id,(expected.get(id)||0)+units(row.qty))}
 if(canonicalSignature([...totals].sort())!==canonicalSignature([...expected].sort()))throw stockLedgerError('HISTORY')
 return true
}
