import {canonicalSignature,moneyValue,quantityValue,operationHeader} from './operationRules.mjs'

export const PROCUREMENT_KINDS=['purchase-create','purchase-bill','purchase-pay','purchase-reverse','purchase-cancel']
export const isProcurement=po=>po?.procurement?.version===1
export const parsePurchase=row=>({...row,items:typeof row.items==='string'?JSON.parse(row.items||'[]'):row.items,procurement:typeof row.procurement==='string'?JSON.parse(row.procurement):row.procurement??null})
export const purchaseParams=po=>({...po,items:JSON.stringify(po.items),procurement:po.procurement?JSON.stringify(po.procurement):null})
const cents=n=>Math.round(moneyValue(n,'金額')*100)
const units=n=>Math.round(quantityValue(n,'數量')*1000)
const amount=n=>moneyValue(n/100,'合計金額')
const sum=rows=>rows.reduce((n,r)=>n+cents(r.amount),0)
function text(value,label,max=200){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(label+'不正確');return value.trim()}
export function procurementDate(time){const d=new Date(time);if(!Number.isFinite(d.getTime()))throw Error('日期不正確');return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function date(value,label){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error(label+'不正確');return value}
export function procurementLineCents(qty,cost){
  const value=(BigInt(units(qty))*BigInt(cents(cost))+500n)/1000n
  if(value>100000000000n)throw Error('品項金額超過上限')
  return Number(value)
}
export function procurementQuantities(po,collection){return po.items.map((_,i)=>amountUnits(po.procurement[collection].reduce((n,r)=>n+units(r.quantities[i]),0)))}
function amountUnits(value){return quantityValue(value/1000,'合計數量')}
function lineAmount(po,before,quantities){return amount(po.items.reduce((n,item,i)=>n+procurementLineCents(amountUnits(units(before[i])+units(quantities[i])),item.unitCost)-procurementLineCents(before[i],item.unitCost),0))}
function availableQuantities(po,quantities,ceiling,before){
  if(!Array.isArray(quantities)||quantities.length!==po.items.length||!quantities.some(q=>q>0))throw Error('請填寫本次數量')
  quantities.forEach((q,i)=>{quantityValue(q,'本次數量');if(units(q)>units(ceiling[i])-units(before[i]))throw Error('本次數量超過尚可處理數量，請核對採購、收貨與請款')})
}
function doc(request){return {id:request.id,time:request.time,date:procurementDate(request.time)}}
function next(po){return {...po,items:po.items.map(i=>({...i})),procurement:structuredClone(po.procurement)}}
export function procurementSummary(po,today=procurementDate(new Date().toISOString())){
  if(!isProcurement(po))return null
  const p=po.procurement,paid=sum(p.payments)-sum(p.reversals),billed=sum(p.bills),received=sum(p.receipts)
  const bills=p.bills.map(b=>{const payments=p.payments.filter(v=>v.invoiceId===b.id),ids=new Set(payments.map(v=>v.id));const balance=cents(b.amount)-sum(payments)+sum(p.reversals.filter(v=>ids.has(v.paymentId)));return {...b,balance:amount(balance),overdue:balance>0&&b.dueDate<today}})
  return {received:amount(received),billed:amount(billed),paid:amount(paid),owed:amount(billed-paid),unbilled:amount(received-billed),overdue:amount(bills.filter(b=>b.overdue).reduce((n,b)=>n+cents(b.balance),0)),bills}
}
function settle(po){const p=po.procurement,s=procurementSummary(po);po.paidDate=po.status==='received'&&s.unbilled===0&&s.owed===0&&p.bills.length?p.payments.at(-1)?.date||p.bills.at(-1).date:'';return po}
export function createProcurement(request,data){
  const input=request.purchase;operationHeader({...request,id:input?.id})
  if(data.purchases.some(p=>p.id===input.id))throw Error('採購單編號已存在，請核對原單')
  const supplier=data.suppliers.find(s=>s.id===input.supplierId);if(!supplier)throw Error('供應商不存在')
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>1000)throw Error('請填寫採購品項')
  const items=input.items.map(item=>{
    quantityValue(item.qty,'訂購量',.001);moneyValue(item.unitCost,'採購單價')
    if(item.received!==undefined&&item.received!==0)throw Error('新增採購不可預先入庫')
    if(item.productId&&!data.products.some(p=>p.id===item.productId))throw Error('採購商品不存在')
    if(!item.productId&&!supplier.catalog?.some(c=>c.id===item.catalogId))throw Error('供應商目錄品項不存在')
    return {productId:item.productId||null,catalogId:item.catalogId||null,name:text(item.name,'商品名稱'),unit:item.unit||'個',qty:item.qty,unitCost:item.unitCost,received:0}
  })
  return {id:input.id,supplierId:supplier.id,supplierName:supplier.name||'',status:'ordered',date:date(input.date,'訂購日'),receivedDate:'',paidDate:'',note:String(input.note||'').slice(0,2000),total:amount(items.reduce((n,i)=>n+procurementLineCents(i.qty,i.unitCost),0)),items,
    procurement:{version:1,revision:1,createdOperationId:request.id,createdAt:request.time,receipts:[],bills:[],payments:[],reversals:[],cancel:null}}
}
export function recordProcurementReceipt(original,received,request){
  if(!isProcurement(original))return received
  validateProcurement(original)
  const po={...received,procurement:structuredClone(original.procurement)},before=procurementQuantities(original,'receipts')
  availableQuantities(original,request.quantities,original.items.map(i=>i.qty),before)
  po.procurement.receipts.push({...doc(request),quantities:[...request.quantities],amount:lineAmount(original,before,request.quantities)})
  po.procurement.revision++;po.receivedDate=procurementDate(request.time)
  return settle(po)
}
export function planProcurement(request,data,actor){
  operationHeader(request)
  if(request.kind==='purchase-create')return {purchase:createProcurement(request,data),cashLog:null}
  const original=data.purchases.find(p=>p.id===request.purchaseId)
  if(!isProcurement(original))throw Error('歷史採購單保留原帳，新採購才使用請款付款流程')
  validateProcurement(original)
  if(request.expectedPurchase!==canonicalSignature(original))throw Error('採購單已變更，請重新核對')
  const po=next(original),p=po.procurement;let cashLog=null
  if(p.cancel)throw Error('採購單已取消')
  if(request.kind==='purchase-bill'){
    const reference=text(request.reference,'供應商請款單號',100),key=reference.normalize('NFKC').toUpperCase()
    if(data.purchases.some(other=>other.supplierId===po.supplierId&&other.procurement?.bills?.some(b=>b.reference.normalize('NFKC').toUpperCase()===key)))throw Error('此供應商請款單號已存在')
    const dueDate=date(request.dueDate,'到期日'),before=procurementQuantities(po,'bills')
    if(dueDate<po.date)throw Error('到期日不可早於訂購日')
    availableQuantities(po,request.quantities,po.items.map(i=>i.received),before)
    p.bills.push({...doc(request),reference,dueDate,quantities:[...request.quantities],amount:lineAmount(po,before,request.quantities)})
  }else if(request.kind==='purchase-pay'){
    const bill=procurementSummary(po).bills.find(b=>b.id===request.invoiceId)
    if(!bill)throw Error('請款單不存在')
    const value=moneyValue(request.amount,'付款金額',.01)
    if(cents(value)>cents(bill.balance))throw Error('付款超過此請款單未付餘額')
    if(!['cash','bank'].includes(request.method))throw Error('付款方式不正確')
    const payment={...doc(request),invoiceId:bill.id,amount:value,method:request.method,note:String(request.note||'').slice(0,500),shiftId:'',cashLogId:''}
    cashLog=cashMovement(request,data,actor,payment,'out');p.payments.push(payment)
  }else if(request.kind==='purchase-reverse'){
    const payment=p.payments.find(v=>v.id===request.paymentId)
    if(!payment||p.reversals.some(v=>v.paymentId===payment.id))throw Error('付款不存在或已沖銷')
    const reversal={...doc(request),paymentId:payment.id,amount:payment.amount,method:payment.method,reason:text(request.reason,'沖銷理由',500),shiftId:'',cashLogId:''}
    cashLog=cashMovement(request,data,actor,reversal,'in');p.reversals.push(reversal)
  }else if(request.kind==='purchase-cancel'){
    if(p.receipts.length||p.bills.length||p.payments.length)throw Error('已有收貨或帳務紀錄，不能取消或刪除')
    p.cancel={...doc(request),reason:text(request.reason,'取消理由',500)};po.status='cancelled'
  }else throw Error('採購操作不正確')
  p.revision++;settle(po);validateProcurement(po)
  return {purchase:po,cashLog}
}
function cashMovement(request,data,actor,entry,type){
  if(entry.method!=='cash')return null
  const shift=data.openShift
  if(!shift||shift.status!=='open'||shift.id!==request.shiftId)throw Error('現金付款或沖銷需要目前開啟中的班次')
  entry.shiftId=shift.id;entry.cashLogId='procurement-'+request.id
  return {id:entry.cashLogId,shiftId:shift.id,time:request.time,type,amount:entry.amount,reason:(type==='out'?'供應商付款 ':'供應商付款沖銷 ')+request.purchaseId,cashier:actor?.username||actor?.userId||''}
}
export function procurementEvent(po,request){
  const collection={receive:'receipts','purchase-bill':'bills','purchase-pay':'payments','purchase-reverse':'reversals'}[request.kind]
  const event=collection?po.procurement[collection].find(r=>r.id===request.id):request.kind==='purchase-cancel'?po.procurement.cancel:{id:po.procurement.createdOperationId,time:po.procurement.createdAt}
  if(!event)throw Error('採購操作缺少保存文件')
  return {collection:collection||request.kind,id:event.id,signature:canonicalSignature(event)}
}
export function validateProcurement(po){
  if(po.procurement==null)return
  if(!isProcurement(po))throw Error('採購紀錄版本不支援')
  const p=po.procurement
  if(!Number.isSafeInteger(p.revision)||p.revision<1||!Array.isArray(po.items)||!po.items.length)throw Error('採購紀錄損壞')
  for(const item of po.items){quantityValue(item.qty,'訂購量',.001);moneyValue(item.unitCost,'採購單價');quantityValue(item.received,'已收貨量');if(units(item.received)>units(item.qty))throw Error('採購收貨超額')}
  if(cents(po.total)!==po.items.reduce((n,i)=>n+procurementLineCents(i.qty,i.unitCost),0))throw Error('採購合計金額不符')
  operationHeader({id:p.createdOperationId,time:p.createdAt});date(po.date,'訂購日')
  const ids=new Set([p.createdOperationId]);let received=po.items.map(()=>0),billed=po.items.map(()=>0)
  for(const group of ['receipts','bills','payments','reversals']){
    if(!Array.isArray(p[group]))throw Error('採購文件集合損壞')
    for(const r of p[group]){operationHeader(r);date(r.date,'文件日期');if(ids.has(r.id))throw Error('採購文件編號重複');ids.add(r.id);moneyValue(r.amount,'文件金額')}
  }
  for(const r of p.receipts){availableQuantities(po,r.quantities,po.items.map(i=>i.qty),received);if(cents(r.amount)!==cents(lineAmount(po,received,r.quantities)))throw Error('收貨金額不符');received=received.map((q,i)=>amountUnits(units(q)+units(r.quantities[i])))}
  for(const b of p.bills){text(b.reference,'請款單號',100);date(b.dueDate,'到期日');availableQuantities(po,b.quantities,received,billed);if(cents(b.amount)!==cents(lineAmount(po,billed,b.quantities)))throw Error('請款金額不符');billed=billed.map((q,i)=>amountUnits(units(q)+units(b.quantities[i])))}
  if(received.some((q,i)=>units(q)!==units(po.items[i].received)))throw Error('採購收貨紀錄與庫存文件不符')
  for(const entry of [...p.payments,...p.reversals]){if(!['cash','bank'].includes(entry.method)||entry.amount<=0||entry.method==='cash'&&(!entry.shiftId||!entry.cashLogId))throw Error('採購付款紀錄損壞')}
  const reversed=new Set()
  for(const r of p.reversals){const pay=p.payments.find(v=>v.id===r.paymentId);if(!pay||reversed.has(pay.id)||pay.amount!==r.amount||pay.method!==r.method)throw Error('付款沖銷紀錄不符');text(r.reason,'沖銷理由',500);reversed.add(pay.id)}
  if(p.payments.some(v=>!p.bills.some(b=>b.id===v.invoiceId)))throw Error('付款缺少原請款單')
  if(procurementSummary(po).bills.some(b=>b.balance<0))throw Error('請款單付款超額')
  if(p.cancel&&(p.receipts.length||p.bills.length||p.payments.length||po.status!=='cancelled'))throw Error('取消採購仍有交易紀錄')
  if(p.cancel){operationHeader(p.cancel);date(p.cancel.date,'取消日期');text(p.cancel.reason,'取消理由',500);if(ids.has(p.cancel.id))throw Error('取消操作編號重複')}
  if(p.revision!==1+p.receipts.length+p.bills.length+p.payments.length+p.reversals.length+(p.cancel?1:0))throw Error('採購版本與歷史文件不符')
  const expectedStatus=p.cancel?'cancelled':po.items.every(i=>units(i.received)===units(i.qty))?'received':p.receipts.length?'partial':'ordered'
  if(po.status!==expectedStatus)throw Error('採購狀態與收貨文件不符')
}
export function validateProcurementRecords(purchases,cashLogs){
  const references=new Set(),ids=new Set()
  for(const po of purchases){validateProcurement(po);if(!isProcurement(po))continue
    for(const id of [po.procurement.createdOperationId,...['receipts','bills','payments','reversals'].flatMap(k=>po.procurement[k].map(r=>r.id)),...(po.procurement.cancel?[po.procurement.cancel.id]:[])]){if(ids.has(id))throw Error('採購操作編號重複');ids.add(id)}
    for(const b of po.procurement.bills){const key=canonicalSignature([po.supplierId,b.reference.normalize('NFKC').toUpperCase()]);if(references.has(key))throw Error('供應商請款單號重複');references.add(key)}
    if(cashLogs)for(const group of ['payments','reversals'])for(const entry of po.procurement[group].filter(r=>r.method==='cash')){const log=cashLogs.find(r=>r.id===entry.cashLogId);if(!log||log.amount!==entry.amount||log.shiftId!==entry.shiftId||log.type!==(group==='payments'?'out':'in'))throw Error('採購付款與現金流水不符')}
  }
}
export function procurementToJournalEntries(po){
  if(!isProcurement(po))return []
  validateProcurement(po)
  const entries=[],p=po.procurement
  function entry(r,label,debit,credit){if(!r.amount)return;entries.push({id:'JP-'+r.id,orderId:po.id,date:r.date,type:'auto_procurement',description:`${label} — ${po.supplierName} / ${po.id}`,lines:[{account:debit,debit:r.amount,credit:0},{account:credit,debit:0,credit:r.amount}]})}
  p.receipts.forEach(r=>entry(r,'進貨收貨','1211','2102'))
  p.bills.forEach(r=>entry(r,'供應商請款','2102','2101'))
  p.payments.forEach(r=>entry(r,'供應商付款','2101',r.method==='cash'?'1101':'1103'))
  p.reversals.forEach(r=>entry(r,'供應商付款沖銷',r.method==='cash'?'1101':'1103','2101'))
  return entries
}
