import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {readRecords,writeRecords,restoreRecords,DATA_KEYS,RECORD_KEY} from '../../src/utils/browserStorage'
import {getBrowserSalesState,commitBrowserSalesDocument} from '../../src/utils/browserSalesDocuments'
import {commitBrowserCustomerLedger} from '../../src/utils/browserCustomerLedger'
import {executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'
import {assertCustomerLedgerResult} from '../../electron/customerLedger.mjs'
import {productReference} from '../../electron/businessExchange.mjs'
import {salesSummary} from '../../electron/salesRules.mjs'
import {readCustomerReceiptDraft,CUSTOMER_RECEIPT_DRAFT,suggestCustomerAllocation,customerOpenClaims} from '../../src/utils/customerLedgerUi.mjs'

const owner={role:'owner',userId:'owner',username:'Fixture Owner'}
let values,context,index,quota,queue
beforeEach(async()=>{
  values=new Map();index=0;quota=false;queue=Promise.resolve()
  vi.stubGlobal('localStorage',{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(quota&&key===RECORD_KEY)throw Error('fixture quota');values.set(key,String(value))},removeItem:key=>values.delete(key)})
  vi.stubGlobal('navigator',{locks:{request:(_name,action)=>{const job=queue.then(action);queue=job.catch(()=>{});return job}}})
  const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos2_products=[{id:'p',name:'牛丼',unit:'碗',stock:10,cost:40,price:150}];data.pos2_shifts=[{id:'shift',status:'open',openCash:100}]
  values.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}));context=await getBrowserSalesState(owner)
})
afterEach(()=>vi.unstubAllGlobals())
const state=()=>getBrowserSalesState(owner)
const request=async(action,input={})=>({id:'browser-customer-'+(++index),time:new Date().toISOString(),kind:'customer-ledger',action,storeId:context.storeId,epoch:context.epoch,date:context.today,expectedRevision:(await state()).customerLedger.revision,...input})
const receiveInput=()=>({customerId:'buyer',amount:500,method:'cash',shiftId:'shift',confirmed:true})
async function ledger(r){const result=await commitBrowserCustomerLedger(r,owner);expect(result.success,result.error).toBe(true);return assertCustomerLedgerResult(r,result)}
async function customer(){return ledger(await request('customer-create',{customer:{id:'buyer',name:'首頁 <script>'}}))}
async function delivered(price){const s=await state(),r={id:'browser-sale-'+(++index),time:new Date().toISOString(),kind:'sales',action:'create',storeId:s.storeId,epoch:s.epoch,date:s.today,expectedLedgerRevision:s.customerLedger.revision,document:{customer:{id:'buyer',name:'首頁 <script>'},date:s.today,items:[{productId:'p',qty:1,unitPrice:price,expectedProduct:productReference(readRecords().data.pos2_products[0])}],note:''}},created=await commitBrowserSalesDocument(r,owner);expect(created.success,created.error).toBe(true);const result=await commitBrowserSalesDocument({id:'browser-deliver-'+(++index),time:r.time,kind:'sales',storeId:s.storeId,epoch:s.epoch,date:s.today,expectedLedgerRevision:s.customerLedger.revision,action:'deliver',orderId:created.document.id,expectedRevision:created.document.revision,quantities:[1],dueDate:s.today,handedOver:true},owner);expect(result.success,result.error).toBe(true);return result.document}

test('actual browser atomic storage keeps one received amount across two documents and quota rejection',async()=>{
  await customer();const received=await ledger(await request('receive',receiveInput())),a=await delivered(150),b=await delivered(250),snapshot=await state(),claims=customerOpenClaims(snapshot.documents,'buyer',snapshot.customerLedger.entries,snapshot.today),items=suggestCustomerAllocation(snapshot.customerLedger.receipts[0],claims)
  expect(items.map(row=>row.amount).sort((x,y)=>x-y)).toEqual([150,250]);await ledger(await request('allocate',{customerId:'buyer',receiptId:received.event.id,items,reviewed:true}))
  const saved=readRecords();expect(saved.data.pos2_cash_log).toHaveLength(1);expect(saved.data.pos2_products[0].stock).toBe(8);expect(saved.data.pos_customer_operations).toHaveLength(3);for(const doc of saved.data.pos_sales_documents)expect(salesSummary(doc,undefined,saved.data.pos_customer_entries).owed).toBe(0)
  const r=await request('refund',{customerId:'buyer',receiptId:received.event.id,amount:20,reason:'refund',shiftId:'shift',confirmed:true}),before=values.get(RECORD_KEY);quota=true
  const result=await commitBrowserCustomerLedger(r,owner);expect(result.success).toBe(false);expect(result.committed).toBe(false);expect(values.get(RECORD_KEY)).toBe(before);quota=false
  expect((await state()).customerLedger.receipts[0].available).toBe(100)
})

