import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {readRecords,writeRecords,restoreRecords,DATA_KEYS,RECORD_KEY} from '../../src/utils/browserStorage'
import {getBrowserSalesState,commitBrowserSalesDocument} from '../../src/utils/browserSalesDocuments'
import {getBrowserExchangeContext,commitBrowserExchange} from '../../src/utils/browserExchange'
import {executeFinancial,readPendingFinancial,FINANCIAL_PENDING} from '../../src/utils/financialCommand'
import {productReference,QUOTE_PRICING,EXCHANGE_SETTING} from '../../electron/businessExchange.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {salesDate,salesSummary} from '../../electron/salesRules.mjs'
import {salesToJournalEntries} from '../../electron/salesJournal.mjs'
import {summarizeShift} from '../../electron/shiftReconciliation.mjs'

const owner={role:'owner',userId:'owner',username:'Fixture Owner'}
let values,context,count,quota
beforeEach(async()=>{
  values=new Map();count=0;quota=false
  vi.stubGlobal('localStorage',{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(quota&&key===RECORD_KEY)throw Error('fixture quota');values.set(key,String(value))},removeItem:key=>values.delete(key)})
  vi.stubGlobal('navigator',{locks:{request:async(_name,action)=>action()}})
  const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos2_products=[{id:'p',name:'牛肉',unit:'公斤',stock:5,cost:8.88,price:15}];data.pos2_shifts=[{id:'shift',status:'open',openCash:100}]
  values.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
  context=await getBrowserSalesState(owner)
})
afterEach(()=>vi.unstubAllGlobals())
const input=()=>({kind:'sales',action:'create',storeId:context.storeId,epoch:context.epoch,date:context.today,document:{customer:{id:'buyer',name:'首頁 <script>'},date:context.today,items:[{productId:'p',qty:3.125,unitPrice:12.34,expectedProduct:productReference(readRecords().data.pos2_products[0])}],note:'客戶原文'}})
const stamp=value=>({...value,id:'browser-sale-'+(++count),time:new Date().toISOString()})
const run=async value=>{const result=await commitBrowserSalesDocument(stamp(value),owner);expect(result.success,result.error).toBe(true);return result}
const doc=()=>readRecords().data.pos_sales_documents[0]
const action=(type,extra={})=>({kind:'sales',storeId:context.storeId,epoch:context.epoch,date:context.today,action:type,orderId:doc().id,expectedRevision:doc().revision,...extra})
const delivery=async()=>{await run(action('deliver',{quantities:[1.125],dueDate:context.today,handedOver:true}));return doc().deliveries[0]}

