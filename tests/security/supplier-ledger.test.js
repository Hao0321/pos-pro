import {beforeEach,test,expect} from 'vitest'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {planInventory,INVENTORY_ACTION,INVENTORY_PREFIX} from '../../electron/inventoryOperations.mjs'
import {procurementSummary} from '../../electron/procurementRules.mjs'
import {planSupplierInventory,supplierInventoryReceipt} from '../../electron/supplierInventory.mjs'
import {planSupplierLedger,supplierLedgerView,validateSupplierLedgerRecords,supplierLedgerReceipt,assertSupplierLedgerResult} from '../../electron/supplierLedger.mjs'

const maker={userId:'maker',username:'Fixture Maker',role:'owner'},checker={userId:'checker',username:'Fixture Checker',role:'owner'}
const time='2026-10-16T02:00:00Z',date='2026-10-16',clone=value=>structuredClone(value)
let data,sequence
beforeEach(()=>{sequence=0;data={storeId:'store',epoch:'restore-epoch',now:Date.parse(time),ownerIds:['maker','checker'],products:[{id:'rice',name:'Rice',stock:0,cost:100,price:150}],suppliers:[{id:'supplier',name:'Fixture Supplier',catalog:[]},{id:'other',name:'Other Supplier',catalog:[]}],purchases:[],supplierEntries:[],supplierOperations:[],inventoryAudits:[],cashLogs:[],openShift:{id:'shift-1',status:'open'}}})
const id=()=> 'supplier-op-'+(++sequence)
const context=()=>({storeId:data.storeId,epoch:data.epoch,revision:data.supplierEntries.length})
const validate=()=>validateSupplierLedgerRecords(data.supplierEntries,data.supplierOperations,data)
function inventory(kind,fields={},actor=maker,{modern=true,unsafe=false}={}){
 const request={id:id(),kind,time,...(modern?{supplierContext:context()}:{}),...fields},plan=(unsafe?planInventory:planSupplierInventory)(request,data,actor)
 if(plan.purchase){const index=data.purchases.findIndex(row=>row.id===plan.purchase.id);if(index<0)data.purchases.push(plan.purchase);else data.purchases[index]=plan.purchase}
 for(const product of plan.products){const index=data.products.findIndex(row=>row.id===product.id);if(index<0)data.products.push(product);else data.products[index]=product}
 if(plan.cashLog)data.cashLogs.push(plan.cashLog)
 data.inventoryAudits.push({id:INVENTORY_PREFIX+request.id,action:INVENTORY_ACTION,detail:JSON.stringify(plan.receipt),...actor})
 if(plan.supplierRegistration){data.supplierEntries.push(plan.supplierRegistration.event);data.supplierOperations.push(plan.supplierRegistration.receipt)}
 return {request,plan,purchase:plan.purchase}
}
function purchase(name='po',supplierId='supplier',{modern=true}={}){
 return inventory('purchase-create',{purchase:{id:name,supplierId,date,items:[{productId:'rice',name:'Rice',unit:'袋',qty:2,unitCost:100}],note:''}},maker,{modern}).purchase
}
function update(kind,purchaseId='po',fields={},options={}){const po=data.purchases.find(row=>row.id===purchaseId);return inventory(kind,{purchaseId,expectedPurchase:canonicalSignature(po),...fields},maker,options)}
function billed(name='po',supplierId='supplier',options={}){purchase(name,supplierId,options);update('receive',name,{quantities:[2]},options);return update('purchase-bill',name,{reference:'INV-'+name,dueDate:date,quantities:[2]},options).plan.receipt.id}
function apply(action,fields={},actor=maker){
 const request={id:id(),kind:'supplier-ledger',time,date,storeId:data.storeId,epoch:data.epoch,expectedRevision:data.supplierEntries.length,action,...fields},plan=planSupplierLedger(request,data,actor)
 data.supplierEntries.push(plan.event);data.supplierOperations.push(plan.receipt);if(plan.cashLog)data.cashLogs.push(plan.cashLog)
 return {request,...plan}
}
const party=()=>({supplierId:'supplier',expectedSupplierName:data.suppliers[0].name})
const pay=(amount=500,fields={})=>apply('pay',{...party(),amount,method:'bank',confirmed:true,...fields})
const mode=value=>apply('policy-set',{mode:value,reviewed:true,reason:'Owner reviewed control'})
const item=(purchaseId,invoiceId,amount)=>({purchaseId,invoiceId,expectedRevision:data.purchases.find(po=>po.id===purchaseId).procurement.revision,amount})
const allocate=(paymentId,items)=>apply('allocate',{...party(),paymentId,items,reviewed:true})

