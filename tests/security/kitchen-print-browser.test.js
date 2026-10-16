// @vitest-environment jsdom
import {test,expect,beforeEach,afterEach,vi} from 'vitest'
import source from '../fixtures/kitchen-print-native-v1.json'
import baseline from '../fixtures/kitchen-print-v1.json'
import {readPortableBackup,createCompleteBackup} from '../../electron/backupEnvelope.mjs'
import {readRecords,restoreRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {browserProtectionGraph,browserProtectionMetadata} from '../../src/utils/browserProtection'
import {browserKitchenPrintState,commitBrowserKitchenPrint} from '../../src/utils/browserKitchenPrint'

const actor=source.owner,record=()=>JSON.parse(localStorage.getItem(RECORD_KEY)),finances=data=>Object.fromEntries(Object.entries(data).filter(([key])=>!['pos_kitchen_print_jobs','pos_kitchen_print_operations'].includes(key)))
const request=()=>{const job=browserKitchenPrintState(actor).jobs[0];return {id:'confirm-browser-original',kind:'kitchen-print',action:'confirm',time:new Date().toISOString(),entryId:job.entryId,jobId:job.id,expectedVersion:job.version,operatorId:actor.userId,operatorRole:actor.role}}
beforeEach(()=>{localStorage.clear();vi.stubGlobal('navigator',{locks:{request:async(_name,callback)=>callback()}});const seed=readPortableBackup(baseline.before,'browser');localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'independent-browser-runtime',data:seed.book,recovery:browserProtectionMetadata(seed.protection)}));const incoming=readPortableBackup(source.packet,'browser');restoreRecords(incoming.book,1,null,incoming)})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear()})

test('unprotected legacy print keys cannot be silently migrated into an authoritative journal',()=>{
 localStorage.clear();localStorage.setItem('pos_kitchen_print_jobs',JSON.stringify(source.packet.book.kitchenPrintJobs));const raw=localStorage.getItem('pos_kitchen_print_jobs');expect(()=>readRecords()).toThrow('廚房列印紀錄需要核對');expect(localStorage.getItem('pos_kitchen_print_jobs')).toBe(raw);expect(localStorage.getItem(RECORD_KEY)).toBe(null)
})

test('actual native submitted ticket, byte digest and complete graph5 move into the browser without granting a printer binding',()=>{
 const saved=readRecords(),state=browserKitchenPrintState(actor);expect(saved.recovery.version).toBe(5);expect(state.binding.ready).toBe(false);expect(state.setup).toBe(null);expect(state.jobs[0].state).toBe('submitted');expect(state.jobs[0].paper).toBe(null);expect(saved.data.pos_kitchen_print_jobs).toEqual(source.packet.book.kitchenPrintJobs);expect(saved.data.pos_kitchen_print_operations).toEqual(source.packet.book.kitchenPrintOperations);expect(saved.data.pos2_products).toEqual(source.packet.book.products)
})
test('browser human paper confirmation is one durable original operation; replay preserves raw bytes and all financial collections',async()=>{
 const before=record(),r=request(),saved=await commitBrowserKitchenPrint(r,actor);expect(saved.success).toBe(true);expect(saved.jobs[0].state).toBe('confirmed');const after=localStorage.getItem(RECORD_KEY);expect(finances(record().data)).toEqual(finances(before.data));expect((await commitBrowserKitchenPrint(r,actor)).receipt).toEqual(saved.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(after);const changed=await commitBrowserKitchenPrint({...r,entryId:'another-original'},actor);expect(changed.success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(after)
})
test('a standalone browser cannot dispatch or reprint through a missing native printer, and a forged current actor cannot confirm',async()=>{
 const before=localStorage.getItem(RECORD_KEY),r=request();for(const action of ['request','send','reprint']){const rejected=await commitBrowserKitchenPrint({...r,id:'unsupported-'+action,action,acknowledgeDuplicateRisk:true},actor);expect(rejected.success).toBe(false);expect(rejected.committed).toBe(false)}expect((await commitBrowserKitchenPrint(r,{...actor,userId:'forged'})).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})
test('quota failure keeps the exact browser book and does not confirm paper',async()=>{
 const before=localStorage.getItem(RECORD_KEY),r=request(),original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY)throw Error('quota');return original.call(this,key,value)});const rejected=await commitBrowserKitchenPrint(r,actor);expect(rejected.success).toBe(false);expect(rejected.committed).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})
test.each([false,true])('post-write acknowledgement loss with unavailable readback=%s resolves from or preserves the original without another confirmation',async unavailable=>{
 const r=request(),before=record(),set=Storage.prototype.setItem,get=Storage.prototype.getItem;let written=false,readFailures=0;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){set.call(this,key,value);if(key===RECORD_KEY&&!written){written=true;readFailures=unavailable?1:0;throw Error('lost post-write result')}});vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(key){if(key===RECORD_KEY&&readFailures){readFailures--;throw Error('readback unavailable')}return get.call(this,key)});const result=await commitBrowserKitchenPrint(r,actor);expect(written).toBe(true);expect(result.success).toBe(!unavailable);if(unavailable)expect(result.committed).toBe(null);vi.restoreAllMocks();const committed=record();expect(committed.data.pos_kitchen_print_jobs[0].state).toBe('confirmed');expect(finances(committed.data)).toEqual(finances(before.data));const raw=localStorage.getItem(RECORD_KEY),replay=await commitBrowserKitchenPrint(r,actor);expect(replay.success).toBe(true);expect(localStorage.getItem(RECORD_KEY)).toBe(raw);expect(committed.data.pos_kitchen_print_operations.filter(o=>o.id===r.id)).toHaveLength(1)
})
test('complete browser export carries the exact original attempt, confirmation and sources back into a native portable packet',async()=>{
 const r=request();expect((await commitBrowserKitchenPrint(r,actor)).success).toBe(true);const saved=readRecords(),packet=createCompleteBackup(saved.data,browserProtectionGraph(saved),'browser'),native=readPortableBackup(packet,'sqlite');expect(packet.protection.version).toBe(5);expect(native.book.kitchenPrintJobs).toEqual(saved.data.pos_kitchen_print_jobs);expect(native.book.kitchenPrintOperations).toEqual(saved.data.pos_kitchen_print_operations);expect(native.book.restaurantOrders).toEqual(source.packet.book.restaurantOrders);expect(native.features).toContain('kitchen-print-v1')
})
