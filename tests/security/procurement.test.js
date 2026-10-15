import {beforeEach,expect,test} from 'vitest'
import {commitBrowserInventory} from '../../src/utils/browserInventory'
import {DATA_KEYS,RECORD_KEY,readRecords} from '../../src/utils/browserStorage'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {executeFinancial,FINANCIAL_PENDING} from '../../src/utils/financialCommand'

let values,initial
const actor={userId:'owner',username:'owner',role:'owner'},time='2026-10-15T04:00:00Z'
const purchase={id:'po-erp',supplierId:'s',date:'2026-10-15',note:'split fixture',items:[{productId:'p',name:'rice',qty:3.125,unitCost:12.34,received:0}]}
beforeEach(()=>{
  values=new Map()
  globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
  const data=Object.fromEntries(DATA_KEYS.map(k=>[k,[]]))
  data.pos2_products=[{id:'p',name:'rice',stock:1.875,cost:10,price:20}]
  data.pos_suppliers=[{id:'s',name:'supplier',catalog:[]}]
  data.pos2_shifts=[{id:'shift',status:'open',openCash:100}]
  values.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}));initial=values.get(RECORD_KEY)
})
const po=()=>readRecords().data.pos_purchases[0]
const request=(kind,id,input={})=>({id,kind,time,...input})
const run=(kind,id,input={})=>commitBrowserInventory(request(kind,id,input),actor)
const command=(kind,id,input={})=>run(kind,id,{purchaseId:po().id,expectedPurchase:canonicalSignature(po()),...input})
async function create(){const r=await run('purchase-create','create',{purchase});expect(r.success,r.error).toBe(true);return r}
async function receive(qty=1.125,id='receive'){return command('receive',id,{quantities:[qty]})}
async function bill(qty=1.125,id='bill'){return command('purchase-bill',id,{quantities:[qty],reference:id,dueDate:'2026-10-20'})}
async function payable(){await create();expect((await receive()).success).toBe(true);expect((await bill()).success).toBe(true)}

