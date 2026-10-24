// @vitest-environment jsdom
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import fixture from '../fixtures/lot-count-native-v1.json'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {unpackRecoveryGraph} from '../../electron/recoveryGraph.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {makeReceiptReview} from '../../electron/receiptReview.mjs'
import {PURCHASE_UNITS_SETTING,purchaseSourceSignature} from '../../electron/purchaseUnitPricing.mjs'
import {readRecords,writeRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {commitBrowserInventory} from '../../src/utils/browserInventory'
import {getBrowserSupplierState} from '../../src/utils/browserSupplierLedger'
import {getBrowserLotState} from '../../src/utils/browserLots'
import {exportBrowserFullBackup} from '../../src/utils/browserRecovery'
import {executeFinancial,readPendingFinancial,assertReceipt} from '../../src/utils/financialCommand'
const owner={userId:'owner',username:'Lot fixture',role:'owner'},staff={userId:'staff',username:'Lot staff',role:'staff'},ok=result=>{expect(result.success,result.error).toBe(true);return result},raw=()=>localStorage.getItem(RECORD_KEY),book=()=>browserToBook(readRecords().data)
let serial=0
beforeEach(()=>{localStorage.clear();serial=0;vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-19T12:00:00.000Z'));vi.stubGlobal('navigator',{locks:{request:async(_key,work)=>work()}})})
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals()})
function seed(mode){
 if(mode==='active'){const packet=readPortableBackup(fixture,'browser'),graph=unpackRecoveryGraph(packet.protection,'browser');localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'unit-browser',data:packet.book,recovery:{version:packet.protection.version,snapshots:graph.snapshots.map(row=>({...row,data:row.storage==='sqlite'?row.data:JSON.parse(row.data)})),originalIds:graph.originalIds,events:graph.events.map(row=>({...row,receipt:JSON.parse(row.receipt)}))}}))}
 else{localStorage.setItem('pos_users',JSON.stringify(fixture.book.users));localStorage.setItem('pos2_products',JSON.stringify([{...fixture.book.products[0],stock:0}]));localStorage.setItem('pos_suppliers',JSON.stringify([{id:'supplier',name:'Unit supplier',catalog:[]}]))}
}
async function command(kind,extra={}){const s=await getBrowserSupplierState(owner),po=s.purchases.find(row=>row.id===extra.purchaseId),request={kind,id:'unit-browser-'+(++serial),time:new Date().toISOString(),supplierContext:{storeId:s.storeId,epoch:s.epoch,revision:s.supplierLedger.revision},...(po?{expectedPurchase:canonicalSignature(po)}:{}),...extra};if(kind==='purchase-create-units')request.unitReview.sourceSignature=purchaseSourceSignature(request.purchase,{products:book().products,suppliers:s.suppliers});return request}
const basis={protocol:'pos-purchase-units/v1',purchasedUnit:'袋',purchasedQuantity:'01.000',baseQuantityPerUnit:'03.0',purchasedUnitPrice:'0100.00'}
async function create(id='unit-po',unfiled=false){return command('purchase-create-units',{unitReview:{protocol:'pos-purchase-units-review/v1',confirmed:true},purchase:{id,supplierId:'supplier',date:'2026-10-19',items:[{productId:unfiled?null:'rice',catalogId:unfiled?'unit-catalog':null,name:'Unit rice 原文',unit:'公斤',qty:3,costBasis:structuredClone(basis)}]}})}
async function receive(mode,id,n){if(mode!=='active')return command('receive',{purchaseId:id,quantities:[1]});const s=await getBrowserLotState(owner);return command('receive-lots',{purchaseId:id,quantities:[1],lots:{protocol:'pos-receipt-lots/v1',storeId:s.context.storeId,epoch:s.context.epoch,expectedStateDigest:s.context.stateDigest,allocations:[{lineIndex:0,quantityUnits:1000,locationId:'main',code:'unit-'+n,expiryMode:'dated',expiryDate:'2026-10-21'}],newItems:[]}})}
test.each(['reference','active'])('actual %s storage keeps three receipts, invoice and three physical returns at the original 100.00',async mode=>{
 seed(mode);const input=await create(),initial=book();const result=ok(await commitBrowserInventory(input,owner));assertReceipt(input.kind,input,result);expect(result.purchase.total).toBe(100);expect(result.purchase.items[0].costBasis).toEqual(basis);expect(book().settings.find(row=>row.key===PURCHASE_UNITS_SETTING)?.value).toBe('1');const oldSources=mode==='active'?validateStockCostBook(book()).projection.custody.sources.length:0
 for(let n=1;n<=3;n++)ok(await commitBrowserInventory(await receive(mode,'unit-po',n),owner))
 let po=book().purchases.find(row=>row.id==='unit-po');expect(po.procurement.receipts.map(row=>row.amount)).toEqual([33.33,33.34,33.33]);expect(book().products.find(row=>row.id==='rice').stock).toBe(initial.products.find(row=>row.id==='rice').stock+3)
 if(mode==='active')expect(validateStockCostBook(book()).projection.custody.sources.slice(oldSources).map(row=>row.valueCents)).toEqual([3333,3334,3333])
 const bill=await command('purchase-bill',{purchaseId:po.id,quantities:[3],reference:'Whole bag invoice',dueDate:'2026-10-21'});ok(await commitBrowserInventory(bill,owner))
 for(let n=1;n<=3;n++){let extra={purchaseId:po.id,invoiceId:bill.id,reason:'Supplier confirmed',quantities:[1]},kind='purchase-return';if(mode==='active'){const s=await getBrowserLotState(owner),row=s.counting.rows.find(row=>row.code==='unit-'+n);expect(row).toBeTruthy();kind='purchase-return-lots';extra={...extra,lots:{protocol:'pos-supplier-lot-return/v1',storeId:s.context.storeId,epoch:s.context.epoch,expectedStateDigest:s.context.stateDigest,allocations:[{lineIndex:0,key:row.key,quantityUnits:1000}],confirmation:{received:true,creditAccepted:true,reference:'Supplier R-'+n}}}}const r=await command(kind,extra);assertReceipt(kind,r,ok(await commitBrowserInventory(r,owner)))}
 po=book().purchases.find(row=>row.id==='unit-po');expect(po.procurement.returns.map(row=>row.amount)).toEqual([33.33,33.34,33.33]);expect(book().products.find(row=>row.id==='rice').stock).toBe(initial.products.find(row=>row.id==='rice').stock);expect(book().cashLog).toEqual(initial.cashLog)
 const backup=await exportBrowserFullBackup(owner);expect(backup.features).toContain('procurement-unit-pricing-v1');expect(readPortableBackup(backup,'sqlite').book.purchases.find(row=>row.id===po.id).items[0].costBasis).toEqual(basis)
},30000)
test('reference storage recovers a post-write lost acknowledgement and confirms the same original once',async()=>{
 seed('reference');const input=await create(),setter=Storage.prototype.setItem;let lost=false;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){const result=setter.call(this,key,value);if(key===RECORD_KEY&&!lost){lost=true;throw Error('fixture lost unit acknowledgement')}return result})
 const {id,time,...body}=input,result=await executeFinancial(input.kind,body,request=>commitBrowserInventory(request,owner),()=>{},{id,time});expect(result.purchase.total).toBe(100);expect(readPendingFinancial()).toBe(null);expect(book().purchases.filter(row=>row.id==='unit-po')).toHaveLength(1);const once=raw();ok(await commitBrowserInventory(input,owner));expect(raw()).toBe(once)
},15000)
test('quota failure, invalid facts, stale scope, staff and forged owner preserve the complete record',async()=>{
 seed('reference');const input=await create(),before=raw();for(const mutate of [r=>r.unitReview.confirmed=false,r=>r.purchase.items[0].qty=2.999,r=>r.purchase.items[0].unit='瓶',r=>r.purchase.items[0].unitCost=33.33,r=>r.purchase.items[0].costBasis.purchasedUnitPrice='1e2',r=>r.supplierContext.epoch='restored',r=>r.supplierContext.storeId='other',r=>r.supplierContext.revision++]){const bad=structuredClone(input);mutate(bad);expect((await commitBrowserInventory(bad,owner)).success).toBe(false);expect(raw()).toBe(before)}
 await expect(async()=>commitBrowserInventory(input,staff)).rejects.toThrow('權限不足');expect(raw()).toBe(before);expect((await commitBrowserInventory(input,{...owner,userId:'forged'})).success).toBe(false);expect(raw()).toBe(before)
 const setter=Storage.prototype.setItem,spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY)throw Error('fixture unit quota');return setter.call(this,key,value)});expect((await commitBrowserInventory(input,owner)).success).toBe(false);expect(raw()).toBe(before);spy.mockRestore();ok(await commitBrowserInventory(input,owner));expect(input.purchase.items[0].costBasis).toEqual(basis)
},15000)
test('catalogue packaging needs an explicit new-SKU sale price, keeps original cost and links the real base unit',async()=>{
 seed('reference');await getBrowserSupplierState(owner);let r=readRecords();writeRecords({pos_suppliers:r.data.pos_suppliers.map(row=>({...row,catalog:[{id:'unit-catalog',name:'New rice',unit:'袋',cost:100,productId:null}]}))},r.revision);ok(await commitBrowserInventory(await create('new-unit-po',true),owner));const input=await command('receive',{purchaseId:'new-unit-po',quantities:[3]}),before=raw();expect((await commitBrowserInventory(input,owner)).success).toBe(false);expect(raw()).toBe(before)
 const reviewed={...input,kind:'receive-reviewed',newItems:[{lineIndex:0,priceCents:4500}]};reviewed.receiptReview=makeReceiptReview(reviewed,{...book(),...input.supplierContext});const saved=ok(await commitBrowserInventory(reviewed,owner));expect(saved.products[0]).toMatchObject({unit:'公斤',stock:3,price:45,cost:33.33});expect(saved.purchase.procurement.receipts[0].amount).toBe(100);expect(saved.supplier.catalog[0].productId).toBe(saved.products[0].id);assertReceipt('receive-reviewed',reviewed,saved)
},15000)
test('an existing SKU cannot be repriced through a package receipt or lose its feature fence',async()=>{
 seed('reference');ok(await commitBrowserInventory(await create(),owner));let before=raw(),input=await command('receive',{purchaseId:'unit-po',quantities:[1],newItems:[{lineIndex:0,priceCents:999999}]});expect((await commitBrowserInventory(input,owner)).success).toBe(false);expect(raw()).toBe(before)
 const r=readRecords();expect(()=>writeRecords({pos_business_settings:r.data.pos_business_settings.filter(row=>row.key!==PURCHASE_UNITS_SETTING)},r.revision)).toThrow();expect(raw()).toBe(before)
},15000)
