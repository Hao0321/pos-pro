// @vitest-environment jsdom
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import fixture from '../fixtures/lot-count-native-v1.json'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {unpackRecoveryGraph} from '../../electron/recoveryGraph.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {readRecords,writeRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {getBrowserLotState,commitBrowserLot} from '../../src/utils/browserLots'
import {commitBrowserInventory} from '../../src/utils/browserInventory'
import {getBrowserSupplierState} from '../../src/utils/browserSupplierLedger'
import {exportBrowserFullBackup} from '../../src/utils/browserRecovery'
import {executeFinancial,readPendingFinancial,assertReceipt} from '../../src/utils/financialCommand'
const owner={userId:'owner',username:'Lot fixture',role:'owner'},staff={userId:'staff',username:'Lot staff',role:'staff'}
const record=()=>readRecords(),book=()=>browserToBook(record().data),state=()=>validateStockCostBook(book()),raw=()=>localStorage.getItem(RECORD_KEY),ok=result=>{expect(result.success,result.error).toBe(true);return result}
let serial=0
beforeEach(()=>{localStorage.clear();serial=0;vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-19T12:00:00.000Z'));vi.stubGlobal('navigator',{locks:{request:async(_key,work)=>work()}});const packet=readPortableBackup(fixture,'browser'),graph=unpackRecoveryGraph(packet.protection,'browser');localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'receipt-browser',data:packet.book,recovery:{version:packet.protection.version,snapshots:graph.snapshots.map(row=>({...row,data:row.storage==='sqlite'?row.data:JSON.parse(row.data)})),originalIds:graph.originalIds,events:graph.events.map(row=>({...row,receipt:JSON.parse(row.receipt)}))}}))})
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals()})
async function inventory(kind,extra={}){const s=await getBrowserSupplierState(owner),po=s.purchases.find(row=>row.id===extra.purchaseId);return {kind,id:'arrival-case-'+(++serial),time:new Date().toISOString(),supplierContext:{storeId:s.storeId,epoch:s.epoch,revision:s.supplierLedger.revision},...(po?{expectedPurchase:canonicalSignature(po)}:{}),...extra}}
async function purchase(unfiled=false){if(unfiled){const r=record();writeRecords({pos_suppliers:r.data.pos_suppliers.map(row=>({...row,catalog:[{id:'unfiled',name:'Rice arrival',unit:'公斤',cost:.07,productId:null}]}))},r.revision)}ok(await commitBrowserInventory(await inventory('purchase-create',{purchase:{id:'arrival-po',supplierId:'supplier',date:'2026-10-19',items:[{productId:unfiled?null:'rice',catalogId:unfiled?'unfiled':null,name:'Rice arrival',unit:'公斤',qty:2,unitCost:.07,received:0}]}}),owner))}
const allocation=(quantityUnits,locationId='main',expiryMode='dated',expiryDate='2026-10-21')=>({lineIndex:0,quantityUnits,locationId,code:'Batch A',expiryMode,expiryDate})
async function receipt(allocations=[allocation(2000)],newItems=[]){const {context}=await getBrowserLotState(owner);return inventory('receive-lots',{purchaseId:'arrival-po',quantities:[2],lots:{protocol:'pos-receipt-lots/v1',storeId:context.storeId,epoch:context.epoch,expectedStateDigest:context.stateDigest,allocations,newItems}})}

