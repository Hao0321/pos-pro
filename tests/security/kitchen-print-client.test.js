// @vitest-environment jsdom
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import native from '../fixtures/kitchen-print-native-v1.json'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {planKitchenAction,kitchenPrintReceipt} from '../../electron/kitchenPrint.mjs'
import {kitchenPreparationReview} from '../../electron/fundedKitchenPrint.mjs'
const mocks=vi.hoisted(()=>({values:new Map(),storage:{getItem:vi.fn(),setItem:vi.fn(),removeItem:vi.fn()},read:vi.fn(),apply:vi.fn(),restaurant:vi.fn(),configure:vi.fn(),recovery:vi.fn()}))
vi.mock('../../src/utils/browserStorage',()=>({browserStorage:mocks.storage}))
vi.mock('../../src/utils/dataAccess',()=>({loadKitchenPrintState:mocks.read,applyKitchenPrintOperation:mocks.apply,loadRestaurantState:mocks.restaurant,applyRestaurantOperation:mocks.configure}))
vi.mock('../../src/utils/recoveryClient',()=>({getRecoveryState:mocks.recovery}))
import {readKitchenPrintPending,submitKitchenPrint,retryKitchenPrint,KITCHEN_PRINT_PENDING} from '../../src/utils/kitchenPrintClient'

const actor=native.owner,storeId='client-test-store',book=native.packet.book
let print,config,lost,partial
const input=()=>({action:'confirm',entryId:print.jobs[0].entryId,jobId:print.jobs[0].id,expectedVersion:print.jobs[0].version})
const clone=value=>structuredClone(value)
beforeEach(()=>{
 vi.resetAllMocks();mocks.values.clear();lost=false;partial=false
 print={jobs:clone(book.kitchenPrintJobs),operations:clone(book.kitchenPrintOperations)}
 const raw=book.settings.find(s=>s.key==='restaurantConfig').value;config=typeof raw==='string'?JSON.parse(raw):clone(raw)
 mocks.storage.getItem.mockImplementation(key=>mocks.values.get(key)??null);mocks.storage.setItem.mockImplementation((key,value)=>mocks.values.set(key,value));mocks.storage.removeItem.mockImplementation(key=>mocks.values.delete(key))
 mocks.read.mockImplementation(async current=>({protocol:'pos-kitchen-print-state/v1',storeId,actor:current,now:new Date().toISOString(),policy:config.kitchenPrinting,jobs:print.jobs}))
 mocks.restaurant.mockImplementation(async()=>({config:clone(config)}))
 mocks.apply.mockImplementation(async(r,current)=>{print=planKitchenAction(r,print,{entries:book.restaurantOrders,restaurantOperations:book.restaurantOperations},current,{epoch:book.kitchenPrintJobs[0].epoch,session:'',activeAttempts:[]}).state;const result=clone(kitchenPrintReceipt(r,print));if(lost){lost=false;throw Error('fixture reply lost after commit')}if(partial)delete result.jobs;return result})
 mocks.configure.mockImplementation(async r=>{config=clone(r.config);const result={success:true,config,receipt:{id:r.id,kind:'restaurant',action:'configure',signature:canonicalSignature(r)}};if(lost){lost=false;throw Error('fixture configuration reply lost after commit')}return result})
 mocks.recovery.mockResolvedValue({active:'matched',storeId});vi.stubGlobal('navigator',{locks:{request:async(_key,action)=>action()}})
 delete window.electronAPI
})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})

test('persist the exact print ID before authority, then clear only a complete canonical paper acknowledgement',async()=>{
 mocks.apply.mockImplementationOnce(async(r,current)=>{expect(readKitchenPrintPending().request).toEqual(r);expect(mocks.values.has('pos_pending_financial_v1')).toBe(false);print=planKitchenAction(r,print,{entries:book.restaurantOrders,restaurantOperations:book.restaurantOperations},current,{epoch:print.jobs[0].epoch}).state;return kitchenPrintReceipt(r,print)})
 const result=await submitKitchenPrint(input(),actor);expect(result.jobs[0].state).toBe('confirmed');expect(readKitchenPrintPending()).toBe(null);expect(print.operations.filter(o=>o.action==='confirm')).toHaveLength(1)
})
test('a reply lost after paper confirmation resumes the same original ID and never dispatches or confirms twice',async()=>{
 lost=true;await expect(submitKitchenPrint(input(),actor)).rejects.toThrow('reply lost');const original=readKitchenPrintPending(),raw=mocks.values.get(KITCHEN_PRINT_PENDING),count=print.operations.length
 await expect(submitKitchenPrint(input(),actor)).rejects.toThrow();expect(mocks.values.get(KITCHEN_PRINT_PENDING)).toBe(raw)
 const result=await retryKitchenPrint(actor);expect(result.receipt.id).toBe(original.request.id);expect(mocks.apply.mock.calls[1][0]).toEqual(original.request);expect(print.operations).toHaveLength(count);expect(readKitchenPrintPending()).toBe(null)
})

test('a reviewed current-meal request keeps its complete preview in the original journal and survives lost reply without another ticket',async()=>{
 print={jobs:[],operations:[]};const entry=book.restaurantOrders[0],review=kitchenPreparationReview(entry);lost=true
 await expect(submitKitchenPrint({action:'request',entryId:entry.id,review,acknowledgeDuplicateRisk:true},actor)).rejects.toThrow('reply lost')
 const pending=readKitchenPrintPending(),count=print.jobs.length;expect(pending.request.review).toEqual(review)
 const result=await retryKitchenPrint(actor);expect(result.receipt.id).toBe(pending.request.id);expect(print.jobs).toHaveLength(count);expect(result.jobs[0].ticket.items).toEqual(review.items);expect(readKitchenPrintPending()).toBeNull()
})