test('new purchasing freezes authoritative supplier and remains stock-neutral until receiving',async()=>{const r=await create();expect(r.purchase.procurement.version).toBe(1);expect(r.purchase.supplierName).toBe('supplier');expect(readRecords().data.pos2_products[0].stock).toBe(1.875);expect(r.receipt.productIds).toEqual([])})
test('fractional split receipts, matching bills and partial payment conserve value across a later receipt',async()=>{
  await payable();const r=await command('purchase-pay','payment',{invoiceId:'bill',amount:5,method:'bank',note:'first'})
  expect(r.success,r.error).toBe(true);expect(r.purchase.procurement.payments[0].amount).toBe(5)
  expect((await receive(2,'receive-2')).success).toBe(true)
  expect((await bill(2,'bill-2')).success).toBe(true)
  const current=po();expect(current.status).toBe('received');expect(current.procurement.receipts.reduce((n,r)=>n+r.amount,0)).toBe(38.56)
  expect(current.procurement.bills.reduce((n,r)=>n+r.amount,0)).toBe(38.56);expect(readRecords().data.pos2_products[0].stock).toBe(5)
})
test('overreceipt, unreceived billing and zero quantity leave the complete store unchanged',async()=>{await create();for(const [kind,quantities] of [['receive',[3.126]],['purchase-bill',[1]],['receive',[0]]]){const before=values.get(RECORD_KEY);expect((await command(kind,'invalid',{quantities,reference:'bad',dueDate:'2026-10-20'})).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)}})
test('excess precision and nonfinite order input cannot create a purchase',async()=>{for(const item of [{qty:.0001},{unitCost:1.001},{qty:Infinity},{qty:-1}]){expect((await run('purchase-create','bad',{purchase:{...purchase,items:[{...purchase.items[0],...item}]}})).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(initial)}})
test('overbilling after a partial bill is rejected without modifying receipt or stock',async()=>{await payable();const before=values.get(RECORD_KEY);expect((await bill(.001,'extra')).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)})
test('supplier bill reference is unique across purchase orders',async()=>{await payable();await run('purchase-create','create-2',{purchase:{...purchase,id:'po-second'}});const other=readRecords().data.pos_purchases.find(p=>p.id==='po-second');const recv=await run('receive','receive-other',{purchaseId:other.id,expectedPurchase:canonicalSignature(other),quantities:[1]});const before=values.get(RECORD_KEY);expect((await run('purchase-bill','duplicate',{purchaseId:other.id,expectedPurchase:canonicalSignature(recv.purchase),quantities:[1],reference:' BILL ',dueDate:'2026-10-20'})).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)})
test('overpayment, invalid currency precision and stale purchase are rejected atomically',async()=>{await payable();for(const input of [{amount:13.89},{amount:.001},{amount:0},{amount:1,expectedPurchase:'stale'}]){const before=values.get(RECORD_KEY);expect((await command('purchase-pay','invalid',{invoiceId:'bill',method:'bank',...input})).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)}})
test('cash payment and reversal each create one linked shift movement',async()=>{await payable();const paid=await command('purchase-pay','cash-pay',{invoiceId:'bill',amount:5,method:'cash',shiftId:'shift'});expect(paid.success,paid.error).toBe(true);expect(readRecords().data.pos2_cash_log).toEqual([expect.objectContaining({type:'out',amount:5,shiftId:'shift'})]);const reversed=await command('purchase-reverse','cash-reverse',{paymentId:'cash-pay',reason:'wrong account',shiftId:'shift'});expect(reversed.success,reversed.error).toBe(true);expect(readRecords().data.pos2_cash_log).toHaveLength(2);expect(readRecords().data.pos2_cash_log.find(l=>l.type==='in').amount).toBe(5);const before=values.get(RECORD_KEY);expect((await command('purchase-reverse','twice',{paymentId:'cash-pay',reason:'again',shiftId:'shift'})).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)})
test('cash payment requires the currently open shift and bank payment has no drawer movement',async()=>{await payable();for(const shiftId of ['', 'closed']){const before=values.get(RECORD_KEY);expect((await command('purchase-pay','wrong-shift',{invoiceId:'bill',amount:5,method:'cash',shiftId})).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)}expect((await command('purchase-pay','bank',{invoiceId:'bill',amount:5,method:'bank'})).success).toBe(true);expect(readRecords().data.pos2_cash_log).toHaveLength(0)})
test('lost payment acknowledgement replays the original ID once and returns current balances',async()=>{await payable();const input={purchaseId:po().id,expectedPurchase:canonicalSignature(po()),invoiceId:'bill',amount:5,method:'bank',kind:'purchase-pay'};let saved
  await expect(executeFinancial('purchase-pay',input,async r=>{saved=r;expect((await commitBrowserInventory(r,actor)).success).toBe(true);throw Error('lost reply')})).rejects.toThrow(/尚未確認/)
  const pending=values.get(FINANCIAL_PENDING);expect(pending).toBeTruthy();const result=await executeFinancial('purchase-pay',input,r=>commitBrowserInventory(r,actor));expect(result.purchase.procurement.payments).toHaveLength(1);expect(values.has(FINANCIAL_PENDING)).toBe(false)
  const before=values.get(RECORD_KEY);expect((await commitBrowserInventory({...saved,amount:6},actor)).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)
})
test('an incomplete purchase reply retains the pending journal',async()=>{await payable();const input={kind:'purchase-pay',purchaseId:po().id,expectedPurchase:canonicalSignature(po()),invoiceId:'bill',amount:5,method:'bank'};await expect(executeFinancial('purchase-pay',input,async r=>{const result=await commitBrowserInventory(r,actor);return {...result,purchase:null}})).rejects.toThrow(/回覆|進貨單|核對/);expect(values.has(FINANCIAL_PENDING)).toBe(true);expect(po().procurement.payments).toHaveLength(1)})
test('quota rejection rolls back every collection and the durable operation receipt',async()=>{await payable();const before=values.get(RECORD_KEY);localStorage.setItem=()=>{throw Error('quota')};expect((await command('purchase-pay','quota',{invoiceId:'bill',amount:5,method:'bank'})).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)})
test('staff cannot create, bill, pay or reverse procurement operations',async()=>{for(const kind of ['purchase-create','purchase-bill','purchase-pay','purchase-reverse','purchase-cancel']){await expect(async()=>commitBrowserInventory(request(kind,'staff',{purchase}),{role:'staff'})).rejects.toThrow(/權限/);expect(values.get(RECORD_KEY)).toBe(initial)}})
test('cancelled empty orders cannot receive; received orders cannot be cancelled',async()=>{await create();expect((await command('purchase-cancel','cancel',{reason:'duplicate order'})).success).toBe(true);expect((await receive()).success).toBe(false)})
test('received orders preserve immutable documents instead of cancelling history',async()=>{await create();await receive();const before=values.get(RECORD_KEY);expect((await command('purchase-cancel','cancel',{reason:'erase'})).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)})
test('legacy overreceived rows remain historical while other unfinished lines can be completed',async()=>{const saved=readRecords();saved.data.pos_purchases=[{id:'legacy',supplierId:'s',status:'partial',date:'2026-10-14',total:30,items:[{productId:'p',name:'old excess',qty:1,received:2,unitCost:10},{productId:'p',name:'remaining',qty:1,received:0,unitCost:20}]}];values.set(RECORD_KEY,JSON.stringify(saved));const before=values.get(RECORD_KEY);expect((await command('receive','extra',{quantities:[.001,0]})).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before);const result=await command('receive','finish-legacy',{quantities:[0,1]});expect(result.success,result.error).toBe(true);expect(result.purchase.items[0].received).toBe(2);expect(result.purchase.status).toBe('received');expect(result.products[0].stock).toBe(2.875)})
