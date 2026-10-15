import {beforeEach,expect,test,vi,afterEach} from 'vitest'
import {planSales,salesReceipt,validateSalesRecords} from '../../electron/salesPlan.mjs'
import {salesDate,salesSummary,validateSalesDocument} from '../../electron/salesRules.mjs'
import {salesToJournalEntries} from '../../electron/salesJournal.mjs'
import {productReference} from '../../electron/businessExchange.mjs'
import {summarizeShift} from '../../electron/shiftReconciliation.mjs'
import {businessReportRows,businessCashFlows,reportLineRevenue,reportDay} from '../../src/utils/businessReports'
import {orderCost} from '../../src/utils/orderLedger'

const owner={role:'owner',userId:'owner',username:'Fixture Owner'}
let data,counter
const request=(action,input={})=>({id:'sales-op-'+(++counter),kind:'sales',storeId:'store',epoch:'epoch',time:new Date().toISOString(),date:salesDate(new Date()),action,...input})
const creation=(input={})=>request('create',{document:{customer:{id:'buyer',name:'客戶 <script>資料</script>'},date:salesDate(new Date()),items:[{productId:'p',qty:3.125,unitPrice:12.34,expectedProduct:productReference(data.products[0])}],note:'',...input}})
const doc=()=>data.documents[0]
const command=(action,input={})=>request(action,{orderId:doc().id,expectedRevision:doc().revision,...input})
function run(r){
  const plan=planSales(r,data,owner)
  data={...data,documents:[plan.document,...data.documents.filter(d=>d.id!==plan.document.id)],products:data.products.map(p=>plan.products.find(n=>n.id===p.id)||p),operations:[...data.operations,plan.receipt],cashLogs:[...data.cashLogs,...(plan.cashLog?[plan.cashLog]:[])]}
  validateSalesRecords(data.documents,data.operations,data.cashLogs,data.storeId,data.products,data.quotes)
  return salesReceipt(r,plan.receipt,data)
}
const deliver=(qty=1.125)=>run(command('deliver',{quantities:[qty],dueDate:salesDate(new Date()),handedOver:true})).document.deliveries.at(-1)
const pay=(deliveryId,amount,method='bank')=>run(command('pay',{deliveryId,amount,method,shiftId:'shift',reference:'fixture bank entry'})).document.payments.at(-1)
beforeEach(()=>{counter=0;data={storeId:'store',epoch:'epoch',documents:[],operations:[],cashLogs:[],quotes:[],products:[{id:'p',name:'牛肉',unit:'公斤',stock:5,cost:8.88,price:15}],openShift:{id:'shift',status:'open',openCash:100}}})
afterEach(()=>vi.useRealTimers())

test('a backdated collection cannot precede the actual delivery it settles',()=>{
  const yesterday=salesDate(Date.now()-86400000),order=creation({date:yesterday});order.date=yesterday;run(order)
  const d=deliver(),before=structuredClone(data)
  expect(()=>run(command('pay',{date:yesterday,deliveryId:d.id,amount:1,method:'bank',reference:''}))).toThrow('日期')
  expect(data).toEqual(before)
})
test('legacy products without an explicit unit retain the same default unit during handover',()=>{
  delete data.products[0].unit;run(creation());expect(deliver().quantities).toEqual([1.125]);expect(data.products[0].stock).toBe(3.875)
})
test('oversized nested quote references are rejected before operation receipts can grow without bound',()=>{
  const r=creation(),quote={protocol:'business-quote/v1',id:'quote',revision:1,createdAt:r.time,issuedAt:r.time,validUntil:new Date(Date.now()+86400000).toISOString(),sender:{id:'store',name:'Seller'},recipient:r.document.customer,currency:'TWD',pricing:'all-inclusive-unit',items:[{sku:'p',name:'牛肉',unit:'公斤',qty:3.125,unitPrice:12.34}],total:38.56,note:''}
  data.quotes=[quote];r.document.quoteRef={id:quote.id,revision:1};r.document.items[0].expectedProduct.name='x'.repeat(140000);const before=structuredClone(data)
  expect(()=>run(r)).toThrow();expect(data).toEqual(before)
})
test('business report rows match original ledger revenue and cost after damaged and sellable returns',()=>{
  run(creation());const d=deliver();pay(d.id,13.88,'cash')
  run(command('return',{deliveryId:d.id,quantities:[.125],restock:false,reason:'damaged'}))
  run(command('allowance',{deliveryId:d.id,amounts:[.01],reason:'rounding'}))
  data.products[0].cost=999
  run(command('return',{deliveryId:d.id,quantities:[.5],restock:true,reason:'sellable'}))
  const rows=businessReportRows(data.documents),cents=value=>Math.round(value*100)
  expect(cents(rows.reduce((n,row)=>n+row.total,0))).toBe(616)
  expect(cents(rows.reduce((n,row)=>n+orderCost(row,data.products),0))).toBe(555)
  expect(cents(rows.flatMap(row=>row.items).reduce((n,row)=>n+reportLineRevenue(row),0))).toBe(616)
  expect(rows.map(reportDay)).toEqual(rows.map(()=>salesDate(new Date())))
  expect(businessCashFlows(data.documents)).toEqual([expect.objectContaining({method:'cash',amount:13.88})])
  expect(data.documents[0].payments).toHaveLength(1);expect(rows).toHaveLength(4)
})

