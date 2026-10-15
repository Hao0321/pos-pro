import {beforeEach,expect,test} from 'vitest'
import {planCustomerLedger,customerLedgerReceipt,assertCustomerLedgerResult,validateCustomerLedgerRecords} from '../../electron/customerLedger.mjs'
import {planSales,validateSalesRecords} from '../../electron/salesPlan.mjs'
import {salesDate,salesSummary} from '../../electron/salesRules.mjs'
import {salesToJournalEntries} from '../../electron/salesJournal.mjs'
import {customerLedgerToJournalEntries} from '../../electron/customerJournal.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {productReference} from '../../electron/businessExchange.mjs'
import {summarizeShift} from '../../electron/shiftReconciliation.mjs'

const owner={role:'owner',userId:'owner',username:'Fixture Owner'}
let data,index
const header=(kind,action,input)=>({id:'customer-test-'+(++index),kind,action,storeId:'store',epoch:'epoch',time:new Date().toISOString(),date:salesDate(new Date()),...input})
const request=(action,input={})=>header('customer-ledger',action,{expectedRevision:data.customerEntries.length,...input})
function check(){data.salesOperations=data.operations;validateSalesRecords(data.documents,data.operations,data.cashLogs,data.storeId,data.products,[]);data.customerLedger=validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data)}
function ledger(input){const plan=planCustomerLedger(input,data,owner);data={...data,customerEntries:[...data.customerEntries,plan.event],customerOperations:[...data.customerOperations,plan.receipt],cashLogs:[...data.cashLogs,...(plan.cashLog?[plan.cashLog]:[])]};check();return assertCustomerLedgerResult(input,customerLedgerReceipt(input,plan.receipt,data))}
function sale(action,input={}){const r=header('sales',action,{expectedLedgerRevision:data.customerEntries.length,...input}),p=planSales(r,data,owner);data={...data,documents:[p.document,...data.documents.filter(d=>d.id!==p.document.id)],operations:[...data.operations,p.receipt],products:data.products.map(product=>p.products.find(row=>row.id===product.id)||product),cashLogs:[...data.cashLogs,...(p.cashLog?[p.cashLog]:[])]};check();return p.document}
const customer=(id='buyer',name='同名客戶')=>ledger(request('customer-create',{customer:{id,name}}))
const receive=(amount=500,method='cash',customerId='buyer')=>ledger(request('receive',{customerId,amount,method,shiftId:method==='cash'?'shift':'',reference:'fixture reference',confirmed:true})).event
function delivered(price=150,customerId='buyer'){
  const doc=sale('create',{document:{customer:{id:customerId,name:'同名客戶'},date:salesDate(new Date()),items:[{productId:'p',qty:1,unitPrice:price,expectedProduct:productReference(data.products[0])}],note:''}})
  return sale('deliver',{orderId:doc.id,expectedRevision:doc.revision,quantities:[1],dueDate:salesDate(new Date()),handedOver:true})
}
const current=doc=>data.documents.find(row=>row.id===doc.id)
const row=(doc,amount)=>({documentId:doc.id,deliveryId:doc.deliveries[0].id,expectedRevision:current(doc).revision,amount})
const allocate=(receipt,items)=>ledger(request('allocate',{customerId:receipt.customerId,receiptId:receipt.id,items,reviewed:true})).event
const balance=()=>data.customerLedger.receipts[0]
const account=(number)=>[...data.documents.flatMap(salesToJournalEntries),...customerLedgerToJournalEntries(data.customerEntries)].flatMap(e=>e.lines).filter(line=>line.account===number).reduce((n,line)=>n+Math.round(line.debit*100)-Math.round(line.credit*100),0)
beforeEach(()=>{index=0;data={storeId:'store',epoch:'epoch',documents:[],operations:[],salesOperations:[],customerEntries:[],customerOperations:[],cashLogs:[],quotes:[],products:[{id:'p',name:'牛丼',unit:'碗',stock:10,price:150,cost:40}],openShift:{id:'shift',status:'open',openCash:100}};check()})

