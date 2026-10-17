import {test,beforeEach,afterEach,expect,vi} from 'vitest'
import {DATA_KEYS,RECORD_KEY} from '../../src/utils/browserStorage'
import {browserRestaurantState,commitBrowserRestaurant} from '../../src/utils/browserRestaurant'
import {canonicalSignature} from '../../electron/operationRules.mjs'
const owner={userId:'menu-owner',username:'Menu owner',role:'owner'};let records
beforeEach(async()=>{
 records=new Map();vi.stubGlobal('localStorage',{getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value)),removeItem:key=>records.delete(key)});vi.stubGlobal('navigator',{locks:{request:async(_name,work)=>work()}})
 const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos2_products=[{id:'meal',name:'Meal',price:100,cost:30,stock:10}];data.pos_users=[{id:owner.userId,username:owner.username,role:'owner'}];records.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
 const state=browserRestaurantState();expect((await commitBrowserRestaurant({id:'enable',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config:{...state.config,enabled:true,fundsEnabled:true}},owner)).success).toBe(true)
})
afterEach(()=>vi.unstubAllGlobals())
const create=(extra={},itemExtra={})=>{const state=browserRestaurantState();return {id:'menu-original',kind:'restaurant',action:'create',time:new Date().toISOString(),storeId:state.storeId,epoch:state.epoch,fundsProtocol:'pos-restaurant-funds/v1',costMode:state.costMode,channel:'walkin',day:state.today,slot:'12:00',customer:'',contact:'',note:'',items:[{id:'meal',price:100,qty:1,...itemExtra}],...extra}}
test('a browser cannot silently discard an unsupported owner menu definition',async()=>{
 const state=browserRestaurantState(),before=records.get(RECORD_KEY),result=await commitBrowserRestaurant({id:'menu-config',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config:{...state.config,menu:{protocol:'pos-restaurant-menu/v1',offers:[]}}},owner)
 expect(result).toMatchObject({success:false,committed:false});expect(result.error).toContain('餐點選項');expect(records.get(RECORD_KEY)).toBe(before)
})
test.each([[{menuProtocol:'pos-restaurant-menu/v1'},{}],[{}, {options:[]}],[{}, {variantId:'large'}],[{}, {modifiers:[{id:'egg',qty:1}]}],[{menuQuote:{}},{}]])('unwired option intent %# is rejected before any browser reservation or money record changes',async(extra,itemExtra)=>{
 const before=records.get(RECORD_KEY),result=await commitBrowserRestaurant(create(extra,itemExtra),owner);expect(result).toMatchObject({success:false,committed:false});expect(result.error).toContain('餐點選項');expect(records.get(RECORD_KEY)).toBe(before)
})
test('ordinary funded browser orders remain usable and their original ID still replays exactly',async()=>{
 const input=create(),result=await commitBrowserRestaurant(input,owner);expect(result.success,result.error).toBe(true);expect(result.entry.total).toBe(100);const after=records.get(RECORD_KEY);expect((await commitBrowserRestaurant(input,owner)).entry).toEqual(result.entry);expect(records.get(RECORD_KEY)).toBe(after)
})
