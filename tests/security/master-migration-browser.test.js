// @vitest-environment jsdom
import {test,expect,beforeEach,afterEach,vi} from 'vitest'
import fixture from '../fixtures/lot-count-native-v1.json'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {unpackRecoveryGraph} from '../../electron/recoveryGraph.mjs'
import {makeMasterMigrationInput} from '../../electron/masterMigration.mjs'
import {readRecords,RECORD_KEY,writeRecords} from '../../src/utils/browserStorage'
import {browserRestaurantState} from '../../src/utils/browserRestaurant'
import {getBrowserPrivateDraftContext} from '../../src/utils/browserPrivateDrafts'
import {previewBrowserMasterMigration,commitBrowserMasterMigration} from '../../src/utils/browserMasterMigration'
const actor={userId:'owner',username:'Lot fixture',role:'owner'},set=Storage.prototype.setItem
const document=(id='browser-first')=>({protocol:'pos-migration-draft/v1',id,source:{system:'Legacy',company:'Company 001'},tables:[{entity:'products',columns:['Name','unit','price','cost'],rows:[{externalId:'0001',values:['Browser new product','piece','0100.00','025.50']}]},{entity:'customers',columns:['Name','phone'],rows:[{externalId:'C0001',values:['New customer','0900000001']}]}]})
beforeEach(()=>{
 localStorage.clear();vi.stubGlobal('navigator',{locks:{request:async(_name,callback)=>callback()}})
 const portable=readPortableBackup(fixture,'browser'),graph=unpackRecoveryGraph(portable.protection,'browser')
 const seed={version:1,revision:1,salesEpoch:'browser-master-epoch',data:portable.book,recovery:{version:portable.protection.version,snapshots:graph.snapshots.map(row=>({...row,data:row.storage==='sqlite'?row.data:JSON.parse(row.data)})),originalIds:graph.originalIds,events:graph.events.map(row=>({...row,receipt:JSON.parse(row.receipt)}))}}
 localStorage.setItem(RECORD_KEY,JSON.stringify(seed))
})
afterEach(()=>{Storage.prototype.setItem=set;vi.unstubAllGlobals()})
async function request(doc=document()){
 const scope=await getBrowserPrivateDraftContext(actor),input=makeMasterMigrationInput(JSON.stringify(doc),scope),view=await previewBrowserMasterMigration(input,actor)
 expect(view.ready).toBe(true)
 return {...input,review:view.review}
}
test('MM3 actual browser adapter commits the master batch and its active cost event once; restaurant/store reads remain usable',async()=>{
 const input=await request(),before=readRecords(),result=await commitBrowserMasterMigration(input,actor)
 expect(result.success,result.error).toBe(true);const saved=readRecords();expect(saved.data.pos2_products).toHaveLength(before.data.pos2_products.length+1);expect(saved.data.pos_stock_cost_entries).toHaveLength(before.data.pos_stock_cost_entries.length+1);expect(saved.recovery.version).toBe(10);expect(()=>browserRestaurantState()).not.toThrow()
 const raw=localStorage.getItem(RECORD_KEY);expect((await commitBrowserMasterMigration(input,actor)).receipt).toEqual(result.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
test('MM3 actual browser quota failure preserves every collection and the same original request can retry',async()=>{
 const input=await request(),before=localStorage.getItem(RECORD_KEY)
 Storage.prototype.setItem=function(key,value){if(key===RECORD_KEY)throw Error('fixture master quota');return set.call(this,key,value)}
 const failed=await commitBrowserMasterMigration(input,actor);expect(failed.success).toBe(false);expect(failed.committed).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
 Storage.prototype.setItem=set;expect((await commitBrowserMasterMigration(input,actor)).success).toBe(true)
})
test('MM3 actual browser post-write reply loss resolves the saved original and never appends a second cost entry',async()=>{
 const input=await request(),before=readRecords();let once=false
 Storage.prototype.setItem=function(key,value){const result=set.call(this,key,value);if(key===RECORD_KEY&&!once){once=true;throw Error('fixture master reply lost after write')}return result}
 const result=await commitBrowserMasterMigration(input,actor);Storage.prototype.setItem=set;expect(result.success,result.error).toBe(true);expect(once).toBe(true);expect(readRecords().data.pos_stock_cost_entries).toHaveLength(before.data.pos_stock_cost_entries.length+1)
 expect((await commitBrowserMasterMigration(input,actor)).receipt).toEqual(result.receipt)
})
test('MM4 browser generic writers cannot fabricate migration receipts or change the protected head',async()=>{
 const input=await request();expect((await commitBrowserMasterMigration(input,actor)).success).toBe(true);const saved=readRecords(),raw=localStorage.getItem(RECORD_KEY)
 expect(()=>writeRecords({pos_audit_log:[]},saved.revision)).toThrow('搬家回執');expect(()=>writeRecords({pos_business_settings:saved.data.pos_business_settings.filter(row=>row.key!=='agentMasterMigrationHead')},saved.revision)).toThrow('搬家保護')
 expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