test('postcommit reply loss preserves the original journal and resolves exactly one browser receipt',async()=>{
  await customer();const stamped=await request('receive',receiveInput()),{id,time,...input}=stamped;let first=true;const persist=async r=>{const result=await commitBrowserCustomerLedger(r,owner);if(first){first=false;throw Error('fixture reply lost')}return result}
  await expect(executeFinancial('customer-ledger',input,persist,()=>{},{id,time})).rejects.toThrow('尚未確認');expect(readRecords().data.pos2_cash_log).toHaveLength(1);expect(readPendingFinancial().request.id).toBe(id)
  const result=await executeFinancial('customer-ledger',input,persist);expect(result.event.id).toBe(id);expect(readPendingFinancial()).toBe(null);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
})
test('draft preparation failure happens after journaling but before any persistence call',async()=>{
  await customer();const r=await request('receive',receiveInput()),{id,time,...input}=r,persist=vi.fn()
  let failure;try{await executeFinancial('customer-ledger',input,persist,()=>{},{id,time},null,prepared=>{expect(readPendingFinancial().request.id).toBe(id);expect(prepared.request.id).toBe(id);throw Error('fixture draft quota')})}catch(e){failure=e}
  expect(failure).toMatchObject({notCommitted:true,operationId:id});expect(persist).not.toHaveBeenCalled();expect(readPendingFinancial()).toBe(null);expect(readRecords().data.pos2_cash_log).toHaveLength(0)
})
test('preparation failure during an uncertain retry cannot clear an already committed original',async()=>{
  await customer();const r=await request('receive',receiveInput()),{id,time,...input}=r
  await expect(executeFinancial('customer-ledger',input,async request=>{await commitBrowserCustomerLedger(request,owner);throw Error('lost reply')},()=>{},{id,time})).rejects.toThrow('尚未確認')
  await expect(executeFinancial('customer-ledger',input,vi.fn(),()=>{},null,null,()=>{throw Error('draft blocked')})).rejects.toThrow('draft blocked');expect(readPendingFinancial().request.id).toBe(id);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
  await executeFinancial('customer-ledger',input,request=>commitBrowserCustomerLedger(request,owner));expect(readPendingFinancial()).toBe(null);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
})

test('two browser allocations using one reviewed version cannot spend one receipt twice',async()=>{
  await customer();const received=await ledger(await request('receive',{...receiveInput(),amount:150})),a=await delivered(150),b=await delivered(150)
  const input=async doc=>request('allocate',{customerId:'buyer',receiptId:received.event.id,items:[{documentId:doc.id,deliveryId:doc.deliveries[0].id,expectedRevision:doc.revision,amount:150}],reviewed:true}),ra=await input(a),rb=await input(b),results=await Promise.all([commitBrowserCustomerLedger(ra,owner),commitBrowserCustomerLedger(rb,owner)])
  expect(results.filter(r=>r.success)).toHaveLength(1);expect(results.filter(r=>r.committed===false)).toHaveLength(1);expect((await state()).customerLedger.receipts[0].available).toBe(0);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
})

test('complete browser restore retains original-ID fences for missing receipts and preserves a full recovery copy',async()=>{
  await customer();const older=structuredClone(readRecords().data),r=await request('receive',receiveInput());await ledger(r);const complete=structuredClone(readRecords().data);restoreRecords(older)
  const result=await commitBrowserCustomerLedger(r,owner);expect(result.success).toBe(false);expect(result.errorCode).toBe('RECOVERY_REQUIRED');expect(readRecords().data.pos2_cash_log).toHaveLength(0);expect(readRecords().recovery.snapshots.at(-1).data.pos_customer_entries).toHaveLength(2)
  restoreRecords(complete);expect((await commitBrowserCustomerLedger(r,owner)).success).toBe(true);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
})

test('missing new history cannot be silently written over a funded browser customer',async()=>{
  await customer();await ledger(await request('receive',receiveInput()));const record=readRecords(),before=values.get(RECORD_KEY)
  expect(()=>writeRecords({pos_customer_operations:[]},record.revision)).toThrow();expect(values.get(RECORD_KEY)).toBe(before)
  const r=await request('receive',receiveInput());expect(()=>commitBrowserCustomerLedger(r,{...owner,role:'staff'})).toThrow('權限');expect(values.get(RECORD_KEY)).toBe(before)
})

test('Agent receipt drafts require current store/customer, valid time and human confirmation at the real authority',async()=>{
  await customer();const now=Date.now(),draft={protocol:CUSTOMER_RECEIPT_DRAFT,id:'agent-receipt',issuedAt:new Date(now).toISOString(),storeId:context.storeId,customerId:'buyer',amount:50,method:'bank',note:'備註 <script>'},snapshot=await state(),options={storeId:context.storeId,customers:snapshot.customerLedger.customers,entries:[],now}
  expect(readCustomerReceiptDraft(JSON.stringify(draft),options).note).toBe('備註 <script>')
  for(const changed of [{storeId:'other'},{customerId:'unknown'},{confirmed:true},{method:'card'},{amount:-1},{issuedAt:'2026-02-30T01:00:00Z'},{id:'unsupported:colon'}])expect(()=>readCustomerReceiptDraft(JSON.stringify({...draft,...changed}),options)).toThrow()
  expect(()=>readCustomerReceiptDraft(JSON.stringify(draft),{...options,entries:[{id:draft.id}]})).toThrow('已有紀錄')
  const r=await request('receive',{customerId:'buyer',amount:50,method:'bank',shiftId:'',confirmed:false});expect((await commitBrowserCustomerLedger(r,owner)).success).toBe(false);expect(readRecords().data.pos_customer_entries).toHaveLength(1)
})
