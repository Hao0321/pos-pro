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
import {commitBrowserRestaurant} from '../../src/utils/browserRestaurant'
const owner={userId:'owner',username:'Lot fixture',role:'owner'},staff={userId:'staff',username:'Lot staff',role:'staff'}
const book=()=>browserToBook(readRecords().data),state=()=>validateStockCostBook(book()),raw=()=>localStorage.getItem(RECORD_KEY),ok=r=>{expect(r.success,r.error).toBe(true);return r}
let serial=0
beforeEach(()=>{localStorage.clear();serial=0;vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-19T12:00:00.000Z'));vi.stubGlobal('navigator',{locks:{request:async(_key,work)=>work()}});const packet=readPortableBackup(fixture,'browser'),graph=unpackRecoveryGraph(packet.protection,'browser');localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'supplier-lot-returns',data:packet.book,recovery:{version:packet.protection.version,snapshots:graph.snapshots.map(row=>({...row,data:row.storage==='sqlite'?row.data:JSON.parse(row.data)})),originalIds:graph.originalIds,events:graph.events.map(row=>({...row,receipt:JSON.parse(row.receipt)}))}}))})
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals()})
async function command(kind,extra={}){const s=await getBrowserSupplierState(owner),po=s.purchases.find(p=>p.id===extra.purchaseId);return {kind,id:'supplier-return-case-'+(++serial),time:new Date().toISOString(),supplierContext:{storeId:s.storeId,epoch:s.epoch,revision:s.supplierLedger.revision},...(po?{expectedPurchase:canonicalSignature(po)}:{}),...extra}}
async function receive(qty=2){ok(await commitBrowserInventory(await command('purchase-create',{purchase:{id:'return-po',supplierId:'supplier',date:'2026-10-19',items:[{productId:'rice',name:'Rice',unit:'公斤',qty,unitCost:.07}]}}),owner));const {context}=await getBrowserLotState(owner);ok(await commitBrowserInventory(await command('receive-lots',{purchaseId:'return-po',quantities:[qty],lots:{protocol:'pos-receipt-lots/v1',storeId:context.storeId,epoch:context.epoch,expectedStateDigest:context.stateDigest,allocations:[{lineIndex:0,quantityUnits:1,locationId:'main',code:'tiny main',expiryMode:'dated',expiryDate:'2026-10-21'},{lineIndex:0,quantityUnits:599,locationId:'backroom',code:'backroom',expiryMode:'dated',expiryDate:'2026-10-21'},{lineIndex:0,quantityUnits:qty*1000-600,locationId:'backroom',code:'held backroom',expiryMode:'unknown',expiryDate:null}],newItems:[]}}),owner))}
async function returning(rows=null,invoiceId=''){const s=await getBrowserLotState(owner),selected=rows||s.counting.rows.filter(r=>['tiny main','backroom','held backroom'].includes(r.code)),allocations=selected.map(row=>({lineIndex:0,key:row.key,quantityUnits:row.quantityUnits??row.availableUnits}));return command('purchase-return-lots',{purchaseId:'return-po',invoiceId,reason:'品質不符',quantities:[allocations.reduce((n,r)=>n+r.quantityUnits,0)/1000],lots:{protocol:'pos-supplier-lot-return/v1',storeId:s.context.storeId,epoch:s.context.epoch,expectedStateDigest:s.context.stateDigest,allocations,confirmation:{received:true,creditAccepted:true,reference:'Supplier acknowledged original document credit R-1'}}})}

test('actual selected main, backroom and held intervals leave once with original 14-cent cost and credit',async()=>{
 await receive();const before=book(),old=state(),input=await returning(),saved=ok(await commitBrowserInventory(input,owner)),after=state(),event=after.projection.business.at(-1)
 expect(saved.products[0].stock).toBe(before.products[0].stock-.001);expect(saved.purchase.procurement.returns.at(-1)).toMatchObject({kind:'purchase-return-lots',amount:.14,lots:input.lots})
 expect(event.effects.every(e=>e.to.stage==='supplierReturned'&&e.from.locationId===e.to.locationId)).toBe(true);expect(event.effects.map(e=>e.quantityUnits).reduce((a,b)=>a+b,0)).toBe(2000);expect(event.effects.reduce((n,e)=>n+e.cost.knownValueCents,0)).toBe(14)
 expect(after.valuation.ownedKnownValueCents-old.valuation.ownedKnownValueCents).toBe(-14);expect(after.projection.custody.sources).toEqual(old.projection.custody.sources);expect(book().cashLog).toEqual(before.cashLog);expect(event.notes.find(n=>n.kind==='supplier-lot-return-clearing').cleared).toBe(true);assertReceipt(input.kind,input,saved)
 const once=raw();expect(await commitBrowserInventory(input,owner)).toEqual(saved);expect(raw()).toBe(once)
 const backup=await exportBrowserFullBackup(owner);expect(backup.features).toContain('stock-supplier-lot-returns-v1');expect(readPortableBackup(backup,'sqlite').book.products[0].stock).toBe(saved.products[0].stock)
})