test('one actual advance before fulfillment settles two claims without a second cash receipt or revenue',()=>{
  customer();const receipt=receive();expect(data.documents).toEqual([]);expect(account('2192')).toBe(-50000);expect(account('4101')).toBe(0);expect(data.products[0].stock).toBe(10)
  const first=delivered(150),second=delivered(250);allocate(receipt,[row(first,150),row(second,250)])
  expect(balance()).toMatchObject({amount:500,allocated:400,available:100,refunded:0});expect(data.cashLogs).toHaveLength(1);expect(data.documents.every(doc=>doc.payments.length===0)).toBe(true)
  for(const doc of data.documents)expect(salesSummary(doc,undefined,data.customerEntries)).toMatchObject({owed:0,paid:doc.total,prepaid:doc.total})
  expect(account('1101')).toBe(50000);expect(account('1141')).toBe(0);expect(account('2192')).toBe(-10000);expect(account('4101')).toBe(-40000);expect(account('5101')).toBe(8000);expect(data.products[0].stock).toBe(8)
  expect(summarizeShift(data.openShift,[],data.cashLogs,[]).expected).toBe(600)
})

test('partial unallocation, actual refund, refund reversal and receipt reversal retain every source',()=>{
  customer();const receipt=receive(),first=delivered(150),second=delivered(250),applied=allocate(receipt,[row(first,150),row(second,250)])
  ledger(request('unallocate',{customerId:'buyer',allocationId:applied.id,items:[row(first,60)],reason:'付款分配錯誤',reviewed:true}))
  expect(balance().available).toBe(160);expect(data.cashLogs).toHaveLength(1);expect(salesSummary(current(first),undefined,data.customerEntries).owed).toBe(60)
  const refund=ledger(request('refund',{customerId:'buyer',receiptId:receipt.id,amount:70,reason:'實際退回',shiftId:'shift',confirmed:true})).event
  expect(balance().available).toBe(90);expect(account('1101')).toBe(43000)
  ledger(request('refund-reverse',{customerId:'buyer',refundId:refund.id,reason:'登記錯誤已核對',shiftId:'shift',confirmed:true}))
  expect(balance().available).toBe(160);expect(account('1101')).toBe(50000)
  expect(()=>ledger(request('receipt-reverse',{customerId:'buyer',receiptId:receipt.id,reason:'更正',shiftId:'shift',confirmed:true}))).toThrow('解除')
  ledger(request('unallocate',{customerId:'buyer',allocationId:applied.id,items:[row(first,90),row(second,250)],reason:'解除剩餘',reviewed:true}))
  ledger(request('receipt-reverse',{customerId:'buyer',receiptId:receipt.id,reason:'整筆登記錯誤',shiftId:'shift',confirmed:true}))
  expect(balance()).toMatchObject({available:0,reversed:true,allocated:0,refunded:0});expect(account('1101')).toBe(0);expect(account('2192')).toBe(0);expect(account('1141')).toBe(40000);expect(data.customerOperations).toHaveLength(data.customerEntries.length)
})

test('same-name customers stay separate and directory edits do not rewrite historical documents',()=>{
  customer();customer('other');const receipt=receive(),other=delivered(150,'other'),first=delivered(150),before=structuredClone(data)
  expect(()=>allocate(receipt,[row(other,1)])).toThrow('同一客戶');expect(data).toEqual(before)
  ledger(request('customer-update',{customerId:'buyer',customer:{id:'buyer',name:'新名稱',phone:'0900000000'}}))
  expect(current(first).customer.name).toBe('同名客戶');expect(balance().customerName).toBe('同名客戶');expect(data.customerLedger.customers.find(c=>c.id==='buyer').name).toBe('新名稱');expect(data.customerLedger.customers.find(c=>c.id==='other').available).toBe(0)
})

