import {canonicalSignature,operationHeader,moneyValue,quantityValue} from './operationRules.mjs'
import {procurementLineCents,allocateCents} from './procurementAmounts.mjs'
import {party,validateQuote,businessId} from './businessExchange.mjs'

export const SALES_KIND='sales'
export const SALES_ACTIONS=['create','deliver','pay','pay-reverse','return','allowance','refund','refund-reverse','close']
export const SALES_COLLECTION={deliver:'deliveries',pay:'payments','pay-reverse':'paymentReversals',return:'returns',allowance:'allowances',refund:'refunds','refund-reverse':'refundReversals',close:'closures'}
export function validateSalesRequest(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||new TextEncoder().encode(JSON.stringify(request)).length>131072||typeof request.epoch!=='string'||!request.epoch||request.epoch.length>128)throw Error('銷售操作內容過大或格式不正確，請分開處理。')
}
export function salesActor(actor){
  if(actor?.role!=='owner'||typeof actor.userId!=='string'||!actor.userId||actor.userId.length>128||typeof actor.username!=='string'||!actor.username||actor.username.length>100)throw Error('銷售操作缺少已登入的管理員身份')
  return {userId:actor.userId,username:actor.username,role:'owner'}
}
export const salesCents=value=>Math.round(moneyValue(value,'金額')*100)
export const salesUnits=value=>Math.round(quantityValue(value,'數量')*1000)
export const salesAmount=value=>moneyValue(value/100,'合計')
export const salesQuantity=value=>quantityValue(value/1000,'數量')
export function salesOnly(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('銷售資料含不支援的欄位')
}
export function salesText(value,max=500,required=true){
  if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error('請填寫有效的銷售說明')
  return value.trim()
}
export function salesDate(time){
  const date=new Date(time);if(!Number.isFinite(date.getTime()))throw Error('銷售日期不正確')
  return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')
}
export function validateSalesDay(day){
  if(typeof day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw Error('銷售日期不正確')
  return day
}
const sumMoney=(rows,key='amount')=>rows.reduce((sum,row)=>sum+salesCents(row[key]),0)
const zeroRows=doc=>doc.items.map(()=>0)
export const saleDeliveredUnits=doc=>doc.items.map((_,index)=>doc.deliveries.reduce((n,row)=>n+salesUnits(row.quantities[index]),0))
export const activeSalesPayments=doc=>doc.payments.filter(p=>!doc.paymentReversals.some(r=>r.paymentId===p.id))
export const activeSalesRefunds=doc=>doc.refunds.filter(p=>!doc.refundReversals.some(r=>r.refundId===p.id))
export function salesClaim(doc,id){
  const delivery=doc.deliveries.find(d=>d.id===id);if(!delivery)throw Error('找不到原交付請款')
  const credits=sumMoney(doc.returns.filter(r=>r.deliveryId===id))+sumMoney(doc.allowances.filter(r=>r.deliveryId===id))
  const paid=sumMoney(activeSalesPayments(doc).filter(p=>p.deliveryId===id))-sumMoney(activeSalesRefunds(doc).filter(p=>p.deliveryId===id))
  const net=salesCents(delivery.amount)-credits
  return {delivery,net:salesAmount(net),paid:salesAmount(paid),owed:salesAmount(Math.max(0,net-paid)),credit:salesAmount(Math.max(0,paid-net))}
}
export function salesSummary(doc,today=salesDate(new Date())){
  const claims=doc.deliveries.map(delivery=>salesClaim(doc,delivery.id)),delivered=saleDeliveredUnits(doc)
  const pending=doc.items.map((item,i)=>salesQuantity(salesUnits(item.qty)-delivered[i]))
  const money=field=>salesAmount(claims.reduce((n,c)=>n+salesCents(c[field]),0))
  return {claims,net:money('net'),paid:money('paid'),owed:money('owed'),credit:money('credit'),pending,
    overdue:salesAmount(claims.filter(c=>c.delivery.dueDate<today).reduce((n,c)=>n+salesCents(c.owed),0)),
    status:doc.closures.length?'closed':pending.every(q=>q===0)?'delivered':doc.deliveries.length?'partial':'ordered'}
}
export function salesRemaining(doc,delivery){
  return delivery.quantities.map((qty,index)=>({
    quantity:salesUnits(qty)-doc.returns.filter(r=>r.deliveryId===delivery.id).reduce((n,r)=>n+salesUnits(r.quantities[index]),0),
    gross:salesCents(delivery.amounts[index])-doc.returns.filter(r=>r.deliveryId===delivery.id).reduce((n,r)=>n+salesCents(r.amounts[index]),0)-doc.allowances.filter(r=>r.deliveryId===delivery.id).reduce((n,r)=>n+salesCents(r.amounts[index]),0),
    cost:salesCents(delivery.costAmounts[index])-doc.returns.filter(r=>r.deliveryId===delivery.id).reduce((n,r)=>n+salesCents(r.costAmounts[index]),0),
  }))
}
function quantities(doc,values,ceilings){
  if(!Array.isArray(values)||values.length!==doc.items.length||!values.some(value=>value>0))throw Error('請填寫本次商品數量')
  values.forEach((q,i)=>{quantityValue(q,'本次數量');if(salesUnits(q)>ceilings[i])throw Error('本次數量超過尚可處理數量')})
  return [...values]
}
const rootFields=['id','time','date','kind','storeId','epoch','action','orderId','expectedRevision']
const actionFields={deliver:['quantities','dueDate','handedOver'],pay:['deliveryId','amount','method','shiftId','reference'],'pay-reverse':['paymentId','reason','shiftId'],return:['deliveryId','quantities','restock','reason'],allowance:['deliveryId','amounts','reason'],refund:['paymentId','amount','reason','shiftId'],'refund-reverse':['refundId','reason','shiftId'],close:['reason']}
function cashFields(request,event,context,type){
  if(event.method!=='cash'){event.shiftId='';event.cashLogId='';return event}
  if(!context.openShift||context.openShift.status!=='open'||request.shiftId!==context.openShift.id)throw Error('現金收付或更正需要目前開啟的班次')
  event.shiftId=context.openShift.id;event.cashLogId='sales-cash:'+request.id;event.cashType=type
  return event
}
export function deriveSalesEvent(request,doc,context={}){
  validateSalesRequest(request)
  if(!actionFields[request.action])throw Error('銷售操作不支援')
  salesOnly(request,[...rootFields,...actionFields[request.action]]);operationHeader(request)
  if(request.kind!==SALES_KIND||request.storeId!==doc.storeId||request.orderId!==doc.id||request.expectedRevision!==doc.revision||typeof request.epoch!=='string'||!request.epoch)throw Error('銷售單版本或店面已改變，請重新核對')
  const event={id:request.id,time:request.time,date:validateSalesDay(request.date),action:request.action,revision:doc.revision+1,input:structuredClone(request),actor:salesActor(context.actor)}
  if(event.date<doc.date)throw Error('操作日期不能早於訂單日期')
  const latestDay=Object.values(SALES_COLLECTION).flatMap(key=>doc[key]).reduce((day,row)=>row.date>day?row.date:day,doc.date)
  if(event.date<latestDay)throw Error('操作日期不能早於這張銷售單已有的紀錄')
  if(request.action==='deliver'){
    if(doc.closures.length)throw Error('剩餘訂單已結束，不能再交貨')
    if(request.handedOver!==true)throw Error('請先確認這批貨已依約交給客戶並可請款')
    const before=saleDeliveredUnits(doc)
    event.quantities=quantities(doc,request.quantities,doc.items.map((item,i)=>salesUnits(item.qty)-before[i]))
    event.dueDate=validateSalesDay(request.dueDate);if(event.dueDate<event.date)throw Error('收款到期日不能早於交付日')
    event.unitCosts=doc.items.map((item,i)=>{
      if(context.historicalCosts)return moneyValue(context.historicalCosts[i],'原交付成本')
      const product=context.products?.find(p=>p.id===item.productId)
      if(!product||(product.unit||'個')!==item.unit||salesUnits(product.stock)<salesUnits(event.quantities[i]))throw Error('商品單位或可用庫存已改變，請重新核對')
      return moneyValue(product.cost??0,'商品成本')
    })
    event.amounts=doc.items.map((item,i)=>salesAmount(procurementLineCents(salesQuantity(before[i]+salesUnits(event.quantities[i])),item.unitPrice)-procurementLineCents(salesQuantity(before[i]),item.unitPrice)))
    event.costAmounts=doc.items.map((_,i)=>salesAmount(procurementLineCents(event.quantities[i],event.unitCosts[i])))
    event.costTotal=salesAmount(event.costAmounts.reduce((n,value)=>n+salesCents(value),0))
    event.amount=salesAmount(event.amounts.reduce((n,value)=>n+salesCents(value),0))
    return event
  }
  if(request.action==='close'){
    if(doc.closures.length)throw Error('剩餘訂單已經結束')
    event.reason=salesText(request.reason);return event
  }
  if(request.action==='return'){
    const delivery=salesClaim(doc,request.deliveryId).delivery,remaining=salesRemaining(doc,delivery)
    event.deliveryId=delivery.id;event.quantities=quantities(doc,request.quantities,remaining.map(row=>row.quantity))
    if(typeof request.restock!=='boolean')throw Error('請確認退回商品是否可再銷售')
    event.restock=request.restock;event.reason=salesText(request.reason)
    event.amounts=remaining.map((row,i)=>salesAmount(event.quantities[i]===0?0:allocateCents(event.quantities[i],salesQuantity(row.quantity),row.gross)))
    event.costAmounts=remaining.map((row,i)=>salesAmount(event.quantities[i]===0?0:allocateCents(event.quantities[i],salesQuantity(row.quantity),row.cost)))
    event.costTotal=salesAmount(event.costAmounts.reduce((n,value)=>n+salesCents(value),0))
    event.amount=salesAmount(event.amounts.reduce((n,value)=>n+salesCents(value),0));return event
  }
  if(request.action==='allowance'){
    const delivery=salesClaim(doc,request.deliveryId).delivery,remaining=salesRemaining(doc,delivery)
    if(!Array.isArray(request.amounts)||request.amounts.length!==doc.items.length||!request.amounts.some(value=>value>0))throw Error('請填寫本次各品項折讓金額')
    event.amounts=request.amounts.map((value,i)=>{moneyValue(value,'折讓金額');if(salesCents(value)>remaining[i].gross)throw Error('折讓超過剩餘請款金額');return value})
    event.deliveryId=delivery.id;event.reason=salesText(request.reason);event.amount=salesAmount(event.amounts.reduce((n,value)=>n+salesCents(value),0));return event
  }
  if(request.action==='pay'){
    const claim=salesClaim(doc,request.deliveryId)
    event.amount=moneyValue(request.amount,'收款金額',.01);if(salesCents(event.amount)>salesCents(claim.owed))throw Error('收款超過這張請款的未收餘額')
    if(!['cash','bank'].includes(request.method))throw Error('請選現金或銀行收款')
    event.method=request.method;event.deliveryId=claim.delivery.id;event.reference=salesText(request.reference??'',100,false)
    return cashFields(request,event,context,'in')
  }
  if(request.action==='pay-reverse'){
    const payment=activeSalesPayments(doc).find(p=>p.id===request.paymentId)
    if(!payment||activeSalesRefunds(doc).some(r=>r.paymentId===payment.id))throw Error('找不到可更正的原收款，已有退款請先更正退款')
    Object.assign(event,{paymentId:payment.id,deliveryId:payment.deliveryId,amount:payment.amount,method:payment.method,reason:salesText(request.reason)})
    return cashFields(request,event,context,'out')
  }
  if(request.action==='refund'){
    const payment=activeSalesPayments(doc).find(p=>p.id===request.paymentId)
    if(!payment)throw Error('找不到可退款的原收款')
    const refunded=sumMoney(activeSalesRefunds(doc).filter(r=>r.paymentId===payment.id)),claim=salesClaim(doc,payment.deliveryId)
    event.amount=moneyValue(request.amount,'退款金額',.01)
    if(salesCents(event.amount)>salesCents(payment.amount)-refunded||salesCents(event.amount)>salesCents(claim.credit))throw Error('退款超過原收款或客戶尚可退餘額')
    Object.assign(event,{paymentId:payment.id,deliveryId:payment.deliveryId,method:payment.method,reason:salesText(request.reason)})
    return cashFields(request,event,context,'out')
  }
  const refund=activeSalesRefunds(doc).find(r=>r.id===request.refundId)
  if(!refund)throw Error('找不到可更正的原退款')
  Object.assign(event,{refundId:refund.id,paymentId:refund.paymentId,deliveryId:refund.deliveryId,amount:refund.amount,method:refund.method,reason:salesText(request.reason)})
  return cashFields(request,event,context,'in')
}
export function appendSalesEvent(doc,event){
  return {...doc,revision:event.revision,[SALES_COLLECTION[event.action]]:[...doc[SALES_COLLECTION[event.action]],event]}
}
export function salesBase(doc){
  return Object.fromEntries(['version','id','storeId','customer','createdOperationId','createdAt','createdBy','date','items','total','note','sourceQuote'].filter(key=>Object.hasOwn(doc,key)).map(key=>[key,doc[key]]))
}
export function salesEvent(doc,action,id){
  if(action==='create')return salesBase(doc)
  const event=doc[SALES_COLLECTION[action]]?.find(e=>e.id===id);if(!event)throw Error('銷售單缺少原操作文件')
  return event
}
export function validateSalesDocument(doc){
  salesOnly(doc,['version','id','storeId','customer','createdOperationId','createdAt','createdBy','date','items','total','note','sourceQuote','revision',...Object.values(SALES_COLLECTION)])
  operationHeader({id:doc.id,time:doc.createdAt});operationHeader({id:doc.createdOperationId,time:doc.createdAt})
  businessId(doc.storeId)
  if(canonicalSignature(salesActor(doc.createdBy))!==canonicalSignature(doc.createdBy))throw Error('銷售建立人紀錄不正確')
  if(doc.version!==1||doc.id!==doc.createdOperationId||!Number.isSafeInteger(doc.revision)||doc.revision<1)throw Error('銷售單身份或版本不正確')
  party(doc.customer);validateSalesDay(doc.date);salesText(doc.note,1000,false)
  if(!Array.isArray(doc.items)||!doc.items.length||doc.items.length>100)throw Error('銷售單品項不正確')
  const seen=new Set()
  doc.items.forEach(item=>{
    salesOnly(item,['productId','name','unit','qty','unitPrice']);businessId(item.productId)
    salesText(item.name,200);salesText(item.unit,30);quantityValue(item.qty,'訂購數量',.001);moneyValue(item.unitPrice,'議定單價')
    if(seen.has(item.productId))throw Error('銷售單有重複商品');seen.add(item.productId)
  })
  moneyValue(doc.total,'銷售合計')
  if(salesCents(doc.total)!==doc.items.reduce((n,item)=>n+procurementLineCents(item.qty,item.unitPrice),0))throw Error('銷售合計與明細不符')
  if(doc.sourceQuote!==undefined){
    validateQuote(doc.sourceQuote)
    if(doc.sourceQuote.sender.id!==doc.storeId||canonicalSignature(doc.sourceQuote.recipient)!==canonicalSignature(doc.customer)||doc.sourceQuote.total!==doc.total||canonicalSignature(doc.sourceQuote.items)!==canonicalSignature(doc.items.map(i=>({sku:i.productId,name:i.name,unit:i.unit,qty:i.qty,unitPrice:i.unitPrice}))))throw Error('銷售單與原報價不符')
  }
  for(const key of Object.values(SALES_COLLECTION))if(!Array.isArray(doc[key]))throw Error('銷售文件集合不正確')
  const events=Object.values(SALES_COLLECTION).flatMap(key=>doc[key]).sort((a,b)=>a.revision-b.revision)
  if(events.length>5000||doc.revision!==events.length+1||new TextEncoder().encode(JSON.stringify(doc)).length>2*1024*1024)throw Error('銷售歷史版本、筆數或大小不正確')
  let previous={...salesBase(doc),revision:1,...Object.fromEntries(Object.values(SALES_COLLECTION).map(key=>[key,[]]))}
  const ids=new Set([doc.id])
  for(const event of events){
    if(!event||ids.has(event.id)||event.revision!==previous.revision+1||!SALES_COLLECTION[event.action]||!doc[SALES_COLLECTION[event.action]].some(e=>e===event))throw Error('銷售操作編號或修訂重複')
    ids.add(event.id)
    const actual=deriveSalesEvent(event.input,previous,{actor:event.actor,historicalCosts:event.unitCosts,openShift:event.method==='cash'?{id:event.shiftId,status:'open'}:null})
    if(canonicalSignature(actual)!==canonicalSignature(event))throw Error('銷售歷史金額、數量或來源不符')
    previous=appendSalesEvent(previous,event)
  }
  if(canonicalSignature(previous)!==canonicalSignature(doc))throw Error('銷售歷史順序或內容不完整')
  return doc
}
