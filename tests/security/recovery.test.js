// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {readRecords,writeRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {addCashLog,addTopup,addWaste} from '../../src/utils/dataAccess'
import * as recovery from '../../src/utils/browserRecovery'
import {commitBrowserSale,commitBrowserRefund,browserReceipt} from '../../src/utils/browserSales'
import {prepareCheckout} from '../../src/utils/checkoutSafety.mjs'
import {createCheckoutCoordinator,CHECKOUT_PROTOCOL} from '../../src/utils/checkoutCoordinator.mjs'
import {executeFinancial,FINANCIAL_PENDING} from '../../src/utils/financialCommand'
import {commitBrowserInventory} from '../../src/utils/browserInventory'
import {commitBrowserRestaurant,browserRestaurantState} from '../../src/utils/browserRestaurant'
import {commitBrowserExchange,getBrowserExchangeContext} from '../../src/utils/browserExchange'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {productReference,QUOTE_PRICING} from '../../electron/businessExchange.mjs'
import {exportRecoverySource as downloadSource} from '../../src/utils/recoveryClient'
import {importBackupFile} from '../../src/utils/security'

const owner={userId:'owner',username:'Owner',role:'owner'},time='2026-10-16T00:00:00Z'
const cash={id:'cash-original',shiftId:'shift',time,type:'in',amount:5,reason:'Actual cash',cashier:'Owner'}
beforeEach(()=>{
  localStorage.clear();vi.stubGlobal('navigator',{languages:['zh-TW'],language:'zh-TW',locks:{request:async(_name,fn)=>fn()}})
  writeRecords({pos_users:[{id:'owner',username:'Owner',role:'owner',password:'current-credential'}],
    pos_business_settings:[{key:'sharedStoreId',value:JSON.stringify('browser-recovery-store')}],
    pos2_products:[{id:'p',name:'Product',unit:'個',price:10,cost:4,stock:5}],
    pos2_members:[{id:'m',name:'Member',balance:0,points:0}],
    pos2_shifts:[{id:'shift',status:'open',openCash:100,openTime:time,cashier:'Owner'}]})
})
afterEach(()=>vi.unstubAllGlobals())
const preview=()=>recovery.previewRestore({kind:'import',data:structuredClone(readRecords().data)},owner)
const confirmRecovery=async pending=>{
  const state=await recovery.getRecoveryState(pending,owner),source=state.sources.find(s=>s.canRecover)
  expect(source).toBeTruthy()
  const request={id:'recovery-test-'+crypto.randomUUID(),sourceId:source.id,expectedRevision:state.revision,pending}
  const result=await recovery.applyRecoveryOperation(request,owner)
  return {request,result}
}
async function roundTrip(pending,commit){
  const target=structuredClone(readRecords().data),first=await commit();expect(first.success,first.error).toBe(true)
  const original=structuredClone(readRecords().data),p=await recovery.previewRestore({kind:'import',data:target},owner)
  await recovery.applyRestorePreview(p.id,owner);const before=localStorage.getItem(RECORD_KEY)
  expect((await commit()).committed).toBeNull();expect(localStorage.getItem(RECORD_KEY)).toBe(before)
  const content=data=>canonicalSignature(Object.fromEntries(Object.entries(data).map(([key,rows])=>[key,[...rows].sort((a,b)=>String(a.id??a.key).localeCompare(String(b.id??b.key)))])))
  await confirmRecovery(pending);expect(content(readRecords().data)).toBe(content(original))
  expect((await commit()).success).toBe(true);expect(content(readRecords().data)).toBe(content(original))
}