test('actual bank prepayment is possible before any order, goods or invoice exists and original-ID readback is exact',()=>{
 const original=pay();expect(data.purchases).toEqual([]);expect(data.products[0].stock).toBe(0);expect(data.cashLogs).toEqual([])
 expect(validate().payments[0]).toMatchObject({id:original.event.id,available:500,allocated:0,refunded:0})
 const response=supplierLedgerReceipt(original.request,original.receipt,data);expect(assertSupplierLedgerResult(original.request,response)).toEqual(response)
 data.epoch='later-restore';expect(supplierLedgerReceipt(original.request,original.receipt,data).event).toEqual(original.event)
 expect(()=>supplierLedgerReceipt({...original.request,amount:501},original.receipt,data)).toThrow('內容不同')
})
test('one original prepayment covers two invoices and leaves no extra cash or inventory movement',()=>{
 const original=pay(350),a=billed('po-a'),b=billed('po-b'),cashBefore=clone(data.cashLogs),stock=data.products[0].stock
 allocate(original.event.id,[item('po-a',a,200),item('po-b',b,150)])
 expect(validate().payments[0]).toMatchObject({available:0,allocated:350});expect(data.cashLogs).toEqual(cashBefore);expect(data.products[0].stock).toBe(stock)
 expect(procurementSummary(data.purchases[0],date,data.supplierEntries)).toMatchObject({owed:0,paid:200,prepaid:200})
 expect(procurementSummary(data.purchases[1],date,data.supplierEntries).owed).toBe(50)
})
test('ordinary direct payment and supplier allocation consume the same invoice balance in either order',()=>{
 const payment=pay(200),invoice=billed();update('purchase-pay','po',{invoiceId:invoice,amount:50,method:'bank'})
 allocate(payment.event.id,[item('po',invoice,150)]);validate()
 expect(()=>update('purchase-pay','po',{invoiceId:invoice,amount:.01,method:'bank'})).toThrow('未付餘額')
 expect(()=>allocate(payment.event.id,[item('po',invoice,.01)])).toThrow('未付餘額')
 expect(procurementSummary(data.purchases[0],date,data.supplierEntries).paid).toBe(200)
})
test('historical verification detects a legacy payment engine bypass that spends the same bill twice',()=>{
 const payment=pay(200),invoice=billed();allocate(payment.event.id,[item('po',invoice,200)])
 // The old planner cannot see supplier credits. This is a positive control for
 // the evaluator: its successful write must fail the new book verifier.
 const unsafe=update('purchase-pay','po',{invoiceId:invoice,amount:1,method:'bank'},{unsafe:true});expect(unsafe.plan.purchase.procurement.payments).toHaveLength(1)
 expect(()=>validate()).toThrow('未付餘額')
})
test('partial release restores source funds and bill debt, then an actual refund and its correction preserve the original',()=>{
 const payment=pay(300),invoice=billed(),allocation=allocate(payment.event.id,[item('po',invoice,180)])
 apply('unallocate',{...party(),allocationId:allocation.event.id,items:[item('po',invoice,30)],reason:'Wrong amount',reviewed:true});validate()
 const refund=apply('refund',{...party(),paymentId:payment.event.id,amount:100,reason:'Unused advance returned',confirmed:true})
 expect(validate().payments[0]).toMatchObject({allocated:150,refunded:100,available:50});expect(procurementSummary(data.purchases[0],date,data.supplierEntries).owed).toBe(50)
 apply('refund-reverse',{...party(),refundId:refund.event.id,reason:'Recorded twice',confirmed:true});expect(validate().payments[0]).toMatchObject({available:150,refunded:0})
 expect(()=>apply('refund-reverse',{...party(),refundId:refund.event.id,reason:'Again',confirmed:true})).toThrow('可更正')
})
test('source refund cannot consume allocated money, and a release cannot exceed its own original invoice rows',()=>{
 const payment=pay(200),invoice=billed(),allocation=allocate(payment.event.id,[item('po',invoice,150)])
 expect(()=>apply('refund',{...party(),paymentId:payment.event.id,amount:51,reason:'Too much',confirmed:true})).toThrow('可退餘額')
 expect(()=>apply('unallocate',{...party(),allocationId:allocation.event.id,items:[item('po',invoice,151)],reason:'Too much',reviewed:true})).toThrow('尚可解除')
 expect(()=>apply('pay-reverse',{...party(),paymentId:payment.event.id,reason:'Still allocated',confirmed:true})).toThrow('解除抵付')
 validate()
})
test('returning goods does not let an invoice refund spend external advance credit',()=>{
 const payment=pay(200),invoice=billed(),allocation=allocate(payment.event.id,[item('po',invoice,200)])
 update('purchase-return','po',{invoiceId:invoice,quantities:[1],reason:'One damaged bag'});expect(procurementSummary(data.purchases[0],date,data.supplierEntries).credit).toBe(100)
 expect(()=>update('purchase-refund','po',{invoiceId:invoice,amount:100,method:'bank'})).toThrow('尚待退回')
 apply('unallocate',{...party(),allocationId:allocation.event.id,items:[item('po',invoice,100)],reason:'Returned goods',reviewed:true});apply('refund',{...party(),paymentId:payment.event.id,amount:100,reason:'Supplier returned unused advance',confirmed:true})
 expect(validate().payments[0]).toMatchObject({allocated:100,refunded:100,available:0});expect(procurementSummary(data.purchases[0],date,data.supplierEntries).credit).toBe(0)
})
test('a fully unused original advance may be reversed once; its source can never be reused',()=>{
 const payment=pay(200);apply('pay-reverse',{...party(),paymentId:payment.event.id,reason:'Wrong verified payment',confirmed:true})
 expect(validate().payments[0]).toMatchObject({available:0,reversed:true})
 expect(()=>apply('pay-reverse',{...party(),paymentId:payment.event.id,reason:'Duplicate reversal',confirmed:true})).toThrow('原付款')
})
test('cash pay/refund/corrections use the frozen open shift and exact one-time cash rows',()=>{
 const payment=pay(100,{method:'cash',shiftId:'shift-1'}),refund=apply('refund',{...party(),paymentId:payment.event.id,amount:40,reason:'Partial return',shiftId:'shift-1',confirmed:true})
 apply('refund-reverse',{...party(),refundId:refund.event.id,reason:'Wrong return',shiftId:'shift-1',confirmed:true});apply('pay-reverse',{...party(),paymentId:payment.event.id,reason:'Wrong actual payment',shiftId:'shift-1',confirmed:true})
 expect(data.cashLogs.map(row=>[row.type,row.amount])).toEqual([['out',100],['in',40],['out',40],['in',100]]);validate()
 data.cashLogs[0].amount=101;expect(()=>validate()).toThrow('現金流水')
})
test.each(['no-confirm','wrong-shift','bank-shift','future-day','stale-clock','foreign-store','old-epoch','staff','actor-in-body'])('rejected %s input never creates a supplier payment plan',variant=>{
 const request={id:'new-pay',kind:'supplier-ledger',action:'pay',time,date,storeId:data.storeId,epoch:data.epoch,expectedRevision:0,...party(),amount:100,method:'bank',confirmed:true}
 const before=canonicalSignature(data);let actor=maker
 if(variant==='no-confirm')request.confirmed=false
 if(variant==='wrong-shift')Object.assign(request,{method:'cash',shiftId:'closed-shift'})
 if(variant==='bank-shift')request.shiftId='shift-1'
 if(variant==='future-day')request.date='2026-10-17'
 if(variant==='stale-clock')request.time='2026-10-16T01:00:00Z'
 if(variant==='foreign-store')request.storeId='other-store'
 if(variant==='old-epoch')request.epoch='old-epoch'
 if(variant==='staff')actor={...maker,role:'staff'}
 if(variant==='actor-in-body')request.actor=checker
 expect(()=>planSupplierLedger(request,data,actor)).toThrow();expect(canonicalSignature(data)).toBe(before)
})
test('different-account purchase approval is frozen at creation and switching to simple never unlocks it',()=>{
 mode('dual-owner');purchase();expect(validate().purchaseApprovals[0]).toMatchObject({requiredApproval:true,status:'pending'})
 expect(()=>update('receive','po',{quantities:[2]})).toThrow('未核准');mode('simple')
 expect(()=>update('receive','po',{quantities:[2]})).toThrow('未核准')
 expect(()=>apply('purchase-approve',{purchaseId:'po',expectedPurchaseRevision:1,reviewed:true})).toThrow('自己的提案')
 apply('purchase-approve',{purchaseId:'po',expectedPurchaseRevision:1,reviewed:true},checker);update('receive','po',{quantities:[2]});expect(validate().purchaseApprovals[0].approvedBy).toEqual(checker)
})
test('a legacy purchase can be explicitly enrolled but cannot fabricate prior approval or omit future ledger context',()=>{
 const invoice=billed('po','supplier',{modern:false});expect(data.supplierEntries).toHaveLength(0);mode('dual-owner')
 expect(()=>update('purchase-pay','po',{invoiceId:invoice,amount:1,method:'bank'})).toThrow('先納入核准')
 apply('purchase-enroll',{purchaseId:'po',expectedPurchaseRevision:3,reviewed:true});apply('purchase-approve',{purchaseId:'po',expectedPurchaseRevision:3,reviewed:true},checker)
 update('purchase-pay','po',{invoiceId:invoice,amount:20,method:'bank'});expect(validate().purchaseApprovals[0]).toMatchObject({adopted:true,originRevision:3,status:'approved'})
 expect(()=>update('purchase-pay','po',{invoiceId:invoice,amount:1,method:'bank'},{modern:false})).toThrow('已升級')
})
test('a dual-account prepayment proposal moves no money and its approved amount can be paid only once',()=>{
 mode('dual-owner');const proposal=apply('payment-propose',{...party(),amount:100,method:'bank',reviewed:true,note:'Deposit for future rice'})
 expect(data.cashLogs).toEqual([]);expect(validate().payments).toEqual([]);expect(()=>pay(100,{proposalId:proposal.event.id})).toThrow('尚未核准')
 apply('payment-approve',{proposalId:proposal.event.id,reviewed:true},checker);const payment=pay(100,{proposalId:proposal.event.id})
 apply('pay-reverse',{...party(),paymentId:payment.event.id,reason:'Wrong actual payment',confirmed:true});mode('simple')
 expect(validate().paymentApprovals[0]).toMatchObject({status:'paid',paymentId:payment.event.id});expect(()=>pay(100,{proposalId:proposal.event.id})).toThrow('已使用')
})
test('supplier renaming preserves recorded identity and invalidates an unused proposal until it is resubmitted',()=>{
 const payment=pay(100),proposal=apply('payment-propose',{...party(),amount:20,method:'bank',reviewed:true,note:'Before rename'})
 data.suppliers[0].name='Renamed Fixture Supplier';expect(validate().payments[0].supplierName).toBe('Fixture Supplier')
 expect(()=>apply('payment-approve',{proposalId:proposal.event.id,reviewed:true},checker)).toThrow('名稱已更新')
 const result=supplierLedgerReceipt(payment.request,payment.receipt,data);expect(assertSupplierLedgerResult(payment.request,result)).toEqual(result)
})
test('same-name vendors are not interchangeable and an old purchase revision cannot authorize an allocation',()=>{
 const payment=pay(300),invoice=billed(),foreign=billed('other-po','other');data.suppliers[1].name=data.suppliers[0].name
 expect(()=>allocate(payment.event.id,[item('other-po',foreign,1)])).toThrow('同一供應商')
 expect(()=>allocate(payment.event.id,[{...item('po',invoice,1),expectedRevision:2}])).toThrow('已更新')
 expect(()=>allocate(payment.event.id,[item('po',invoice,1),item('po',invoice,1)])).toThrow('不可重複');validate()
})
test('orphaned controlled purchases, changed before-images, and dropped cash receipts are all rejected',()=>{
 const payment=pay(200,{method:'cash',shiftId:'shift-1'}),invoice=billed();allocate(payment.event.id,[item('po',invoice,100)]);validate()
 const original=clone(data);data.supplierEntries=data.supplierEntries.filter(event=>event.action!=='purchase-register');data.supplierOperations=data.supplierOperations.filter(row=>!row.internal);expect(()=>validate()).toThrow();data=clone(original)
 const row=data.inventoryAudits.find(row=>JSON.parse(JSON.parse(row.detail).signature).kind==='purchase-bill'),receipt=JSON.parse(row.detail),request=JSON.parse(receipt.signature);request.expectedPurchase=canonicalSignature({...JSON.parse(request.expectedPurchase),note:'Changed after approval'});receipt.signature=canonicalSignature(request);row.detail=JSON.stringify(receipt)
 expect(()=>validate()).toThrow('條件不一致');data=clone(original);data.cashLogs.push({id:'supplier-cash:orphan',amount:1});expect(()=>validate()).toThrow('缺少原款項')
})
test.each(['amount','cash','view','actor','event-source','core-history'])('reply verification rejects forged %s while preserving the original request for recovery',variant=>{
 const payment=pay(200,{method:'cash',shiftId:'shift-1'}),invoice=billed();allocate(payment.event.id,[item('po',invoice,100)])
 const response=supplierLedgerReceipt(payment.request,payment.receipt,data);assertSupplierLedgerResult(payment.request,response);const broken=clone(response)
 if(variant==='amount')broken.event.amount=201
 if(variant==='cash')broken.cashLog.shiftId='another-shift'
 if(variant==='view')broken.supplierLedger.payments[0].available=999
 if(variant==='actor')broken.supplierLedger.entries[0].actor.role='staff'
 if(variant==='event-source')broken.supplierLedger.entries.at(-1).paymentId='other-source'
 if(variant==='core-history')broken.inventoryAudits.pop()
 expect(()=>assertSupplierLedgerResult(payment.request,broken)).toThrow();expect(payment.request.amount).toBe(200)
})
test('a current inventory replay returns original registration and current ledger even after restoring to another epoch',()=>{
 const created=inventory('purchase-create',{purchase:{id:'po',supplierId:'supplier',date,items:[{productId:'rice',name:'Rice',unit:'袋',qty:2,unitCost:100}],note:''}});pay(100);data.epoch='restored-epoch'
 const result=supplierInventoryReceipt(created.request,created.plan.receipt,data);expect(result.supplierRegistration.id).toBe(created.request.id);expect(result.supplierLedger.revision).toBe(2);expect(data.purchases).toHaveLength(1)
})
test('more than fifty original supplier operations remain fully verifiable and do not lose source balances',()=>{
 for(let i=0;i<60;i++)pay(.01);const view=validate();expect(view.entries).toHaveLength(60);expect(view.balances).toEqual([{supplierId:'supplier',available:.6}]);expect(supplierLedgerView(data.supplierEntries)).toEqual(view)
})
