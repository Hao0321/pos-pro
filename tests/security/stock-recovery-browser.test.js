// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import fixture from '../fixtures/stock-cost-native-v1.json'
import {bookToBrowser,browserToBook,operationRecords,materialSignature} from '../../electron/recoveryRules.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {readRecords,writeRecords,RECORD_KEY,assertOriginalOperationAvailable} from '../../src/utils/browserStorage'
import * as recovery from '../../src/utils/browserRecovery'
import {getBrowserStockSalesState,getBrowserStockAccountingState} from '../../src/utils/browserStockReports'
import {buildPnL} from '../../electron/accountingCore.mjs'
import {stockPeriodDisclosure} from '../../electron/stockAccounting.mjs'

const owner={userId:'owner',username:'Current browser owner',role:'owner'},staff={userId:'staff',username:'Staff',role:'staff'}
// Test-only representation conversion. Public imports retain their format guard.
const source=()=>bookToBrowser({...structuredClone(fixture.book),settings:fixture.book.settings.map(row=>({...row,value:row.key==='stockCostVersionFence'?row.value:JSON.stringify(row.value)}))})
beforeEach(()=>{localStorage.clear();vi.useFakeTimers({toFake:['Date']}).setSystemTime(new Date('2026-10-16T04:00:00Z'));vi.stubGlobal('navigator',{languages:['zh-TW'],language:'zh-TW',locks:{request:async(_name,fn)=>fn()}});writeRecords({pos_users:[{id:owner.userId,username:owner.username,role:'owner',password:'current-owner-password'},{id:staff.userId,username:staff.username,role:'staff',password:'staff-password'}],pos_business_settings:[{key:'sharedStoreId',value:JSON.stringify('new-browser')} ]})})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
const restore=async data=>{const preview=await recovery.previewRestore({kind:'import',data},owner);return {preview,result:await recovery.applyRestorePreview(preview.id,owner)}}
it('round trips the full native-derived cost history in one browser record and reports actual gross',async()=>{
 const before=readRecords(),restored=await restore(source()),saved=readRecords();expect(restored.preview.target.stockCostEntries).toBe(3);expect(saved.data.pos_stock_cost_entries).toEqual(fixture.book.stockCostEntries);expect(saved.data.pos_stock_cost_operations).toEqual(fixture.book.stockCostOperations);expect(saved.data.pos_users).toEqual(before.data.pos_users);expect(saved.salesEpoch).toBeTruthy()
 const report=getBrowserStockSalesState(owner),accounting=getBrowserStockAccountingState(owner),pnl=buildPnL(accounting.journals,'2026-10-16','2026-10-16',stockPeriodDisclosure(accounting,'2026-10-16','2026-10-16'))
 expect(report.periods.today.profitCents).toBe('87000');expect(pnl.exact.grossProfit).toBe('87000');expect(report.performance.enriched[0].stockValue.available.valueCents).toBe('27000')
 const limited=getBrowserStockSalesState(staff);expect(limited.scope).toBe('pos');expect(limited.data).not.toHaveProperty('supplierState');expect(limited.performance.enriched[0]).not.toHaveProperty('stockValue');expect(()=>getBrowserStockAccountingState(staff)).toThrow(/權限/);expect(()=>getBrowserStockSalesState({...owner,username:'forged'})).toThrow(/權限/)
 expect((await recovery.lookupRestorePreview(restored.preview.id,owner)).receipt).toEqual(restored.result);expect(await recovery.applyRestorePreview(restored.preview.id,owner)).toEqual(restored.result)
})
it.each(['missing-half','missing-both-marked','null-arrays','changed-hash','changed-order'])('rejects %s before preview or any browser mutation',async kind=>{
 const data=source(),before=localStorage.getItem(RECORD_KEY)
 if(kind==='missing-half')delete data.pos_stock_cost_operations
 if(kind==='missing-both-marked'){delete data.pos_stock_cost_entries;delete data.pos_stock_cost_operations;data.pos_business_settings.push({key:'stockCostVersionFence',value:'1'})}
 if(kind==='null-arrays'){data.pos_stock_cost_entries=null;data.pos_stock_cost_operations=null}
 if(kind==='changed-hash')data.pos_stock_cost_entries[0].hash='bad'
 if(kind==='changed-order')data.pos2_orders[0].total+=1
 await expect(recovery.previewRestore({kind:'import',data},owner)).rejects.toThrow(/成本回執/);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})
