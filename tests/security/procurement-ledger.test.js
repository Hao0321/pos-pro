import {expect,test} from 'vitest'
import {planInventory} from '../../electron/inventoryOperations.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {procurementSummary,procurementToJournalEntries,validateProcurementRecords} from '../../electron/procurementRules.mjs'

const time='2026-10-15T04:00:00Z',actor={role:'owner',username:'fixture'}
function fixture(qty=3.125,cost=12.34){
  const data={products:[{id:'p',stock:0,cost:1}],suppliers:[{id:'s',name:'fixture'}],purchases:[],cashLogs:[],openShift:{id:'shift',status:'open'}}
  let seq=0
  function run(kind,input={}){const current=data.purchases[0],r={id:'event-'+(++seq),kind,time,...(current?{purchaseId:current.id,expectedPurchase:canonicalSignature(current)}:{}),...input},plan=planInventory(r,data,actor);if(plan.purchase)data.purchases=[plan.purchase];data.products=data.products.map(p=>plan.products.find(n=>n.id===p.id)||p);if(plan.cashLog)data.cashLogs.push(plan.cashLog);return plan.purchase}
  run('purchase-create',{purchase:{id:'po',supplierId:'s',date:'2026-10-15',items:[{productId:'p',name:'fixture',qty,unitCost:cost}]}})
  return {data,run,po:()=>data.purchases[0]}
}
test('cent allocation remains identical for differently split fractional receipts and bills',()=>{
  for(const parts of [[3.125],[.001,.124,1,2],[1.125,2],[.005,.005,3.115]]){
    const f=fixture();parts.forEach(q=>f.run('receive',{quantities:[q]}));parts.forEach((q,i)=>f.run('purchase-bill',{quantities:[q],reference:'ref-'+i,dueDate:'2026-10-20'}))
    expect(procurementSummary(f.po()).received).toBe(38.56);expect(procurementSummary(f.po()).billed).toBe(38.56);expect(procurementSummary(f.po()).unbilled).toBe(0)
    for(const entry of procurementToJournalEntries(f.po()))expect(entry.lines.reduce((n,l)=>n+Math.round(l.debit*100)-Math.round(l.credit*100),0)).toBe(0)
  }
})
test('tiny and free quantities retain documents without inventing a cash movement',()=>{const f=fixture(.003,.01);f.run('receive',{quantities:[.001]});f.run('receive',{quantities:[.002]});f.run('purchase-bill',{quantities:[.003],reference:'free-rounding',dueDate:'2026-10-20'});expect(f.po().procurement.receipts).toHaveLength(2);expect(procurementSummary(f.po()).owed).toBe(0);expect(procurementToJournalEntries(f.po())).toHaveLength(0);expect(f.data.cashLogs).toHaveLength(0)})
test('supplier bill aging uses its due date and net payments including reversals',()=>{const f=fixture();f.run('receive',{quantities:[3.125]});const bill=f.run('purchase-bill',{quantities:[3.125],reference:'aging',dueDate:'2026-10-20'}).procurement.bills[0];expect(procurementSummary(f.po(),'2026-10-20').overdue).toBe(0);expect(procurementSummary(f.po(),'2026-10-21').overdue).toBe(38.56);const payment=f.run('purchase-pay',{invoiceId:bill.id,amount:10,method:'bank'}).procurement.payments[0];expect(procurementSummary(f.po(),'2026-10-21').overdue).toBe(28.56);f.run('purchase-reverse',{paymentId:payment.id,reason:'fixture'});expect(procurementSummary(f.po(),'2026-10-21').overdue).toBe(38.56)})
test('product cost edits cannot rewrite historical procurement journal values',()=>{const f=fixture();f.run('receive',{quantities:[3.125]});const before=procurementToJournalEntries(f.po());f.data.products[0].cost=999;expect(procurementToJournalEntries(f.po())).toEqual(before);expect(before[0].lines[0].debit).toBe(38.56)})
test('backup validation detects changed totals, line quantities, document amounts and missing cash movements',()=>{const f=fixture();f.run('receive',{quantities:[3.125]});const bill=f.run('purchase-bill',{quantities:[3.125],reference:'backup',dueDate:'2026-10-20'}).procurement.bills[0];f.run('purchase-pay',{invoiceId:bill.id,amount:10,method:'cash',shiftId:'shift'});expect(()=>validateProcurementRecords([f.po()],f.data.cashLogs)).not.toThrow();for(const mutate of [p=>p.total+=.01,p=>p.items[0].received-=.001,p=>p.procurement.bills[0].amount+=.01,p=>p.procurement.receipts.pop()]){const p=structuredClone(f.po());mutate(p);expect(()=>validateProcurementRecords([p],f.data.cashLogs)).toThrow()}expect(()=>validateProcurementRecords([f.po()],[])).toThrow(/現金流水/)})
test('invalid bill dates and financial overflow reject before changing the authoritative order',()=>{const f=fixture();f.run('receive',{quantities:[3.125]});const before=canonicalSignature(f.po());for(const dueDate of ['2026-02-30','wrong','2026-10-14'])expect(()=>f.run('purchase-bill',{quantities:[1],reference:'invalid',dueDate})).toThrow();expect(canonicalSignature(f.po())).toBe(before);expect(()=>fixture(1e9,1e9)).toThrow(/上限/)})