test.each(['sum','key','location','reserved','unit','epoch','store','head','extra','unconfirmed','reference','staff','changed-purchase'])('rejects %s and preserves the complete browser book',async variant=>{
 await receive();const input=await returning(),row=input.lots.allocations[0]
 if(variant==='sum')row.quantityUnits++
 if(variant==='key')row.key=canonicalSignature(['other','main',null,'shelf'])
 if(variant==='location')row.key=canonicalSignature(['rice','missing',null,'quarantined'])
 if(variant==='reserved')row.key=canonicalSignature(['rice','main','reserved','reserved'])
 if(variant==='unit'){const r=readRecords();expect(()=>writeRecords({pos2_products:r.data.pos2_products.map(p=>({...p,unit:'包'}))},r.revision)).toThrow();return}
 if(variant==='epoch')input.lots.epoch='restored'
 if(variant==='store')input.lots.storeId='other'
 if(variant==='head')input.lots.expectedStateDigest='sha256:'+'0'.repeat(64)
 if(variant==='extra')input.lots.allocations[0].vendorId='guessed'
 if(variant==='unconfirmed')input.lots.confirmation.received=false
 if(variant==='reference')input.lots.confirmation.reference=''
 if(variant==='changed-purchase')input.expectedPurchase='changed'
 const before=raw();if(variant==='staff')expect(()=>commitBrowserInventory(input,staff)).toThrow('權限');else expect((await commitBrowserInventory(input,owner)).success).toBe(false);expect(raw()).toBe(before)
})

test('partial returns preserve exact cumulative purchase cents and physical original intervals',async()=>{
 await receive();const row=(await getBrowserLotState(owner)).counting.rows.find(r=>r.code==='held backroom'),old=state().valuation.ownedKnownValueCents
 const first=ok(await commitBrowserInventory(await returning([{...row,quantityUnits:333}]),owner));expect(first.purchase.procurement.returns.at(-1).amount).toBe(.02)
 const next=(await getBrowserLotState(owner)).counting.rows.filter(r=>['tiny main','backroom','held backroom'].includes(r.code)),last=ok(await commitBrowserInventory(await returning(next),owner));expect(last.purchase.procurement.returns.at(-1).amount).toBe(.12);expect(state().valuation.ownedKnownValueCents-old).toBe(-14)
})

test('supplier-approved physical source can differ from credit document; unknown found cost remains suspended',async()=>{
 await receive(4);const s=await getBrowserLotState(owner),row=s.counting.rows.find(r=>r.code==='later'&&r.kind==='shelf'&&r.locationId==='main')
 ok(await commitBrowserLot({protocol:'pos-stock-lots/v1',id:'found-return-stock',time:s.context.now,storeId:s.context.storeId,epoch:s.context.epoch,expectedStateDigest:s.context.stateDigest,action:'count',locationId:'main',counts:[{key:row.key,quantityUnits:row.expectedUnits+500}]},owner))
 const found=(await getBrowserLotState(owner)).counting.rows.find(r=>r.key===row.key),result=ok(await commitBrowserInventory(await returning([found]),owner)),projection=state().projection,note=projection.business.at(-1).notes.find(r=>r.kind==='supplier-lot-return-clearing')
 expect(result.purchase.procurement.returns.at(-1).amount).toBe(.25);expect(note.cleared).toBe(false);expect(projection.business.at(-1).effects.some(r=>r.cost.complete===false)).toBe(true);expect(projection.custody.sources.at(-1).valueCents).toBe(null);expect(result.products[0].stock).toBe(.001)
})

