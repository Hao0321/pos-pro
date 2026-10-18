import {canonicalSignature,operationHeader,moneyValue} from './operationRules.mjs'
import {businessId,businessInstant,only,text} from './businessExchange.mjs'
import {salesDate,validateSalesDay} from './salesRules.mjs'
import {procurementSummary,isPurchaseCreate} from './procurementRules.mjs'
import {supplierClaimKey} from './supplierCredit.mjs'
import {SUPPLIER_CONTROL_ACTIONS,emptySupplierControl,supplierActor,deriveSupplierControl,projectSupplierControl,supplierControlView,assertProcurementApproval,validateSupplierPaymentApproval,consumeSupplierPaymentApproval} from './supplierControl.mjs'
import {buildSupplierPurchaseTimelines,supplierPurchaseAt,supplierInventoryContext,assertSupplierInventoryTransition} from './procurementHistory.mjs'

export const SUPPLIER_KIND='supplier-ledger'
export const SUPPLIER_MONEY_ACTIONS=['pay','allocate','unallocate','refund','refund-reverse','pay-reverse']
export const SUPPLIER_ACTIONS=[...SUPPLIER_CONTROL_ACTIONS,...SUPPLIER_MONEY_ACTIONS]
const rootFields=['id','kind','action','time','date','storeId','epoch','expectedRevision']
const partyFields=['supplierId','expectedSupplierName']
const fields={
 'policy-set':['mode','reason','reviewed'],
 'purchase-enroll':['purchaseId','expectedPurchaseRevision','reviewed'],
 'purchase-approve':['purchaseId','expectedPurchaseRevision','reviewed'],
 'purchase-reject':['purchaseId','expectedPurchaseRevision','reason','reviewed'],
 'purchase-withdraw':['purchaseId','expectedPurchaseRevision','reason','reviewed'],
 'payment-propose':[...partyFields,'amount','method','note','reference','reviewed'],
 'payment-approve':['proposalId','reviewed'],'payment-reject':['proposalId','reason','reviewed'],'payment-withdraw':['proposalId','reason','reviewed'],
 pay:[...partyFields,'amount','method','reference','note','shiftId','confirmed','proposalId'],
 allocate:[...partyFields,'paymentId','items','reviewed'],unallocate:[...partyFields,'allocationId','items','reason','reviewed'],
 refund:[...partyFields,'paymentId','amount','reference','reason','shiftId','confirmed'],
 'refund-reverse':[...partyFields,'refundId','reason','shiftId','confirmed'],'pay-reverse':[...partyFields,'paymentId','reason','shiftId','confirmed'],
}
const cents=value=>Math.round(moneyValue(value,'供應商金額')*100)
const amount=value=>{if(!Number.isSafeInteger(value)||value<0)throw Error('供應商款項餘額不正確');return value/100}
const sum=items=>items.reduce((total,row)=>total+cents(row.amount),0)
const remaining=payment=>payment.reversed?0:cents(payment.event.amount)-payment.allocated-payment.refunded
function emptyProjection(){return {entries:[],control:emptySupplierControl(),payments:new Map(),allocations:new Map(),refunds:new Map(),reversedRefunds:new Set(),credits:new Map(),latestDay:new Map()}}
function projectOne(state,event){
 state.entries.push(event)
 if(projectSupplierControl(state.control,event))return
 if(!SUPPLIER_MONEY_ACTIONS.includes(event.action))throw Error('供應商款項歷史含有不支援的操作')
 state.latestDay.set(event.supplierId,event.date)
 if(event.action==='pay'){state.payments.set(event.id,{event,allocated:0,refunded:0,reversed:false});consumeSupplierPaymentApproval(state.control,event)}
 if(['allocate','unallocate'].includes(event.action)){
  const sign=event.action==='allocate'?1:-1,payment=state.payments.get(event.paymentId);if(!payment)throw Error('供應商抵付缺少原付款')
  payment.allocated+=sign*cents(event.amount)
  for(const item of event.items){const key=supplierClaimKey(item.purchaseId,item.invoiceId),next=(state.credits.get(key)||0)+sign*cents(item.amount);if(!Number.isSafeInteger(next)||next<0)throw Error('供應商抵付餘額不正確');state.credits.set(key,next)}
  if(sign===1)state.allocations.set(event.id,{event,released:new Map()})
  else{const allocation=state.allocations.get(event.allocationId);if(!allocation)throw Error('解除抵付缺少原供應商分配');for(const item of event.items){const key=supplierClaimKey(item.purchaseId,item.invoiceId);allocation.released.set(key,(allocation.released.get(key)||0)+cents(item.amount))}}
 }
 if(event.action==='refund'){state.payments.get(event.paymentId).refunded+=cents(event.amount);state.refunds.set(event.id,event)}
 if(event.action==='refund-reverse'){state.payments.get(event.paymentId).refunded-=cents(event.amount);state.reversedRefunds.add(event.refundId)}
 if(event.action==='pay-reverse')state.payments.get(event.paymentId).reversed=true
 const affected=state.payments.get(event.action==='pay'?event.id:event.paymentId)
 if(affected&&(affected.allocated<0||affected.refunded<0||remaining(affected)<0))throw Error('供應商款項餘額不正確')
}
export function supplierLedgerView(entries=[]){
 const state=emptyProjection();for(const event of entries)projectOne(state,event)
 const payments=[...state.payments.values()].map(row=>({...row.event,allocated:amount(row.allocated),refunded:amount(row.refunded),available:amount(remaining(row)),reversed:row.reversed})),balances=new Map()
 for(const payment of payments)balances.set(payment.supplierId,(balances.get(payment.supplierId)||0)+cents(payment.available))
 return {version:1,revision:entries.length,...supplierControlView(state.control),payments,balances:[...balances].map(([supplierId,value])=>({supplierId,available:amount(value)})),entries}
}
function validateHeader(request){
 if(!request||typeof request!=='object'||Array.isArray(request)||!fields[request.action]||new TextEncoder().encode(JSON.stringify(request)).length>131072)throw Error('供應商操作格式不正確或過大')
 only(request,[...rootFields,...fields[request.action]],'供應商操作');operationHeader(request);businessInstant(request.time);businessId(request.storeId)
 if(request.kind!==SUPPLIER_KIND||typeof request.epoch!=='string'||!request.epoch||request.epoch.length>128||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0)throw Error('供應商帳版本或還原識別不正確')
 try{validateSalesDay(request.date)}catch{throw Error('供應商款項日期不正確')}
}
function eventHeader(request,data,actor,state,history){
 if(request.storeId!==data.storeId)throw Object.assign(Error('這筆供應商操作屬於另一間店'),{historyUncertain:true})
 if(!history&&request.epoch!==data.epoch)throw Object.assign(Error('資料已還原或更換，請以原編號核對供應商款項'),{historyUncertain:true})
 if(request.expectedRevision!==state.entries.length)throw Error('供應商帳已更新，請重新核對')
 const now=data.now??Date.now()
 if(!history&&(Math.abs(now-Date.parse(request.time))>300000||request.date>salesDate(new Date(now))))throw Error('供應商操作日期或時間已過期，請重新核對')
 return {version:1,id:request.id,storeId:data.storeId,revision:state.entries.length+1,time:request.time,date:request.date,action:request.action,actor:supplierActor(actor),input:structuredClone(request)}
}
function supplierFor(request,data,history){
 businessId(request.supplierId)
 if(typeof request.expectedSupplierName!=='string'||!request.expectedSupplierName.trim()||request.expectedSupplierName.length>2000)throw Error('請先確認供應商名稱')
 const supplier=data.suppliers.find(row=>row.id===request.supplierId)
 if(!supplier)throw Error('供應商不存在，請先新增或選擇原供應商')
 if(!history&&supplier.name!==request.expectedSupplierName)throw Error('供應商名稱已更新，請重新核對原身份')
 return {...supplier,name:request.expectedSupplierName}
}
function cashFields(event,request,data,direction,history){
 if(request.confirmed!==true)throw Error('請先確認實際付出或收到這筆供應商款項')
 if(event.method==='bank'){if(request.shiftId)throw Error('銀行收付不應包含現金班次');event.shiftId='';event.cashLogId='';return}
 if(event.method!=='cash'||!data.openShift||data.openShift.status!=='open'||request.shiftId!==data.openShift.id)throw Error('供應商現金收付需要目前開啟的班次')
 if(!history&&event.date!==salesDate(new Date(data.now??Date.now())))throw Error('現金操作請使用目前營業日')
 event.shiftId=data.openShift.id;event.cashLogId='supplier-cash:'+event.id;event.cashType=direction
}
function historicalData(request,data,eventRevision,timelines){
 const revisions=new Map()
 if(request.purchaseId)revisions.set(request.purchaseId,request.expectedPurchaseRevision)
 for(const row of request.items||[]){if(revisions.has(row.purchaseId)&&revisions.get(row.purchaseId)!==row.expectedRevision)throw Error('同一採購在本次抵付必須使用相同版本');revisions.set(row.purchaseId,row.expectedRevision)}
 const purchases=data.purchases.map(po=>revisions.has(po.id)?supplierPurchaseAt(timelines,po.id,revisions.get(po.id),eventRevision):po)
 return {...data,purchases}
}
function derive(request,data,actor,state,{history=false,timelines=null}={}){
 validateHeader(request)
 const event=eventHeader(request,data,actor,state,history)
 let controlData=data
 if(history&&request.purchaseId)controlData=historicalData(request,data,event.revision,timelines)
 if(request.action==='payment-propose'){const supplier=supplierFor(request,data,history);controlData={...controlData,suppliers:[supplier,...data.suppliers.filter(row=>row.id!==supplier.id)]}}
 const controlled=deriveSupplierControl(request.action,request,controlData,actor,state.control,event,{history});if(controlled)return controlled
 const supplier=supplierFor(request,data,history);event.supplierId=supplier.id;event.supplierName=supplier.name
 if(event.date<(state.latestDay.get(supplier.id)||''))throw Error('供應商款項日期不能早於已有紀錄')
 if(request.action==='pay'){
  event.amount=moneyValue(request.amount,'預付款金額',.01);if(!['cash','bank'].includes(request.method))throw Error('請選現金或銀行付款');event.method=request.method
  const proposal=validateSupplierPaymentApproval(request,state.control);if(proposal)event.proposalId=proposal.id
  event.reference=text(request.reference??'',100,'付款參考',false);event.note=text(request.note??'',1000,'付款說明',false);cashFields(event,request,data,'out',history);return event
 }
 const allocation=request.action==='unallocate'?state.allocations.get(request.allocationId):null
 if(request.action==='unallocate'&&!allocation)throw Error('找不到原供應商抵付紀錄')
 const refund=request.action==='refund-reverse'?state.refunds.get(request.refundId):null
 if(request.action==='refund-reverse'&&(!refund||state.reversedRefunds.has(refund.id)))throw Error('找不到可更正的供應商原退款')
 const paymentId=allocation?.event.paymentId||refund?.paymentId||request.paymentId,payment=state.payments.get(paymentId)
 if(!payment||payment.reversed||payment.event.supplierId!==supplier.id)throw Error('找不到這位供應商可使用的原付款')
 event.paymentId=paymentId
 if(['allocate','unallocate'].includes(request.action)){
  if(request.reviewed!==true)throw Error('請先核對本次供應商請款與抵付金額')
  if(!Array.isArray(request.items)||!request.items.length||request.items.length>100)throw Error('請選擇 1 至 100 張供應商請款')
  const used=new Set(),versions=new Map()
  if(history)controlData=historicalData(request,data,event.revision,timelines)
  event.items=request.items.map(row=>{
   only(row,['purchaseId','invoiceId','expectedRevision','amount'],'供應商抵付');businessId(row.purchaseId);businessId(row.invoiceId)
   const key=supplierClaimKey(row.purchaseId,row.invoiceId);if(used.has(key))throw Error('供應商抵付請款不可重複');used.add(key)
   const po=controlData.purchases.find(purchase=>purchase.id===row.purchaseId)
   if(!po||po.supplierId!==supplier.id)throw Error('只能抵付同一供應商的請款')
   if(!Number.isSafeInteger(row.expectedRevision)||row.expectedRevision!==po.procurement?.revision||versions.has(po.id)&&versions.get(po.id)!==row.expectedRevision)throw Error('抵付的採購已更新，請重新核對')
   versions.set(po.id,row.expectedRevision)
   if(request.action==='allocate')assertProcurementApproval({kind:'purchase-pay',purchaseId:po.id},controlData,state.control)
   const bill=procurementSummary(po,request.date,state.credits)?.bills.find(invoice=>invoice.id===row.invoiceId)
   if(!bill)throw Error('找不到原供應商請款')
   const dates=['receipts','bills','payments','reversals','returns','refunds','refundReversals'].flatMap(group=>po.procurement[group]||[]).map(item=>item.date)
   if(event.date<po.date||dates.some(day=>day>event.date))throw Error('供應商抵付日期不能早於採購已有紀錄')
   const value=moneyValue(row.amount,'抵付金額',.01)
   if(request.action==='allocate'&&cents(value)>cents(Math.max(0,bill.balance)))throw Error('抵付超過這張供應商請款的未付餘額')
   if(allocation){const original=allocation.event.items.find(item=>supplierClaimKey(item.purchaseId,item.invoiceId)===key);if(!original||cents(value)>cents(original.amount)-(allocation.released.get(key)||0))throw Error('解除金額超過原供應商抵付尚可解除餘額')}
   return {...row,amount:value}
  })
  event.amount=amount(sum(event.items));if(request.action==='allocate'&&cents(event.amount)>remaining(payment))throw Error('抵付超過原預付款可用餘額')
  if(allocation){event.allocationId=allocation.event.id;event.reason=text(request.reason,500,'解除抵付理由')}
  return event
 }
 event.method=payment.event.method;event.reason=text(request.reason,500,'供應商款項更正理由')
 if(request.action==='refund'){
  event.amount=moneyValue(request.amount,'退回預付款金額',.01);if(cents(event.amount)>remaining(payment))throw Error('供應商退回金額超過原付款可退餘額，請先解除抵付')
  event.reference=text(request.reference??'',100,'退款參考',false);cashFields(event,request,data,'in',history);return event
 }
 if(request.action==='pay-reverse'){
  if(payment.allocated||payment.refunded||remaining(payment)!==cents(payment.event.amount))throw Error('請先解除抵付並更正退款，才能沖銷整筆預付款')
  event.amount=payment.event.amount;cashFields(event,request,data,'in',history);return event
 }
 event.refundId=refund.id;event.amount=refund.amount;cashFields(event,request,data,'out',history);return event
}
const receiptFor=event=>({id:event.id,kind:SUPPLIER_KIND,action:event.action,supplierId:event.supplierId||null,revision:event.revision,signature:canonicalSignature(event.input),event:canonicalSignature(event),cashLogId:event.cashLogId||null,internal:event.action==='purchase-register'})
const cashFor=event=>event.cashLogId?{id:event.cashLogId,shiftId:event.shiftId,time:event.time,type:event.cashType,amount:event.amount,reason:'供應商收付 '+event.supplierId,cashier:event.actor.username}:null
function validateCash(event,receipt,logs=[]){const expected=cashFor(event),actual=expected?logs.find(row=>row.id===expected.id):null;if(canonicalSignature(actual)!==canonicalSignature(expected)||receipt.cashLogId!==(event.cashLogId||null))throw Error('供應商款項與原現金流水不符');return actual}
function project(entries=[]){const state=emptyProjection();for(const event of [...entries].sort((a,b)=>a.revision-b.revision))projectOne(state,event);return state}
export function planSupplierLedger(request,data,actor){const event=derive(request,data,actor,project(data.supplierEntries));return {event,receipt:receiptFor(event),cashLog:cashFor(event)}}
export function planSupplierRegistration(request,purchase,data,actor){
 if(!isPurchaseCreate(request.kind))throw Error('只有建立新採購能自動登記核准，舊單請明確納入')
 const context=supplierInventoryContext(request);if(!context)throw Error('採購登記缺少供應商帳版本')
 const state=project(data.supplierEntries),header={id:request.id,time:request.time,date:salesDate(request.time),action:'purchase-register',storeId:context.storeId,epoch:context.epoch,expectedRevision:context.revision}
 operationHeader(header);businessInstant(header.time)
 const event=deriveSupplierControl('purchase-register',request,data,actor,state.control,eventHeader(header,data,actor,state,false),{registerPurchase:purchase})
 event.input=structuredClone(request);return {event,receipt:receiptFor(event),cashLog:null}
}