test('legacy direct collection and advance allocation share the claim ceiling and refund source',()=>{
  customer();const receipt=receive(500,'bank'),first=delivered(150),deliveryId=first.deliveries[0].id
  let document=sale('pay',{orderId:first.id,expectedRevision:current(first).revision,deliveryId,amount:50,method:'bank',reference:''})
  const payment=document.payments[0],applied=allocate(receipt,[row(document,100)]),before=structuredClone(data)
  expect(()=>sale('pay',{orderId:first.id,expectedRevision:current(first).revision,deliveryId,amount:1,method:'bank',reference:''})).toThrow('未收餘額');expect(data).toEqual(before)
  sale('return',{orderId:first.id,expectedRevision:current(first).revision,deliveryId,quantities:[1],restock:true,reason:'退貨'})
  expect(salesSummary(current(first),undefined,data.customerEntries).credit).toBe(150)
  expect(()=>sale('refund',{orderId:first.id,expectedRevision:current(first).revision,paymentId:payment.id,amount:100,reason:'不應退此來源'})).toThrow()
  ledger(request('unallocate',{customerId:'buyer',allocationId:applied.id,items:[row(current(first),100)],reason:'退貨解除',reviewed:true}))
  sale('refund',{orderId:first.id,expectedRevision:current(first).revision,paymentId:payment.id,amount:50,reason:'退回原逐單收款'})
  expect(salesSummary(current(first),undefined,data.customerEntries)).toMatchObject({credit:0,owed:0,paid:0});expect(account('4101')).toBe(0);expect(account('1141')).toBe(0);expect(account('2192')).toBe(-50000)
})

test.each(['duplicate','too-much','stale-document','unreviewed'])('rejects %s allocation before changing data',kind=>{
  customer();const receipt=receive(100),first=delivered(150),item=row(first,50),r=request('allocate',{customerId:'buyer',receiptId:receipt.id,items:[item],reviewed:true})
  if(kind==='duplicate')r.items.push({...item});if(kind==='too-much')r.items[0].amount=101;if(kind==='stale-document')r.items[0].expectedRevision=1;if(kind==='unreviewed')r.reviewed=false
  const before=structuredClone(data);expect(()=>ledger(r)).toThrow();expect(data).toEqual(before)
})

test.each(['not-confirmed','wrong-shift','future-cash','precision','stale-ledger','other-store','old-epoch'])('rejects %s actual money request without cash or balance changes',kind=>{
  customer();const r=request('receive',{customerId:'buyer',amount:100,method:'cash',shiftId:'shift',confirmed:true})
  if(kind==='not-confirmed')r.confirmed=false;if(kind==='wrong-shift')r.shiftId='other';if(kind==='future-cash')r.date='2099-01-01';if(kind==='precision')r.amount=.001;if(kind==='stale-ledger')r.expectedRevision=0;if(kind==='other-store')r.storeId='other';if(kind==='old-epoch')r.epoch='old'
  const before=structuredClone(data);expect(()=>ledger(r)).toThrow();expect(data).toEqual(before)
})

test('missing history, orphan cash and contradictory sales/ledger ordering cannot be imported as a valid book',()=>{
  customer();const receipt=receive(),first=delivered(150);allocate(receipt,[row(first,100)])
  expect(()=>validateCustomerLedgerRecords(data.customerEntries,data.customerOperations.slice(1),data)).toThrow()
  expect(()=>validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,{...data,cashLogs:[...data.cashLogs,{id:'customer-cash:orphan'}]})).toThrow()
  const wrongCash=structuredClone(data);wrongCash.cashLogs[0].reason='客戶收付 another-customer'
  expect(()=>validateCustomerLedgerRecords(wrongCash.customerEntries,wrongCash.customerOperations,wrongCash)).toThrow('現金流水不符')
  const changed=structuredClone(data),event=changed.customerEntries.find(e=>e.action==='allocate');event.items[0].expectedRevision=1;event.input.items[0].expectedRevision=1;const operation=changed.customerOperations.find(r=>r.id===event.id);operation.event=canonicalSignature(event);operation.signature=canonicalSignature(event.input)
  expect(()=>validateCustomerLedgerRecords(changed.customerEntries,changed.customerOperations,changed)).toThrow()
})

test('forged internally consistent receipt amounts are refused before a durable pending request can clear',()=>{
  customer();const r=request('receive',{customerId:'buyer',amount:100,method:'bank',shiftId:'',confirmed:true}),result=ledger(r),changed=structuredClone(result)
  changed.event.amount=999;changed.receipt.event=canonicalSignature(changed.event);changed.customerLedger.entries.at(-1).amount=999;changed.customerLedger.receipts[0].amount=999;changed.customerLedger.receipts[0].available=999;changed.customerLedger.customers[0].available=999
  expect(()=>assertCustomerLedgerResult(r,changed)).toThrow();expect(assertCustomerLedgerResult(r,result)).toBe(result)
})
