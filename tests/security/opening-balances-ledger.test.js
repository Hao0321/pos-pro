import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import fixture from '../fixtures/opening-balances-source-v1.json'
import legacyNull from '../fixtures/opening-null-digest-v1.json'
import {projectOpeningBalanceSource,openingBalancesToJournalEntries} from '../../electron/openingBalanceSource.mjs'
import {appendOpeningBalanceContext,openingBalanceTimeline} from '../../electron/openingBalanceLedger.mjs'
import {planCustomerLedger,customerLedgerView,validateCustomerLedgerRecords,customerLedgerReceipt,assertCustomerLedgerResult} from '../../electron/customerLedger.mjs'
import {planSupplierLedger,supplierLedgerView,validateSupplierLedgerRecords,supplierLedgerReceipt,assertSupplierLedgerResult} from '../../electron/supplierLedger.mjs'
import {customerLedgerToJournalEntries} from '../../electron/customerJournal.mjs'
import {supplierLedgerToJournalEntries} from '../../electron/supplierJournal.mjs'
import {planSales,validateSalesRecords} from '../../electron/salesPlan.mjs'
import {salesToJournalEntries} from '../../electron/salesJournal.mjs'
import {planSupplierInventory} from '../../electron/supplierInventory.mjs'
import {procurementToJournalEntries} from '../../electron/procurementRules.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'

