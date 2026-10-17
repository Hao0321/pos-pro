// @vitest-environment jsdom
import {test,expect,beforeEach,afterEach,vi} from 'vitest'
import native from '../fixtures/kitchen-print-cost-native-v1.json'
import {readPortableBackup,createCompleteBackup} from '../../electron/backupEnvelope.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {RECORD_KEY,readRecords,restoreRecords} from '../../src/utils/browserStorage'
import {browserProtectionGraph} from '../../src/utils/browserProtection'
import {commitBrowserRestaurant,browserRestaurantState} from '../../src/utils/browserRestaurant'

const actor=native.owner,records=()=>readRecords().data,costCount=()=>records().pos_stock_cost_entries.length
const request=()=>{const d=new Date(),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return {id:'browser-cost-print-original',kind:'restaurant',action:'create',time:d.toISOString(),channel:'walkin',day,slot:'12:00',customer:'Browser fixture',contact:'',note:'',items:[{id:'bowl',qty:1,price:60}]}}
beforeEach(()=>{localStorage.clear();vi.stubGlobal('navigator',{locks:{request:async(_key,work)=>work()}});const incoming=readPortableBackup(native.packet,'browser');restoreRecords(incoming.book,0,null,incoming)})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear()})
test('one actual standalone cost-enabled restaurant writer saves its original, exact cost event and unique kitchen intent in the same atomic record',async()=>{
 const r=request(),before=readRecords(),count=costCount(),saved=await commitBrowserRestaurant(r,actor);expect(saved.success,saved.error).toBe(true);expect(saved.costReceipt).toBeTruthy();expect(costCount()).toBe(count+1);expect(count).toBe(63);const after=readRecords();expect(after.recovery.version).toBe(5);expect(after.data.pos_kitchen_print_jobs).toHaveLength(1);expect(after.data.pos_kitchen_print_jobs[0]).toMatchObject({entryId:saved.entry.id,state:'queued',dispatch:'auto',paper:null});expect(after.revision).toBe(before.revision+1)
 const raw=localStorage.getItem(RECORD_KEY),again=await commitBrowserRestaurant(r,actor);expect(again).toEqual(saved);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
 const book=browserToBook(after.data),packet=createCompleteBackup(after.data,browserProtectionGraph(after),'browser'),converted=readPortableBackup(packet,'sqlite');expect(converted.book.stockCostEntries).toEqual(book.stockCostEntries);expect(converted.book.kitchenPrintJobs).toEqual(book.kitchenPrintJobs);expect(converted.book.kitchenPrintOperations).toEqual(book.kitchenPrintOperations)
},20000)
test('browser quota failure cannot leave a reservation, cost event or print intent on its own; exact original retry commits them once',async()=>{
 const raw=localStorage.getItem(RECORD_KEY),r=request(),original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY)throw Error('fixture quota before atomic commit');return original.call(this,key,value)})
 const rejected=await commitBrowserRestaurant(r,actor);expect(rejected.success).toBe(false);expect(rejected.committed).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw);vi.restoreAllMocks();const saved=await commitBrowserRestaurant(r,actor);expect(saved.success,saved.error).toBe(true);expect(costCount()).toBe(64);expect(records().pos_kitchen_print_jobs).toHaveLength(1)
},20000)
test('a postcommit storage exception still reads the original cost and print acknowledgement without another business operation',async()=>{
 const r=request(),original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){original.call(this,key,value);if(key===RECORD_KEY)throw Error('fixture exception after atomic record persisted')});const saved=await commitBrowserRestaurant(r,actor);expect(saved.success,saved.error).toBe(true);const raw=localStorage.getItem(RECORD_KEY);vi.restoreAllMocks();expect((await commitBrowserRestaurant(r,actor)).receipt).toEqual(saved.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw);expect(costCount()).toBe(64);expect(records().pos_kitchen_print_jobs).toHaveLength(1)
},20000)
test('cost-enabled browser cancellation releases the same reservation and voids its unsent prep ticket without inventing a cancellation print',async()=>{
 const created=await commitBrowserRestaurant(request(),actor);expect(created.success,created.error).toBe(true);const entry=browserRestaurantState().entries.find(e=>e.id===created.entry.id),r={id:'browser-cancel-print-original',kind:'restaurant',action:'cancel',time:new Date().toISOString(),entryId:entry.id,expectedVersion:entry.version,reason:'Cancelled before printing'},saved=await commitBrowserRestaurant(r,actor);expect(saved.success,saved.error).toBe(true);expect(saved.costReceipt).toBeTruthy();expect(costCount()).toBe(65);expect(records().pos_kitchen_print_jobs).toHaveLength(1);expect(records().pos_kitchen_print_jobs[0].state).toBe('voided');const raw=localStorage.getItem(RECORD_KEY);expect((await commitBrowserRestaurant(r,actor)).receipt).toEqual(saved.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
},20000)
