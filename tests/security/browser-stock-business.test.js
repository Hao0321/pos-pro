// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import fixture from '../fixtures/stock-cost-native-v1.json'
import fixed from '../fixtures/browser-stock-command-v1.json'
import {bookToBrowser,browserToBook} from '../../electron/recoveryRules.mjs'
import {readRecords,writeRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {commitBrowserSale,commitBrowserRefund,browserReceipt} from '../../src/utils/browserSales'
import {commitBrowserInventory} from '../../src/utils/browserInventory'
import {commitBrowserRestaurant,browserRestaurantState} from '../../src/utils/browserRestaurant'
import {commitBrowserSalesDocument,getBrowserSalesState} from '../../src/utils/browserSalesDocuments'
import {getBrowserSupplierState} from '../../src/utils/browserSupplierLedger'
import {dbAddProduct,dbUpdateProduct,dbDeleteProduct,addWaste} from '../../src/utils/dataAccess'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {prepareCheckout} from '../../src/utils/checkoutSafety.mjs'
import {assertStoredBrowserCostReceipt} from '../../src/utils/browserStockBusiness'
import {planBrowserStockBusiness} from '../../electron/browserStockPlan.mjs'
import {executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'
import {createCheckoutCoordinator} from '../../src/utils/checkoutCoordinator.mjs'

function seed(){const book=structuredClone(fixture.book);book.settings=book.settings.map(row=>({...row,value:JSON.stringify(row.value)}));localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'browser-stock-fixed-epoch',data:bookToBrowser(book)}));return readRecords()}
const owner=fixed.actor,now=()=>new Date().toISOString(),ok=result=>{expect(result.success,result.error).toBe(true);return result}
const book=()=>browserToBook(readRecords().data),state=()=>validateStockCostBook(book()),stock=()=>book().products.find(row=>row.id==='p').stock
const effect=id=>state().projection.business.find(row=>row.id===id).effects
const sale=(id,qty=1)=>prepareCheckout({id,cart:[{id:'p',qty,price:100}],products:book().products,members:book().members,activeMember:null,pointsRule:{earn:10,redeem:1},birthdayBonus:100,openShift:book().shifts.find(row=>row.status==='open'),payMethod:'cash',paid:Math.round(qty*10000)/100,now:new Date(),opts:{cashier:owner.username}})
const refund=(id,refundOf,qty)=>({id,time:now(),refundOf,items:[{id:'p',qty}],reason:'Fixture return',cashier:owner.username,shiftId:'shift'})
async function inventory(kind,id,extra={}){const s=await getBrowserSupplierState(owner),po=s.purchases.find(row=>row.id===extra.purchaseId);return {kind,id,time:now(),supplierContext:{storeId:s.storeId,epoch:s.epoch,revision:s.supplierLedger.revision},...(po?{expectedPurchase:canonicalSignature(po)}:{}),...extra}}
async function purchase(id='new-po',qty=2,cost=.07){const p=book().products[0],supplier=book().suppliers[0];ok(await commitBrowserInventory(await inventory('purchase-create','create-'+id,{purchase:{id,supplierId:supplier.id,date:'2026-10-16',items:[{productId:p.id,name:p.name,unit:p.unit,qty,unitCost:cost,received:0}]}}),owner));return id}
async function restaurant(action,id,extra={}){return commitBrowserRestaurant({kind:'restaurant',action,id,time:now(),...extra},owner)}
async function configure(){const config=browserRestaurantState().config;ok(await restaurant('configure','enable-restaurant',{expectedConfig:canonicalSignature(config),config:{...config,enabled:true,dailyCapacity:100,slotCapacity:100}}))}
async function reserve(id='reservation'){return ok(await restaurant('create',id,{channel:'walkin',day:'2026-10-16',slot:'12:00',customer:'Fixture',contact:'',note:'',items:[{id:'p',qty:1,price:100}]})).entry}
async function transition(action,id,entryId,extra={}){const entry=browserRestaurantState().entries.find(row=>row.id===entryId);return ok(await restaurant(action,id,{entryId,expectedVersion:entry.version,...extra}))}
beforeEach(()=>{localStorage.clear();vi.useFakeTimers();vi.setSystemTime(new Date(fixed.clock));vi.stubGlobal('navigator',{locks:{request:async(_key,work)=>work()}})})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('commits the identical frozen standalone sale and cost acknowledgement from the unchanged native-derived source',async()=>{
  const before=seed(),result=await commitBrowserSale(structuredClone(fixed.request),fixed.actor)
  expect(result.success,result.error).toBe(true)
  expect(result.costReceipt).toMatchObject({success:true,id:fixed.request.id,sourceMethod:'checkout'})
  const saved=readRecords()
  expect(saved.data.pos2_products[0].stock).toBe(8)
  expect(saved.data.pos_stock_cost_entries).toHaveLength(before.data.pos_stock_cost_entries.length+1)
  expect(saved.data.pos_stock_cost_entries.slice(0,-1)).toEqual(before.data.pos_stock_cost_entries)
  const raw=localStorage.getItem(RECORD_KEY)
  expect(await commitBrowserSale(structuredClone(fixed.request),fixed.actor)).toEqual(result)
  expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
it('uses exact FIFO for a fractional sale, then returns the original intervals through partial and full refunds',async()=>{
  seed();await purchase();ok(await commitBrowserInventory(await inventory('receive','tiny-arrival',{purchaseId:'new-po',quantities:[2]}),owner))
  const request=sale('layered-sale',9.333).order;ok(await commitBrowserSale(request,owner));expect(effect(request.id)[0].cost.valueCents).toBe(27002);expect(stock()).toBe(1.667)
  const first=ok(await commitBrowserRefund(refund('part-return',request.id,.333),owner));expect(effect('part-return')[0].cost.valueCents).toBe(999);expect(stock()).toBe(2)
  ok(await commitBrowserRefund(refund('rest-return',request.id,9),owner));expect(stock()).toBe(11);expect(effect('part-return')[0].cost.valueCents+effect('rest-return')[0].cost.valueCents).toBe(27002)
  const before=localStorage.getItem(RECORD_KEY);expect(ok(await commitBrowserRefund(refund('part-return',request.id,.333),owner)).costReceipt).toEqual(first.costReceipt);expect(localStorage.getItem(RECORD_KEY)).toBe(before);expect(browserReceipt(request.id,owner).order.status).toBe('refunded')
})
it('adds known, unknown and zero-stock products and saves fractional waste without inventing a zero cost',async()=>{
  seed();const before=state().valuation.ownedKnownValueCents
  ok(await dbAddProduct({id:'new',name:'New',unit:'袋',stock:.003,cost:.07,price:1},owner));expect(state().valuation.ownedKnownValueCents-before).toBe(0)
  const input={id:'waste-new',time:now(),productId:'new',qty:.001,reason:'Fixture',cashier:owner.username};const first=ok(await addWaste(input,owner));expect(first.product.stock).toBe(.002);expect(effect(input.id)[0].cost.valueCents).toBe(0)
  ok(await dbAddProduct({id:'unknown',name:'Unknown',unit:'個',stock:1,cost:0,price:1},owner));expect(state().valuation.ownedValueCents).toBeNull();expect(state().projection.sourceEvidence.at(-1).basis).toBe('unknown')
  ok(await dbAddProduct({id:'empty',name:'Empty',unit:'個',stock:0,cost:0,price:1},owner));const emptyRaw=localStorage.getItem(RECORD_KEY);expect((await dbDeleteProduct('empty',owner)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(emptyRaw);expect((await dbUpdateProduct('empty',{unit:'袋'},owner)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(emptyRaw)
  const raw=localStorage.getItem(RECORD_KEY);expect(ok(await addWaste(input,owner)).costReceipt).toEqual(first.costReceipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
it('allows current metadata edits but preserves stock, historical units, pricing preconditions and old receipts',async()=>{
  seed();ok(await commitBrowserSale(fixed.request,owner));const before=structuredClone(state().projection)
  ok(await dbUpdateProduct('p',{price:120,cost:99,name:'Updated'},owner));expect(state().projection).toEqual(before)
  for(const data of [{stock:999},{unit:'袋'},{price:130,_expectedPricing:{price:100,cost:20}}]){const raw=localStorage.getItem(RECORD_KEY);expect((await dbUpdateProduct('p',data,owner)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)}
  const raw=localStorage.getItem(RECORD_KEY);expect((await dbDeleteProduct('p',owner)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw);expect((await commitBrowserSale(fixed.request,owner)).costReceipt.id).toBe(fixed.request.id)
})
it('holds paid and unpaid restaurant costs once, restores an unused reservation and keeps cooked cancellation as waste',async()=>{
  seed();await configure();await reserve('unused');expect(stock()).toBe(8);expect(state().valuation.ownedValueCents).toBe(27000)
  await transition('pay','unused-pay','unused',{shiftId:'shift',payMethod:'cash',paid:100});expect(stock()).toBe(8);expect(state().valuation.ownedValueCents).toBe(24000)
  await transition('cancel','unused-cancel','unused',{reason:'Fixture',shiftId:'shift'});expect(stock()).toBe(9);expect(state().valuation.ownedValueCents).toBe(27000)
  await reserve('cooked');await transition('advance','start-cooking','cooked',{status:'cooking'});await transition('cancel','unpaid-cooked-cancel','cooked',{reason:'Fixture'});expect(stock()).toBe(8);expect(effect('unpaid-cooked-cancel')[0].to.stage).toBe('wasted');expect(effect('unpaid-cooked-cancel')[0].cost.valueCents).toBe(3000)
  await reserve('paid-cooked');await transition('pay','paid-cooked-pay','paid-cooked',{shiftId:'shift',payMethod:'cash',paid:100});await transition('advance','paid-cooking','paid-cooked',{status:'cooking'});await transition('cancel','paid-cancel','paid-cooked',{reason:'Fixture',shiftId:'shift'});expect(stock()).toBe(7);expect(effect('paid-cancel')[0].from.stage).toBe('consumed');expect(effect('paid-cancel')[0].to.stage).toBe('wasted');expect(book().wasteLog).toHaveLength(2)
})
it('receives exact partial-purchase cents and distinguishes supplier credit from outgoing FIFO cost without new cash',async()=>{
  seed();await purchase();ok(await commitBrowserInventory(await inventory('receive','receipt-first',{purchaseId:'new-po',quantities:[.001]}),owner));ok(await commitBrowserInventory(await inventory('receive','receipt-rest',{purchaseId:'new-po',quantities:[1.999]}),owner));expect(stock()).toBe(11);expect(effect('receipt-first')[0].cost.valueCents).toBe(0);expect(effect('receipt-rest')[0].cost.valueCents).toBe(14)
  ok(await commitBrowserInventory(await inventory('purchase-bill','new-bill',{purchaseId:'new-po',quantities:[2],reference:'Fixture invoice',dueDate:'2026-10-16'}),owner))
  const request=await inventory('purchase-return','supplier-return',{purchaseId:'new-po',invoiceId:'new-bill',quantities:[1],reason:'Fixture'}),first=ok(await commitBrowserInventory(request,owner));expect(stock()).toBe(10);expect(effect(request.id)[0].cost.valueCents).toBe(3000);expect(book().cashLog).toHaveLength(0)
  const raw=localStorage.getItem(RECORD_KEY);expect(ok(await commitBrowserInventory(request,owner)).costReceipt).toEqual(first.costReceipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
it('delivers customer orders and preserves the original restock/dispose choice and actual cost',async()=>{
  seed();let s=await getBrowserSalesState(owner);const base={kind:'sales',time:now(),date:'2026-10-16',storeId:s.storeId,epoch:s.epoch},p=book().products[0]
  ok(await commitBrowserSalesDocument({...base,id:'sales-doc',action:'create',document:{customer:{id:'customer',name:'Fixture customer'},date:'2026-10-16',items:[{productId:p.id,qty:2,unitPrice:100,expectedProduct:{name:p.name,unit:p.unit,price:p.price}}],note:''}},owner))
  const run=async(action,id,extra)=>{s=await getBrowserSalesState(owner);return ok(await commitBrowserSalesDocument({...base,action,id,orderId:'sales-doc',expectedRevision:s.documents[0].revision,...extra},owner))}
  await run('deliver','delivery',{quantities:[2],dueDate:'2026-10-16',handedOver:true});expect(stock()).toBe(7);expect(effect('delivery')[0].cost.valueCents).toBe(6000)
  await run('return','restock-return',{deliveryId:'delivery',quantities:[1],restock:true,reason:'Fixture'});await run('return','dispose-return',{deliveryId:'delivery',quantities:[1],restock:false,reason:'Fixture'});expect(stock()).toBe(8);expect(effect('dispose-return')[0].to.stage).toBe('wasted');expect(state().valuation.ownedValueCents).toBe(24000)
})
it('rejects changed originals, stale new commands, forged accounts, staff refunds and uncoupled write options atomically',async()=>{
  seed();ok(await commitBrowserSale(fixed.request,owner));let raw=localStorage.getItem(RECORD_KEY)
  for(const [request,actor] of [[{...fixed.request,paid:101},owner],[sale('forged-sale').order,{...owner,username:'Forged'}],[{...sale('old-sale').order,time:'2026-10-16T00:00:00Z'},owner]]){expect((await commitBrowserSale(request,actor)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)}
  const record=readRecords();record.data.pos_users.push({id:'staff',username:'Staff',role:'staff'});localStorage.setItem(RECORD_KEY,JSON.stringify(record));raw=localStorage.getItem(RECORD_KEY)
  expect((await commitBrowserRefund(refund('staff-refund',fixed.request.id,1),{userId:'staff',username:'Staff',role:'staff'})).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
  const current=readRecords();expect(()=>writeRecords({pos2_products:current.data.pos2_products.map(p=>({...p,stock:999}))},current.revision,{allowStock:true})).toThrow(/店面電腦/);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
  const request=sale('exact-postimage').order,timestamp=now(),before=book(),planned=planBrowserStockBusiness(before,{epoch:current.salesEpoch,state:state(),timestamp},'checkout',request,owner);planned.book.members.push({id:'unrelated',name:'Injected'})
  expect(()=>writeRecords(bookToBrowser(planned.book),current.revision,{stockBusiness:{method:'checkout',request,actor:owner,timestamp}})).toThrow(/內容/);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
it('keeps the complete original record on quota failure and resolves a lost post-persist reply across restart',async()=>{
  seed();const raw=localStorage.getItem(RECORD_KEY),set=Storage.prototype.setItem;let mode='before'
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY&&mode==='before')throw new DOMException('Fixture quota','QuotaExceededError');set.call(this,key,value);if(key===RECORD_KEY&&mode==='after'){mode='none';throw Error('Fixture lost post-persist reply')}})
  let result=await commitBrowserSale(fixed.request,owner);expect(result.success).toBe(false);expect(result.committed).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
  mode='after';const first=ok(await commitBrowserSale(fixed.request,owner));expect(stock()).toBe(8);const committed=localStorage.getItem(RECORD_KEY);localStorage.setItem(RECORD_KEY,committed);expect(ok(await commitBrowserSale(fixed.request,owner))).toEqual(first);expect(localStorage.getItem(RECORD_KEY)).toBe(committed)
})
it('keeps the financial original when a browser cost acknowledgement is missing and resolves that original once',async()=>{
  seed();const input={productId:'p',qty:.333,reason:'Fixture',cashier:owner.username};let original
  await expect(executeFinancial('waste',input,async request=>{original=ok(await addWaste(request,owner));const reply={...original};delete reply.costReceipt;return reply},()=>{},{id:'pending-waste',time:now()})).rejects.toThrow(/成本回覆/)
  expect(readPendingFinancial().request.id).toBe('pending-waste');const count=readRecords().data.pos_stock_cost_entries.length
  expect(await executeFinancial('waste',input,request=>addWaste(request,owner))).toEqual(original);expect(readPendingFinancial()).toBeNull();expect(readRecords().data.pos_stock_cost_entries).toHaveLength(count);expect(stock()).toBe(8.667)
})
it('keeps the original checkout journal until its saved cost receipt passes verification',async()=>{
  seed();let pending=null,applied=0,damage=true;const plan=sale('pending-checkout')
  const coordinator=createCheckoutCoordinator({prepare:()=>plan,persist:async saved=>{const result=ok(await commitBrowserSale(saved.order,owner));if(damage)delete result.costReceipt;return result},lookup:id=>browserReceipt(id,owner),readPending:()=>pending,writePending:value=>{pending=value},clearPending:()=>{pending=null},apply:()=>{applied++},verifyReceipt:assertStoredBrowserCostReceipt.bind(null,'checkout'),replayVerified:true})
  const error=await coordinator.submit({}).catch(value=>value);expect(error.code).toBe('OUTCOME_UNKNOWN');expect(error.cause.message).toMatch(/成本回覆/);expect(pending.plan.order.id).toBe(plan.order.id);expect(applied).toBe(0);expect(stock()).toBe(8)
  damage=false;await coordinator.retry();expect(pending).toBeNull();expect(applied).toBe(1);expect(stock()).toBe(8)
})
it('preserves more than 50 fractional movements and the first original cost acknowledgement through a reload',async()=>{
  seed();let first,request
  for(let i=0;i<60;i++){const input={id:'history-'+i,time:now(),productId:'p',qty:.001,reason:'Fixture',cashier:owner.username},result=ok(await addWaste(input,owner));if(!i){first=result;request=input}}
  expect(stock()).toBe(8.94);const raw=localStorage.getItem(RECORD_KEY);localStorage.setItem(RECORD_KEY,raw);expect(ok(await addWaste(request,owner)).costReceipt).toEqual(first.costReceipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw);expect(state().projection.journals.every(row=>row.lines.reduce((sum,line)=>sum+BigInt(line.debitCents)-BigInt(line.creditCents),0n)===0n)).toBe(true)
},60000)
it('rejects missing cost history after an otherwise unchanged zero-stock product creation',async()=>{
  seed();ok(await dbAddProduct({id:'zero-history',name:'Empty',stock:0,unit:'個',price:1,cost:0},owner))
  const damaged=book();damaged.settings=damaged.settings.filter(row=>row.key!=='stockCostBookHead');damaged.stockCostEntries=structuredClone(fixture.book.stockCostEntries);damaged.stockCostOperations=structuredClone(fixture.book.stockCostOperations)
  expect(()=>validateStockCostBook(damaged)).toThrow(/成本回執/)
})
it('rejects missing cost history when a full sale and refund have returned stock to its original quantity',async()=>{
  seed();ok(await commitBrowserSale(fixed.request,owner));ok(await commitBrowserRefund(refund('full-refund',fixed.request.id,1),owner));expect(stock()).toBe(9)
  const damaged=book();damaged.settings=damaged.settings.filter(row=>row.key!=='stockCostBookHead');damaged.stockCostEntries=structuredClone(fixture.book.stockCostEntries);damaged.stockCostOperations=structuredClone(fixture.book.stockCostOperations)
  expect(()=>validateStockCostBook(damaged)).toThrow(/成本回執/)
})
it('rejects missing cost history for a restaurant stage change that leaves available and reserved quantities unchanged',async()=>{
  seed();await configure();await reserve();const before=book();await transition('advance','missing-stage-cost','reservation',{status:'cooking'})
  const damaged=book();damaged.settings=damaged.settings.filter(row=>row.key!=='stockCostBookHead');damaged.stockCostEntries=before.stockCostEntries;damaged.stockCostOperations=before.stockCostOperations
  expect(()=>validateStockCostBook(damaged)).toThrow(/成本回執/)
})
it('rejects missing all cost history after a zero-effect operation instead of treating the book as inactive',async()=>{
  seed();ok(await dbAddProduct({id:'empty-protected',name:'Empty',stock:0,unit:'個',price:1,cost:0},owner))
  const damaged=book();damaged.stockCostEntries=[];damaged.stockCostOperations=[]
  expect(()=>validateStockCostBook(damaged)).toThrow(/成本回執/)
})
it('binds the last cost event in the same book and denies direct changes to that binding',async()=>{
  seed();const result=ok(await commitBrowserSale(fixed.request,owner)),saved=book(),anchor=saved.settings.find(row=>row.key==='stockCostBookHead')
  expect(JSON.parse(anchor.value)).toBe(result.costReceipt.eventHash)
  for(const value of ['not-json',JSON.stringify('sha256:'+'0'.repeat(64))]){const damaged=structuredClone(saved);damaged.settings.find(row=>row.key==='stockCostBookHead').value=value;expect(()=>validateStockCostBook(damaged)).toThrow(/成本回執/)}
  const record=readRecords(),raw=localStorage.getItem(RECORD_KEY);expect(()=>writeRecords({pos_business_settings:record.data.pos_business_settings.filter(row=>row.key!=='stockCostBookHead')},record.revision)).toThrow(/最後紀錄/);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