function registrationHistory(event,data,state,timelines){
 const request=event.input,context=supplierInventoryContext(request),timeline=timelines.get(event.purchaseId),row=timeline?.rows.find(item=>item.request.id===event.id)
 if(!context||!isPurchaseCreate(request.kind)||!row||row.receipt.purchaseVersion!==1||row.receipt.signature!==canonicalSignature(request)||canonicalSignature(row.actor)!==canonicalSignature(event.actor))throw Error('採購核准登記缺少原建立操作與登入身份')
 const header={id:request.id,time:request.time,date:salesDate(request.time),action:'purchase-register',storeId:context.storeId,epoch:context.epoch,expectedRevision:context.revision}
 operationHeader(header);businessInstant(header.time)
 const purchase=timeline.snapshots.get(1),before={...data,purchases:data.purchases.filter(po=>po.id!==purchase.id)}
 const actual=deriveSupplierControl('purchase-register',request,before,event.actor,state.control,eventHeader(header,data,event.actor,state,true),{history:true,registerPurchase:purchase})
 actual.input=structuredClone(request);return actual
}
function historyScope(entries,data){
 const needed=new Set()
 for(const event of entries){
  if(!event||typeof event!=='object'||!Number.isSafeInteger(event.revision))throw Error('供應商款項歷史格式不正確')
  if(event.purchaseId)needed.add(event.purchaseId)
  if(event.input?.purchaseId)needed.add(event.input.purchaseId)
  if(event.items!==undefined&&!Array.isArray(event.items))throw Error('供應商抵付歷史格式不正確')
  for(const row of event.items||[])needed.add(row.purchaseId)
 }
 // Old stocktake-only logs have no role in this ledger. Financial procurement
 // receipts become mandatory when a controlled purchase references the ledger.
 const inventoryAudits=(data.inventoryAudits||[]).filter(row=>{
  if(row.action!=='INVENTORY_OPERATION')return false
  let receipt,request
  try{receipt=typeof row.detail==='string'?JSON.parse(row.detail):row.detail;request=JSON.parse(receipt?.signature)}catch{
   if(entries.length||data.supplierFence)throw Error('採購原始回執需要核對')
   return false
  }
  if(request?.supplierContext){needed.add(isPurchaseCreate(request.kind)?request.purchase?.id:request.purchaseId)}
  return request?.kind!=='stocktake'
 })
 return buildSupplierPurchaseTimelines({...data,inventoryAudits,supplierEntries:entries},needed)
}
function inventoryBuckets(entries,data,scope){
 const buckets=new Map(),registrations=new Map()
 for(const event of entries)if(['purchase-register','purchase-enroll'].includes(event.action)){
  if(registrations.has(event.purchaseId))throw Error('採購核准登記不能重複')
  registrations.set(event.purchaseId,event)
 }
 for(const row of scope.operations){
  const timeline=scope.timelines.get(row.purchaseId);if(!timeline)continue
  const registered=registrations.get(row.purchaseId)
  if(row.context&&isPurchaseCreate(row.request.kind)&&(!registered||registered.action!=='purchase-register'||registered.id!==row.request.id||registered.revision!==row.seenRevision+1))throw Error('新採購缺少同一操作的原核准登記')
  if(registered&&row.receipt.purchaseVersion>registered.originRevision&&(!row.context||row.seenRevision<registered.revision))throw Error('已納入核准的採購缺少當時供應商帳版本')
  if(!buckets.has(row.seenRevision))buckets.set(row.seenRevision,[])
  buckets.get(row.seenRevision).push(row)
 }
 return buckets
}
function checkInventory(rows,state,data,scope){
 for(const row of rows||[]){
  const timeline=scope.timelines.get(row.purchaseId),previous=timeline.snapshots.get(row.receipt.purchaseVersion-1)
  const context={...data,purchases:previous?[previous,...data.purchases.filter(po=>po.id!==previous.id)]:data.purchases.filter(po=>po.id!==row.purchaseId)}
  if(row.context)assertProcurementApproval(row.request,context,state.control)
  assertSupplierInventoryTransition(row,timeline,state.credits,data)
 }
}
export function validateSupplierLedgerRecords(entries=[],operations=[],data={}){
 if(!Array.isArray(entries)||!Array.isArray(operations)||entries.length!==operations.length)throw Error('供應商款項歷史與正式回執不完整')
 const sorted=[...entries].sort((a,b)=>a.revision-b.revision),byId=new Map(operations.map(row=>[row.id,row])),seen=new Set(),cashIds=new Set(),state=emptyProjection(),scope=historyScope(sorted,data),buckets=inventoryBuckets(sorted,data,scope)
 if(byId.size!==operations.length)throw Error('供應商款項回執編號重複')
 checkInventory(buckets.get(0),state,data,scope)
 for(const event of sorted){
  if(event.revision!==state.entries.length+1||seen.has(event.id))throw Error('供應商款項歷史版本或編號不正確')
  if(event.supplierId&&!data.suppliers?.some(row=>row.id===event.supplierId))throw Error('供應商款項缺少原往來身份，請保留完整資料')
  seen.add(event.id)
  const receipt=byId.get(event.id),context={...data,openShift:event.method==='cash'?{id:event.shiftId,status:'open'}:null}
  const actual=event.action==='purchase-register'?registrationHistory(event,context,state,scope.timelines):derive(event.input,context,event.actor,state,{history:true,timelines:scope.timelines})
  if(!receipt||canonicalSignature(actual)!==canonicalSignature(event)||canonicalSignature(receiptFor(event))!==canonicalSignature(receipt))throw Error('供應商款項金額、來源或回執不符')
  validateCash(event,receipt,data.cashLogs||[]);if(event.cashLogId)cashIds.add(event.cashLogId)
  projectOne(state,event);checkInventory(buckets.get(event.revision),state,data,scope)
 }
 if((data.cashLogs||[]).some(row=>String(row.id).startsWith('supplier-cash:')&&!cashIds.has(row.id)))throw Error('供應商現金流水缺少原款項回執')
 return supplierLedgerView(sorted)
}
export function supplierLedgerReceipt(request,receipt,data){
 if(receipt?.id!==request.id||receipt.kind!==SUPPLIER_KIND||receipt.internal||receipt.signature!==canonicalSignature(request))throw Object.assign(Error('原供應商款項編號已存在且內容不同，請核對原紀錄'),{operationConflict:true})
 const event=data.supplierEntries.find(row=>row.id===request.id)
 if(!event||event.storeId!==data.storeId||canonicalSignature(receiptFor(event))!==canonicalSignature(receipt))throw Error('供應商款項回執找不到原始紀錄')
 // A response carries all linked purchase snapshots so its historical
 // before-images can be verified without trusting a displayed balance.
 return {success:true,receipt,event,...supplierLedgerEvidence(data),cashLog:validateCash(event,receipt,data.cashLogs||[]),supplierLedger:supplierLedgerView([...data.supplierEntries].sort((a,b)=>a.revision-b.revision))}
}
export function supplierLedgerEvidence(data){
 const scope=historyScope(data.supplierEntries,data),purchases=[...scope.timelines.values()].map(row=>row.purchase),operationIds=new Set(scope.operations.filter(op=>scope.timelines.has(op.purchaseId)).map(op=>'stock-operation:'+op.request.id)),cashIds=new Set(scope.operations.map(op=>op.receipt.cashLogId)),supplierIds=new Set(data.supplierEntries.map(entry=>entry.supplierId))
 return {purchases,inventoryAudits:(data.inventoryAudits||[]).filter(row=>operationIds.has(row.id)),suppliers:data.suppliers.filter(row=>supplierIds.has(row.id)),cashLogs:(data.cashLogs||[]).filter(row=>String(row.id).startsWith('supplier-cash:')||cashIds.has(row.id))}
}
export function assertSupplierLedgerView(view,evidence,storeId){
 if(!view||!Array.isArray(view.entries)||!evidence||['purchases','inventoryAudits','suppliers','cashLogs'].some(key=>!Array.isArray(evidence[key])))throw Error('供應商款項保存結果尚未確認：缺少完整核對資料')
 const actual=validateSupplierLedgerRecords(view.entries,view.entries.map(receiptFor),{...evidence,storeId,supplierEntries:view.entries})
 if(canonicalSignature(actual)!==canonicalSignature(view))throw Error('供應商款項保存結果尚未確認：餘額或原紀錄不符')
 return actual
}
export function assertSupplierLedgerResult(request,result){
 if(result?.success!==true||!result.supplierLedger||!Array.isArray(result.supplierLedger.entries)||!Array.isArray(result.purchases)||!Array.isArray(result.inventoryAudits)||!Array.isArray(result.suppliers)||!Array.isArray(result.cashLogs)||canonicalSignature(result.event?.input)!==canonicalSignature(request)||canonicalSignature(receiptFor(result.event))!==canonicalSignature(result.receipt))throw Error('供應商款項保存結果尚未確認：回覆內容不符')
 if(result.event.revision!==request.expectedRevision+1||result.event.id!==request.id||result.event.storeId!==request.storeId)throw Error('供應商款項保存結果尚未確認：原身份或版本不符')
 const entries=result.supplierLedger.entries,context={storeId:request.storeId,purchases:result.purchases,suppliers:result.suppliers,inventoryAudits:result.inventoryAudits,cashLogs:result.cashLogs,supplierEntries:entries}
 const view=assertSupplierLedgerView(result.supplierLedger,result,request.storeId),replay=supplierLedgerReceipt(request,result.receipt,context)
 if(canonicalSignature(view)!==canonicalSignature(result.supplierLedger)||canonicalSignature(replay.event)!==canonicalSignature(result.event)||canonicalSignature(replay.cashLog)!==canonicalSignature(result.cashLog))throw Error('供應商款項保存結果尚未確認：餘額或原紀錄不符')
 return result
}
export const supplierControlFromEntries=entries=>project(entries).control
