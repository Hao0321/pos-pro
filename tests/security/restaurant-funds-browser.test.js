import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import legacy from '../fixtures/table-kitchen-v1.json'
import {DATA_KEYS,RECORD_KEY,readRecords} from '../../src/utils/browserStorage'
import {commitBrowserRestaurant,browserRestaurantState} from '../../src/utils/browserRestaurant'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {summarizeRestaurantFunds} from '../../electron/restaurantFunds.mjs'
import {browserProtectionGraph} from '../../src/utils/browserProtection'
import {createCompleteBackup,readCompleteBackup} from '../../electron/backupEnvelope.mjs'
let records,refuse,throwAfterWrite,ordinal
const owner=legacy.owner
function command(action,fields={}){const state=browserRestaurantState();return {id:'browser-funds-'+(++ordinal),time:new Date().toISOString(),kind:'restaurant',action,storeId:state.storeId,epoch:state.epoch,...fields}}
const ok=result=>{expect(result.success,result.error).toBe(true);return result}
async function apply(action,entry,fields={}){return commitBrowserRestaurant(command(action,{entryId:entry.id,expectedVersion:entry.version,...fields}),owner)}
function current(){return browserRestaurantState().entries[0]}
beforeEach(async()=>{
 records=new Map();refuse=false;throwAfterWrite=false;ordinal=0
 vi.stubGlobal('localStorage',{getItem:key=>records.get(key)??null,removeItem:key=>records.delete(key),setItem:(key,value)=>{if(key===RECORD_KEY&&refuse)throw Error('fixture quota before write');records.set(key,String(value));if(key===RECORD_KEY&&throwAfterWrite){throwAfterWrite=false;throw Error('fixture lost reply after atomic setItem')}}})
 vi.stubGlobal('navigator',{locks:{request:async(_name,fn)=>fn()}})
 const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]))
 data.pos2_products=[{id:'p',name:'Finished portion',price:95,cost:40,stock:3}]
 data.pos_users=structuredClone(legacy.before.users)
 data.pos2_shifts=[{id:'shift',status:'open',openCash:200}]
 records.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
 const state=browserRestaurantState()
 ok(await commitBrowserRestaurant(command('configure',{expectedConfig:canonicalSignature(state.config),config:{...state.config,enabled:true,fundsEnabled:true}}),owner))
 const context=browserRestaurantState();expect(context.storeId&&context.epoch).toBeTruthy();expect(readRecords().recovery.version).toBe(6)
 ok(await commitBrowserRestaurant(command('create',{day:context.today,slot:'12:00',channel:'walkin',customer:'Guest',contact:'',note:'',items:[{id:'p',qty:2,price:95}]}),owner))
})
afterEach(()=>vi.unstubAllGlobals())
test('standalone atomic collection, selected cancellation and original tender tail preserve one book',async()=>{
 const paid=ok(await apply('funds-receive',current(),{amount:50,paid:100,payMethod:'cash',shiftId:'shift'}))
 expect(paid.fundsEvent.changeCents).toBe(5000);expect(readRecords().data.pos2_cash_log).toHaveLength(1)
 ok(await apply('cancel-part',current(),{quantities:[{id:'p',qty:1}],reason:'one less'}))
 expect(readRecords().data.pos2_products[0].stock).toBe(2);expect(summarizeRestaurantFunds(current().funds).dueCents).toBe(4500)
 ok(await apply('funds-receive',current(),{amount:45,paid:45,payMethod:'card',shiftId:'shift'}))
 ok(await apply('advance',current(),{status:'cooking'}));ok(await apply('advance',current(),{status:'ready'}));const done=ok(await apply('advance',current(),{status:'completed'}))
 expect(done.order).toMatchObject({source:'restaurant-funded',total:95,shiftId:'',payments:[{method:'cash',amount:50},{method:'card',amount:45}]})
 expect(readRecords().data.pos2_cash_log).toHaveLength(1)
})
test('a prewrite quota failure preserves every source, amount and version',async()=>{
 const before=records.get(RECORD_KEY),request=command('funds-receive',{entryId:current().id,expectedVersion:current().version,amount:50,paid:50,payMethod:'cash',shiftId:'shift'})
 refuse=true;const result=await commitBrowserRestaurant(request,owner)
 expect(result).toMatchObject({success:false,committed:false});expect(records.get(RECORD_KEY)).toBe(before)
})
test('postwrite reply loss must recover the actually saved original rather than report noncommit',async()=>{
 const request=command('funds-receive',{entryId:current().id,expectedVersion:current().version,amount:50,paid:50,payMethod:'cash',shiftId:'shift'})
 throwAfterWrite=true;const result=await commitBrowserRestaurant(request,owner)
 expect(summarizeRestaurantFunds(current().funds).retainedCents).toBe(5000)
 expect(result).toMatchObject({success:true,fundsEvent:{id:request.id,amountCents:5000}})
 const once=records.get(RECORD_KEY);ok(await commitBrowserRestaurant(request,owner));expect(records.get(RECORD_KEY)).toBe(once)
})
test('re-reading storage preserves originals, complete backup source identities and version6',async()=>{
 const request=command('funds-receive',{entryId:current().id,expectedVersion:current().version,amount:50,paid:50,payMethod:'cash',shiftId:'shift'})
 ok(await commitBrowserRestaurant(request,owner));const saved=readRecords()
 const packet=createCompleteBackup(saved.data,browserProtectionGraph(saved),'browser')
 expect(packet.features).toContain('restaurant-funds-v1');expect(packet.protection.version).toBe(6)
 expect(readCompleteBackup(packet,'browser').book).toEqual(saved.data)
 const before=records.get(RECORD_KEY);ok(await commitBrowserRestaurant(request,owner));expect(records.get(RECORD_KEY)).toBe(before)
})
test('wrong store and epoch do not clear an uncertain original or mutate storage',async()=>{
 const base=command('funds-receive',{entryId:current().id,expectedVersion:current().version,amount:10,paid:10,payMethod:'cash',shiftId:'shift'}),before=records.get(RECORD_KEY)
 for(const change of [{storeId:'another'},{epoch:'replaced'}]){
  expect(await commitBrowserRestaurant({...base,...change},owner)).toMatchObject({success:false,committed:null})
  expect(records.get(RECORD_KEY)).toBe(before)
 }
})
test('a prepared full cancellation restores real tender totals without restoring eaten ingredients',async()=>{
 ok(await apply('funds-receive',current(),{amount:190,paid:190,payMethod:'cash',shiftId:'shift'}))
 ok(await apply('advance',current(),{status:'cooking'}));ok(await apply('advance',current(),{status:'ready'}));ok(await apply('advance',current(),{status:'completed'}))
 const before=readRecords().data.pos2_products[0].stock
 const cancelled=ok(await apply('cancel',current(),{reason:'prepared return',shiftId:'shift'}))
 expect(cancelled.refund.total).toBe(-190);expect(readRecords().data.pos2_products[0].stock).toBe(before)
 expect(readRecords().data.pos2_waste[0]).toMatchObject({productId:'p',qty:2,cost:40})
 expect(readRecords().data.pos2_cash_log.reduce((sum,row)=>sum+(row.type==='in'?row.amount:-row.amount),0)).toBe(0)
})
