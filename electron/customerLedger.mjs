import {canonicalSignature,operationHeader,moneyValue} from './operationRules.mjs'
import {businessId} from './businessExchange.mjs'
import {salesActor,salesText,salesOnly,salesDate,validateSalesDay,salesCents,salesAmount,salesClaim,salesDocumentAt,validateSalesDocument,SALES_COLLECTION} from './salesRules.mjs'
import {customerClaimKey} from './customerCredit.mjs'
import {openingBalanceTimeline,assertOpeningBalanceOrdinaryIds,assertOpeningBalanceParties,assertOpeningBalanceRequest,syncOpeningBalanceProjection,openingBalanceClaim,openingBalanceView} from './openingBalanceLedger.mjs'

export const CUSTOMER_KIND='customer-ledger'
export const CUSTOMER_ACTIONS=['customer-create','customer-update','receive','allocate','unallocate','refund','refund-reverse','receipt-reverse']
const rootFields=['id','kind','time','date','storeId','epoch','expectedRevision','action','expectedOpeningDigest']
const fields={
  'customer-create':['customer'], 'customer-update':['customerId','customer'],
  receive:['customerId','amount','method','reference','note','shiftId','confirmed'],
  allocate:['customerId','receiptId','items','reviewed'],
  unallocate:['customerId','allocationId','items','reason','reviewed'],
  refund:['customerId','receiptId','amount','reference','reason','shiftId','confirmed','method'],
  'refund-reverse':['customerId','refundId','reason','shiftId','confirmed'],
  'receipt-reverse':['customerId','receiptId','reason','shiftId','confirmed'],
}
const cents=n=>salesCents(n),sum=items=>items.reduce((n,row)=>n+cents(row.amount),0)
function profile(value){
  salesOnly(value,['id','name','contact','phone','email','address','note'])
  return {id:businessId(value.id),name:salesText(value.name,100),...Object.fromEntries(['contact','phone','email','address','note'].map(key=>[key,salesText(value[key]??'',key==='note'?1000:300,false)]))}
}
function emptyProjection(){return {entries:[],customers:new Map(),receipts:new Map(),allocations:new Map(),refunds:new Map(),reversedRefunds:new Set(),credits:new Map(),latestDay:new Map()}}
const available=receipt=>receipt.reversed?0:cents(receipt.event.amount)-receipt.allocated-receipt.refunded
function projectOne(state,event){
  state.entries.push(event)
  if(event.action==='customer-create'||event.action==='customer-update'){
    const previous=state.customers.get(event.customerId)
    state.customers.set(event.customerId,{...event.customer,createdAt:previous?.createdAt||event.time,updatedAt:event.time,revision:(previous?.revision||0)+1})
  }else state.latestDay.set(event.customerId,event.date)
  if(event.action==='receive'){if(state.receipts.has(event.id))throw Error('原收款編號與帳款來源重複');state.receipts.set(event.id,{event,allocated:0,refunded:0,reversed:false})}
  if(event.action==='allocate'||event.action==='unallocate'){
    const sign=event.action==='allocate'?1:-1,receipt=state.receipts.get(event.receiptId)
    if(!receipt)throw Error('客戶抵付缺少原收款')
    receipt.allocated+=sign*cents(event.amount)
    for(const item of event.items){const key=customerClaimKey(item.documentId,item.deliveryId),next=(state.credits.get(key)||0)+sign*cents(item.amount);if(next<0)throw Error('客戶抵付餘額不正確');state.credits.set(key,next)}
    if(sign===1)state.allocations.set(event.id,{event,released:new Map()})
    else{const allocation=state.allocations.get(event.allocationId);for(const item of event.items){const key=customerClaimKey(item.documentId,item.deliveryId);allocation.released.set(key,(allocation.released.get(key)||0)+cents(item.amount))}}
  }
  if(event.action==='refund'){state.receipts.get(event.receiptId).refunded+=cents(event.amount);state.refunds.set(event.id,event)}
  if(event.action==='refund-reverse'){state.receipts.get(event.receiptId).refunded-=cents(event.amount);state.reversedRefunds.add(event.refundId)}
  if(event.action==='receipt-reverse')state.receipts.get(event.receiptId).reversed=true
  const affected=state.receipts.get(event.action==='receive'?event.id:event.receiptId)
  if(affected&&(affected.allocated<0||affected.refunded<0||available(affected)<0))throw Error('客戶款項餘額不正確')
}
function syncOpening(state,timeline){const active=timeline.at(state.entries.length);if(state.opening===active)return;assertOpeningBalanceParties(active,new Set(state.customers.keys()));syncOpeningBalanceProjection(state,active)}
function project(entries,context,storeId,totalRevision=entries.length){const timeline=openingBalanceTimeline(context,'receivable',totalRevision,storeId),state=emptyProjection();for(const event of entries){syncOpening(state,timeline);projectOne(state,event)}syncOpening(state,timeline);return state}
export function customerLedgerView(entries=[],context,storeId){
  const state=project(entries,context,storeId)
  const receipts=[...state.receipts.values()].map(row=>({...row.event,allocated:salesAmount(row.allocated),refunded:salesAmount(row.refunded),available:salesAmount(available(row)),reversed:row.reversed}))
  const balances=new Map();for(const receipt of receipts)balances.set(receipt.customerId,(balances.get(receipt.customerId)||0)+cents(receipt.available))
  const customers=[...state.customers.values()].map(row=>({...row,available:salesAmount(balances.get(row.id)||0)}))
  return {version:1,revision:entries.length,customers,receipts,entries,...openingBalanceView(state)}
}
function validateHeader(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||new TextEncoder().encode(JSON.stringify(request)).length>131072||!fields[request.action])throw Error('客戶款項操作格式不正確')
  salesOnly(request,[...rootFields,...fields[request.action]]);operationHeader(request);businessId(request.storeId)
  if(request.kind!==CUSTOMER_KIND||typeof request.epoch!=='string'||!request.epoch||request.epoch.length>128||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0)throw Error('客戶款項身份或版本不正確')
  validateSalesDay(request.date)
}
function cashFields(event,request,data,direction,history){
  if(request.confirmed!==true)throw Error('請先確認實際收到或退回這筆款項')
  if(event.method==='bank'){
    if(request.shiftId)throw Error('銀行收付不應包含現金班次')
    event.shiftId='';event.cashLogId='';return
  }
  if(event.method!=='cash'||!data.openShift||data.openShift.status!=='open'||request.shiftId!==data.openShift.id)throw Error('現金收付或更正需要目前開啟的班次')
  if(!history&&event.date!==salesDate(new Date()))throw Error('現金操作請使用目前營業日')
  event.shiftId=data.openShift.id;event.cashLogId='customer-cash:'+event.id;event.cashType=direction
}
function atCommit(document,revision,ledgerRevision,data,history){
  if(!Number.isSafeInteger(revision)||revision<1||!history&&revision!==document.revision)throw Error('抵付的銷售單已更新，請重新核對')
  if(history)for(const receipt of data.salesOperations||[]){
    if(receipt.documentId!==document.id)continue
    const original=JSON.parse(receipt.signature),seen=original.expectedLedgerRevision??0
    if(receipt.documentRevision<=revision?seen>=ledgerRevision:seen<ledgerRevision)throw Error('客戶抵付與銷售歷史先後不一致')
  }
  return salesDocumentAt(document,revision)
}
function derive(request,data,actor,state,{history=false}={}){
  validateHeader(request)
  if(request.storeId!==data.storeId)throw Object.assign(Error('客戶款項屬於另一間店'),{historyUncertain:true})
  if(!history&&request.epoch!==data.epoch)throw Object.assign(Error('資料已還原或更換，請以原編號核對客戶款項'),{historyUncertain:true})
  if(request.expectedRevision!==state.entries.length)throw Error('客戶款項已更新，請重新核對')
  assertOpeningBalanceRequest(request,state.opening,!['customer-create','customer-update'].includes(request.action))
  if(!history&&(Math.abs(Date.now()-Date.parse(request.time))>300000||request.date>salesDate(new Date())))throw Error('客戶款項日期或操作時間已過期，請重新核對')
  const customerId=request.action==='customer-create'?request.customer?.id:request.customerId
  businessId(customerId)
  const event={version:1,id:request.id,storeId:data.storeId,revision:state.entries.length+1,time:request.time,date:request.date,action:request.action,customerId,actor:salesActor(actor),input:structuredClone(request)}
  const customer=state.customers.get(customerId)
  if(request.action==='customer-create'){
    if(customer)throw Error('客戶代碼已存在，請選擇原客戶')
    event.customer=profile(request.customer)
    const names=(data.documents||[]).filter(d=>d.customer.id===customerId).map(d=>d.customer.name)
    if(names.length&&!names.includes(event.customer.name))throw Error('名稱與既有往來不同，請先沿用原身份再修改客戶資料')
    return event
  }
  if(!customer)throw Error('請先選擇或新增往來客戶')
  if(request.action==='customer-update'){
    event.customer=profile(request.customer);if(event.customer.id!==customerId)throw Error('不能改寫客戶代碼');return event
  }
  event.customerName=customer.name
  if(event.date<(state.latestDay.get(customerId)||''))throw Error('客戶款項日期不能早於已有的款項紀錄')
  if(request.action==='receive'){
    event.amount=moneyValue(request.amount,'收款金額',.01)
    if(!['cash','bank'].includes(request.method))throw Error('請選現金或銀行收款')
    event.method=request.method;event.reference=salesText(request.reference??'',100,false);event.note=salesText(request.note??'',1000,false)
    cashFields(event,request,data,'in',history);return event
  }
  const allocation=request.action==='unallocate'?state.allocations.get(request.allocationId):null
  if(request.action==='unallocate'&&!allocation)throw Error('找不到原抵付紀錄')
  const refund=request.action==='refund-reverse'?state.refunds.get(request.refundId):null
  if(request.action==='refund-reverse'&&(!refund||state.reversedRefunds.has(refund.id)))throw Error('找不到可更正的原退款')
  const receiptId=allocation?.event.receiptId||refund?.receiptId||request.receiptId
  const receipt=state.receipts.get(receiptId)
  if(!receipt||receipt.reversed||receipt.event.customerId!==customerId)throw Error('找不到這位客戶可使用的原收款')
  event.receiptId=receiptId
  if(receipt.event.fundingKind==='opening-credit')event.fundingKind='opening-credit'
  if(request.action==='allocate'||request.action==='unallocate'){
    if(request.reviewed!==true)throw Error('請先核對本次抵付單據與金額')
    if(!Array.isArray(request.items)||!request.items.length||request.items.length>100)throw Error('請選擇 1 至 100 張交付請款')
    const used=new Set()
    event.items=request.items.map(row=>{
      salesOnly(row,['documentId','deliveryId','expectedRevision','amount']);businessId(row.documentId);businessId(row.deliveryId)
      const key=customerClaimKey(row.documentId,row.deliveryId);if(used.has(key))throw Error('抵付單據不可重複');used.add(key)
      const opening=openingBalanceClaim(state.opening,row.documentId,row.deliveryId,row.expectedRevision,customerId,event.date,state.credits)
      let owedCents
      if(opening)owedCents=opening.owedCents
      else{
        const document=data.documents?.find(d=>d.id===row.documentId)
        if(!document||document.customer.id!==customerId)throw Error('只能抵付同一客戶的交付請款')
        const original=atCommit(document,row.expectedRevision,event.revision,data,history),claim=salesClaim(original,row.deliveryId,state.credits)
        if(event.date<claim.delivery.date||Object.values(SALES_COLLECTION).flatMap(k=>original[k]).some(e=>e.date>event.date))throw Error('抵付日期不能早於銷售已有的紀錄')
        owedCents=cents(claim.owed)
      }
      const amount=moneyValue(row.amount,'抵付金額',.01)
      if(request.action==='allocate'&&cents(amount)>owedCents)throw Error('抵付超過這張請款的未收餘額')
      if(allocation){const source=allocation.event.items.find(i=>customerClaimKey(i.documentId,i.deliveryId)===key);if(!source||cents(amount)>cents(source.amount)-(allocation.released.get(key)||0))throw Error('解除金額超過原抵付尚可解除餘額')}
      return {...row,amount}
    })
    event.amount=salesAmount(sum(event.items))
    if(request.action==='allocate'&&cents(event.amount)>available(receipt))throw Error('抵付超過原收款可用餘額')
    if(allocation){event.allocationId=allocation.event.id;event.reason=salesText(request.reason)}
    return event
  }
  if(event.fundingKind==='opening-credit'&&request.action==='receipt-reverse')throw Error('原單貸項須連同來源批次核對更正，不能當作收款沖銷。')
  if(Object.hasOwn(request,'method')&&event.fundingKind!=='opening-credit')throw Error('原收款退款須沿用實際原收款方式。')
  event.method=refund?.method||(event.fundingKind==='opening-credit'?request.method:receipt.event.method);event.reason=salesText(request.reason)
  if(request.action==='refund'){
    event.amount=moneyValue(request.amount,'退款金額',.01)
    if(cents(event.amount)>available(receipt))throw Error('退款超過原收款可用餘額，請先解除抵付')
    event.reference=salesText(request.reference??'',100,false);cashFields(event,request,data,'out',history);return event
  }
  if(request.action==='receipt-reverse'){
    if(available(receipt)!==cents(receipt.event.amount)||receipt.allocated||receipt.refunded)throw Error('請先解除有效抵付並更正退款，才能沖銷整筆收款')
    event.amount=receipt.event.amount;cashFields(event,request,data,'out',history);return event
  }
  event.refundId=refund.id;event.amount=refund.amount;cashFields(event,request,data,'in',history);return event
}
const receiptFor=event=>({id:event.id,kind:CUSTOMER_KIND,action:event.action,customerId:event.customerId,revision:event.revision,signature:canonicalSignature(event.input),event:canonicalSignature(event),cashLogId:event.cashLogId||null})
function validateCash(event,receipt,cashLogs){
  const row=event.cashLogId?cashLogs.find(c=>c.id===event.cashLogId):null
  if(event.cashLogId&&(!row||row.time!==event.time||row.shiftId!==event.shiftId||row.type!==event.cashType||row.amount!==event.amount||row.cashier!==event.actor.username||row.reason!=='客戶收付 '+event.customerId)||receipt.cashLogId!==(event.cashLogId||null))throw Error('客戶款項與現金流水不符')
  return row
}
function salesBuckets(data,count){
  const buckets=new Map()
  for(const receipt of data.salesOperations||[]){
    const request=JSON.parse(receipt.signature),revision=request.expectedLedgerRevision??0
    if(!Number.isSafeInteger(revision)||revision<0||revision>count)throw Error('銷售引用的客戶帳版本不完整')
    if(!buckets.has(revision))buckets.set(revision,[])
    buckets.get(revision).push({request,receipt})
  }
  return buckets
}
function checkSales(rows,state,data){
  for(const {request,receipt}of rows||[]){
    if(request.action==='create'){
      if(Object.hasOwn(request,'expectedLedgerRevision')&&!state.customers.has(request.document.customer.id))throw Error('銷售單缺少原客戶身份')
      continue
    }
    if(!['pay','refund'].includes(request.action))continue
    const document=data.documents.find(d=>d.id===receipt.documentId),previous=salesDocumentAt(document,receipt.documentRevision-1)
    if(request.action==='pay'&&cents(request.amount)>cents(salesClaim(previous,request.deliveryId,state.credits).owed))throw Error('銷售收款與客戶抵付重複或超額')
    if(request.action==='refund'){
      const payment=previous.payments.find(p=>p.id===request.paymentId),claim=salesClaim(previous,payment.deliveryId)
      if(cents(request.amount)>cents(claim.credit))throw Error('原單退款不可使用其他客戶收款的抵付餘額')
    }
  }
}
export function validateCustomerLedgerRecords(entries=[],operations=[],data={}){
  if(!Array.isArray(entries)||!Array.isArray(operations)||entries.length!==operations.length)throw Error('客戶款項歷史與正式回執不完整')
  const sorted=[...entries].sort((a,b)=>a.revision-b.revision),byId=new Map(operations.map(r=>[r.id,r])),state=emptyProjection(),cashIds=new Set(),seen=new Set(),buckets=salesBuckets(data,entries.length),timeline=openingBalanceTimeline(data.openingBalanceContext,'receivable',entries.length,data.storeId)
  assertOpeningBalanceOrdinaryIds(timeline.at(entries.length),data.documents)
  if(byId.size!==operations.length)throw Error('客戶款項回執編號重複')
  syncOpening(state,timeline);checkSales(buckets.get(0),state,data)
  for(const event of sorted){
    if(event.revision!==state.entries.length+1||seen.has(event.id))throw Error('客戶款項歷史版本或編號不正確')
    seen.add(event.id)
    const receipt=byId.get(event.id),actual=derive(event.input,{...data,openShift:event.method==='cash'?{id:event.shiftId,status:'open'}:null},event.actor,state,{history:true})
    if(!receipt||canonicalSignature(actual)!==canonicalSignature(event)||canonicalSignature(receiptFor(event))!==canonicalSignature(receipt))throw Error('客戶款項金額、來源或回執不符')
    validateCash(event,receipt,data.cashLogs||[]);if(event.cashLogId)cashIds.add(event.cashLogId)
    projectOne(state,event);syncOpening(state,timeline);checkSales(buckets.get(event.revision),state,data)
  }
  if((data.cashLogs||[]).some(row=>String(row.id).startsWith('customer-cash:')&&!cashIds.has(row.id)))throw Error('客戶現金流水缺少原收款回執')
  return customerLedgerView(sorted,data.openingBalanceContext,data.storeId)
}
export function planCustomerLedger(request,data,actor){
  const entries=data.customerEntries||[],state=project([...entries].sort((a,b)=>a.revision-b.revision),data.openingBalanceContext,data.storeId)
  assertOpeningBalanceOrdinaryIds(state.opening,data.documents)
  const event=derive(request,data,actor,state),receipt=receiptFor(event)
  const cashLog=event.cashLogId?{id:event.cashLogId,shiftId:event.shiftId,time:event.time,type:event.cashType,amount:event.amount,reason:'客戶收付 '+event.customerId,cashier:event.actor.username}:null
  return {event,receipt,cashLog}
}
export function customerLedgerReceipt(request,receipt,data){
  if(receipt?.id!==request.id||receipt.kind!==CUSTOMER_KIND||receipt.signature!==canonicalSignature(request))throw Object.assign(Error('原客戶款項編號已存在且內容不同，請核對原紀錄'),{operationConflict:true})
  const event=data.customerEntries.find(e=>e.id===request.id)
  if(!event||event.storeId!==data.storeId||canonicalSignature(receiptFor(event))!==canonicalSignature(receipt))throw Error('客戶款項回執找不到原始紀錄')
  const active=openingBalanceTimeline(data.openingBalanceContext,'receivable',data.customerEntries.length,data.storeId).at(event.revision-1),openingIds=new Set(active.claims.map(row=>row.documentId))
  const referenced=new Set((event.items||[]).map(item=>item.documentId).filter(id=>!openingIds.has(id))),documents=(data.documents||[]).filter(doc=>referenced.has(doc.id))
  if(documents.length!==referenced.size)throw Error('客戶款項回覆缺少原銷售單')
  return {success:true,receipt,event,documents,cashLog:validateCash(event,receipt,data.cashLogs),...(data.openingBalanceContext?{openingBalanceContext:structuredClone(data.openingBalanceContext)}:{}),customerLedger:customerLedgerView([...data.customerEntries].sort((a,b)=>a.revision-b.revision),data.openingBalanceContext,data.storeId)}
}
export function assertCustomerLedgerResult(request,result){
  if(result?.success!==true||!result.customerLedger||!Array.isArray(result.customerLedger.entries)||!Array.isArray(result.documents)||canonicalSignature(result.event?.input)!==canonicalSignature(request)||canonicalSignature(receiptFor(result.event))!==canonicalSignature(result.receipt))throw Error('客戶款項保存結果尚未確認：回覆內容不符')
  salesActor(result.event.actor)
  if(result.event.revision!==request.expectedRevision+1||result.event.id!==request.id||result.event.customerId!==(request.customerId||request.customer?.id))throw Error('客戶款項保存結果尚未確認：原身份或版本不符')
  const prior=result.customerLedger.entries.filter(e=>e.revision<result.event.revision).sort((a,b)=>a.revision-b.revision)
  if(prior.some((event,index)=>event.revision!==index+1))throw Error('客戶款項回覆缺少原帳版本')
  const prefix=project(prior,result.openingBalanceContext,request.storeId,result.customerLedger.entries.length)
  result.documents.forEach(validateSalesDocument)
  const actual=derive(request,{storeId:request.storeId,documents:result.documents,openShift:result.event.method==='cash'?{id:result.event.shiftId,status:'open'}:null},result.event.actor,prefix,{history:true})
  if(canonicalSignature(actual)!==canonicalSignature(result.event))throw Error('客戶款項保存結果尚未確認：金額或來源不符')
  const replay=customerLedgerReceipt(request,result.receipt,{storeId:request.storeId,documents:result.documents,customerEntries:result.customerLedger.entries,cashLogs:result.cashLog?[result.cashLog]:[],openingBalanceContext:result.openingBalanceContext})
  if(canonicalSignature(replay.customerLedger)!==canonicalSignature(result.customerLedger)||canonicalSignature(replay.event)!==canonicalSignature(result.event))throw Error('客戶款項保存結果尚未確認：餘額或原紀錄不符')
  return result
}