it('confirms a lost original checkout after cumulative partial and full refunds without restoring its paid status or applying stock again',async()=>{
  const data=readRecords().data,plan=prepareCheckout({cart:[{...data.pos2_products[0],qty:1}],products:data.pos2_products,members:[],activeMember:null,pointsRule:{earn:10,redeem:1},birthdayBonus:0,openShift:data.pos2_shifts[0],payMethod:'cash',paid:10,pointsUsed:0,opts:{cashier:'Owner'},id:'checkout-refunded',now:new Date(time)})
  expect((await commitBrowserSale(plan.order)).success).toBe(true)
  for(const [id,qty] of [['refund-quarter',.25],['refund-rest',.75]])expect((await commitBrowserRefund({id,time,refundOf:plan.order.id,items:[{id:'p',qty}],reason:'actual refund',shiftId:'shift',cashier:'Owner'})).success).toBe(true)
  const real=browserReceipt(plan.order.id)
  for(const refunds of [undefined,real.refunds.slice(1),[real.refunds[0],real.refunds[0]],[{...real.refunds[0],total:-99},real.refunds[1]]]){
    let saved={version:1,protocol:CHECKOUT_PROTOCOL,plan},applied=false
    const invalid=createCheckoutCoordinator({prepare:()=>plan,persist:()=>{},lookup:()=>({...real,refunds}),readPending:()=>saved,writePending:()=>{},clearPending:()=>{saved=null},apply:()=>{applied=true}})
    invalid.restore();await expect(invalid.reconcile()).rejects.toMatchObject({code:'OUTCOME_UNKNOWN'});expect(saved).toBeTruthy();expect(applied).toBe(false)
  }
  let journal={version:1,protocol:CHECKOUT_PROTOCOL,plan},applied
  const coordinator=createCheckoutCoordinator({prepare:()=>{throw Error('no new sale')},persist:()=>{throw Error('read only')},lookup:browserReceipt,readPending:()=>journal,writePending:()=>{throw Error('keep original')},clearPending:id=>{expect(id).toBe(plan.order.id);journal=null},apply:receipt=>{applied=receipt}})
  coordinator.restore();const before=localStorage.getItem(RECORD_KEY),order=await coordinator.reconcile()
  expect(order.status).toBe('refunded');expect(applied.order.status).toBe('refunded');expect(journal).toBeNull()
  expect(localStorage.getItem(RECORD_KEY)).toBe(before);expect(readRecords().data.pos2_products[0].stock).toBe(5)
  expect((await commitBrowserSale(plan.order)).success).toBe(true);expect(readRecords().data.pos2_orders).toHaveLength(3)
})

it('atomically retains an original cash receipt and recovers it once through the browser adapter',async()=>{
  const target=structuredClone(readRecords().data)
  expect((await addCashLog(cash)).success).toBe(true)
  const p=await recovery.previewRestore({kind:'import',data:target},owner)
  await recovery.applyRestorePreview(p.id,owner)
  expect(readRecords().data.pos2_cash_log).toHaveLength(0)
  expect((await addCashLog(cash)).committed).toBeNull()
  const pending={kind:'cashlog',request:cash},{request,result}=await confirmRecovery(pending)
  expect(result.originalOperationId).toBe(cash.id)
  expect(readRecords().data.pos2_cash_log).toEqual([cash])
  expect((await recovery.applyRecoveryOperation(request,owner)).id).toBe(result.id)
  expect((await addCashLog(cash)).success).toBe(true)
  expect(readRecords().data.pos2_cash_log).toHaveLength(1)
})
it('rejects a stale browser restore preview and preserves all new business data',async()=>{
  const p=await preview();await addCashLog(cash);const before=localStorage.getItem(RECORD_KEY)
  await expect(recovery.applyRestorePreview(p.id,owner)).rejects.toThrow(/已改變/)
  expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})
it('a quota failure preserves the active record, preimages, operation index and absent restore receipt',async()=>{
  const p=await preview(),before=localStorage.getItem(RECORD_KEY),original=Storage.prototype.setItem
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY)throw new DOMException('full','QuotaExceededError');return original.call(this,key,value)})
  try{await expect(recovery.applyRestorePreview(p.id,owner)).rejects.toThrow('full');expect(localStorage.getItem(RECORD_KEY)).toBe(before);expect((await recovery.lookupRestorePreview(p.id,owner)).found).toBe(false)}finally{vi.restoreAllMocks()}
})
it('never clears an original topup/loss as a pre-commit failure after an older restore',async()=>{
  const target=structuredClone(readRecords().data),topup={id:'topup',time,memberId:'m',amount:10,bonus:0,payMethod:'cash',shiftId:'shift',cashier:'Owner',note:''},waste={id:'waste',time,productId:'p',qty:.25,reason:'damaged',cashier:'Owner'}
  expect((await addTopup(topup)).success).toBe(true);expect((await addWaste(waste)).success).toBe(true)
  const p=await recovery.previewRestore({kind:'import',data:target},owner);await recovery.applyRestorePreview(p.id,owner)
  expect((await addTopup(topup)).committed).toBeNull();expect((await addWaste(waste)).committed).toBeNull()
  await confirmRecovery({kind:'topup',request:topup})
  expect(readRecords().data.pos2_members[0].balance).toBe(10);expect(readRecords().data.pos2_products[0].stock).toBe(4.75)
})
it('blocks automatic recovery after business drift while permitting preserved ordinary audit traffic',async()=>{
  const target=structuredClone(readRecords().data);await addCashLog(cash)
  const p=await recovery.previewRestore({kind:'import',data:target},owner);await recovery.applyRestorePreview(p.id,owner)
  let record=readRecords();writeRecords({pos_audit_log:[{id:'audit-login',action:'LOGIN',timestamp:time}]},record.revision)
  expect((await recovery.getRecoveryState({kind:'cashlog',request:cash},owner)).sources[0].canRecover).toBe(true)
  record=readRecords();writeRecords({pos2_products:record.data.pos2_products.map(p=>({...p,name:'New actual name'}))},record.revision)
  const state=await recovery.getRecoveryState({kind:'cashlog',request:cash},owner)
  expect(state.sources[0].canRecover).toBe(false)
  const before=localStorage.getItem(RECORD_KEY)
  await expect(recovery.applyRecoveryOperation({id:'recovery-drift',sourceId:state.sources[0].id,expectedRevision:state.revision,pending:{kind:'cashlog',request:cash}},owner)).rejects.toThrow(/已有新資料/)
  expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})