it('retains the original browser record bytes when a marked book has lost both cost collections',async()=>{
 await restore(source());const record=readRecords();delete record.data.pos_stock_cost_entries;delete record.data.pos_stock_cost_operations;const raw=JSON.stringify(record);localStorage.setItem(RECORD_KEY,raw);expect(()=>readRecords()).toThrow(/成本回執/);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
it('rejects standalone uncoupled stock writes while retaining inputs, exact history and metadata price edits',async()=>{
 await restore(source());const before=localStorage.getItem(RECORD_KEY),record=readRecords()
 expect(()=>writeRecords({pos2_products:record.data.pos2_products.map(row=>({...row,stock:0}))},record.revision)).toThrow(/店面電腦/);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
 const changed=writeRecords({pos2_products:record.data.pos2_products.map(row=>({...row,cost:99}))},record.revision);expect(changed.data.pos_stock_cost_entries).toEqual(record.data.pos_stock_cost_entries);expect(getBrowserStockSalesState(owner).periods.today.profitCents).toBe('87000')
 expect(()=>writeRecords({pos_business_settings:changed.data.pos_business_settings.filter(row=>row.key!=='stockCostVersionFence')},changed.revision)).toThrow(/版本保護/)
})
it('preserves full source snapshots and original-ID recovery through an older restore and rotated epoch',async()=>{
 const start=readRecords();writeRecords({pos_business_settings:[{key:'sharedStoreId',value:JSON.stringify(fixture.book.settings.find(row=>row.key==='sharedStoreId').value)}]},start.revision);const old=structuredClone(readRecords().data);await restore(source());const original=structuredClone(readRecords().data),previousEpoch=readRecords().salesEpoch;await restore(old);const current=readRecords();expect(current.data.pos_stock_cost_entries).toEqual([]);expect(current.data.pos_business_settings.find(row=>row.key==='stockCostVersionFence').value).toBe('1');expect(current.salesEpoch).not.toBe(previousEpoch)
 expect(()=>assertOriginalOperationAvailable('checkout','sale')).toThrow(/原編號/)
 const opening=fixture.book.stockCostEntries.find(row=>row.input.action==='open').input,pending={kind:'stock-cost',request:opening},state=await recovery.getRecoveryState(pending,owner),selected=state.sources.find(row=>row.canRecover);expect(selected).toBeTruthy();const input={id:'recovery-cost-original',sourceId:selected.id,expectedRevision:state.revision,pending},result=await recovery.applyRecoveryOperation(input,owner);expect(readRecords().data.pos_stock_cost_entries).toEqual(original.pos_stock_cost_entries);expect(readRecords().data.pos_stock_cost_operations).toEqual(original.pos_stock_cost_operations);expect(await recovery.applyRecoveryOperation(input,owner)).toEqual(result);expect(operationRecords(browserToBook(readRecords().data)).some(row=>row.method==='applyStockCostOperation'&&row.id==='opening')).toBe(true)
})
it('quota failure retains the old complete record with no rescue or acknowledgement half-write',async()=>{
 const before=localStorage.getItem(RECORD_KEY),preview=await recovery.previewRestore({kind:'import',data:source()},owner),original=Storage.prototype.setItem
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY)throw new DOMException('Quota fixture','QuotaExceededError');return original.call(this,key,value)})
 try{await expect(recovery.applyRestorePreview(preview.id,owner)).rejects.toThrow(/Quota/);expect(localStorage.getItem(RECORD_KEY)).toBe(before);expect((await recovery.lookupRestorePreview(preview.id,owner)).found).toBe(false)}finally{spy.mockRestore()}
})
it('keeps a legacy protected browser original recoverable when the new empty cost collections first appear',async()=>{
 const record=readRecords(),data=structuredClone(record.data);delete data.pos_stock_cost_entries;delete data.pos_stock_cost_operations
 const request={id:'legacy-original-cash',time:new Date().toISOString(),shiftId:'legacy-shift',type:'in',amount:50,reason:'Original legacy cash',cashier:owner.username},original={...structuredClone(data),pos2_cash_log:[request]},legacyBook=browserToBook(data);delete legacyBook.stockCostEntries;delete legacyBook.stockCostOperations
 const snapshot={id:'legacy-source',createdAt:new Date().toISOString(),actorId:owner.userId,storeId:'new-browser',data:original,contentSignature:canonicalSignature(original),afterMaterial:materialSignature(legacyBook)},signedBytes=JSON.stringify(snapshot)
 localStorage.setItem(RECORD_KEY,JSON.stringify({...record,data,recovery:{version:1,snapshots:[snapshot],originalIds:[['addCashLog',request.id,snapshot.id]],events:[]}}))
 expect(readRecords().data.pos_stock_cost_entries).toEqual([]);expect(()=>assertOriginalOperationAvailable('addCashLog',request.id)).toThrow(/原編號/)
 const pending={kind:'cashlog',request},state=await recovery.getRecoveryState(pending,owner),source=state.sources.find(row=>row.canRecover);expect(source?.id).toBe(snapshot.id)
 const input={id:'recovery-legacy-cash',sourceId:source.id,expectedRevision:state.revision,pending},result=await recovery.applyRecoveryOperation(input,owner);expect(readRecords().data.pos2_cash_log).toEqual([request]);expect(await recovery.applyRecoveryOperation(input,owner)).toEqual(result);expect(JSON.stringify(readRecords().recovery.snapshots.find(row=>row.id===snapshot.id))).toBe(signedBytes)
})