test('one receipt keeps one original cost source across split batches, backroom and unknown held stock',async()=>{
 await purchase();const before=book(),old=state(),stock=before.products[0].stock,input=await receipt([allocation(1),allocation(599,'backroom'),allocation(1400,'main','unknown',null)]),result=ok(await commitBrowserInventory(input,owner)),next=state(),added=next.projection.custody.sources.slice(old.projection.custody.sources.length)
 expect(added).toHaveLength(1);expect(added[0]).toMatchObject({quantityUnits:2000,valueCents:14});expect(result.products[0].stock).toBe(stock+.001)
 const lots=next.projection.lots.items.filter(row=>row.sourceId===added[0].id);expect(lots.map(row=>row.segments)).toEqual([[{offsetUnits:0,quantityUnits:1}],[{offsetUnits:1,quantityUnits:599}],[{offsetUnits:600,quantityUnits:1400}]])
 expect(next.valuation.ownedKnownValueCents-old.valuation.ownedKnownValueCents).toBe(14);expect(book().cashLog).toEqual(before.cashLog);expect(book().stockCostEntries.slice(0,before.stockCostEntries.length)).toEqual(before.stockCostEntries)
 expect(result.purchase.procurement.receipts.at(-1).amount).toBe(.14);assertReceipt('receive-lots',input,result)
 const saved=raw();expect(await commitBrowserInventory(input,owner)).toEqual(result);expect(raw()).toBe(saved)
 const backup=await exportBrowserFullBackup(owner);expect(backup.features).toContain('stock-receipt-lots-v1');expect(readPortableBackup(backup,'sqlite').book.products[0].stock).toBe(stock+.001)
})
test('expired goods in backroom stay owned and held without reviving main availability',async()=>{
 await purchase();const stock=book().products[0].stock,input=await receipt([allocation(2000,'backroom','dated','2026-10-18')]);ok(await commitBrowserInventory(input,owner));expect(book().products[0].stock).toBe(stock);const source=state().projection.custody.sources.at(-1),position=state().projection.custody.positions.find(row=>row.segments.some(part=>part.sourceId===source.id));expect(position.owner).toMatchObject({stage:'quarantined',locationId:'backroom'})
 const lot=state().projection.lots.items.at(-1),s=await getBrowserLotState(owner);const release={protocol:'pos-stock-lots/v1',id:'illegal-release',time:s.context.now,storeId:s.context.storeId,epoch:s.context.epoch,expectedStateDigest:s.context.stateDigest,action:'release',lotId:lot.id,locationId:'backroom',quantityUnits:2000,reason:'fixture'};const before=raw();expect((await commitBrowserLot(release,owner)).success).toBe(false);expect(raw()).toBe(before)
})
test('new SKU requires accepted sale price; existing SKU cannot be repriced by receiving',async()=>{
 await purchase(true);const input=await receipt(),before=raw();expect((await commitBrowserInventory(input,owner)).success).toBe(false);expect(raw()).toBe(before)
 const withPrice=await receipt([allocation(2000)],[{lineIndex:0,priceCents:0}]);const result=ok(await commitBrowserInventory(withPrice,owner));expect(result.products[0]).toMatchObject({name:'Rice arrival',unit:'公斤',price:0,cost:.07});expect(state().projection.custody.sources.at(-1).valueCents).toBe(14)
})
test('existing SKU price input is rejected before changing stock, purchase or ledger',async()=>{await purchase();const input=await receipt([allocation(2000)],[{lineIndex:0,priceCents:9999}]),before=raw();expect((await commitBrowserInventory(input,owner)).success).toBe(false);expect(raw()).toBe(before)})
test.each(['sum','location','date','required-none','epoch','store','head','extra','staff'])('refuses %s with the complete original browser record preserved',async control=>{
 await purchase();const input=await receipt(),row=input.lots.allocations[0]
 if(control==='sum')row.quantityUnits--
 if(control==='location')row.locationId='missing'
 if(control==='date')row.expiryDate='2026-02-30'
 if(control==='required-none'){row.expiryMode='none';row.expiryDate=null}
 if(control==='epoch')input.lots.epoch='restored'
 if(control==='store')input.lots.storeId='other'
 if(control==='head')input.lots.expectedStateDigest='sha256:'+'0'.repeat(64)
 if(control==='extra')row.sourceId='caller-forged-source'
 const before=raw();if(control==='staff')expect(()=>commitBrowserInventory(input,staff)).toThrow('權限');else expect((await commitBrowserInventory(input,owner)).success).toBe(false);expect(raw()).toBe(before)
})
test('quota failure changes no business record and reply loss retains the original financial ID',async()=>{
 await purchase();const input=await receipt(),before=raw(),set=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY)throw new DOMException('full','QuotaExceededError');return set.call(this,key,value)})
 expect((await commitBrowserInventory(input,owner)).success).toBe(false);expect(raw()).toBe(before);vi.restoreAllMocks()
 const {id,time,...material}=input;let lost=true;const persist=async request=>{const result=await commitBrowserInventory(request,owner);if(lost){lost=false;throw Error('fixture reply loss')}return result}
 await expect(executeFinancial('receive-lots',material,persist,()=>{},{id,time})).rejects.toThrow();expect(readPendingFinancial().request.id).toBe(id);const committed=raw();ok(await executeFinancial('receive-lots',material,persist,()=>{},{id,time}));expect(readPendingFinancial()).toBe(null);expect(raw()).toBe(committed)
})
test('raw fence removal and same ID changed content cannot bypass complete backup compatibility',async()=>{
 await purchase();const input=await receipt();ok(await commitBrowserInventory(input,owner));const before=raw(),r=record();expect(()=>writeRecords({pos_business_settings:r.data.pos_business_settings.filter(row=>row.key!=='stockReceiptLotsVersionFence')},r.revision)).toThrow();expect(raw()).toBe(before)
 const changed=structuredClone(input);changed.lots.allocations[0].code='different';expect((await commitBrowserInventory(changed,owner)).success).toBe(false);expect(raw()).toBe(before)
 const broken=structuredClone(book());broken.settings=broken.settings.filter(row=>row.key!=='stockReceiptLotsVersionFence');expect(()=>validateStockCostBook(broken)).toThrow()
})
