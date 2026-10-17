import {beforeEach,afterEach,expect,test,vi} from 'vitest'
import {makeAgentContext,validateAgentDraft,agentCommand,draftFromText} from '../../electron/agentDraftRules.mjs'
import {makeAgentHandoff,projectAgentContext,parseAgentDocument} from '../../electron/agentHandoff.mjs'
import {RESTAURANT_AGENT_PROTOCOL,reviewedRestaurantAgentDraft,assertRestaurantAgentShape} from '../../electron/restaurantAgentDraft.mjs'
import {browserRestaurantState,browserRestaurantAgentPreview,commitBrowserRestaurant} from '../../src/utils/browserRestaurant'
import {DATA_KEYS,RECORD_KEY,readRecords,writeRecords} from '../../src/utils/browserStorage'
import {executeFinancial,readPendingFinancial,FINANCIAL_PENDING} from '../../src/utils/financialCommand'
import {prepareRestaurantCommand} from '../../src/utils/restaurantCommand.mjs'
import {quickDraftScope,readQuickDraft,writeQuickDraft} from '../../src/utils/quickDraftCache'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {restaurantMenuFixture,choose,bowl} from '../fixtures/restaurant-menu-v1.mjs'

const owner={userId:'agent-menu-owner',username:'Menu owner',role:'owner'},staff={userId:'agent-menu-staff',username:'Menu staff',role:'staff'};let values,context,seed
async function current(actor=staff){const state=browserRestaurantState();return makeAgentContext({storeId:state.storeId,role:actor.role,products:readRecords().data.pos2_products,suppliers:[],restaurantConfig:state.config,mappings:{privateCompany:{'sku:private':'rice'}}})}
beforeEach(async()=>{
 values=new Map();vi.stubGlobal('localStorage',{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)});vi.stubGlobal('navigator',{locks:{request:async(_name,work)=>work()}})
 seed=restaurantMenuFixture();const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos2_products=structuredClone(seed.products);data.pos_users=[owner,staff].map(row=>({id:row.userId,username:row.username,role:row.role}));values.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
 const state=browserRestaurantState(),config={...state.config,enabled:true,fundsEnabled:true,dailyCapacity:100,slotCapacity:100,recipes:seed.config.recipes,menu:seed.menu};expect((await commitBrowserRestaurant({id:'agent-menu-setup',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config},owner)).success).toBe(true);context=await current()
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
const draft=extra=>({protocol:RESTAURANT_AGENT_PROTOCOL,id:'selected-agent-original',issuedAt:new Date().toISOString(),storeId:context.storeId,menuRevision:context.restaurantMenuRevision,kind:'restaurant',items:[bowl(),bowl(1,{variantId:'large',selections:[choose('extras','egg')]})],channel:'walkin',day:browserRestaurantState().today,slot:'12:00',customer:'Agent guest',contact:'',note:'',...extra})
async function reviewed(d,refresh=false,actor=staff){const result=await browserRestaurantAgentPreview({draft:d,...(refresh?{refresh:true}:{})},actor);return {result,preview:result.status==='review'?reviewedRestaurantAgentDraft(result.draft,await current(actor),result):null}}
async function commit(d,persist=request=>commitBrowserRestaurant(request,staff)){
 const {result,preview}=await reviewed(d),command=agentCommand(preview),prepared=prepareRestaurantCommand(command.input,{state:browserRestaurantState(),identity:command.identity})
 return {result,command,prepared,run:()=>executeFinancial('restaurant',prepared.input,persist,()=>{},prepared.identity)}
}
const keys=value=>value&&typeof value==='object'?[...Object.keys(value),...Object.values(value).flatMap(keys)]:[]

test('one copied selected-menu packet contains public choices and no private composition, catalogue, inventory, costs or mappings',async()=>{
 const kit=makeAgentHandoff(await current(owner),'restaurant'),all=keys(kit)
 expect(kit.example.protocol).toBe(RESTAURANT_AGENT_PROTOCOL);expect(kit.context.products).toEqual([]);expect(kit.context.restaurantMenu.offers).toHaveLength(2);expect(kit.context.restaurantMenu.offers[0].variants).toHaveLength(2)
 for(const key of ['components','recipes','cost','unitCost','supplierId','mappings','productId','stock','allocations','menuReview','epoch'])expect(all).not.toContain(key)
 expect(validateAgentDraft(kit.example,await current(owner),Date.now(),true).total).toBe(100);expect(parseAgentDocument('```json\n'+JSON.stringify(kit.example)+'\n```')).toEqual(kit.example)
 expect(projectAgentContext(await current(owner),'restaurant')).toEqual(kit.context);expect((await current(owner)).restaurantConfig.recipes).toBeUndefined()
})
test('public menu revisions ignore stock and private costs but change when an actual offered price changes',async()=>{
 const saved=readRecords();writeRecords({pos2_products:saved.data.pos2_products.map(row=>({...row,stock:row.stock+1,cost:row.cost+1}))},saved.revision);expect((await current()).restaurantMenuRevision).toBe(context.restaurantMenuRevision)
 const state=browserRestaurantState(),config=structuredClone(state.config);config.menu.offers[0].variants[0].price=101;expect((await commitBrowserRestaurant({id:'agent-price-change',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config},owner)).success).toBe(true);expect((await current()).restaurantMenuRevision).not.toBe(context.restaurantMenuRevision)
})
test('the shared kernel keeps distinct versions, merges repeated defaults and sums exact whole-order prices',async()=>{
 const d=draft({items:[bowl(),bowl(),bowl(1,{variantId:'large',selections:[choose('extras','egg')]}),bowl(1,{selections:[choose('rice','without')]}),{offerId:'bowl-set',qty:1}]})
 const before=values.get(RECORD_KEY),preview=validateAgentDraft(d,context),result=await browserRestaurantAgentPreview({draft:d},staff)
 expect(preview.items).toHaveLength(4);expect(preview.total).toBe(545);expect(preview.items[0].qty).toBe(2);expect(result.menuReview.quote.totalCents).toBe(54500);expect(result.draft.items).toEqual(preview.menuInput);expect(values.get(RECORD_KEY)).toBe(before)
 expect(reviewedRestaurantAgentDraft(result.draft,context,result).items.map(row=>row.id)).toEqual(result.menuReview.quote.items.map(row=>row.id));expect(()=>agentCommand(preview)).toThrow(/核對/)
})
test('an actual authenticated browser preview/confirm saves one selected funded original and does not record payment',async()=>{
 const d=draft(),operation=await commit(d),r=await operation.run();expect(r.entry.total).toBe(235);expect(r.entry.menu.quote.input).toEqual(operation.result.draft.items);expect(readRecords().data.pos_restaurant_orders).toHaveLength(1);expect(readRecords().data.pos2_orders).toEqual([]);expect(r.entry.funds.events).toEqual([]);expect(readPendingFinancial()).toBeNull()
 expect(readRecords().data.pos2_products.find(row=>row.id==='rice').stock).toBe(9.5);expect(readRecords().data.pos2_products.find(row=>row.id==='egg').stock).toBe(19)
})
test('a lost acknowledgement keeps the journal and an exact retry confirms the same reservation after current menu changes',async()=>{
 const d=draft(),operation=await commit(d,async request=>{expect((await commitBrowserRestaurant(request,staff)).success).toBe(true);throw Error('lost reply')});await expect(operation.run()).rejects.toThrow(/尚未確認/);const pending=readPendingFinancial(),once=values.get(RECORD_KEY);expect(pending.request.id).toBe('agent-'+d.id)
 const result=await executeFinancial('restaurant',JSON.parse(pending.signature).input,request=>commitBrowserRestaurant(request,staff),()=>{});expect(result.entry.id).toBe(pending.request.id);expect(values.get(RECORD_KEY)).toBe(once);expect(readPendingFinancial()).toBeNull()
 const state=browserRestaurantState(),config=structuredClone(state.config);config.menu.offers[0].variants[0].price=999;expect((await commitBrowserRestaurant({id:'after-original-price',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config},owner)).success).toBe(true)
 const beforeLookup=values.get(RECORD_KEY),accepted=await browserRestaurantAgentPreview({draft:d},staff);expect(accepted.status).toBe('accepted');expect(accepted.original.totalCents).toBe(23500);expect(values.get(RECORD_KEY)).toBe(beforeLookup)
})
test('accepted original lookup precedes expiry and disabled current menus, while changed content or another store is rejected',async()=>{
 const d=draft({issuedAt:new Date(Date.now()-23*3600000).toISOString()}),operation=await commit(d);await operation.run();const state=browserRestaurantState(),config={...state.config,enabled:false};expect((await commitBrowserRestaurant({id:'disable-after-agent',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config},owner)).success).toBe(true)
 const now=Date.now;vi.spyOn(Date,'now').mockReturnValue(now()+2*3600000)
 expect((await browserRestaurantAgentPreview({draft:d},staff)).status).toBe('accepted')
 for(const change of [{storeId:'another-store'},{items:[bowl(2)]},{note:'changed'},{issuedAt:new Date(now()).toISOString()}])await expect(browserRestaurantAgentPreview({draft:{...d,...change}},staff)).rejects.toThrow()
 vi.restoreAllMocks()
})
test('explicit refresh keeps identity/time/choices and exposes the new price before a second confirmation',async()=>{
 const d=draft(),state=browserRestaurantState(),config=structuredClone(state.config);config.menu.offers[0].variants.find(row=>row.id==='large').price=130;expect((await commitBrowserRestaurant({id:'new-agent-price',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config},owner)).success).toBe(true)
 await expect(browserRestaurantAgentPreview({draft:d},staff)).rejects.toThrow(/菜單已更新/);const result=await browserRestaurantAgentPreview({draft:d,refresh:true},staff)
 expect(result.draft.id).toBe(d.id);expect(result.draft.issuedAt).toBe(d.issuedAt);expect(result.menuReview.quote.totalCents).toBe(24500);expect(result.draft.menuRevision).not.toBe(d.menuRevision);expect(readRecords().data.pos_restaurant_orders).toEqual([])
 expect(()=>reviewedRestaurantAgentDraft(d,context,result)).toThrow()
})
test('private/forged fields, invalid fractional counts, unknown choices and wrong stored actors fail without mutation',async()=>{
 const before=values.get(RECORD_KEY)
 for(const change of [{execute:'charge'},{menuReview:{}},{actor:owner},{kind:'purchase'},{items:[{...bowl(),price:1}]},{items:[bowl(.5)]},{items:[bowl(1,{variantId:'missing'})]},{items:[bowl(1,{selections:[choose('extras','not-real')]})]},{items:[bowl(1,{selections:[choose('extras','egg',3)]})]},{items:[]},{issuedAt:'2026-02-30T00:00:00Z'},{issuedAt:new Date(Date.now()-25*3600000).toISOString()}])await expect(browserRestaurantAgentPreview({draft:draft(change)},staff)).rejects.toThrow()
 await expect(browserRestaurantAgentPreview({draft:draft()}, {...staff,role:'owner'})).rejects.toThrow(/權限/);expect(values.get(RECORD_KEY)).toBe(before)
})
test('a valid reply for another selected cart cannot be shown as the requested draft',async()=>{
 const d=draft(),other=draft({items:[bowl(3)]}),result=await browserRestaurantAgentPreview({draft:other},staff)
 expect(()=>reviewedRestaurantAgentDraft(d,context,result)).toThrow(/不同|核對/)
})
test('a draft source cannot be smuggled through the ordinary raw-item restaurant boundary',async()=>{
 const state=browserRestaurantState(),before=values.get(RECORD_KEY),result=await commitBrowserRestaurant({id:'plain-agent-source',kind:'restaurant',action:'create',time:state.now,storeId:state.storeId,epoch:state.epoch,costMode:state.costMode,fundsProtocol:'pos-restaurant-funds/v1',day:state.today,slot:'12:00',channel:'walkin',customer:'',contact:'',note:'',items:[{id:'tea',qty:1,price:20}],agentDraft:draft()},staff)
 expect(result).toMatchObject({success:false,committed:false});expect(values.get(RECORD_KEY)).toBe(before)
})
test('exact zero prices survive the public draft and the real reservation without a fallback price',async()=>{
 const state=browserRestaurantState(),config=structuredClone(state.config);config.menu.offers[1].variants[0].price=0;expect((await commitBrowserRestaurant({id:'zero-agent-menu',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config},owner)).success).toBe(true);context=await current();const d=draft({items:[{offerId:'bowl-set',qty:2}]}),operation=await commit(d),result=await operation.run();expect(result.entry.total).toBe(0);expect(result.entry.menu.quote.totalCents).toBe(0)
})
test('latest shared stock is checked at real commit even after a successful readonly preview',async()=>{
 const operation=await commit(draft()),saved=readRecords();writeRecords({pos2_products:saved.data.pos2_products.map(row=>row.id==='rice'?{...row,stock:0}:row)},saved.revision);const before=values.get(RECORD_KEY);await expect(operation.run()).rejects.toThrow(/不足/);expect(values.get(RECORD_KEY)).toBe(before);expect(readPendingFinancial()).toBeNull()
})
test('local default text uses the selected protocol while explicit unrecognized modifiers are never dropped',()=>{
 const d=draftFromText('現場牛肉丼2，下午五點',context,'restaurant');expect(d.protocol).toBe(RESTAURANT_AGENT_PROTOCOL);expect(d.items).toEqual([{offerId:'bowl-offer',qty:2}]);expect(validateAgentDraft({...d,channel:'walkin'},context).total).toBe(200)
 expect(()=>draftFromText('現場牛肉丼2大份加蛋',context,'restaurant')).toThrow()
})
test('typed selected drafts retain their raw selections and metadata in the scoped cache, including an editable empty cart',()=>{
 const d=draft(),scope=quickDraftScope(context,staff),state={kind:'restaurant',text:'',draft:d,external:null};writeQuickDraft(localStorage,scope,state);expect(readQuickDraft(localStorage,scope)).toEqual(state)
 writeQuickDraft(localStorage,scope,{...state,draft:{...d,items:[]}});expect(readQuickDraft(localStorage,scope).draft.items).toEqual([]);expect(()=>assertRestaurantAgentShape({...d,items:[]})).toThrow();expect(readQuickDraft(localStorage,quickDraftScope(context,{...staff,userId:'other'}))).toBeNull()
})
test('quota rejection before atomic save keeps the editable draft and records no reservation or financial original',async()=>{
 const d=draft(),operation=await commit(d),scope=quickDraftScope(context,staff),state={kind:'restaurant',text:'',draft:d,external:null};writeQuickDraft(localStorage,scope,state);const before=values.get(RECORD_KEY),original=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key===RECORD_KEY)throw Error('quota');original(key,value)};await expect(operation.run()).rejects.toThrow(/quota/);expect(values.get(RECORD_KEY)).toBe(before);expect(values.has(FINANCIAL_PENDING)).toBe(false);expect(readQuickDraft(localStorage,scope)).toEqual(state)
})
