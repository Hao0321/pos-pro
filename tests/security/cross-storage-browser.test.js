// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import native from '../fixtures/cross-storage-native-v1.json'
import browser from '../fixtures/cross-storage-browser-v1.json'
import independent from '../fixtures/cross-storage-independent-browser-v1.json'
import nativeIndependent from '../fixtures/cross-storage-independent-native-v1.json'
import {readRecords,writeRecords,RECORD_KEY,browserStorage} from '../../src/utils/browserStorage.js'
import {addCashLog,getSetting} from '../../src/utils/dataAccess.js'
import * as recovery from '../../src/utils/browserRecovery.js'
import {readPortableBackup,createCompleteBackup} from '../../electron/backupEnvelope.mjs'
import {stockLedgerDigest} from '../../electron/stockLedgerModel.mjs'
import {EXCHANGE_SETTING,EXCHANGE_ACTION,EXCHANGE_PREFIX,planExchange,readExchangeStore,productReference,QUOTE_PRICING} from '../../electron/businessExchange.mjs'
import {commitBrowserExchange} from '../../src/utils/browserExchange.js'
import {prepareCheckout} from '../../src/utils/checkoutSafety.mjs'
import {commitBrowserSale} from '../../src/utils/browserSales.js'
import {browserReceipt} from '../../src/utils/browserSales.js'
const owner={userId:'destination-owner',username:'Destination 店主',role:'owner'},staff={userId:'destination-staff',username:'Staff',role:'staff'}
function install(){localStorage.clear();writeRecords({pos_users:[{id:owner.userId,username:owner.username,role:'owner',password:'current-password'},{id:staff.userId,username:staff.username,role:'staff',password:'staff-password'}],pos_business_settings:[{key:'integrationToken',value:JSON.stringify('current-secret')}]});return readRecords()}
async function restore(packet){const preview=await recovery.previewRestore({kind:'import',data:packet},owner),receipt=await recovery.applyRestorePreview(preview.id,owner);return {preview,receipt}}
beforeEach(()=>{install();vi.stubGlobal('navigator',{language:'zh-TW',locks:{request:async(_name,fn)=>fn()}})})
afterEach(()=>vi.unstubAllGlobals())
it('imports the real native file and recovers all sixty originals once under the new owner and credentials',async()=>{
 const before=readRecords(),{preview,receipt}=await restore(native.reference.packet);expect(preview.protection).toMatchObject({sourceStorage:'sqlite',converted:true,snapshots:1,originalIds:61,receipts:1});expect(readRecords().recovery.version).toBe(3);expect(readRecords().data.pos_users).toEqual(before.data.pos_users);expect(await getSetting('integrationToken')).toBe('current-secret')
 expect((await recovery.lookupRestorePreview(native.reference.preview.id,owner)).receipt).toEqual(native.reference.receipt)
 for(const request of [native.reference.requests[0],native.reference.requests.at(-1)])expect((await addCashLog(request)).errorCode).toBe('RECOVERY_REQUIRED')
 const pending={kind:'cashlog',request:native.reference.requests[0]},state=await recovery.getRecoveryState(pending,owner),source=state.sources.find(row=>row.canRecover);expect(source).toBeTruthy()
 const sourceExport=await recovery.exportRecoverySource(source.id,owner);expect(sourceExport.storage).toBe('sqlite');expect(sourceExport.book.cashLog).toHaveLength(60)
 const input={id:'recovery-cross-native-cash',sourceId:source.id,expectedRevision:state.revision,pending},recovered=await recovery.applyRecoveryOperation(input,owner);expect(await recovery.applyRecoveryOperation(input,owner)).toEqual(recovered)
 for(const i of [0,59])expect(await addCashLog(native.reference.requests[i])).toEqual(native.reference.receipts[i]);expect(readRecords().data.pos2_cash_log).toHaveLength(60);expect((await recovery.lookupRestorePreview(preview.id,owner)).receipt).toEqual(receipt)
 const raw=localStorage.getItem(RECORD_KEY);localStorage.setItem(RECORD_KEY,raw);expect(await recovery.applyRecoveryOperation(input,owner)).toEqual(recovered);expect(readRecords().data.pos_users).toEqual(before.data.pos_users)
})
it('retains original native text values and the entire mixed graph through another exported file',async()=>{
 await restore(native.reference.packet);const packet=recovery.exportBrowserFullBackup(owner),back=readPortableBackup(packet,'sqlite');for(const key of ['nativeZero','nativeFalse','nativeEmpty','nativeNumberText','nativeJson'])expect(await getSetting(key)).toBe(native.reference.packet.book.settings.find(row=>row.key===key).value)
 expect(back.book.settings.find(row=>row.key==='nativeJson')).toEqual(native.reference.packet.book.settings.find(row=>row.key==='nativeJson'));for(const row of native.reference.packet.protection.books)expect(packet.protection.books.find(r=>r.id===row.id)).toEqual({...row,storage:'sqlite'})
 browserStorage.setItem('pos_settings_nativeNumberText',JSON.stringify('002.30'));expect(readRecords().data.pos_business_settings.find(row=>row.key==='nativeNumberText').encoding).toBe('sqlite-text/v1');expect(await getSetting('nativeNumberText')).toBe('002.30')
 browserStorage.setItem('pos_settings_nativeNumberText','0');expect(await getSetting('nativeNumberText')).toBe(0);expect(readRecords().data.pos_business_settings.find(row=>row.key==='nativeNumberText')).not.toHaveProperty('encoding')
})
it('restores a protected original cost book by date with all known/unknown events and immutable acknowledgements',async()=>{
 const timings=[],timed=async(label,action)=>{const start=performance.now(),value=await action(),elapsedMs=performance.now()-start;timings.push({label,elapsedMs});expect(elapsedMs,label).toBeLessThan(10000);return value}
 const imported=await timed('native cost import preview',()=>recovery.previewRestore({kind:'import',data:native.cost.packet},owner));await timed('native cost import confirm',()=>recovery.applyRestorePreview(imported.id,owner));const expected=native.cost.original,packet=await timed('mixed cost export',()=>recovery.exportBrowserFullBackup(owner)),source=packet.protection.snapshots.find(row=>JSON.parse(packet.protection.books.find(b=>b.id===row.bookId).data).stockCostEntries.length===63)
 expect((await timed('date list',()=>recovery.getProtectedBackups(null,owner))).find(row=>row.id===source.id).canRestore).toBe(true);const preview=await timed('original cost preview',()=>recovery.previewRestore({kind:'protected',id:source.id},owner));await timed('original cost confirm',()=>recovery.applyRestorePreview(preview.id,owner))
 expect(readRecords().data.pos_stock_cost_entries).toEqual(expected.stockCostEntries);expect(readRecords().data.pos_stock_cost_operations).toEqual(expected.stockCostOperations);expect(readRecords().data.pos2_waste).toEqual(expected.wasteLog);expect(readRecords().data.pos_restaurant_orders).toEqual(expected.restaurantOrders)
 const current=readRecords(),data=current.data,beforeRice=data.pos2_products.find(row=>row.id==='rice'),sale=prepareCheckout({id:'cross-cost-sale',cart:[{id:'rice',qty:.1,price:10}],products:data.pos2_products,members:data.pos2_members,activeMember:null,pointsRule:{earn:10,redeem:1},birthdayBonus:0,openShift:data.pos2_shifts.find(row=>row.status==='open'),payMethod:'cash',paid:1,now:new Date(),opts:{cashier:owner.username}}),receipt=await timed('sale after cross-storage recovery',()=>commitBrowserSale(sale.order,owner));expect(receipt.success).toBe(true);expect(await commitBrowserSale(sale.order,owner)).toEqual(receipt);expect(readRecords().data.pos_stock_cost_entries).toHaveLength(64);expect(Math.round(readRecords().data.pos2_products.find(row=>row.id==='rice').stock*1000)).toBe(Math.round(beforeRice.stock*1000)-100);expect(readPortableBackup(recovery.exportBrowserFullBackup(owner),'sqlite').book.stockCostEntries).toHaveLength(64);console.log('CROSS_STORAGE_COST_TIMINGS '+JSON.stringify(timings))
},30000)
it('keeps the exact atomic record on quota or stale review and resolves a lost post-commit reply by the original ID',async()=>{
 const preview=await recovery.previewRestore({kind:'import',data:native.reference.packet},owner),before=localStorage.getItem(RECORD_KEY),set=Storage.prototype.setItem,spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY)throw Error('fixture quota');return set.call(this,key,value)})
 try{await expect(recovery.applyRestorePreview(preview.id,owner)).rejects.toThrow(/quota/);expect(localStorage.getItem(RECORD_KEY)).toBe(before)}finally{spy.mockRestore()}
 const lost=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){const result=set.call(this,key,value);if(key===RECORD_KEY)throw Error('fixture lost reply');return result})
 try{await expect(recovery.applyRestorePreview(preview.id,owner)).rejects.toThrow(/lost reply/)}finally{lost.mockRestore()}
 const committed=localStorage.getItem(RECORD_KEY),receipt=await recovery.applyRestorePreview(preview.id,owner);expect(receipt.success).toBe(true);expect(localStorage.getItem(RECORD_KEY)).toBe(committed)
 const stale=await recovery.previewRestore({kind:'import',data:native.reference.packet},owner);browserStorage.setItem('pos_settings_note',JSON.stringify('new material setting'));const changed=localStorage.getItem(RECORD_KEY);await expect(recovery.applyRestorePreview(stale.id,owner)).rejects.toThrow(/已改變/);expect(localStorage.getItem(RECORD_KEY)).toBe(changed)
})
it('rejects forged/staff authority, damaged sources and missing cross-storage metadata without changing data',async()=>{
 const original=localStorage.getItem(RECORD_KEY);for(const actor of [staff,{...owner,username:'forged'}])await expect(recovery.previewRestore({kind:'import',data:native.reference.packet},actor)).rejects.toThrow(/權限/)
 const damaged=structuredClone(native.reference.packet);damaged.protection.books[0].data+=' ';const {checksum,...body}=damaged;damaged.checksum=stockLedgerDigest(body);await expect(recovery.previewRestore({kind:'import',data:damaged},owner)).rejects.toThrow(/保護紀錄/);expect(localStorage.getItem(RECORD_KEY)).toBe(original)
 await restore(native.reference.packet);const record=readRecords();record.recovery.version=1;localStorage.setItem(RECORD_KEY,JSON.stringify(record));const broken=localStorage.getItem(RECORD_KEY);expect(()=>readRecords()).toThrow(/保護/);expect(localStorage.getItem(RECORD_KEY)).toBe(broken)
})
it('keeps real native quotes and unrelated settings intact when the browser issues another customer-specific quote',async()=>{
 const book=structuredClone(native.reference.packet.book),product=book.products[0],request={id:'native-quote-cross-storage',kind:'exchange',storeId:'cross-storage-shop',time:new Date().toISOString(),expectedRevision:0,quoteId:'',expectedQuoteRevision:0,recipient:{id:'buyer-one',name:'Buyer One'},validUntil:new Date(Date.now()+86400000).toISOString(),items:[{productId:product.id,qty:1,unitPrice:90,expectedProduct:productReference(product)}],note:'Private customer price',rememberPrices:true,pricing:QUOTE_PRICING},plan=planExchange(request,readExchangeStore(null),book.products,{id:request.storeId,name:'商店'},native.owner)
 book.settings.push({key:EXCHANGE_SETTING,value:JSON.stringify(plan.state),id:'legacy-exchange-row'});book.auditLog.push({id:EXCHANGE_PREFIX+request.id,action:EXCHANGE_ACTION,label:'客戶報價',timestamp:request.time,userId:native.owner.userId,username:native.owner.username,role:'owner',detail:JSON.stringify(plan.receipt)})
 await restore(createCompleteBackup(book,native.reference.packet.protection,'sqlite'));const untouched=readRecords().data.pos_business_settings.filter(row=>row.key!==EXCHANGE_SETTING),next={...request,id:'browser-quote-after-cross-storage',expectedRevision:1,recipient:{id:'buyer-two',name:'Buyer Two'},items:[{...request.items[0],unitPrice:85}]},result=await commitBrowserExchange(next,owner)
 expect(result.success).toBe(true);expect(readRecords().data.pos_business_settings.filter(row=>row.key!==EXCHANGE_SETTING)).toEqual(untouched);expect(readRecords().data.pos_business_settings.find(row=>row.key===EXCHANGE_SETTING).id).toBe('legacy-exchange-row')
 const back=readPortableBackup(recovery.exportBrowserFullBackup(owner),'sqlite'),state=readExchangeStore(back.book.settings.find(row=>row.key===EXCHANGE_SETTING).value);expect(state.quotes).toHaveLength(2);expect(state.quotes.map(row=>row.recipient.id)).toEqual(['buyer-one','buyer-two'])
})
it('returns the independently created original sale and every omitted field after real native SQL transfer',async()=>{
 await restore(nativeIndependent.packetRecovered);const record=readRecords();expect(record.recovery.version).toBe(3);expect(record.data.pos2_products).toEqual(independent.original.pos2_products);expect(record.data.pos2_shifts).toEqual(independent.original.pos2_shifts);expect(record.data.pos2_orders).toEqual(independent.original.pos2_orders);expect(browserReceipt(independent.plan.order.id)).toEqual(independent.receipt)
 const request=JSON.parse(nativeIndependent.packetRecovered.protection.events.find(row=>row.id===nativeIndependent.receipt.id).signature);expect((await recovery.lookupRecoveryOperation(request,owner)).receipt).toEqual(nativeIndependent.receipt)
 const again=readPortableBackup(recovery.exportBrowserFullBackup(owner),'sqlite');expect(again.book.products).toEqual(independent.original.pos2_products);expect(again.book.orders).toEqual(independent.original.pos2_orders);expect(again.protection.version).toBe(3);expect(again.features).toContain('record-shapes-v1')
 for(const row of independent.packet.protection.books)expect(recovery.exportBrowserFullBackup(owner).protection.books.find(book=>book.id===row.id)).toEqual({...row,storage:'browser'})
})
