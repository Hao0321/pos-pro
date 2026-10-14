import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {DATA_KEYS,RECORD_KEY,readRecords,writeRecords} from '../../src/utils/browserStorage'
import {commitBrowserRestaurant,browserRestaurantState} from '../../src/utils/browserRestaurant'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {executeFinancial,FINANCIAL_PENDING} from '../../src/utils/financialCommand'
let records,refuse=false
const owner={role:'owner',username:'fixture'},time='2026-10-14T01:00:00Z'
const command=(id,action,extra={})=>({id,time,kind:'restaurant',action,...extra})
const create=id=>command(id,'create',{channel:'walkin',day:'2026-10-14',slot:'12:00',customer:'',contact:'',note:'',items:[{id:'p',qty:1,price:95}]})
beforeEach(async()=>{
  records=new Map();refuse=false;vi.stubGlobal('localStorage',{getItem:k=>records.get(k)??null,setItem:(k,v)=>{if(refuse&&k===RECORD_KEY)throw Error('fixture quota');records.set(k,String(v))},removeItem:k=>records.delete(k)});vi.stubGlobal('navigator',{locks:{request:async(_name,fn)=>fn()}})
  const data=Object.fromEntries(DATA_KEYS.map(k=>[k,[]]));data.pos2_products=[{id:'p',name:'fixture bowl',price:95,cost:40,stock:2}];data.pos2_shifts=[{id:'s',status:'open',openCash:200}];records.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
  const state=browserRestaurantState();const r=await commitBrowserRestaurant(command('configure','configure',{expectedConfig:canonicalSignature(state.config),config:{...state.config,enabled:true,dailyCapacity:5,slotCapacity:2}}),owner);expect(r.success).toBe(true)
})
afterEach(()=>vi.unstubAllGlobals())
test('browser receiving quota failure leaves the entire restaurant and stock record unchanged',async()=>{const before=records.get(RECORD_KEY);refuse=true;expect(await commitBrowserRestaurant(create('quota'),owner)).toMatchObject({success:false,committed:false});expect(records.get(RECORD_KEY)).toBe(before)})
test('two original requests cannot oversell the last finished portion',async()=>{await commitBrowserRestaurant(create('first'),owner);const both=await Promise.all([commitBrowserRestaurant(create('second'),owner),commitBrowserRestaurant(create('third'),owner)]);expect(both.filter(r=>r.success)).toHaveLength(1);expect(readRecords().data.pos2_products[0].stock).toBe(0)})
test('browser payment and cooked cancellation preserve original stock and signed ledger totals',async()=>{
  await commitBrowserRestaurant(create('first'),owner);const pay=command('pay','pay',{entryId:'first',expectedVersion:1,shiftId:'s',payMethod:'cash',paid:100});const paid=await commitBrowserRestaurant(pay,owner);expect(paid).toMatchObject({success:true,order:{total:95,change:5}});expect((await commitBrowserRestaurant(pay,owner)).success).toBe(true);expect(readRecords().data.pos2_orders).toHaveLength(1)
  await commitBrowserRestaurant(command('cook','advance',{entryId:'first',expectedVersion:2,status:'cooking'}),owner);const cancel=command('cancel','cancel',{entryId:'first',expectedVersion:3,shiftId:'s',reason:'fixture'});expect(await commitBrowserRestaurant(cancel,owner)).toMatchObject({success:true,refund:{total:-95},entry:{status:'cancelled'}});expect(readRecords().data.pos2_products[0].stock).toBe(1);expect(readRecords().data.pos2_waste).toHaveLength(1);expect(readRecords().data.pos2_orders.reduce((n,o)=>n+o.total,0)).toBe(0);const once=records.get(RECORD_KEY);await commitBrowserRestaurant(cancel,owner);expect(records.get(RECORD_KEY)).toBe(once)
})
test('lost restaurant reply retains one journal and recovers the same durable order',async()=>{
  const {id,time,...input}=create('ignored');let original
  await expect(executeFinancial('restaurant',input,async r=>{original=r;await commitBrowserRestaurant(r,owner);throw Error('fixture reply lost')})).rejects.toThrow(/尚未確認/);expect(records.has(FINANCIAL_PENDING)).toBe(true);expect(browserRestaurantState().entries).toHaveLength(1)
  const result=await executeFinancial('restaurant',input,r=>commitBrowserRestaurant(r,owner));expect(result.entry.id).toBe(original.id);expect(records.has(FINANCIAL_PENDING)).toBe(false);expect(readRecords().data.pos2_products[0].stock).toBe(1)
})
test('a bare success reply cannot clear a restaurant journal',async()=>{const {id,time,...input}=create('ignored');await expect(executeFinancial('restaurant',input,async()=>({success:true}))).rejects.toThrow(/尚未確認/);expect(records.has(FINANCIAL_PENDING)).toBe(true)})
test('changing a paid preorder financial link during restore rejects before replacing any collection',async()=>{
  await commitBrowserRestaurant(create('first'),owner);await commitBrowserRestaurant(command('pay','pay',{entryId:'first',expectedVersion:1,shiftId:'s',payMethod:'cash',paid:100}),owner);const before=records.get(RECORD_KEY)
  expect(()=>writeRecords({pos2_orders:[]})).toThrow(/流水/);expect(records.get(RECORD_KEY)).toBe(before)
})
test('legacy atomic records gain empty restaurant collections without rewriting the original bytes',()=>{const data=readRecords().data;delete data.pos_restaurant_orders;delete data.pos_restaurant_operations;const before=JSON.stringify({version:1,revision:1,data});records.set(RECORD_KEY,before);expect(browserRestaurantState().entries).toEqual([]);expect(records.get(RECORD_KEY)).toBe(before)})
test('delivery details, stale prices and mismatched versions reject without affecting the record',async()=>{
  const before=records.get(RECORD_KEY);expect((await commitBrowserRestaurant({...create('delivery'),channel:'delivery'},owner)).success).toBe(false);expect((await commitBrowserRestaurant({...create('price'),items:[{id:'p',qty:1,price:1}]},owner)).success).toBe(false);expect(records.get(RECORD_KEY)).toBe(before)
  await commitBrowserRestaurant(create('first'),owner);const once=records.get(RECORD_KEY);expect((await commitBrowserRestaurant(command('stale','advance',{entryId:'first',expectedVersion:2,status:'cooking'}),owner)).success).toBe(false);expect(records.get(RECORD_KEY)).toBe(once)
})