test('old browser records acquire a device-local fence and encoded store identity without business changes',async()=>{
  const record=readRecords();delete record.data.pos_sales_documents;delete record.data.pos_sales_operations;delete record.salesEpoch;values.set(RECORD_KEY,JSON.stringify(record))
  const state=await getBrowserSalesState(owner)
  expect(state.documents).toEqual([]);expect(state.epoch).toBeTruthy();expect(readRecords().data.pos2_products[0].stock).toBe(5)
  expect(JSON.parse(readRecords().data.pos_business_settings.find(s=>s.key==='sharedStoreId').value)).toBe(state.storeId)
  expect(Object.keys(readRecords().data)).not.toContain('salesEpoch')
})
test('browser order creation has no stock, cash or revenue movement',async()=>{
  await run(input());expect(doc().total).toBe(38.56);expect(salesToJournalEntries(doc())).toEqual([])
  expect(readRecords().data.pos2_products[0].stock).toBe(5);expect(readRecords().data.pos2_cash_log).toEqual([])
})
test('actual browser handover and partial cash collection commit documents, drawer and receivable together',async()=>{
  await run(input());const d=await delivery();await run(action('pay',{deliveryId:d.id,amount:5,method:'cash',shiftId:'shift',reference:''}))
  const data=readRecords().data
  expect(data.pos2_products[0].stock).toBe(3.875);expect(salesSummary(doc()).owed).toBe(8.88)
  expect(summarizeShift(data.pos2_shifts[0],[],data.pos2_cash_log,[],[]).expected).toBe(105)
  expect(data.pos_sales_operations).toHaveLength(3);expect(data.pos2_orders).toEqual([])
})
test('lost postcommit reply and coordinator reload retain the original payment ID and collect once',async()=>{
  await run(input());const d=await delivery(),form=action('pay',{deliveryId:d.id,amount:5,method:'cash',shiftId:'shift',reference:''})
  await expect(executeFinancial('sales',form,async request=>{await commitBrowserSalesDocument(request,owner);throw Error('lost reply')})).rejects.toThrow('尚未確認')
  const pending=readPendingFinancial(),cash=structuredClone(readRecords().data.pos2_cash_log)
  vi.resetModules();const reloaded=await import('../../src/utils/financialCommand')
  const result=await reloaded.executeFinancial('sales',JSON.parse(pending.signature).input,r=>commitBrowserSalesDocument(r,owner))
  expect(result.receipt.id).toBe(pending.request.id);expect(readRecords().data.pos2_cash_log).toEqual(cash);expect(values.has(FINANCIAL_PENDING)).toBe(false)
})
test('a response with coherently forged customer data cannot clear the original creation journal',async()=>{
  await expect(executeFinancial('sales',input(),async request=>{
    const result=await commitBrowserSalesDocument(request,owner);result.document.customer.name='forged'
    const {salesBase}=await import('../../electron/salesRules.mjs');result.receipt.event=canonicalSignature(salesBase(result.document));return result
  })).rejects.toThrow('來源')
  expect(readPendingFinancial()).not.toBeNull();expect(doc().customer.name).toBe('首頁 <script>')
})
test('a receipt with a wrong cash amount cannot clear the durable payment journal',async()=>{
  await run(input());const d=await delivery()
  await expect(executeFinancial('sales',action('pay',{deliveryId:d.id,amount:5,method:'cash',shiftId:'shift',reference:''}),async request=>{
    const result=structuredClone(await commitBrowserSalesDocument(request,owner));result.cashLog.amount=6;return result
  })).rejects.toThrow('現金流水')
  expect(readPendingFinancial()).not.toBeNull();expect(readRecords().data.pos2_cash_log[0].amount).toBe(5)
})
test('same ID with changed contents and stale order revisions reject with no record changes',async()=>{
  const request=stamp(input());expect((await commitBrowserSalesDocument(request,owner)).success).toBe(true)
  let before=values.get(RECORD_KEY),changed=structuredClone(request);changed.document.note='different'
  expect(await commitBrowserSalesDocument(changed,owner)).toMatchObject({success:false,committed:false});expect(values.get(RECORD_KEY)).toBe(before)
  const stale=stamp(action('close',{reason:'fixture'}));await delivery();before=values.get(RECORD_KEY)
  expect(await commitBrowserSalesDocument(stale,owner)).toMatchObject({success:false,committed:false});expect(values.get(RECORD_KEY)).toBe(before)
})
test('a full snapshot restore rotates its fence atomically and original committed replay still works',async()=>{
  const request=stamp(input());await commitBrowserSalesDocument(request,owner);const snapshot=structuredClone(readRecords().data)
  restoreRecords(snapshot);const restored=await getBrowserSalesState(owner);expect(restored.epoch).not.toBe(context.epoch)
  const before=values.get(RECORD_KEY);expect((await commitBrowserSalesDocument(request,owner)).success).toBe(true);expect(values.get(RECORD_KEY)).toBe(before)
})
test('restoring an older snapshot cannot replay a later lost payment whose receipt was rolled back',async()=>{
  await run(input());const d=await delivery(),snapshot=structuredClone(readRecords().data),form=action('pay',{deliveryId:d.id,amount:5,method:'cash',shiftId:'shift',reference:''})
  await expect(executeFinancial('sales',form,async request=>{await commitBrowserSalesDocument(request,owner);throw Error('lost')})).rejects.toThrow()
  const original=values.get(FINANCIAL_PENDING);restoreRecords(snapshot)
  const before=values.get(RECORD_KEY)
  expect(await commitBrowserSalesDocument(readPendingFinancial().request,owner)).toMatchObject({success:false,committed:null})
  await expect(executeFinancial('sales',form,r=>commitBrowserSalesDocument(r,owner))).rejects.toThrow()
  expect(values.get(FINANCIAL_PENDING)).toBe(original);expect(values.get(RECORD_KEY)).toBe(before);expect(readRecords().data.pos2_cash_log).toEqual([])
})
test('pre-sales snapshots replace future sales collections instead of mixing old inventory with new debts',async()=>{
  const snapshot=structuredClone(readRecords().data);delete snapshot.pos_sales_documents;delete snapshot.pos_sales_operations
  await run(input());await delivery();restoreRecords(snapshot)
  expect(readRecords().data.pos_sales_documents).toEqual([]);expect(readRecords().data.pos_sales_operations).toEqual([]);expect(readRecords().data.pos2_products[0].stock).toBe(5)
})
test('corrupt restore rolls back both business content and the restore fence',async()=>{
  await run(input());await delivery();const corrupt=structuredClone(readRecords().data);corrupt.pos_sales_operations.pop()
  const before=values.get(RECORD_KEY);expect(()=>restoreRecords(corrupt)).toThrow('不完整');expect(values.get(RECORD_KEY)).toBe(before)
})
test('quota failure cannot save a partial payment or rotate the restore fence',async()=>{
  await run(input());const d=await delivery(),before=values.get(RECORD_KEY);quota=true
  expect(await commitBrowserSalesDocument(stamp(action('pay',{deliveryId:d.id,amount:5,method:'cash',shiftId:'shift',reference:''})),owner)).toMatchObject({success:false,committed:false})
  expect(()=>restoreRecords(readRecords().data)).toThrow('quota');expect(values.get(RECORD_KEY)).toBe(before)
})
test('unreadable historical receipts stay uncertain and cannot be treated as an uncommitted new payment',async()=>{
  await run(input());const d=await delivery(),request=stamp(action('pay',{deliveryId:d.id,amount:5,method:'bank',reference:''}));await commitBrowserSalesDocument(request,owner)
  const broken=readRecords();broken.data.pos_sales_operations.at(-1).signature='{bad';values.set(RECORD_KEY,JSON.stringify(broken));const before=values.get(RECORD_KEY)
  expect(await commitBrowserSalesDocument(request,owner)).toMatchObject({success:false,committed:null});expect(values.get(RECORD_KEY)).toBe(before)
})
test('referenced products cannot disappear and staff cannot access the sales adapter',async()=>{
  await run(input());const before=values.get(RECORD_KEY)
  expect(()=>writeRecords({pos2_products:[]})).toThrow();expect(()=>getBrowserSalesState({role:'staff'})).toThrow('權限');expect(()=>commitBrowserSalesDocument(stamp(input()),{role:'staff'})).toThrow('權限');expect(values.get(RECORD_KEY)).toBe(before)
})
test('cash requires the authoritative open shift while bank collection can proceed without a shift',async()=>{
  await run(input());const d=await delivery();writeRecords({pos2_shifts:[]})
  expect(await commitBrowserSalesDocument(stamp(action('pay',{deliveryId:d.id,amount:1,method:'cash',shiftId:'shift',reference:''})),owner)).toMatchObject({success:false,committed:false})
  await run(action('pay',{deliveryId:d.id,amount:1,method:'bank',reference:'bank statement'}));expect(readRecords().data.pos2_cash_log).toEqual([])
})
test('a restored legacy database with a different store identity cannot classify an old operation as safely uncommitted',async()=>{
  const request=stamp(input());const snapshot=structuredClone(readRecords().data);snapshot.pos_business_settings=[]
  await commitBrowserSalesDocument(request,owner);restoreRecords(snapshot);await getBrowserSalesState(owner)
  expect(await commitBrowserSalesDocument(request,owner)).toMatchObject({success:false,committed:null})
})
test('an accepted quote keeps its saved source, rejects duplicate conversion, and cannot restore with that source silently removed',async()=>{
  const exchange=await getBrowserExchangeContext(owner),r=input(),quoteRequest={id:'browser-owned-quote',kind:'exchange',storeId:context.storeId,time:new Date().toISOString(),expectedRevision:exchange.state.revision,quoteId:'',expectedQuoteRevision:0,recipient:r.document.customer,validUntil:new Date(Date.now()+86400000).toISOString(),items:r.document.items,rememberPrices:true,note:'',pricing:QUOTE_PRICING}
  const quote=await commitBrowserExchange(quoteRequest,owner);expect(quote.success,quote.error).toBe(true)
  r.document.quoteRef={id:quote.quote.id,revision:1};const result=await run(r)
  expect(result.document.sourceQuote).toEqual(quote.quote)
  const before=values.get(RECORD_KEY);expect(await commitBrowserSalesDocument(stamp(r),owner)).toMatchObject({success:false,committed:false});expect(values.get(RECORD_KEY)).toBe(before)
  const bad=structuredClone(readRecords().data);bad.pos_business_settings=bad.pos_business_settings.filter(row=>row.key!==EXCHANGE_SETTING);bad.pos_audit_log=bad.pos_audit_log.filter(row=>row.action!=='business-quote')
  expect(()=>restoreRecords(bad)).toThrow('原報價版本');expect(values.get(RECORD_KEY)).toBe(before)
})