test('order creation preserves stock, money and journal until explicit handover',()=>{
  const result=run(creation())
  expect(result.document.total).toBe(38.56);expect(data.products[0].stock).toBe(5);expect(data.cashLogs).toEqual([]);expect(salesToJournalEntries(doc())).toEqual([])
  expect(salesSummary(doc()).status).toBe('ordered');expect(salesSummary(doc()).pending).toEqual([3.125])
})
test('fractional split handovers allocate exactly the whole agreed amount',()=>{
  run(creation());const a=deliver(1.125),b=deliver(2)
  expect([a.amount,b.amount,doc().total]).toEqual([13.88,24.68,38.56]);expect(data.products[0].stock).toBe(1.875)
  expect(salesSummary(doc()).owed).toBe(38.56);expect(salesSummary(doc()).status).toBe('delivered')
})
test('small partial deliveries cannot manufacture rounding cents',()=>{
  run(creation({items:[{productId:'p',qty:.003,unitPrice:1.67,expectedProduct:productReference(data.products[0])}]}))
  const amounts=[deliver(.001).amount,deliver(.001).amount,deliver(.001).amount]
  expect(amounts).toEqual([0,0,0.01]);expect(amounts.reduce((n,v)=>n+v,0)).toBe(doc().total)
})
test('handover confirmation, insufficient stock and overdelivery reject without mutation',()=>{
  run(creation());const before=structuredClone(data)
  for(const extra of [{quantities:[1],handedOver:false},{quantities:[6],handedOver:true},{quantities:[.0001],handedOver:true}])expect(()=>run(command('deliver',{dueDate:salesDate(new Date()),...extra}))).toThrow()
  expect(data).toEqual(before)
})
test('partial cash and bank collections reduce receivables once and reconcile shift money',()=>{
  run(creation());const d=deliver();pay(d.id,5,'cash');pay(d.id,4,'bank')
  expect(salesSummary(doc()).owed).toBe(4.88);expect(data.cashLogs).toHaveLength(1)
  expect(summarizeShift(data.openShift,[],data.cashLogs).expected).toBe(105)
  const entries=salesToJournalEntries(doc())
  expect(entries.flatMap(e=>e.lines).filter(l=>l.account==='4101').reduce((n,l)=>n+l.credit-l.debit,0)).toBe(13.88)
})
test('collection never exceeds the original claim balance and cash needs the current shift',()=>{
  run(creation());const d=deliver(),before=structuredClone(data)
  expect(()=>run(command('pay',{deliveryId:d.id,amount:13.89,method:'bank'}))).toThrow(/超過/)
  expect(()=>run(command('pay',{deliveryId:d.id,amount:1,method:'cash',shiftId:'old'}))).toThrow(/班次/)
  expect(data).toEqual(before)
})
test('returns use original delivery value and cost after product price and cost change',()=>{
  run(creation());const d=deliver(1.125);pay(d.id,d.amount)
  data.products[0].cost=999;data.products[0].price=1000
  const result=run(command('return',{deliveryId:d.id,quantities:[.125],restock:true,reason:'fixture return'}))
  expect(result.document.returns[0].amount).toBe(1.54);expect(result.document.returns[0].costTotal).toBe(1.11)
  expect(data.products[0].stock).toBe(4);expect(salesSummary(doc()).credit).toBe(1.54)
})
test('damaged goods do not add stock or reverse the already incurred cost',()=>{
  run(creation());const d=deliver(),stock=data.products[0].stock
  run(command('return',{deliveryId:d.id,quantities:[1.125],restock:false,reason:'damaged'}))
  expect(data.products[0].stock).toBe(stock);expect(salesToJournalEntries(doc()).filter(e=>e.id.includes('cost-return'))).toEqual([])
})
test('line allowances and later partial returns never credit the same value twice',()=>{
  run(creation());const d=deliver(1.125)
  run(command('allowance',{deliveryId:d.id,amounts:[3.88],reason:'agreed reduction'}))
  const a=run(command('return',{deliveryId:d.id,quantities:[.125],restock:true,reason:'partial'})).document.returns.at(-1)
  const b=run(command('return',{deliveryId:d.id,quantities:[1],restock:true,reason:'remaining'})).document.returns.at(-1)
  expect([a.amount,b.amount]).toEqual([1.11,8.89]);expect(salesSummary(doc()).net).toBe(0)
  expect(()=>run(command('allowance',{deliveryId:d.id,amounts:[.01],reason:'too much'}))).toThrow()
})
test('refunds are limited by both invoice credit and the remaining original payment',()=>{
  run(creation());const d=deliver(),p=pay(d.id,10,'cash')
  run(command('return',{deliveryId:d.id,quantities:[1.125],restock:true,reason:'full'}))
  expect(()=>run(command('refund',{paymentId:p.id,amount:10.01,shiftId:'shift',reason:'over'}))).toThrow()
  const r=run(command('refund',{paymentId:p.id,amount:6,shiftId:'shift',reason:'partial refund'})).document.refunds.at(-1)
  expect(salesSummary(doc()).credit).toBe(4);expect(summarizeShift(data.openShift,[],data.cashLogs).expected).toBe(104)
  expect(()=>run(command('pay-reverse',{paymentId:p.id,reason:'cannot reverse refunded cash',shiftId:'shift'}))).toThrow()
  run(command('refund-reverse',{refundId:r.id,reason:'wrong refund entry',shiftId:'shift'}))
  run(command('pay-reverse',{paymentId:p.id,reason:'wrong payment entry',shiftId:'shift'}))
  expect(salesSummary(doc()).paid).toBe(0);expect(summarizeShift(data.openShift,[],data.cashLogs).expected).toBe(100)
})
test('returns and allowances can turn a fully paid claim into an exact customer refund credit',()=>{
  run(creation());const d=deliver(3.125),p=pay(d.id,38.56)
  run(command('allowance',{deliveryId:d.id,amounts:[.01],reason:'rounding concession'}))
  run(command('return',{deliveryId:d.id,quantities:[3.125],restock:true,reason:'all returned'}))
  expect(salesSummary(doc()).credit).toBe(38.56)
  run(command('refund',{paymentId:p.id,amount:38.56,reason:'full bank refund'}))
  expect(salesSummary(doc()).credit).toBe(0);expect(salesSummary(doc()).owed).toBe(0);expect(data.products[0].stock).toBe(5)
})
test('all source journals balance and receivables match the document summary',()=>{
  run(creation());const d=deliver(3.125),p=pay(d.id,30)
  run(command('return',{deliveryId:d.id,quantities:[.125],restock:true,reason:'return'}))
  run(command('allowance',{deliveryId:d.id,amounts:[.02],reason:'allowance'}))
  const entries=salesToJournalEntries(doc())
  for(const e of entries)expect(Math.round(e.lines.reduce((n,l)=>n+l.debit-l.credit,0)*100)).toBe(0)
  const ar=Math.round(entries.flatMap(e=>e.lines).filter(l=>l.account==='1141').reduce((n,l)=>n+l.debit-l.credit,0)*100)/100
  expect(ar).toBe(salesSummary(doc()).owed-salesSummary(doc()).credit);expect(p.amount).toBe(30)
})
test('an old receipt returns the current document after later actions and rejects changed-content replay',()=>{
  const r=creation(),first=run(r);deliver()
  const current=salesReceipt(r,first.receipt,data);expect(current.document.revision).toBe(2)
  expect(()=>salesReceipt({...r,document:{...r.document,note:'changed'}},first.receipt,data)).toThrow(/編號/)
})
test('stale versions, wrong epoch and unauthorized actors cannot mutate a sales document',()=>{
  run(creation());const before=structuredClone(data),r=command('close',{reason:'fixture'})
  expect(()=>planSales({...r,expectedRevision:0},data,owner)).toThrow(/版本/)
  expect(()=>planSales({...r,epoch:'restored-epoch'},data,owner)).toThrow(/還原/)
  expect(()=>planSales(r,data,{role:'staff'})).toThrow(/權限/)
  expect(data).toEqual(before)
})
test('corrupt documents, dropped receipts and cash mismatches fail a complete restore validation',()=>{
  run(creation());const d=deliver();pay(d.id,5,'cash')
  const corrupted=structuredClone(doc());corrupted.deliveries[0].amount+=.01
  expect(()=>validateSalesDocument(corrupted)).toThrow()
  expect(()=>validateSalesRecords(data.documents,data.operations.slice(1),data.cashLogs,data.storeId,data.products)).toThrow()
  expect(()=>validateSalesRecords(data.documents,data.operations,[{...data.cashLogs[0],amount:6}],data.storeId,data.products)).toThrow()
})
test('a partial order can close its undelivered remainder without erasing amounts still due',()=>{
  run(creation());deliver();run(command('close',{reason:'customer cancels the remainder'}))
  expect(salesSummary(doc()).status).toBe('closed');expect(salesSummary(doc()).owed).toBe(13.88)
  expect(()=>deliver()).toThrow(/結束/)
})
