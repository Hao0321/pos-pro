import {canonicalSignature,operationHeader,moneyValue,quantityValue} from './operationRules.mjs'
import {procurementLineCents} from './procurementAmounts.mjs'
import {party,validateQuote,productReference} from './businessExchange.mjs'
import {SALES_KIND,SALES_COLLECTION,salesOnly,salesText,salesActor,salesDate,validateSalesDay,validateSalesRequest,salesCents,salesAmount,salesUnits,salesQuantity,deriveSalesEvent,appendSalesEvent,validateSalesDocument,salesBase,salesEvent} from './salesRules.mjs'

function validateSalesItem(row){
  salesOnly(row,['productId','qty','unitPrice','expectedProduct'])
  if(row.expectedProduct!==undefined){salesOnly(row.expectedProduct,['name','unit','price']);salesText(row.expectedProduct.name,200);salesText(row.expectedProduct.unit,30);moneyValue(row.expectedProduct.price,'一般售價')}
  quantityValue(row.qty,'訂購數量',.001);moneyValue(row.unitPrice,'議定單價')
}
export function makeSalesOrder(request,data,actor){
  salesOnly(request,['id','time','date','kind','storeId','epoch','action','document','expectedLedgerRevision'])
  const input=request.document;salesOnly(input,['customer','date','items','note','quoteRef'])
  const customer=party(input.customer),date=validateSalesDay(input.date)
  if(Object.hasOwn(request,'expectedLedgerRevision')&&!data.customerLedger?.customers.some(row=>row.id===customer.id))throw Error('請先選擇或新增往來客戶')
  if(date>request.date)throw Error('訂單日期不能在未來')
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)throw Error('請選擇 1 至 100 個商品')
  let quote
  if(input.quoteRef!==undefined){
    salesOnly(input.quoteRef,['id','revision'])
    quote=data.quotes?.find(q=>q.id===input.quoteRef.id&&q.revision===input.quoteRef.revision)
    if(!quote)throw Error('找不到本店已保存的原報價版本')
    validateQuote(quote,{now:Date.now()})
    if(quote.sender.id!==data.storeId||canonicalSignature(quote.recipient)!==canonicalSignature(customer))throw Error('原報價的店面或客戶不符')
    if(data.documents.some(d=>d.sourceQuote?.id===quote.id))throw Error('這份報價已轉成銷售單，請查看原單')
  }
  const items=input.items.map((row,index)=>{
    validateSalesItem(row)
    const product=data.products.find(p=>p.id===row.productId)
    if(!product)throw Error('找不到銷售商品')
    if(quote){
      const original=quote.items[index]
      if(quote.items.length!==input.items.length||!original||original.sku!==row.productId||original.qty!==row.qty||original.unitPrice!==row.unitPrice||original.unit!==(product.unit||'個'))throw Error('銷售內容與議定報價不同，請先修訂報價')
      return {productId:product.id,name:original.name,unit:original.unit,qty:row.qty,unitPrice:row.unitPrice}
    }
    if(canonicalSignature(row.expectedProduct)!==canonicalSignature(productReference(product)))throw Error('商品名稱、單位或一般售價已更新，請重新選取')
    return {productId:product.id,name:product.name,unit:product.unit||'個',qty:row.qty,unitPrice:row.unitPrice}
  })
  const document={version:1,id:request.id,storeId:data.storeId,createdOperationId:request.id,createdAt:request.time,createdBy:salesActor(actor),customer,date,items,total:salesAmount(items.reduce((n,row)=>n+procurementLineCents(row.qty,row.unitPrice),0)),note:salesText(input.note??'',1000,false),revision:1,...Object.fromEntries(Object.values(SALES_COLLECTION).map(key=>[key,[]])),...(quote?{sourceQuote:structuredClone(quote)}:{})}
  validateSalesDocument(document)
  return document
}
export function planSales(request,data,actor){
  if(actor?.role!=='owner')throw Error('權限不足')
  validateSalesRequest(request)
  operationHeader(request)
  if(request.kind!==SALES_KIND)throw Error('銷售操作類型不正確')
  if(request.storeId!==data.storeId)throw Object.assign(Error('銷售操作屬於另一間店，請回原店面核對'),{historyUncertain:true})
  if(request.epoch!==data.epoch)throw Object.assign(Error('資料已還原或更換，請先核對原銷售操作，不要重新收款'),{historyUncertain:true})
  if(!Number.isSafeInteger(request.expectedLedgerRevision??0)||(request.expectedLedgerRevision??0)!==(data.customerEntries?.length||0))throw Error('客戶款項已更新，請重新核對')
  if(Math.abs(Date.now()-Date.parse(request.time))>300000)throw Error('操作時間已過久，請重新核對')
  validateSalesDay(request.date);if(request.date>salesDate(new Date()))throw Error('操作日期不能在未來')
  let document,event
  if(request.action==='create'){
    if(data.documents.some(d=>d.id===request.id))throw Error('銷售單編號已存在')
    document=makeSalesOrder(request,data,actor);event=salesBase(document)
  }else{
    const old=data.documents.find(d=>d.id===request.orderId);if(!old)throw Error('找不到原銷售單')
    validateSalesDocument(old)
    event=deriveSalesEvent(request,old,{...data,actor});document=appendSalesEvent(old,event);validateSalesDocument(document)
    if(event.method==='cash'&&event.date!==salesDate(new Date()))throw Error('現金操作請使用目前營業日')
  }
  const deltas=new Map()
  if(request.action==='deliver'||request.action==='return'&&event.restock){
    const sign=request.action==='deliver'?-1:1
    document.items.forEach((item,index)=>{const q=event.quantities[index];if(q)deltas.set(item.productId,sign*salesUnits(q))})
  }
  const products=[...deltas].map(([id,delta])=>{
    const product=data.products.find(p=>p.id===id),item=document.items.find(i=>i.productId===id)
    if(!product||item.unit!==(product.unit||'個')||salesUnits(product.stock)+delta<0)throw Error('商品單位或庫存已改變，請核對')
    return {...product,stock:salesQuantity(salesUnits(product.stock)+delta)}
  })
  const cashLog=event.cashLogId?{id:event.cashLogId,shiftId:event.shiftId,time:request.time,type:event.cashType,amount:event.amount,reason:'銷售收付 '+document.id,cashier:actor.username||actor.userId||''}:null
  const receipt={id:request.id,kind:SALES_KIND,action:request.action,signature:canonicalSignature(request),documentId:document.id,documentRevision:document.revision,event:canonicalSignature(event),productIds:products.map(p=>p.id),cashLogId:cashLog?.id||null}
  return {document,products,cashLog,receipt}
}
export function salesReceipt(request,receipt,data,checkDocument=true){
  if(receipt?.id!==request.id||receipt.kind!==SALES_KIND||receipt.signature!==canonicalSignature(request)||receipt.action!==request.action)throw Object.assign(Error('原銷售操作編號已存在且內容不同，請核對原單'),{operationConflict:true})
  if(request.storeId!==data.storeId)throw Error('銷售回執屬於另一間店')
  const document=data.documents.find(d=>d.id===receipt.documentId)
  if(!document||document.revision<receipt.documentRevision||canonicalSignature(salesEvent(document,request.action,request.id))!==receipt.event)throw Error('銷售回執找不到原文件，請保留紀錄核對')
  if(checkDocument)validateSalesDocument(document)
  const products=receipt.productIds.map(id=>data.products.find(p=>p.id===id))
  if(products.some(p=>!p||!Number.isFinite(p.stock)||p.stock<0)||new Set(receipt.productIds).size!==receipt.productIds.length)throw Error('銷售回執缺少完整庫存結果')
  const cashLog=receipt.cashLogId?data.cashLogs.find(row=>row.id===receipt.cashLogId):null
  if(receipt.cashLogId&&!cashLog)throw Error('銷售回執缺少原現金流水')
  return {success:true,receipt,document,products,cashLog}
}
function validateSalesSource(request,doc,event,receipt){
  validateSalesRequest(request)
  if(receipt.action!=='create'){
    if(canonicalSignature(request)!==canonicalSignature(event.input))throw Error('銷售回執與來源內容不同')
  }else{
    salesOnly(request,['id','time','date','kind','storeId','epoch','action','document','expectedLedgerRevision']);operationHeader(request);validateSalesDay(request.date)
    const input=request.document;salesOnly(input,['customer','date','items','note','quoteRef'])
    if(Array.isArray(input.items))input.items.forEach(validateSalesItem)
    if(typeof request.epoch!=='string'||!request.epoch||doc.date>request.date||request.id!==doc.id||request.storeId!==doc.storeId||request.action!=='create'||request.kind!==SALES_KIND||request.time!==doc.createdAt||input.date!==doc.date||salesText(input.note??'',1000,false)!==doc.note||canonicalSignature(party(input.customer))!==canonicalSignature(doc.customer)||!Array.isArray(input.items)||input.items.length!==doc.items.length||input.items.some((row,i)=>row.productId!==doc.items[i].productId||row.qty!==doc.items[i].qty||row.unitPrice!==doc.items[i].unitPrice||!doc.sourceQuote&&(row.expectedProduct?.name!==doc.items[i].name||(row.expectedProduct?.unit||'個')!==doc.items[i].unit))||canonicalSignature(input.quoteRef??null)!==canonicalSignature(doc.sourceQuote?{id:doc.sourceQuote.id,revision:doc.sourceQuote.revision}:null))throw Error('銷售單缺少正確的建立來源')
  }
  const affected=['deliver','return'].includes(receipt.action)&&(receipt.action!=='return'||event.restock)?doc.items.filter((_,i)=>event.quantities[i]>0).map(i=>i.productId):[]
  if(canonicalSignature(affected)!==canonicalSignature(receipt.productIds))throw Error('銷售回執的庫存來源不完整')
}
function validateSalesCash(event,cashLog,receipt){
  if(event.cashLogId){
    if(!cashLog||receipt.cashLogId!==event.cashLogId||cashLog.id!==event.cashLogId||cashLog.shiftId!==event.shiftId||cashLog.time!==event.time||cashLog.type!==event.cashType||cashLog.amount!==event.amount)throw Error('銷售收付與現金流水不符')
  }else if(receipt.cashLogId||cashLog)throw Error('銷售回執現金引用不正確')
}
export function assertSalesResult(request,result){
  if(result?.success!==true||!Array.isArray(result.products)||!Array.isArray(result.receipt?.productIds)||result.products.length!==result.receipt.productIds.length)throw Error('銷售保存結果尚未確認：回覆內容不符')
  const checked=salesReceipt(request,result.receipt,{storeId:request.storeId,documents:[result.document],products:result.products,cashLogs:result.cashLog?[result.cashLog]:[]})
  const event=salesEvent(result.document,request.action,request.id)
  validateSalesSource(request,result.document,event,result.receipt);validateSalesCash(event,checked.cashLog,result.receipt)
  return result
}
export function validateSalesRecords(documents,operations,cashLogs,storeId,products=[],quotes=[]){
  if(!Array.isArray(documents)||!Array.isArray(operations)||!Array.isArray(cashLogs))throw Error('銷售資料集合不正確')
  const ids=new Set(),expected=new Map(),quoteFamilies=new Set()
  for(const doc of documents){
    validateSalesDocument(doc)
    if(doc.storeId!==storeId||ids.has(doc.id)||products&&doc.items.some(item=>!products.some(p=>p.id===item.productId)))throw Error('銷售文件的身份、商品或編號不符')
    ids.add(doc.id)
    if(doc.sourceQuote){
      const original=quotes.find(quote=>quote.id===doc.sourceQuote.id&&quote.revision===doc.sourceQuote.revision)
      if(!original||canonicalSignature(original)!==canonicalSignature(doc.sourceQuote))throw Error('銷售單缺少本店保存的原報價版本，請保留資料核對')
      if(quoteFamilies.has(doc.sourceQuote.id))throw Error('同一份報價重複轉成銷售單');quoteFamilies.add(doc.sourceQuote.id)
    }
    const events=[{id:doc.createdOperationId,action:'create',revision:1},...Object.values(SALES_COLLECTION).flatMap(key=>doc[key])]
    for(const event of events){if(expected.has(event.id))throw Error('銷售操作編號重複');expected.set(event.id,{doc,event})}
  }
  if(expected.size!==operations.length)throw Error('銷售歷史與正式回執不完整')
  const seen=new Set(),expectedCash=new Map()
  for(const receipt of operations){
    const found=expected.get(receipt.id)
    if(!found||seen.has(receipt.id))throw Error('銷售回執編號不正確')
    seen.add(receipt.id)
    const request=JSON.parse(receipt.signature)
    if(receipt.action!==found.event.action||receipt.documentRevision!==found.event.revision)throw Error('銷售回執版本不符')
    const result=salesReceipt(request,receipt,{storeId,documents,products,cashLogs},false)
    validateSalesSource(request,found.doc,found.event,receipt);validateSalesCash(found.event,result.cashLog,receipt)
    if(found.event.cashLogId)expectedCash.set(result.cashLog.id,true)
  }
  if(cashLogs.some(row=>String(row.id).startsWith('sales-cash:')&&!expectedCash.has(row.id)))throw Error('現金流水缺少原銷售回執')
}
