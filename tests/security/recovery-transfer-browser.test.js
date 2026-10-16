// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import fixture from '../fixtures/stock-cost-native-v1.json'
import {bookToBrowser} from '../../electron/recoveryRules.mjs'
import {stockLedgerDigest} from '../../electron/stockLedgerModel.mjs'
import {readRecords,writeRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {addCashLog} from '../../src/utils/dataAccess'
import {createBackup} from '../../src/utils/security'
import * as recovery from '../../src/utils/browserRecovery'

const sourceOwner={userId:'owner',username:'Browser Source',role:'owner'},newOwner={userId:'replacement',username:'Browser New',role:'owner'},staff={userId:'staff',username:'Staff',role:'staff'}
function install(owner=sourceOwner){localStorage.clear();writeRecords({pos_users:[{id:owner.userId,username:owner.username,role:owner.role,password:'credential-'+owner.userId},{id:staff.userId,username:staff.username,role:staff.role,password:'staff-credential'}],pos_business_settings:[{key:'sharedStoreId',value:JSON.stringify('blank-'+owner.userId)},{key:'integrationToken',value:JSON.stringify('secret-'+owner.userId)}]});return readRecords()}
const restore=async(data,owner)=>{const preview=await recovery.previewRestore({kind:'import',data},owner),receipt=await recovery.applyRestorePreview(preview.id,owner);return {preview,receipt}}
async function source(count=1){
 install();const data=bookToBrowser({...structuredClone(fixture.book),settings:fixture.book.settings.map(row=>({...row,value:row.key==='stockCostVersionFence'?row.value:JSON.stringify(row.value)}))});await restore(data,sourceOwner);const backup=await createBackup(sourceOwner,'Before original cash'),requests=[],receipts=[]
 for(let index=0;index<count;index++){const request={id:'original-cash-'+index,time:new Date().toISOString(),shiftId:readRecords().data.pos2_shifts[0].id,type:'in',amount:.01,reason:'Original cash',cashier:sourceOwner.username},receipt=await addCashLog(request);expect(receipt.success).toBe(true);requests.push(request);receipts.push(receipt)}
 const original=structuredClone(readRecords().data),preview=await recovery.previewRestore({kind:'backup',id:backup.id},sourceOwner),receipt=await recovery.applyRestorePreview(preview.id,sourceOwner);expect((await addCashLog(requests[0])).errorCode).toBe('RECOVERY_REQUIRED');return {packet:recovery.exportBrowserFullBackup(sourceOwner),original,requests,receipts,preview,receipt}
}
function seal(p){const {checksum,...body}=p;return {...body,checksum:stockLedgerDigest(body)}}
beforeEach(()=>{localStorage.clear();vi.useFakeTimers({toFake:['Date']}).setSystemTime(new Date('2026-10-16T04:00:00Z'));vi.stubGlobal('navigator',{language:'zh-TW',languages:['zh-TW'],locks:{request:async(_name,fn)=>fn()}})})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
it('transfers all browser protection into a fresh identity and recovers the exact original once while retaining current credentials',async()=>{
 const src=await source(),current=install(newOwner);await restore(src.packet,newOwner);expect(readRecords().data.pos_users).toEqual(current.data.pos_users);expect(readRecords().data.pos_business_settings.find(row=>row.key==='integrationToken').value).toBe(JSON.stringify('secret-replacement'));expect((await addCashLog(src.requests[0])).errorCode).toBe('RECOVERY_REQUIRED')
 const pending={kind:'cashlog',request:src.requests[0]},state=await recovery.getRecoveryState(pending,newOwner),selected=state.sources.find(row=>row.canRecover);expect(selected).toBeTruthy();const input={id:'recovery-transferred-original',sourceId:selected.id,expectedRevision:state.revision,pending},receipt=await recovery.applyRecoveryOperation(input,newOwner);expect(await addCashLog(src.requests[0])).toEqual(src.receipts[0]);expect(await recovery.applyRecoveryOperation(input,newOwner)).toEqual(receipt)
 const expected=structuredClone(src.original);expected.pos_users=current.data.pos_users;expected.pos_business_settings=expected.pos_business_settings.map(row=>row.key==='integrationToken'?{...row,value:JSON.stringify('secret-replacement')}:row);expect(readRecords().data).toEqual(expected)
 expect((await recovery.lookupRestorePreview(src.preview.id,newOwner)).receipt).toEqual(src.receipt);expect(()=>recovery.exportBrowserFullBackup(staff)).toThrow(/權限/);expect(()=>recovery.exportBrowserFullBackup({...newOwner,username:'forged'})).toThrow(/權限/);await expect(recovery.previewRestore({kind:'import',data:src.packet},staff)).rejects.toThrow(/權限/)
})
it('keeps every original cash ID beyond fifty records and reads it from fresh persisted storage',async()=>{
 const src=await source(60);expect(src.packet.protection.originalIds.filter(row=>row[0]==='addCashLog')).toHaveLength(60);install(newOwner);await restore(src.packet,newOwner);const serialized=localStorage.getItem(RECORD_KEY);localStorage.setItem(RECORD_KEY,serialized)
 for(const request of [src.requests[0],src.requests.at(-1)])expect((await addCashLog(request)).errorCode).toBe('RECOVERY_REQUIRED')
 const pending={kind:'cashlog',request:src.requests[0]},state=await recovery.getRecoveryState(pending,newOwner),selected=state.sources.find(row=>row.canRecover);await recovery.applyRecoveryOperation({id:'recovery-sixty-originals',sourceId:selected.id,expectedRevision:state.revision,pending},newOwner);expect(readRecords().data.pos2_cash_log).toHaveLength(60);expect(await addCashLog(src.requests[0])).toEqual(src.receipts[0]);expect(await addCashLog(src.requests.at(-1))).toEqual(src.receipts.at(-1))
})
it('rejects missing, conflicting and tampered protection before changing the browser record',async()=>{
 const src=await source();install(newOwner);await restore(src.packet,newOwner)
 for(const mutate of [p=>p.protection.originalIds.pop(),p=>{p.protection.events=[]},p=>{p.protection.snapshots[0].createdAt='2026-10-17T00:00:00Z'},p=>{delete p.protection}]){const p=structuredClone(src.packet);mutate(p);const before=localStorage.getItem(RECORD_KEY);await expect(recovery.previewRestore({kind:'import',data:seal(p)},newOwner)).rejects.toThrow(/保護紀錄/);expect(localStorage.getItem(RECORD_KEY)).toBe(before)}
})
it('retains the whole record on quota failure during protection merge and can retry the same reviewed request',async()=>{
 const src=await source();install(newOwner);const preview=await recovery.previewRestore({kind:'import',data:src.packet},newOwner),before=localStorage.getItem(RECORD_KEY),set=Storage.prototype.setItem,spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY)throw new DOMException('quota fixture','QuotaExceededError');return set.call(this,key,value)})
 try{await expect(recovery.applyRestorePreview(preview.id,newOwner)).rejects.toThrow(/quota/);expect(localStorage.getItem(RECORD_KEY)).toBe(before);expect((await recovery.lookupRestorePreview(preview.id,newOwner)).found).toBe(false)}finally{spy.mockRestore()}
 await recovery.applyRestorePreview(preview.id,newOwner);expect((await addCashLog(src.requests[0])).errorCode).toBe('RECOVERY_REQUIRED')
})
it('binds review to protection history even when an external change keeps the same record revision',async()=>{
 const src=await source();install(newOwner);await restore(src.packet,newOwner);const preview=await recovery.previewRestore({kind:'import',data:src.packet},newOwner),changed=readRecords();changed.recovery.snapshots[0].createdAt='2026-10-17T00:00:00Z';localStorage.setItem(RECORD_KEY,JSON.stringify(changed));const raw=localStorage.getItem(RECORD_KEY);await expect(recovery.applyRestorePreview(preview.id,newOwner)).rejects.toThrow(/已改變/);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
it('deduplicates flat source content during repeated full browser transfers without recursive backups',async()=>{
 const src=await source();install(newOwner);for(let index=0;index<4;index++)await restore(src.packet,newOwner);const packet=recovery.exportBrowserFullBackup(newOwner),ids=packet.protection.snapshots.map(row=>row.id);expect(new Set(ids).size).toBe(ids.length);expect(packet.protection.books.length).toBeLessThan(packet.protection.snapshots.length);for(const row of packet.protection.books){const data=JSON.parse(row.data);expect(data).not.toHaveProperty('format');expect(data).not.toHaveProperty('protection')}
})
it('finds a transferred protected copy by date without an old client journal and blocks stale or other-store overwrites',async()=>{
 const src=await source(),fresh=install(newOwner);await restore(src.packet,newOwner)
 expect(localStorage.getItem('pos_pending_financial_v1')).toBeNull()
 const sources=recovery.getProtectedBackups(null,newOwner),selected=sources.find(row=>row.canRestore&&row.summary.cashLogs===1);expect(selected).toBeTruthy();expect(selected.createdAt).toBe('2026-10-16T04:00:00.000Z')
 const preview=await recovery.previewRestore({kind:'protected',id:selected.id},newOwner);expect(preview.kind).toBe('protected');expect(preview.target.cashLogs).toBe(1);await recovery.applyRestorePreview(preview.id,newOwner);expect(await addCashLog(src.requests[0])).toEqual(src.receipts[0]);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
 await addCashLog({...src.requests[0],id:'new-later-cash'});const before=localStorage.getItem(RECORD_KEY);expect(recovery.getProtectedBackups(null,newOwner).every(row=>!row.canRestore)).toBe(true);await expect(recovery.previewRestore({kind:'protected',id:selected.id},newOwner)).rejects.toThrow(/新的營運/);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
 const otherBook={...fresh.data,pos_business_settings:fresh.data.pos_business_settings.map(row=>row.key==='sharedStoreId'?{...row,value:JSON.stringify('different-store')}:row)};install(newOwner);await restore(seal({...src.packet,storeId:'different-store',book:otherBook}),newOwner);expect(recovery.getProtectedBackups(null,newOwner).find(row=>row.id===selected.id).reason).toBe('店面不符');await expect(recovery.previewRestore({kind:'protected',id:selected.id},newOwner)).rejects.toThrow(/店面/)
 expect(()=>recovery.getProtectedBackups(null,staff)).toThrow(/權限/);expect(()=>recovery.getProtectedBackups(null,{...newOwner,username:'forged'})).toThrow(/權限/)
})