it('protects real browser purchase receipt/payment/return/refund, stocktake and quote originals',async()=>{
  writeRecords({pos_suppliers:[{id:'supplier',name:'Supplier'}]},readRecords().revision)
  let request={id:'po-create',kind:'purchase-create',time,purchase:{id:'po',supplierId:'supplier',date:time.slice(0,10),items:[{productId:'p',name:'Product',unit:'個',qty:2,unitCost:4}]}}
  await roundTrip({kind:request.kind,request},()=>commitBrowserInventory(request,owner))
  for(const [kind,id,extra]of [['receive','po-receive',{quantities:[2]}],['purchase-bill','po-bill',{reference:'SUP-001',quantities:[2],dueDate:time.slice(0,10)}],['purchase-pay','po-pay',{invoiceId:'po-bill',amount:8,method:'cash',shiftId:'shift'}],['purchase-return','po-return',{invoiceId:'po-bill',quantities:[1],reason:'actual damaged delivery'}],['purchase-refund','po-refund',{invoiceId:'po-bill',amount:4,method:'cash',shiftId:'shift'}],['purchase-refund-reverse','po-refund-correction',{refundId:'po-refund',reason:'actual correction',shiftId:'shift'}]]){
    request={id,kind,time,purchaseId:'po',expectedPurchase:canonicalSignature(readRecords().data.pos_purchases[0]),...extra}
    await roundTrip({kind,request},()=>commitBrowserInventory(request,owner))
  }
  request={id:'count',kind:'stocktake',time,counts:[{id:'p',expectedStock:6,stock:5.5}],reason:'actual count'}
  await roundTrip({kind:'stocktake',request},()=>commitBrowserInventory(request,owner))
  const context=await getBrowserExchangeContext(owner)
  request={id:'quote',kind:'exchange',time:new Date().toISOString(),storeId:context.storeId,expectedRevision:context.state.revision,quoteId:'',expectedQuoteRevision:0,recipient:{id:'buyer',name:'Buyer'},validUntil:new Date(Date.now()+86400000).toISOString(),items:[{productId:'p',qty:1,unitPrice:10,expectedProduct:productReference(readRecords().data.pos2_products[0])}],rememberPrices:true,note:'',pricing:QUOTE_PRICING}
  await roundTrip({kind:'exchange',request},()=>commitBrowserExchange(request,owner))
})
it('protects real browser restaurant reserve, pay and cancel originals',async()=>{
  const config=browserRestaurantState().config
  expect((await commitBrowserRestaurant({id:'configure',kind:'restaurant',action:'configure',time,expectedConfig:canonicalSignature(config),config:{...config,enabled:true}},owner)).success).toBe(true)
  let request={id:'reservation',kind:'restaurant',action:'create',time,day:time.slice(0,10),slot:'12:00',channel:'walkin',customer:'Customer',contact:'',note:'',items:[{id:'p',qty:1,price:10}]}
  await roundTrip({kind:'restaurant',request},()=>commitBrowserRestaurant(request,owner))
  for(const [id,action,extra]of [['payment','pay',{shiftId:'shift',payMethod:'cash',paid:10}],['cancel','cancel',{reason:'actual cancellation',shiftId:'shift'}]]){
    request={id,kind:'restaurant',action,time,entryId:'reservation',expectedVersion:browserRestaurantState().entries[0].version,...extra}
    await roundTrip({kind:'restaurant',request},()=>commitBrowserRestaurant(request,owner))
  }
})
it('preserves conflicting branches and refuses a different active original amount',async()=>{
  await addCashLog(cash);const target=structuredClone(readRecords().data);target.pos2_cash_log[0].amount=3
  const p=await recovery.previewRestore({kind:'import',data:target},owner);await recovery.applyRestorePreview(p.id,owner)
  const before=localStorage.getItem(RECORD_KEY);expect((await addCashLog(cash)).committed).toBeNull()
  const state=await recovery.getRecoveryState({kind:'cashlog',request:cash},owner);expect(state.active).toBe('different');expect(state.sources.every(s=>!s.canRecover)).toBe(true);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})