test.each(['wrong-current-quantity','wrong-current-total','cancellation-instead-of-preparation'])('a structurally valid %s cannot clear a reviewed preparation request',async mode=>{
 print={jobs:[],operations:[]};const entry=book.restaurantOrders[0],actual=mocks.apply.getMockImplementation()
 mocks.apply.mockImplementation(async(r,current)=>{const result=await actual(r,current);for(const job of [result.jobs[0],result.receipt.changes[0].job]){if(mode==='wrong-current-quantity')job.ticket.items[0].qty++;if(mode==='wrong-current-total')job.ticket.total++;if(mode==='cancellation-instead-of-preparation'){job.kind='cancel';job.ticket.kind='cancel'}}return result})
 await expect(submitKitchenPrint({action:'request',entryId:entry.id,review:kitchenPreparationReview(entry),acknowledgeDuplicateRisk:true},actor)).rejects.toThrow()
 expect(readKitchenPrintPending()).not.toBeNull()
})
test.each(['missing-jobs','wrong-quantity','wrong-version','wrong-actor','contradictory-rejection'])('a %s response preserves the original journal instead of claiming paper success',async mode=>{
 const actual=mocks.apply.getMockImplementation();mocks.apply.mockImplementation(async(r,current)=>{const result=await actual(r,current);if(mode==='missing-jobs')delete result.jobs;if(mode==='wrong-quantity')result.jobs[0].ticket.items[0].qty++;if(mode==='wrong-version')result.receipt.changes[0].beforeVersion++;if(mode==='wrong-actor')result.receipt.actor.userId='forged';if(mode==='contradictory-rejection'){result.success=false;result.committed=false}return result})
 await expect(submitKitchenPrint(input(),actor)).rejects.toThrow();expect(readKitchenPrintPending().request.action).toBe('confirm')
})
test('quota and malformed original records refuse a new mutation, preserving the stored bytes and ordinary financial state',async()=>{
 mocks.storage.setItem.mockImplementationOnce(()=>{throw Error('fixture quota')});await expect(submitKitchenPrint(input(),actor)).rejects.toThrow('quota');expect(mocks.apply).not.toHaveBeenCalled();expect(readKitchenPrintPending()).toBe(null)
 mocks.values.set(KITCHEN_PRINT_PENDING,'{damaged');mocks.values.set('pos_pending_financial_v1','ordinary-cash-original');await expect(submitKitchenPrint(input(),actor)).rejects.toThrow();expect(mocks.values.get(KITCHEN_PRINT_PENDING)).toBe('{damaged');expect(mocks.values.get('pos_pending_financial_v1')).toBe('ordinary-cash-original');expect(mocks.apply).not.toHaveBeenCalled()
})
test('unconfirmed configuration uses its own journal, retains the restaurant CAS and replays the original instead of blocking cashier',async()=>{
 lost=true;const policy={...config.kitchenPrinting,enabled:false};await expect(submitKitchenPrint({action:'configure',policy,kitchenPaperAcknowledged:false},actor)).rejects.toThrow('configuration reply lost')
 const original=readKitchenPrintPending();expect(original.kind).toBe('restaurant');expect(original.request.expectedConfig).toBeTypeOf('string');expect(mocks.values.has('pos_pending_financial_v1')).toBe(false);expect(original.request.config.kitchenPrinting).toEqual(policy)
 await retryKitchenPrint(actor);expect(mocks.configure.mock.calls[1][0]).toEqual(original.request);expect(readKitchenPrintPending()).toBe(null)
})
test('a changed shop or operator preserves the original, while protected-original recovery requires a current owner and matching proof',async()=>{
 lost=true;await expect(submitKitchenPrint(input(),actor)).rejects.toThrow();const raw=mocks.values.get(KITCHEN_PRINT_PENDING),other={userId:'different-owner',username:'Other owner',role:'owner'}
 await expect(retryKitchenPrint(other)).rejects.toThrow('帳號已變更');expect(mocks.values.get(KITCHEN_PRINT_PENDING)).toBe(raw)
 const originalRead=mocks.read.getMockImplementation();mocks.read.mockImplementation(async current=>({...await originalRead(current),storeId:'changed-store'}));await expect(retryKitchenPrint(actor)).rejects.toThrow('店面已變更');expect(mocks.values.get(KITCHEN_PRINT_PENDING)).toBe(raw);mocks.read.mockImplementation(originalRead)
 mocks.recovery.mockResolvedValueOnce({active:'missing',storeId});await expect(retryKitchenPrint(other,{recovered:true})).rejects.toThrow('店主核對');expect(mocks.values.get(KITCHEN_PRINT_PENDING)).toBe(raw)
 await retryKitchenPrint(other,{recovered:true});expect(readKitchenPrintPending()).toBe(null);expect(print.operations.filter(o=>o.action==='confirm')).toHaveLength(1)
})
test('an invalid new intent is rejected before it can poison the durable print journal',async()=>{
 await expect(submitKitchenPrint({...input(),expectedVersion:0},actor)).rejects.toThrow();expect(readKitchenPrintPending()).toBe(null);expect(mocks.apply).not.toHaveBeenCalled()
})
