import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import legacy from '../fixtures/table-kitchen-v1.json'
import {DATA_KEYS,RECORD_KEY} from '../../src/utils/browserStorage'
import {commitBrowserRestaurant,browserRestaurantState} from '../../src/utils/browserRestaurant'
import {executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'
import {canonicalSignature} from '../../electron/operationRules.mjs'

const owner=legacy.owner,ok=result=>{expect(result.success,result.error).toBe(true);return result}
let records,ordinal
function body(action,fields={}){const state=browserRestaurantState(),entry=state.entries[0];return {kind:'restaurant',action,storeId:state.storeId,epoch:state.epoch,fundsProtocol:'pos-restaurant-funds/v1',costMode:state.costMode,...(entry?{entryId:entry.id,expectedVersion:entry.version}:{}),...fields}}
const command=(action,fields={})=>({...body(action,fields),id:'funded-client-'+(++ordinal),time:new Date().toISOString()})
const apply=async(action,fields={})=>ok(await commitBrowserRestaurant(command(action,fields),owner))
const cash=amount=>({amount,paid:amount,payMethod:'cash',shiftId:'shift'})
beforeEach(async()=>{
 records=new Map();ordinal=0
 vi.stubGlobal('localStorage',{getItem:key=>records.get(key)??null,removeItem:key=>records.delete(key),setItem:(key,value)=>records.set(key,String(value))})
 vi.stubGlobal('navigator',{locks:{request:async(_name,fn)=>fn()}})
 const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos_users=structuredClone(legacy.before.users);data.pos2_products=[{id:'p',name:'Bowl',price:95,cost:40,stock:3}];data.pos2_shifts=[{id:'shift',status:'open'}]
 records.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
 const config=browserRestaurantState().config
 ok(await commitBrowserRestaurant({id:'configure',time:new Date().toISOString(),kind:'restaurant',action:'configure',expectedConfig:canonicalSignature(config),config:{...config,enabled:true,fundsEnabled:true}},owner))
 const state=browserRestaurantState()
 ok(await commitBrowserRestaurant(command('create',{day:state.today,slot:'12:00',channel:'walkin',customer:'Guest',contact:'',note:'',items:[{id:'p',qty:2,price:95}]}),owner))
})
afterEach(()=>vi.unstubAllGlobals())

test.each([
 ['missing immutable event',result=>{delete result.fundsEvent}],
 ['changed event amount',result=>{result.fundsEvent.amountCents++}],
 ['missing cash movement',result=>{delete result.cashLog}],
 ['changed cash amount',result=>{result.cashLog.amount++}],
 ['missing original event signature',result=>{delete result.receipt.eventSignature}],
 ['wrong current balance',result=>{result.funding.dueCents++}],
 ['stripped protocol',result=>{delete result.receipt.fundsProtocol}],
])('an acknowledged %s cannot clear the original pending collection',async(_label,mutate)=>{
 const input=body('funds-receive',cash(50));let original
 await expect(executeFinancial('restaurant',input,async request=>{original=request;const result=structuredClone(ok(await commitBrowserRestaurant(request,owner)));mutate(result);return result})).rejects.toThrow()
 expect(readPendingFinancial()?.request.id).toBe(original.id)
 const saved=records.get(RECORD_KEY),result=await executeFinancial('restaurant',input,request=>commitBrowserRestaurant(request,owner))
 expect(result.fundsEvent.amountCents).toBe(5000);expect(readPendingFinancial()).toBeNull();expect(records.get(RECORD_KEY)).toBe(saved)
})

test('a full funded cancellation acknowledges its actual source refund even though the remaining entry total is zero',async()=>{
 await apply('funds-receive',cash(190));await apply('advance',{status:'cooking'});await apply('advance',{status:'ready'});await apply('advance',{status:'completed'})
 const result=await executeFinancial('restaurant',body('cancel',{reason:'all prepared',shiftId:'shift'}),request=>commitBrowserRestaurant(request,owner))
 expect(result.entry.total).toBe(0);expect(result.refund.total).toBe(-190);expect(readPendingFinancial()).toBeNull()
})

test('an explicitly funded preparation command cannot be downgraded to a legacy reply by removing both protocol and funds data',async()=>{
 const input=body('advance',{status:'cooking'})
 await expect(executeFinancial('restaurant',input,async request=>{const result=structuredClone(ok(await commitBrowserRestaurant(request,owner)));delete result.receipt.fundsProtocol;delete result.entry.funds;result.config.fundsEnabled=false;return result})).rejects.toThrow()
 expect(readPendingFinancial()).not.toBeNull();const saved=records.get(RECORD_KEY)
 await executeFinancial('restaurant',input,request=>commitBrowserRestaurant(request,owner))
 expect(readPendingFinancial()).toBeNull();expect(records.get(RECORD_KEY)).toBe(saved)
})

test.each([
 ['another funds original',result=>{result.entry.funds.entryId='another-booking'}],
 ['missing receipt actor name',result=>{delete result.receipt.actor.username}],
])('a preparation acknowledgment with %s retains the pending original',async(_label,mutate)=>{
 const input=body('advance',{status:'cooking'})
 await expect(executeFinancial('restaurant',input,async request=>{const result=structuredClone(ok(await commitBrowserRestaurant(request,owner)));mutate(result);return result})).rejects.toThrow()
 expect(readPendingFinancial()).not.toBeNull();const saved=records.get(RECORD_KEY)
 await executeFinancial('restaurant',input,request=>commitBrowserRestaurant(request,owner))
 expect(readPendingFinancial()).toBeNull();expect(records.get(RECORD_KEY)).toBe(saved)
})

test('late original collection recovery accepts its unchanged event with a newer fulfilled and partially refunded work order',async()=>{
 const input=body('funds-receive',cash(50))
 await expect(executeFinancial('restaurant',input,async request=>{ok(await commitBrowserRestaurant(request,owner));throw Error('fixture reply lost')})).rejects.toThrow()
 await apply('funds-receive',{amount:140,paid:140,payMethod:'card',shiftId:'shift'});await apply('advance',{status:'cooking'});await apply('advance',{status:'ready'});await apply('advance',{status:'completed'});await apply('cancel-part',{quantities:[{id:'p',qty:1}],reason:'one later',shiftId:'shift'})
 const saved=records.get(RECORD_KEY),result=await executeFinancial('restaurant',input,request=>commitBrowserRestaurant(request,owner))
 expect(result.entry.status).toBe('completed');expect(result.entry.total).toBe(95);expect(result.fundsEvent.amountCents).toBe(5000);expect(readPendingFinancial()).toBeNull();expect(records.get(RECORD_KEY)).toBe(saved)
})
