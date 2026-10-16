import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {DATA_KEYS,RECORD_KEY,readRecords,writeRecords,restoreRecords} from '../../src/utils/browserStorage'
import {getBrowserSupplierState,commitBrowserSupplierLedger} from '../../src/utils/browserSupplierLedger'
import {commitBrowserInventory} from '../../src/utils/browserInventory'
import {executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'
import {assertSupplierLedgerResult} from '../../electron/supplierLedger.mjs'
import {assertSupplierInventoryResult} from '../../electron/supplierInventory.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {procurementSummary} from '../../electron/procurementRules.mjs'
import {supplierLedgerToJournalEntries} from '../../electron/supplierJournal.mjs'

const owner={userId:'owner',username:'Fixture Owner',role:'owner'},checker={userId:'checker',username:'Fixture Checker',role:'owner'}
let values,queue,quota,index
beforeEach(async()=>{
 values=new Map();queue=Promise.resolve();quota=false;index=0
 vi.stubGlobal('localStorage',{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(quota&&key===RECORD_KEY)throw Error('fixture atomic quota');values.set(key,String(value))},removeItem:key=>values.delete(key)})
 vi.stubGlobal('navigator',{locks:{request:(_name,action)=>{const job=queue.then(action);queue=job.catch(()=>{});return job}}})
 const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos2_products=[{id:'p',name:'Rice',unit:'袋',price:150,cost:100,stock:0}];data.pos_suppliers=[{id:'supplier',name:'Fixture Supplier',catalog:[]}];data.pos_users=[{id:owner.userId,...owner},{id:checker.userId,...checker}];data.pos2_shifts=[{id:'shift',status:'open',openCash:1000}]
 values.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}));await getBrowserSupplierState(owner)
})
afterEach(()=>vi.unstubAllGlobals())
const id=()=> 'browser-supplier-'+(++index),state=()=>getBrowserSupplierState(owner),party={supplierId:'supplier',expectedSupplierName:'Fixture Supplier'}
async function request(action,fields={}){const s=await state();return {id:id(),kind:'supplier-ledger',time:new Date().toISOString(),date:s.today,storeId:s.storeId,epoch:s.epoch,expectedRevision:s.supplierLedger.revision,action,...fields}}
async function ledger(r,actor=owner){const result=await commitBrowserSupplierLedger(r,actor);expect(result.success,result.error).toBe(true);return assertSupplierLedgerResult(r,result)}
const pay=async(amount=500,fields={})=>ledger(await request('pay',{...party,amount,method:'cash',shiftId:'shift',confirmed:true,...fields}))
async function inventory(kind,fields={}){const s=await state(),r={id:id(),kind,time:new Date().toISOString(),supplierContext:{storeId:s.storeId,epoch:s.epoch,revision:s.supplierLedger.revision},...fields},result=await commitBrowserInventory(r,owner);expect(result.success,result.error).toBe(true);assertSupplierInventoryResult(r,result);return {...result,request:r}}
async function update(kind,purchaseId,fields={}){const po=(await state()).purchases.find(row=>row.id===purchaseId);return inventory(kind,{purchaseId,expectedPurchase:canonicalSignature(po),...fields})}
async function billed(name){const s=await state();await inventory('purchase-create',{purchase:{id:name,supplierId:'supplier',date:s.today,items:[{productId:'p',name:'Rice',unit:'袋',qty:2,unitCost:100}],note:''}});await update('receive',name,{quantities:[2]});return (await update('purchase-bill',name,{quantities:[2],reference:'INV-'+name,dueDate:s.today})).receipt.id}
async function item(purchaseId,invoiceId,amount){return {purchaseId,invoiceId,expectedRevision:(await state()).purchases.find(row=>row.id===purchaseId).procurement.revision,amount}}

