import {test,expect} from 'vitest'
import {businessCashFlows} from '../../src/utils/businessReports'
import {planInventory} from '../../electron/inventoryOperations.mjs'
import {planSupplierLedger} from '../../electron/supplierLedger.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {salesDate} from '../../electron/salesRules.mjs'
import {supplierLedgerToJournalEntries} from '../../electron/supplierJournal.mjs'

test('actual cash-flow report counts supplier money once and excludes invoices, allocations, proposals and approvals',()=>{
 const owner={role:'owner',userId:'owner',username:'Fixture Owner'},time=new Date().toISOString(),date=salesDate(time),data={storeId:'store',epoch:'epoch',supplierEntries:[],supplierOperations:[],ownerIds:['owner','other'],suppliers:[{id:'supplier',name:'Fixture Supplier'}],products:[{id:'p',name:'Rice',stock:0,cost:100,price:150}],purchases:[],cashLogs:[],openShift:{id:'shift',status:'open'}},party={supplierId:'supplier',expectedSupplierName:'Fixture Supplier'}
 let index=0
 function core(kind,fields){const request={id:'report-core-'+(++index),kind,time,...fields},plan=planInventory(request,{...data,supplierCredits:data.supplierEntries},owner);if(plan.purchase)data.purchases=[plan.purchase,...data.purchases.filter(po=>po.id!==plan.purchase.id)];if(plan.cashLog)data.cashLogs.push(plan.cashLog);data.products=data.products.map(p=>plan.products.find(row=>row.id===p.id)||p);return plan}
 function ledger(action,fields){const request={id:'report-supplier-'+(++index),kind:'supplier-ledger',action,time,date,storeId:data.storeId,epoch:data.epoch,expectedRevision:data.supplierEntries.length,...fields},plan=planSupplierLedger(request,data,owner);data.supplierEntries.push(plan.event);data.supplierOperations.push(plan.receipt);if(plan.cashLog)data.cashLogs.push(plan.cashLog);return plan.event}
 const paid=ledger('pay',{...party,amount:200,method:'bank',confirmed:true})
 let purchase=core('purchase-create',{purchase:{id:'po',supplierId:'supplier',date,items:[{productId:'p',name:'Rice',qty:2,unitCost:100}]}}).purchase
 purchase=core('receive',{purchaseId:purchase.id,expectedPurchase:canonicalSignature(purchase),quantities:[2]}).purchase
 purchase=core('purchase-bill',{purchaseId:purchase.id,expectedPurchase:canonicalSignature(purchase),reference:'INV',dueDate:date,quantities:[2]}).purchase
 const bill=purchase.procurement.bills[0],allocated=ledger('allocate',{...party,paymentId:paid.id,items:[{purchaseId:purchase.id,invoiceId:bill.id,expectedRevision:purchase.procurement.revision,amount:150}],reviewed:true})
 const returned=ledger('refund',{...party,paymentId:paid.id,amount:20,reason:'Returned unused advance',confirmed:true})
 purchase=core('purchase-pay',{purchaseId:purchase.id,expectedPurchase:canonicalSignature(purchase),invoiceId:bill.id,amount:40,method:'cash',shiftId:'shift'}).purchase
 const direct=purchase.procurement.payments[0];purchase=core('purchase-reverse',{purchaseId:purchase.id,expectedPurchase:canonicalSignature(purchase),paymentId:direct.id,reason:'Correct payment',shiftId:'shift'}).purchase
 ledger('payment-propose',{...party,amount:500,method:'bank',reviewed:true,note:'Only a proposal'})
 const flows=businessCashFlows([],[],data.purchases,data.supplierEntries)
 expect(flows.filter(row=>row.method==='bank').reduce((sum,row)=>sum+row.amount,0)).toBe(-180);expect(flows.filter(row=>row.method==='cash').reduce((sum,row)=>sum+row.amount,0)).toBe(0);expect(flows).toHaveLength(4);expect(flows.map(row=>row.id)).not.toContain(allocated.id)
 ledger('refund-reverse',{...party,refundId:returned.id,reason:'Correction of recorded refund',confirmed:true});expect(businessCashFlows([],[],data.purchases,data.supplierEntries).reduce((sum,row)=>sum+row.amount,0)).toBe(-200)
 const entries=supplierLedgerToJournalEntries(data.supplierEntries);expect(entries.flatMap(row=>row.lines).reduce((sum,row)=>sum+Math.round(row.debit*100)-Math.round(row.credit*100),0)).toBe(0);expect(entries.some(row=>row.lines.some(line=>line.account==='4101'))).toBe(false)
})