const actor={userId:'owner',username:'Owner',role:'owner'},time='2026-10-18T06:00:00.000Z',date='2026-10-18',clone=value=>structuredClone(value)
let data,sequence
const id=()=> 'opening-ledger-op-'+(++sequence)
function arView(){return customerLedgerView(data.customerEntries,data.openingBalanceContext,data.storeId)}
function apView(){return supplierLedgerView(data.supplierEntries,data.openingBalanceContext,data.storeId)}
function check(){
 data.salesOperations=data.operations;validateSalesRecords(data.documents,data.operations,data.cashLogs,data.storeId,data.products,[])
 data.customerLedger=validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data)
 data.supplierLedger=validateSupplierLedgerRecords(data.supplierEntries,data.supplierOperations,data)
}
function header(side,action,fields={}){const view=side==='receivable'?arView():apView();return {id:id(),kind:side==='receivable'?'customer-ledger':'supplier-ledger',storeId:data.storeId,epoch:data.epoch,time,date,action,expectedRevision:view.revision,...(view.openingDigest?{expectedOpeningDigest:view.openingDigest}:{}),...fields}}
function customer(action,fields={},options={}){
 const request=options.request||header('receivable',action,fields),plan=planCustomerLedger(request,data,options.actor||actor)
 data.customerEntries.push(plan.event);data.customerOperations.push(plan.receipt);if(plan.cashLog)data.cashLogs.push(plan.cashLog);check()
 return {request,...plan,result:assertCustomerLedgerResult(request,customerLedgerReceipt(request,plan.receipt,data))}
}
function supplier(action,fields={},options={}){
 const request=options.request||header('payable',action,fields),plan=planSupplierLedger(request,data,options.actor||actor)
 data.supplierEntries.push(plan.event);data.supplierOperations.push(plan.receipt);if(plan.cashLog)data.cashLogs.push(plan.cashLog);check()
 return {request,...plan,result:assertSupplierLedgerResult(request,supplierLedgerReceipt(request,plan.receipt,data))}
}
function cutover(sourceText=JSON.stringify(fixture),revisions={}){
 const p=projectOpeningBalanceSource(sourceText,date)
 data.openingBalanceContext=appendOpeningBalanceContext(data.openingBalanceContext,{storeId:data.storeId,sourceText,cutoffDate:date,partyMappings:p.parties.map(row=>({key:row.key,side:row.side,externalId:row.externalId,targetId:row.side==='receivable'?'customer':'supplier',targetName:row.name||'原客戶'})),customerRevision:data.customerEntries.length,supplierRevision:data.supplierEntries.length,actor,time,...revisions});check();return data.openingBalanceContext
}
function sale(action,fields){
 const request={id:id(),kind:'sales',storeId:data.storeId,epoch:data.epoch,time,date,action,expectedLedgerRevision:data.customerEntries.length,...fields},plan=planSales(request,data,actor)
 data.documents=[plan.document,...data.documents.filter(row=>row.id!==plan.document.id)];data.operations.push(plan.receipt);data.products=data.products.map(p=>plan.products.find(r=>r.id===p.id)||p);if(plan.cashLog)data.cashLogs.push(plan.cashLog);check();return plan.document
}
function delivered(){const document=sale('create',{document:{customer:{id:'customer',name:'原客戶'},date,items:[{productId:'p',qty:1,unitPrice:100,expectedProduct:{name:'商品',unit:'份',price:100}}],note:''}});return sale('deliver',{orderId:document.id,expectedRevision:document.revision,quantities:[1],dueDate:date,handedOver:true})}
function inventory(kind,fields){
 const request={id:id(),kind,time,supplierContext:{storeId:data.storeId,epoch:data.epoch,revision:data.supplierEntries.length},...fields},plan=planSupplierInventory(request,data,actor)
 if(plan.purchase)data.purchases=[plan.purchase,...data.purchases.filter(row=>row.id!==plan.purchase.id)]
 data.products=data.products.map(p=>plan.products.find(row=>row.id===p.id)||p);if(plan.cashLog)data.cashLogs.push(plan.cashLog)
 data.inventoryAudits.push({id:'stock-operation:'+request.id,action:'INVENTORY_OPERATION',detail:JSON.stringify(plan.receipt),...actor})
 if(plan.supplierRegistration){data.supplierEntries.push(plan.supplierRegistration.event);data.supplierOperations.push(plan.supplierRegistration.receipt)}
 check();return plan
}
function billed(){inventory('purchase-create',{purchase:{id:'new-purchase',supplierId:'supplier',date,items:[{productId:'p',name:'商品',unit:'份',qty:1,unitCost:300}],note:''}});for(const [kind,fields]of [['receive',{quantities:[1]}],['purchase-bill',{reference:'NEW-INVOICE',dueDate:date,quantities:[1]}]]){const po=data.purchases.find(p=>p.id==='new-purchase');inventory(kind,{purchaseId:po.id,expectedPurchase:canonicalSignature(po),...fields})}return data.purchases.find(p=>p.id==='new-purchase')}
const party=()=>({supplierId:'supplier',expectedSupplierName:'原供應商'})
const arItem=(amount,claim=arView().openingClaims[0])=>({documentId:claim.documentId,deliveryId:claim.deliveryId,expectedRevision:claim.revision,amount})
const apItem=(amount,claim=apView().openingClaims[0])=>({purchaseId:claim.purchaseId,invoiceId:claim.invoiceId,expectedRevision:claim.revision,amount})
const arCredit=()=>arView().receipts.find(row=>row.fundingKind==='opening-credit')
const apCredit=()=>apView().payments.find(row=>row.fundingKind==='opening-credit')
function journals(){const ctx=data.openingBalanceContext,source=ctx?[...openingBalanceTimeline(ctx,'receivable',data.customerEntries.length,data.storeId).at(data.customerEntries.length).claims,...openingBalanceTimeline(ctx,'payable',data.supplierEntries.length,data.storeId).at(data.supplierEntries.length).claims]:[];return [...source.flatMap(row=>openingBalancesToJournalEntries({id:row.batchId,cutoffDate:row.cutoffDate},[row])),...customerLedgerToJournalEntries(data.customerEntries),...supplierLedgerToJournalEntries(data.supplierEntries),...data.documents.flatMap(salesToJournalEntries),...data.purchases.flatMap(procurementToJournalEntries)]}
const account=code=>journals().flatMap(j=>j.lines).filter(row=>row.account===code).reduce((sum,row)=>sum+Math.round(row.debit*100)-Math.round(row.credit*100),0)
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(time));sequence=0
 data={storeId:'store',epoch:'epoch',now:Date.parse(time),ownerIds:['owner'],products:[{id:'p',name:'商品',stock:20,unit:'份',price:100,cost:40}],suppliers:[{id:'supplier',name:'原供應商',catalog:[]}],purchases:[],documents:[],operations:[],salesOperations:[],customerEntries:[],customerOperations:[],supplierEntries:[],supplierOperations:[],inventoryAudits:[],cashLogs:[],quotes:[],openShift:{id:'shift',status:'open'}}
 check();customer('customer-create',{customer:{id:'customer',name:'原客戶'}})
})
afterEach(()=>vi.useRealTimers())