test('quota and lost reply preserve original ID; changed original input and feature stripping are rejected',async()=>{
 await receive();const input=await returning(),before=raw(),set=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY)throw new DOMException('full','QuotaExceededError');return set.call(this,key,value)})
 expect((await commitBrowserInventory(input,owner)).success).toBe(false);expect(raw()).toBe(before);vi.restoreAllMocks()
 const {id,time,...material}=input;let lost=true;const persist=async request=>{const result=await commitBrowserInventory(request,owner);if(lost){lost=false;throw Error('fixture reply loss')}return result}
 await expect(executeFinancial(input.kind,material,persist,()=>{},{id,time})).rejects.toThrow();expect(readPendingFinancial().request.id).toBe(id);const once=raw();ok(await executeFinancial(input.kind,material,persist,()=>{},{id,time}));expect(readPendingFinancial()).toBe(null);expect(raw()).toBe(once)
 const changed=structuredClone(input);changed.lots.confirmation.reference='different';expect((await commitBrowserInventory(changed,owner)).success).toBe(false);expect(raw()).toBe(once)
 const broken=structuredClone(book());broken.settings=broken.settings.filter(r=>r.key!=='stockSupplierLotReturnsVersionFence');expect(()=>validateStockCostBook(broken)).toThrow()
 const r=readRecords();expect(()=>writeRecords({pos_business_settings:r.data.pos_business_settings.filter(s=>s.key!=='stockSupplierLotReturnsVersionFence')},r.revision)).toThrow();expect(raw()).toBe(once)
})

test('two original purchase lines may return disjoint quantities from the same physical batch',async()=>{
 ok(await commitBrowserInventory(await command('purchase-create',{purchase:{id:'return-po',supplierId:'supplier',date:'2026-10-19',items:[{productId:'rice',name:'Rice first',unit:'公斤',qty:1,unitCost:.07},{productId:'rice',name:'Rice second',unit:'公斤',qty:1,unitCost:.09}]}}),owner))
 const s=await getBrowserLotState(owner);ok(await commitBrowserInventory(await command('receive-lots',{purchaseId:'return-po',quantities:[1,1],lots:{protocol:'pos-receipt-lots/v1',storeId:s.context.storeId,epoch:s.context.epoch,expectedStateDigest:s.context.stateDigest,allocations:[0,1].map(lineIndex=>({lineIndex,quantityUnits:1000,locationId:'main',code:'two lines '+lineIndex,expiryMode:'dated',expiryDate:'2026-10-21'})),newItems:[]}}),owner))
 const row=(await getBrowserLotState(owner)).counting.rows.find(r=>r.code==='two lines 0'),input=await returning([{...row,quantityUnits:500}]);input.quantities=[.5,.5];input.lots.allocations.push({...input.lots.allocations[0],lineIndex:1})
 const invalid=structuredClone(input);invalid.quantities=[.6,.6];invalid.lots.allocations.forEach(r=>r.quantityUnits=600);const before=raw();expect((await commitBrowserInventory(invalid,owner)).success).toBe(false);expect(raw()).toBe(before)
 const result=ok(await commitBrowserInventory(input,owner)),effects=state().projection.business.at(-1).effects;expect(result.purchase.procurement.returns.at(-1).amount).toBe(.09);expect(effects.reduce((n,e)=>n+e.cost.knownValueCents,0)).toBe(7);expect(effects.flatMap(e=>e.segments).map(r=>[r.offsetUnits,r.quantityUnits])).toEqual([[0,500],[500,500]])
})

test('actual customer reservations stay excluded even when the physical count includes them',async()=>{
 await receive(4);ok(await commitBrowserRestaurant({kind:'restaurant',id:'supplier-return-reserved',time:new Date().toISOString(),action:'create',channel:'walkin',day:'2026-10-19',slot:'12:00',customer:'Return fixture',contact:'',note:'',items:[{id:'rice',qty:1,price:10}]},owner))
 const row=(await getBrowserLotState(owner)).counting.rows.find(r=>r.reservedUnits>0);expect(row).toBeDefined();const input=await returning([{...row,quantityUnits:row.expectedUnits}]),before=raw();expect((await commitBrowserInventory(input,owner)).success).toBe(false);expect(raw()).toBe(before)
})
