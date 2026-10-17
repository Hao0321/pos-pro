// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {browserStorage,readRecords,writeRecords} from '../../src/utils/browserStorage'
import {RECOVERY_PROTOCOL} from '../../electron/recoveryRules.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import * as kernel from '../../src/utils/browserRecovery'
import * as client from '../../src/utils/recoveryClient'

const owner={userId:'recovery-owner',username:'Current owner',role:'owner'},key='pos_pending_restore_v1'
let afterSales,lockNames
function entry(preview){const input={previewId:preview.id};return {version:1,kind:'restore',id:preview.id,input,scope:{storeId:preview.storeId,userId:owner.userId},signature:canonicalSignature(input)}}
async function preview(){return kernel.previewRestore({kind:'import',data:structuredClone(readRecords().data)},owner)}
beforeEach(()=>{
 localStorage.clear();delete window.electronAPI;lockNames=[];afterSales=null
 vi.stubGlobal('navigator',{language:'zh-TW',languages:['zh-TW'],locks:{request:async(name,action)=>{lockNames.push(name);const result=await action();if(name==='pos-sales-write-v1')afterSales?.(result);return result}}})
 writeRecords({pos_users:[{id:owner.userId,username:owner.username,role:owner.role,password:'owned-fixture'}],pos_business_settings:[{key:'sharedStoreId',value:JSON.stringify('recovery-store')}],pos2_products:[{id:'rice',name:'Rice',price:10,cost:3,stock:4,unit:'kg'}]})
})
afterEach(()=>{delete window.electronAPI;vi.unstubAllGlobals();vi.restoreAllMocks()})

it('a real browser kernel commit finishes when its pending client cache is cleared before acknowledgement',async()=>{
 const p=await preview();let received;afterSales=result=>{received=result;expect(client.readRecoveryCommand('restore').id).toBe(p.id);browserStorage.removeItem(key)}
 const receipt=await client.applyRestorePreview(p,owner);expect(receipt).toEqual(received);expect((await kernel.lookupRestorePreview(p.id,owner)).receipt).toEqual(receipt);expect(localStorage.getItem(key)).toBeNull();expect(lockNames.filter(name=>name==='pos-sales-write-v1')).toHaveLength(1)
})
it('a real accepted original returns before replay and leaves a newer pending source byte-for-byte intact',async()=>{
 const p=await preview(),receipt=await client.applyRestorePreview(p,owner),old=entry(p),next=entry(await preview()),raw=JSON.stringify(next);browserStorage.setItem(key,raw);const before=structuredClone(readRecords());lockNames=[]
 expect(await client.retryRecoveryCommand(old,owner)).toEqual(receipt);expect(browserStorage.getItem(key)).toBe(raw);expect(readRecords()).toEqual(before);expect(lockNames).toEqual(['pos-recovery-write-v1'])
})
it('an accepted original with no pending source returns without recreating a journal or redoing the restore',async()=>{
 const p=await preview(),receipt=await client.applyRestorePreview(p,owner),before=structuredClone(readRecords());lockNames=[];expect(await client.retryRecoveryCommand(entry(p),owner)).toEqual(receipt);expect(localStorage.getItem(key)).toBeNull();expect(readRecords()).toEqual(before);expect(lockNames).toEqual(['pos-recovery-write-v1'])
})
it('a missing original cannot replace another pending source or apply a new restore',async()=>{
 const old=entry(await preview()),next=entry(await preview()),raw=JSON.stringify(next);browserStorage.setItem(key,raw);const before=structuredClone(readRecords());lockNames=[];await expect(client.retryRecoveryCommand(old,owner)).rejects.toThrow(/上次復原/);expect(browserStorage.getItem(key)).toBe(raw);expect(readRecords()).toEqual(before);expect(lockNames).toEqual(['pos-recovery-write-v1'])
})
it('a real precommit rejection clears only its own journal after authoritative absence is confirmed',async()=>{
 const p=await preview();writeRecords({pos2_products:[...readRecords().data.pos2_products,{id:'new-product',name:'New',price:1,cost:1,stock:1}]});const before=structuredClone(readRecords());await expect(client.applyRestorePreview(p,owner)).rejects.toThrow(/更新|改變/);expect(localStorage.getItem(key)).toBeNull();expect(readRecords()).toEqual(before);expect((await kernel.lookupRestorePreview(p.id,owner)).found).toBe(false)
})
it('a corrupt current journal is retained even when another original is verifiably complete',async()=>{
 const p=await preview();await client.applyRestorePreview(p,owner);browserStorage.setItem(key,'{');const before=structuredClone(readRecords());await expect(client.retryRecoveryCommand(entry(p),owner)).rejects.toThrow();expect(browserStorage.getItem(key)).toBe('{');expect(readRecords()).toEqual(before)
})
it('the current real browser actor is checked before an accepted historical result is returned',async()=>{
 const p=await preview();await client.applyRestorePreview(p,owner);const next=entry(await preview()),raw=JSON.stringify(next);browserStorage.setItem(key,raw);const before=structuredClone(readRecords());await expect(client.retryRecoveryCommand(entry(p),{...owner,username:'Forged'})).rejects.toThrow(/權限/);await expect(client.retryRecoveryCommand(entry(p),{...owner,role:'staff'})).rejects.toThrow(/店主/);expect(browserStorage.getItem(key)).toBe(raw);expect(readRecords()).toEqual(before)
})