it('carries invoices and source credits without creating any historical sale, purchase, payment, cash or stock movement',()=>{
 const products=clone(data.products);cutover()
 expect(data.documents).toEqual([]);expect(data.purchases).toEqual([]);expect(data.customerEntries).toHaveLength(1);expect(data.supplierEntries).toEqual([]);expect(data.cashLogs).toEqual([]);expect(data.products).toEqual(products)
 expect(arView().openingClaims[0]).toMatchObject({amount:600,owed:600,number:'AR-ORIGINAL-001',dueDate:'2026-10-31'});expect(apView().openingClaims[0]).toMatchObject({amount:900,owed:900})
 expect(arCredit()).toMatchObject({amount:100,available:100,method:'opening-credit',sourceNumber:'AR-CREDIT-001'});expect(apCredit()).toMatchObject({amount:200,available:200,method:'opening-credit'})
 expect(account('1141')).toBe(50000);expect(account('2101')).toBe(-70000);expect(account('1103')).toBe(0);expect(account('2192')).toBe(0);expect(account('1261')).toBe(0)
})
it('shares one actual customer receipt across original and new sales claims, then releases and refunds only its actual source',()=>{
 cutover();const newSale=delivered(),ordinary={documentId:newSale.id,deliveryId:newSale.deliveries[0].id,expectedRevision:newSale.revision,amount:50},cash=customer('receive',{customerId:'customer',amount:250,method:'bank',confirmed:true})
 const paid=customer('allocate',{customerId:'customer',receiptId:cash.event.id,items:[arItem(150),ordinary],reviewed:true})
 expect(arView().openingClaims[0].owed).toBe(450);expect(account('1141')).toBe(40000);expect(account('2192')).toBe(-5000);expect(account('1103')).toBe(25000)
 const source=customer('allocate',{customerId:'customer',receiptId:arCredit().id,items:[arItem(100)],reviewed:true})
 expect(source.event.fundingKind).toBe('opening-credit');expect(customerLedgerToJournalEntries([source.event])).toEqual([]);expect(account('1141')).toBe(40000);expect(arView().openingClaims[0].owed).toBe(350);expect(arCredit().available).toBe(0)
 customer('refund',{customerId:'customer',receiptId:cash.event.id,amount:20,reason:'實際退回未用款',confirmed:true})
 customer('unallocate',{customerId:'customer',allocationId:paid.event.id,items:[arItem(50)],reason:'解除原分配',reviewed:true})
 expect(account('1141')).toBe(45000);expect(account('2192')).toBe(-8000);expect(account('1103')).toBe(23000)
 customer('unallocate',{customerId:'customer',allocationId:source.event.id,items:[arItem(100)],reason:'解除原貸項分配',reviewed:true})
 const refund=customer('refund',{customerId:'customer',receiptId:arCredit().id,amount:40,method:'bank',reason:'實際退回原單貸項',confirmed:true})
 expect(account('1141')).toBe(49000);expect(account('1103')).toBe(19000);expect(account('2192')).toBe(-8000);expect(arCredit().available).toBe(60)
 expect(customerLedgerToJournalEntries([refund.event])[0].lines).toEqual([{account:'1141',debit:40,credit:0},{account:'1103',debit:0,credit:40}])
 customer('refund-reverse',{customerId:'customer',refundId:refund.event.id,reason:'重複登記更正',confirmed:true})
 expect(account('1141')).toBe(45000);expect(account('1103')).toBe(23000);expect(arCredit().available).toBe(100);expect(data.documents).toHaveLength(1);expect(data.documents[0].payments).toEqual([])
})
it('shares a supplier payment across original and new invoices while a source credit stays outside the advance account',()=>{
 cutover();const po=billed(),ordinary={purchaseId:po.id,invoiceId:po.procurement.bills[0].id,expectedRevision:po.procurement.revision,amount:100},payment=supplier('pay',{...party(),amount:400,method:'bank',confirmed:true})
 supplier('allocate',{...party(),paymentId:payment.event.id,items:[apItem(150),ordinary],reviewed:true})
 expect(account('2101')).toBe(-75000);expect(account('1261')).toBe(15000);expect(account('1103')).toBe(-40000)
 const credit=supplier('allocate',{...party(),paymentId:apCredit().id,items:[apItem(200)],reviewed:true})
 expect(supplierLedgerToJournalEntries([credit.event])).toEqual([]);expect(account('2101')).toBe(-75000);expect(apView().openingClaims[0].owed).toBe(550);expect(apCredit().available).toBe(0)
 supplier('refund',{...party(),paymentId:payment.event.id,amount:50,reason:'實際退回未用預付款',confirmed:true})
 supplier('unallocate',{...party(),allocationId:credit.event.id,items:[apItem(200)],reason:'解除原貸項分配',reviewed:true})
 const refund=supplier('refund',{...party(),paymentId:apCredit().id,amount:50,method:'bank',reason:'實際收到原單貸項退款',confirmed:true})
 expect(account('2101')).toBe(-80000);expect(account('1261')).toBe(10000);expect(account('1103')).toBe(-30000);expect(apCredit().available).toBe(150)
 expect(supplierLedgerToJournalEntries([refund.event])[0].lines).toEqual([{account:'1103',debit:50,credit:0},{account:'2101',debit:0,credit:50}])
 supplier('refund-reverse',{...party(),refundId:refund.event.id,reason:'退款登記更正',confirmed:true})
 expect(account('2101')).toBe(-75000);expect(account('1103')).toBe(-35000);expect(apCredit().available).toBe(200);expect(data.purchases).toHaveLength(1)
})
it.each(['receivable','payable'])('supports actual cash refunds and reverse direction on the current shift for %s credits',side=>{
 cutover();const ar=side==='receivable',apply=ar?customer:supplier,credit=ar?arCredit():apCredit(),fields=ar?{customerId:'customer',receiptId:credit.id}: {...party(),paymentId:credit.id}
 const refunded=apply('refund',{...fields,amount:25,method:'cash',shiftId:'shift',reason:'已實際收付',confirmed:true})
 expect(data.cashLogs).toHaveLength(1);expect(data.cashLogs[0]).toMatchObject({type:ar?'out':'in',amount:25,shiftId:'shift'});expect(account('1101')).toBe(ar?-2500:2500)
 apply('refund-reverse',{...(ar?{customerId:'customer'}:party()),refundId:refunded.event.id,shiftId:'shift',reason:'更正原退款',confirmed:true})
 expect(data.cashLogs).toHaveLength(2);expect(account('1101')).toBe(0);expect((ar?arCredit():apCredit()).available).toBe(ar?100:200)
})
it.each(['receivable','payable'])('requires actual money method, confirmation and shift and blocks treating a %s source credit as an ordinary payment reversal',side=>{
 cutover();const ar=side==='receivable',apply=ar?customer:supplier,credit=ar?arCredit():apCredit(),fields=ar?{customerId:'customer',receiptId:credit.id}: {...party(),paymentId:credit.id}
 for(const extra of [{},{method:'opening-credit',confirmed:true},{method:'bank',confirmed:false},{method:'cash',shiftId:'other',confirmed:true},{method:'bank',shiftId:'shift',confirmed:true}]){const before=clone(data);expect(()=>apply('refund',{...fields,amount:1,reason:'待核對',...extra})).toThrow();expect(data).toEqual(before)}
 expect(()=>apply(ar?'receipt-reverse':'pay-reverse',{...fields,reason:'不能偽造原銀行收付',confirmed:true})).toThrow('來源批次')
})
it.each(['receivable','payable'])('rejects another party, a stale original revision, over-allocation, missing review and stale source digest for %s',side=>{
 cutover();const ar=side==='receivable',apply=ar?customer:supplier,credit=ar?arCredit():apCredit(),row=ar?arItem(1):apItem(1),fields=ar?{customerId:'customer',receiptId:credit.id}: {...party(),paymentId:credit.id}
 for(const change of [r=>delete r.expectedOpeningDigest,r=>r.expectedOpeningDigest='0'.repeat(64),r=>r.reviewed=false,r=>r.items[0].expectedRevision=2,r=>r.items[0].amount=1001,r=>r.items.push({...r.items[0]})]){const request=header(side,'allocate',{...fields,items:[{...row}],reviewed:true});change(request);const before=clone(data);expect(()=>apply('allocate',{}, {request})).toThrow();expect(data).toEqual(before)}
 if(ar){customer('customer-create',{customer:{id:'other',name:'原客戶'}});const request=header(side,'allocate',{...fields,customerId:'other',items:[row],reviewed:true});expect(()=>customer('allocate',{}, {request})).toThrow('這位客戶')}
 else{data.suppliers.push({id:'other',name:'原供應商',catalog:[]});expect(()=>supplier('allocate',{...fields,supplierId:'other',items:[row],reviewed:true})).toThrow('這位供應商')}
})
it('replays real pre-cutover customer and supplier history without making a later source credit available earlier',()=>{
 customer('receive',{customerId:'customer',amount:50,method:'bank',confirmed:true});supplier('pay',{...party(),amount:30,method:'bank',confirmed:true});cutover()
 expect(arView().receipts.map(row=>row.available)).toEqual([50,100]);expect(apView().payments.map(row=>row.available)).toEqual([30,200]);check()
 const old=clone(data.openingBalanceContext);delete data.openingBalanceContext;expect(()=>cutover(JSON.stringify(fixture),{customerRevision:1,supplierRevision:1})).toThrow('原單帳款已更新')
 // Rebuilding a valid hash is not permission to move an opening boundary
 // backwards: the earlier original request did not review that source.
 data.openingBalanceContext=old;delete data.openingBalanceContext
 expect(()=>cutover(JSON.stringify(fixture),{customerRevision:2,supplierRevision:0})).toThrow();data.openingBalanceContext=old;check()
})
it('binds old operations to the then-active source, accepts a later source at a new boundary, and rejects a stale draft',()=>{
 cutover();const received=customer('receive',{customerId:'customer',amount:25,method:'bank',confirmed:true}),oldDigest=arView().openingDigest
 const source=clone(fixture);source.id='later-original-credit';source.tables=source.tables.filter(t=>t.entity==='customers'||t.entity==='opening-receivables');source.tables[1].rows=[{externalId:'CR-LATER',values:['C0001','LATER-CREDIT','credit','2026-10-18','','40','TWD','40','0']}];cutover(JSON.stringify(source))
 expect(arView().receipts.filter(r=>r.fundingKind==='opening-credit').map(r=>r.available)).toEqual([100,40]);expect(arView().openingDigest).not.toBe(oldDigest)
 const request=header('receivable','allocate',{customerId:'customer',receiptId:received.event.id,items:[arItem(1)],reviewed:true,expectedOpeningDigest:oldDigest});expect(()=>customer('allocate',{}, {request})).toThrow('原單帳款已更新')
 expect(assertCustomerLedgerResult(received.request,customerLedgerReceipt(received.request,received.receipt,data)).event).toEqual(received.event)
})
it.each(['receivable','payable'])('does not acknowledge changed source proofs or changed displayed balances for %s',side=>{
 cutover();const ar=side==='receivable',apply=ar?customer:supplier,credit=ar?arCredit():apCredit(),fields=ar?{customerId:'customer',receiptId:credit.id}: {...party(),paymentId:credit.id},written=apply('allocate',{...fields,items:[ar?arItem(1):apItem(1)],reviewed:true}),assert=ar?assertCustomerLedgerResult:assertSupplierLedgerResult
 for(const change of [r=>r.openingBalanceContext.batches[0].sourceText+=' ',r=>delete r.openingBalanceContext,r=>(ar?r.customerLedger:r.supplierLedger).openingClaims[0].owed+=1,r=>(ar?r.customerLedger.receipts:r.supplierLedger.payments).find(p=>p.fundingKind==='opening-credit').available+=1]){const result=clone(written.result);change(result);expect(()=>assert(written.request,result)).toThrow()}
})
it('rejects an opening context hidden in a public money request instead of accepting the caller as the source authority',()=>{
 cutover();const context=data.openingBalanceContext;delete data.openingBalanceContext
 const request=header('receivable','receive',{customerId:'customer',amount:1,method:'bank',confirmed:true,openingBalanceContext:context});expect(()=>customer('receive',{}, {request})).toThrow('不支援')
 const ap=header('payable','pay',{...party(),amount:1,method:'bank',confirmed:true,openingBalanceContext:context});expect(()=>supplier('pay',{}, {request:ap})).toThrow('不支援')
})
it.each([
 ['receivable','receive',{customerId:'customer',amount:1,method:'bank',confirmed:true}],
 ['receivable','customer-create',{customer:{id:'another',name:'另一個客戶'}}],
 ['receivable','customer-update',{customerId:'customer',customer:{id:'customer',name:'原客戶'}}],
 ['payable','pay',{supplierId:'supplier',expectedSupplierName:'原供應商',amount:1,method:'bank',confirmed:true}],
 ['payable','policy-set',{mode:'simple',reason:'Owner reviewed',reviewed:true}],
])('does not persist an unavailable null source digest on a new %s %s command', (side,action,fields)=>{
 const request=header(side,action,{...fields,expectedOpeningDigest:null}),before=clone(data)
 expect(()=>(side==='receivable'?customer:supplier)(action,{}, {request})).toThrow('原單帳款已更新');expect(data).toEqual(before)
})
it.each(['receivable','payable'])('preserves the exact genuine preceding nullable %s requests and original receipts during historical readback',side=>{
 expect(legacyNull.provenance.generatedByActualNativeApi).toBe(true);expect(legacyNull.provenance.producerHead).toBe('4cd440092ba155a1af75e96850f00891f2a029c1')
 const ar=side==='receivable',d=clone(legacyNull.data),view=(ar?validateCustomerLedgerRecords:validateSupplierLedgerRecords)(d[ar?'customerEntries':'supplierEntries'],d[ar?'customerOperations':'supplierOperations'],d),request=legacyNull.requests[ar?'receive':'pay'],receipt=d[ar?'customerOperations':'supplierOperations'].find(row=>row.id===request.id),result=(ar?customerLedgerReceipt:supplierLedgerReceipt)(request,receipt,d)
 expect((ar?view.receipts:view.payments)[0].available).toBe(ar?5:7);expect(result.event.input).toEqual(request);expect(result.event.input.expectedOpeningDigest).toBe(null);expect((ar?assertCustomerLedgerResult:assertSupplierLedgerResult)(request,result)).toEqual(result)
})
it.each(['receivable','payable'])('does not treat a historical null digest as permission to backdate an active %s source',side=>{
 const d=clone(legacyNull.data),parsed=projectOpeningBalanceSource(JSON.stringify(fixture),date)
 d.openingBalanceContext=appendOpeningBalanceContext(undefined,{storeId:d.storeId,sourceText:JSON.stringify(fixture),cutoffDate:date,partyMappings:parsed.parties.map(p=>({key:p.key,side:p.side,externalId:p.externalId,targetId:p.side==='receivable'?'customer':'supplier',targetName:p.side==='receivable'?'Synthetic Customer':'Synthetic Supplier'})),customerRevision:1,supplierRevision:0,actor:legacyNull.owner,time})
 expect(()=>(side==='receivable'?validateCustomerLedgerRecords:validateSupplierLedgerRecords)(d[side==='receivable'?'customerEntries':'supplierEntries'],d[side==='receivable'?'customerOperations':'supplierOperations'],d)).toThrow('原單帳款已更新')
})