test('real atomic browser storage records a pre-goods cash advance and allocates it across two actual invoices',async()=>{
 const payment=await pay(350);expect(readRecords().data.pos_purchases).toEqual([]);const a=await billed('a'),b=await billed('b')
 await ledger(await request('allocate',{...party,paymentId:payment.event.id,items:[await item('a',a,200),await item('b',b,150)],reviewed:true}))
 const data=readRecords().data;expect(data.pos2_cash_log).toHaveLength(1);expect(data.pos2_products[0].stock).toBe(4);expect((await state()).supplierLedger.payments[0]).toMatchObject({available:0,allocated:350})
 expect(procurementSummary(data.pos_purchases.find(row=>row.id==='b'),undefined,data.pos_supplier_entries).owed).toBe(50)
 const lines=supplierLedgerToJournalEntries(data.pos_supplier_entries).flatMap(row=>row.lines);expect(lines.filter(row=>row.account==='1261').reduce((sum,row)=>sum+row.debit-row.credit,0)).toBe(0);expect(lines.reduce((sum,row)=>sum+row.debit-row.credit,0)).toBe(0)
})
test('quota rejection keeps the complete prior book and permits a fresh uncommitted original ID to be reviewed again',async()=>{
 await pay();const r=await request('pay',{...party,amount:10,method:'cash',shiftId:'shift',confirmed:true}),before=values.get(RECORD_KEY);quota=true
 const result=await commitBrowserSupplierLedger(r,owner);expect(result).toMatchObject({success:false,committed:false});expect(values.get(RECORD_KEY)).toBe(before);quota=false
 expect((await state()).supplierLedger.payments).toHaveLength(1);expect((await commitBrowserSupplierLedger(r,owner)).success).toBe(true);expect(readRecords().data.pos2_cash_log).toHaveLength(2)
})
test('lost acknowledgement keeps the global original request and a retry resolves one actual supplier payment',async()=>{
 const stamped=await request('pay',{...party,amount:500,method:'cash',shiftId:'shift',confirmed:true}),{id,time,...input}=stamped;let first=true
 const persist=async r=>{const result=await commitBrowserSupplierLedger(r,owner);if(first){first=false;throw Error('fixture lost supplier reply')}return result}
 await expect(executeFinancial('supplier-ledger',input,persist,()=>{},{id,time})).rejects.toThrow('尚未確認');expect(readPendingFinancial().request.id).toBe(id);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
 const result=await executeFinancial('supplier-ledger',input,persist);expect(result.event.id).toBe(id);expect(readPendingFinancial()).toBe(null);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
})
test('forged balance acknowledgement cannot clear a supplier financial journal even after actual commit',async()=>{
 const stamped=await request('pay',{...party,amount:100,method:'bank',confirmed:true}),{id,time,...input}=stamped
 await expect(executeFinancial('supplier-ledger',input,async r=>{const result=await commitBrowserSupplierLedger(r,owner);result.supplierLedger.payments[0].available=999;return result},()=>{},{id,time})).rejects.toThrow('尚未確認')
 expect(readPendingFinancial().request.id).toBe(id);expect((await state()).supplierLedger.payments[0].available).toBe(100)
 await executeFinancial('supplier-ledger',input,r=>commitBrowserSupplierLedger(r,owner));expect(readPendingFinancial()).toBe(null);expect((await state()).supplierLedger.payments).toHaveLength(1)
})
test('draft pin failure occurs before supplier persistence and clears only a known uncommitted journal',async()=>{
 const stamped=await request('pay',{...party,amount:100,method:'bank',confirmed:true}),{id,time,...input}=stamped,persist=vi.fn();let failure
 try{await executeFinancial('supplier-ledger',input,persist,()=>{},{id,time},null,prepared=>{expect(prepared.request.id).toBe(id);throw Error('fixture draft quota')})}catch(error){failure=error}
 expect(failure).toMatchObject({notCommitted:true,operationId:id});expect(persist).not.toHaveBeenCalled();expect(readPendingFinancial()).toBe(null);expect(readRecords().data.pos_supplier_entries).toEqual([])
})
test('two concurrent browser allocations of one reviewed balance can succeed only once',async()=>{
 const payment=await pay(200),a=await billed('a'),b=await billed('b'),ra=await request('allocate',{...party,paymentId:payment.event.id,items:[await item('a',a,200)],reviewed:true}),rb=await request('allocate',{...party,paymentId:payment.event.id,items:[await item('b',b,200)],reviewed:true})
 const results=await Promise.all([commitBrowserSupplierLedger(ra,owner),commitBrowserSupplierLedger(rb,owner)]);expect(results.filter(row=>row.success)).toHaveLength(1);expect(results.filter(row=>row.committed===false)).toHaveLength(1);expect((await state()).supplierLedger.payments[0].available).toBe(0);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
})
test('a newer supplier revision prevents a direct-payment request reviewed before an allocation',async()=>{
 const payment=await pay(200),invoice=await billed('a'),s=await state(),po=s.purchases[0],direct={id:id(),kind:'purchase-pay',time:new Date().toISOString(),purchaseId:po.id,expectedPurchase:canonicalSignature(po),invoiceId:invoice,amount:1,method:'bank',supplierContext:{storeId:s.storeId,epoch:s.epoch,revision:s.supplierLedger.revision}}
 await ledger(await request('allocate',{...party,paymentId:payment.event.id,items:[await item('a',invoice,200)],reviewed:true}));const before=values.get(RECORD_KEY),result=await commitBrowserInventory(direct,owner)
 expect(result).toMatchObject({success:false,committed:false});expect(result.error).toContain('供應商帳已更新');expect(values.get(RECORD_KEY)).toBe(before)
})
test('a different owner account must approve a submitted purchase even after switching back to simple mode',async()=>{
 await ledger(await request('policy-set',{mode:'dual-owner',reason:'Reviewed by owner',reviewed:true}));const s=await state(),po=(await inventory('purchase-create',{purchase:{id:'a',supplierId:'supplier',date:s.today,items:[{productId:'p',name:'Rice',qty:2,unitCost:100}],note:''}})).purchase
 await ledger(await request('policy-set',{mode:'simple',reason:'Future simple documents',reviewed:true}));const approve=await request('purchase-approve',{purchaseId:po.id,expectedPurchaseRevision:1,reviewed:true}),before=values.get(RECORD_KEY)
 expect((await commitBrowserSupplierLedger(approve,owner)).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before);await ledger(approve,checker);await update('receive',po.id,{quantities:[2]});expect((await state()).supplierLedger.purchaseApprovals[0].approvedBy).toEqual(checker)
})
test('browser restore retains missing original payment IDs, the complete recovery copy and the supplier writer floor',async()=>{
 const older=structuredClone(readRecords().data),payment=await pay(),complete=structuredClone(readRecords().data);restoreRecords(older)
 expect(readRecords().supplierFence).toBe(true);expect(readRecords().recovery.snapshots.at(-1).data.pos_supplier_entries).toHaveLength(1)
 const result=await commitBrowserSupplierLedger(payment.event.input,owner);expect(result).toMatchObject({success:false,committed:null,errorCode:'RECOVERY_REQUIRED'});expect(readRecords().data.pos2_cash_log).toEqual([])
 const s=await state(),legacy={id:id(),kind:'purchase-create',time:new Date().toISOString(),purchase:{id:'new-legacy',supplierId:'supplier',date:s.today,items:[{productId:'p',name:'Rice',qty:1,unitCost:100}]}}
 expect((await commitBrowserInventory(legacy,owner)).success).toBe(false);restoreRecords(complete);expect((await commitBrowserSupplierLedger(payment.event.input,owner)).success).toBe(true);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
})
test('dropping supplier operations or deleting a funded supplier is rejected before any atomic write',async()=>{
 await pay();const current=readRecords(),before=values.get(RECORD_KEY)
 expect(()=>writeRecords({pos_supplier_operations:[]},current.revision)).toThrow('不完整');expect(values.get(RECORD_KEY)).toBe(before)
 expect(()=>writeRecords({pos_suppliers:[]},current.revision)).toThrow('原往來身份');expect(values.get(RECORD_KEY)).toBe(before)
 expect(()=>getBrowserSupplierState({...owner,role:'staff'})).toThrow('權限');expect(()=>commitBrowserSupplierLedger({}, {...owner,role:'staff'})).toThrow('權限')
})
test('a lost modern inventory reply cannot drop its pending original when the registration acknowledgement is omitted',async()=>{
 const s=await state(),identity={id:id(),time:new Date().toISOString()},input={kind:'purchase-create',supplierContext:{storeId:s.storeId,epoch:s.epoch,revision:0},purchase:{id:'a',supplierId:'supplier',date:s.today,items:[{productId:'p',name:'Rice',qty:1,unitCost:100}],note:''}}
 await expect(executeFinancial('purchase-create',input,async r=>{const result=await commitBrowserInventory(r,owner);delete result.supplierRegistration;return result},()=>{},identity)).rejects.toThrow('尚未確認')
 expect(readPendingFinancial().request.id).toBe(identity.id);await executeFinancial('purchase-create',input,r=>commitBrowserInventory(r,owner));expect(readPendingFinancial()).toBe(null);expect(readRecords().data.pos_purchases).toHaveLength(1);expect(readRecords().data.pos_supplier_entries).toHaveLength(1)
})
test('legacy purchase flag edits cannot bypass an activated supplier ledger but a protected restore retains its original book',async()=>{
 const legacy={id:'legacy',supplierId:'supplier',supplierName:'Fixture Supplier',status:'received',date:(await state()).today,total:100,paidDate:'',items:[{productId:'p',name:'Rice',qty:1,received:1,unitCost:100}],procurement:null}
 writeRecords({pos_purchases:[legacy]});const older=structuredClone(readRecords().data);await pay();const before=values.get(RECORD_KEY)
 expect(()=>writeRecords({pos_purchases:[{...legacy,paidDate:legacy.date,status:'paid'}]})).toThrow('歷史進貨單');expect(()=>writeRecords({pos_purchases:[]})).toThrow('歷史進貨單');expect(values.get(RECORD_KEY)).toBe(before)
 restoreRecords(older);expect(readRecords().supplierFence).toBe(true);expect(readRecords().data.pos_purchases).toEqual([legacy]);expect(readRecords().data.pos_supplier_entries).toEqual([])
})
