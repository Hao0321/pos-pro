// @vitest-environment jsdom
import {test,beforeEach,afterEach,expect,vi} from 'vitest'
import legacy from '../fixtures/table-kitchen-v1.json'
import {DATA_KEYS,RECORD_KEY,readRecords} from '../../src/utils/browserStorage'
import {browserRestaurantState,commitBrowserRestaurant} from '../../src/utils/browserRestaurant'
import {canonicalSignature} from '../../electron/operationRules.mjs'
let records
const actor=legacy.owner,request=(id,config,extra={})=>({id,kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(browserRestaurantState().config),config,...extra})
beforeEach(()=>{
 records=new Map();vi.stubGlobal('localStorage',{getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value)),removeItem:key=>records.delete(key)});vi.stubGlobal('navigator',{locks:{request:async(_name,options,work)=>typeof options==='function'?options():work({name:_name})}})
 const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos_users=structuredClone(legacy.before.users);data.pos2_products=[{id:'meal',name:'Meal',price:80,cost:30,stock:10}];records.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
test('a new empty browser store only proposes the option; the owner explicitly saves it and may also decline it',async()=>{
 const before=records.get(RECORD_KEY),state=browserRestaurantState();expect(state.fundsSetup.newStore).toBe(true);expect(state.config.fundsEnabled).toBeUndefined();expect(records.get(RECORD_KEY)).toBe(before)
 const result=await commitBrowserRestaurant(request('first',{...state.config,enabled:true,fundsEnabled:true},{fundsSetupProposal:true}),actor);expect(result.success,result.error).toBe(true);expect(browserRestaurantState().config.fundsEnabled).toBe(true);expect(browserRestaurantState().fundsSetup.newStore).toBe(false)
})
test('another saved configuration invalidates an implicit new-store proposal even if its config signature is unchanged',async()=>{
 const original=browserRestaurantState().config;expect((await commitBrowserRestaurant(request('other-window',original),actor)).success).toBe(true);expect(browserRestaurantState().fundsSetup.newStore).toBe(false)
 const before=records.get(RECORD_KEY),failed=await commitBrowserRestaurant(request('old-proposal',{...original,enabled:true,fundsEnabled:true},{fundsSetupProposal:true}),actor)
 expect(failed).toMatchObject({success:false,committed:false});expect(records.get(RECORD_KEY)).toBe(before)
 expect((await commitBrowserRestaurant(request('explicit-owner',{...original,enabled:true,fundsEnabled:true}),actor)).success).toBe(true)
})
test('explicit existing-store opt-in keeps the complete old booking and makes only a new booking funded',async()=>{
 let config=browserRestaurantState().config;expect((await commitBrowserRestaurant(request('legacy-enable',{...config,enabled:true}),actor)).success).toBe(true)
 const create=id=>({id,kind:'restaurant',action:'create',time:new Date().toISOString(),channel:'walkin',day:new Date().toISOString().slice(0,10),slot:'12:00',customer:'Guest',contact:'',note:'',items:[{id:'meal',qty:1,price:80}]})
 const original=await commitBrowserRestaurant(create('old-booking'),actor);expect(original.success,original.error).toBe(true);expect(original.entry.funds).toBeUndefined()
 config=browserRestaurantState().config;expect((await commitBrowserRestaurant(request('opt-in',{...config,fundsEnabled:true}),actor)).success).toBe(true);expect(browserRestaurantState().entries.find(row=>row.id==='old-booking')).toEqual(original.entry)
 const state=browserRestaurantState(),fresh=await commitBrowserRestaurant({...create('new-booking'),storeId:state.storeId,epoch:state.epoch,fundsProtocol:'pos-restaurant-funds/v1',costMode:state.costMode},actor);expect(fresh.success,fresh.error).toBe(true);expect(fresh.entry.funds.protocol).toBe('pos-restaurant-funds/v1');expect(readRecords().data.pos_restaurant_orders.find(row=>row.id==='old-booking')).toEqual(original.entry)
})