it.each(['wrong id','wrong store','missing revision','missing source','malformed absence','unknown lookup'])('a forged or uncertain %s cannot clear pending source or authorize a write',async bad=>{
 const p={id:'restore-owned',storeId:'recovery-store'},old=entry(p),raw=JSON.stringify(old);browserStorage.setItem(key,raw)
 const receipt={protocol:RECOVERY_PROTOCOL,success:true,id:p.id,storeId:p.storeId,revision:'original-revision',sourceId:'original-source'},status={protocol:RECOVERY_PROTOCOL,success:true,id:p.id,found:true,receipt},apply=vi.fn()
 if(bad==='wrong id')receipt.id='restore-other';if(bad==='wrong store')receipt.storeId='other-store';if(bad==='missing revision')delete receipt.revision;if(bad==='missing source')delete receipt.sourceId;if(bad==='malformed absence'){status.found=false;delete status.receipt}const lookup=bad==='unknown lookup'?vi.fn().mockRejectedValue(Error('transport unknown')):vi.fn().mockResolvedValue(status);window.electronAPI={db:{lookupRestorePreview:lookup,applyRestorePreview:apply}}
 await expect(client.retryRecoveryCommand(old,owner)).rejects.toThrow();expect(localStorage.getItem(key)).toBe(raw);expect(apply).not.toHaveBeenCalled()
})
it.each(['restored source','original operation'])('a recover acknowledgement must bind its %s as well as the restore ID',async field=>{
 const input={id:'recovery-owned',sourceId:'wanted-source',expectedRevision:'r',pending:{kind:'cashlog',request:{id:'wanted-cash'}}},old={version:1,kind:'recover',id:input.id,input,scope:{storeId:'recovery-store',userId:owner.userId},signature:canonicalSignature(input)},pendingKey='pos_pending_recovery_v1',raw=JSON.stringify(old);browserStorage.setItem(pendingKey,raw)
 const receipt={protocol:RECOVERY_PROTOCOL,success:true,id:input.id,storeId:'recovery-store',revision:'r2',sourceId:'preimage',restoredSourceId:field==='restored source'?'wrong':input.sourceId,originalOperationId:field==='original operation'?'wrong':input.pending.request.id},apply=vi.fn();window.electronAPI={db:{lookupRecoveryOperation:vi.fn().mockResolvedValue({protocol:RECOVERY_PROTOCOL,success:true,id:input.id,found:true,receipt}),applyRecoveryOperation:apply}}
 await expect(client.retryRecoveryCommand(old,owner)).rejects.toThrow(/原始紀錄/);expect(browserStorage.getItem(pendingKey)).toBe(raw);expect(apply).not.toHaveBeenCalled()
})