it('retains older financial journals and requires actual matching evidence before replaying them',async()=>{
  const {id,time:at,...input}=cash
  const old={kind:'cashlog',signature:JSON.stringify({kind:'cashlog',input}),request:cash}
  localStorage.setItem(FINANCIAL_PENDING,JSON.stringify(old));let sends=0
  const persist=async request=>{sends++;return addCashLog(request)}
  await expect(executeFinancial('cashlog',input,persist)).rejects.toThrow(/舊版/);expect(sends).toBe(0);expect(localStorage.getItem(FINANCIAL_PENDING)).toBe(JSON.stringify(old))
  await expect(executeFinancial('cashlog',input,persist,()=>{},null,async pending=>(await recovery.getRecoveryState(pending,owner)).active==='matched')).rejects.toThrow(/舊版/);expect(sends).toBe(0)
  await addCashLog(cash)
  expect((await executeFinancial('cashlog',input,persist,()=>{},null,async pending=>(await recovery.getRecoveryState(pending,owner)).active==='matched')).success).toBe(true);expect(sends).toBe(1);expect(readRecords().data.pos2_cash_log).toHaveLength(1);expect(localStorage.getItem(FINANCIAL_PENDING)).toBeNull()
})
it('exports exact original corrupt bytes for review while preserving a pending journal and refusing ordinary restore',async()=>{
  const target=structuredClone(readRecords().data);await addCashLog(cash)
  const p=await recovery.previewRestore({kind:'import',data:target},owner);await recovery.applyRestorePreview(p.id,owner)
  const record=JSON.parse(localStorage.getItem(RECORD_KEY));record.recovery.snapshots[0].data.pos2_cash_log[0].amount=99
  localStorage.setItem(RECORD_KEY,JSON.stringify(record));const before=localStorage.getItem(RECORD_KEY),journal='unreadable-but-preserve-original';localStorage.setItem(FINANCIAL_PENDING,journal)
  await expect(recovery.getRecoveryState({kind:'cashlog',request:cash},owner)).rejects.toThrow(/保護副本需要核對/)
  const diagnostic=await recovery.exportRecoveryDiagnostics(null,owner);expect(diagnostic.importable).toBe(false);expect(diagnostic.raw[RECORD_KEY]).toBe(before);expect(diagnostic.raw[FINANCIAL_PENDING]).toBe(journal)
  await expect(recovery.previewRestore({kind:'import',data:diagnostic},owner)).rejects.toThrow(/備份格式/);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
  localStorage.setItem(RECORD_KEY,'{broken-json');expect((await recovery.exportRecoveryDiagnostics(null,owner)).raw[RECORD_KEY]).toBe('{broken-json')
})
it('downloads a protected source in the ordinary backup envelope and reimports it only as a reviewable preview',async()=>{
  const target=structuredClone(readRecords().data);await addCashLog(cash)
  const p=await recovery.previewRestore({kind:'import',data:target},owner);await recovery.applyRestorePreview(p.id,owner)
  const state=await recovery.getRecoveryState({kind:'cashlog',request:cash},owner);let downloaded
  let released;const release=new Promise(resolve=>{released=resolve}),create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
  URL.createObjectURL=blob=>{downloaded=blob;return 'blob:protected-source'};URL.revokeObjectURL=()=>released()
  try{
    await downloadSource(state.sources[0].id,owner);expect(click).toHaveBeenCalledOnce()
    const text=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(downloaded)})
    const parsed=JSON.parse(text);expect(parsed.storage).toBe('browser');expect(parsed.data.pos2_cash_log).toEqual([cash])
    const before=localStorage.getItem(RECORD_KEY),preview=await importBackupFile(new File([text],'protected.json',{type:'application/json'}),owner)
    expect(preview.target.cashLogs).toBe(1);expect(preview.current.cashLogs).toBe(0);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
    await recovery.applyRestorePreview(preview.id,owner);expect(readRecords().data.pos2_cash_log).toEqual([cash])
  }finally{await release;URL.createObjectURL=create;URL.revokeObjectURL=revoke;click.mockRestore()}
})
