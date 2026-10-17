import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {privateDraftDigest,PRIVATE_DRAFT_CONTEXT} from '../../electron/privateDrafts.mjs'
import {restaurantSettingsDraft,validRestaurantSettingsDraft,compileRestaurantSettingsDraft,rebaseRestaurantSettingsDraft,assertRestaurantSettingsOriginal} from '../../src/utils/restaurantSettingsDraft.mjs'
import {workspaceScope,writeWorkspaceDraft,readWorkspaceDraft} from '../../src/utils/workspaceDraft'
import {DATA_KEYS,RECORD_KEY,readRecords} from '../../src/utils/browserStorage'
import {browserRestaurantState,commitBrowserRestaurant} from '../../src/utils/browserRestaurant'
import {getBrowserPrivateDraftContext,lookupBrowserPrivateDraftOriginal} from '../../src/utils/browserPrivateDrafts'

const owner={userId:'settings-owner',username:'Settings owner',role:'owner'},staff={userId:'settings-staff',username:'Settings staff',role:'staff'},context={protocol:PRIVATE_DRAFT_CONTEXT,storeId:'settings-store',epoch:'settings-epoch',userId:owner.userId,role:'owner'}
const products=[{id:'bowl',name:'Bowl',price:100,cost:40,stock:0,unit:'碗'},{id:'rice',name:'Rice',price:0,cost:50,stock:20,unit:'kg'},{id:'box',name:'Box',price:0,cost:3,stock:100,unit:'個'}]
const config=()=>({enabled:true,dailyCapacity:30,slotCapacity:5,recipes:{bowl:[{id:'rice',qty:.2},{id:'box',qty:1}]}})
const editor=()=>({draft:restaurantSettingsDraft(config()),baseline:canonicalSignature(config()),recipeTarget:'bowl',ingredient:'rice',open:true,setupProposal:false})
let values,storage
beforeEach(()=>{values=new Map();storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};vi.stubGlobal('localStorage',storage);vi.stubGlobal('navigator',{locks:{request:async(_name,work)=>work()}})})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
test('capacity and ingredient raw text survive scoped storage without coercion or staff adoption',()=>{
 const state=editor();state.draft.dailyCapacity='';state.draft.slotCapacity='003';state.draft.recipes.bowl[0].qty='-';const scope=workspaceScope(context,'restaurant-settings')
 writeWorkspaceDraft(storage,scope,{documentId:'draft-00000000-0000-4000-8000-000000000001',state,original:null},null,validRestaurantSettingsDraft)
 expect(readWorkspaceDraft(storage,scope,validRestaurantSettingsDraft).value.state).toEqual(state)
 expect(()=>workspaceScope({...context,role:'staff'},'restaurant-settings')).toThrow()
 for(const patch of [{preview:{}},{draft:{...state.draft,enabled:1}},{draft:{...state.draft,recipes:{bowl:[{id:'rice',qty:'1'},{id:'rice',qty:'2'}]}}},{baseline:'[]'}])expect(validRestaurantSettingsDraft({...state,...patch})).toBe(false)
})
test('only explicit valid decimal input compiles and current hidden configuration is preserved',()=>{
 const state=editor(),hidden={...config(),fundsEnabled:false,kitchenPrinting:{version:1,enabled:false,destination:null,format:null}}
 state.baseline=canonicalSignature(hidden);state.draft.dailyCapacity='0045';state.draft.recipes.bowl[0].qty='.125'
 const result=compileRestaurantSettingsDraft(state,products);expect(result.dailyCapacity).toBe(45);expect(result.recipes.bowl[0].qty).toBe(.125);expect(result.kitchenPrinting).toEqual(hidden.kitchenPrinting);expect(result.fundsEnabled).toBe(false)
 for(const raw of ['', '-', '1e2', '0', '1.0001']){const bad=editor();bad.draft.recipes.bowl[0].qty=raw;expect(()=>compileRestaurantSettingsDraft(bad,products)).toThrow()}
 for(const raw of ['', '0', '-1', '1.2', '100001']){const bad=editor();bad.draft.dailyCapacity=raw;expect(()=>compileRestaurantSettingsDraft(bad,products)).toThrow()}
})
test('independent capacity and recipe changes reconcile against a new complete baseline',()=>{
 const state=editor();state.draft.dailyCapacity='47';state.draft.recipes.bowl[0].qty='';const remote={...config(),slotCapacity:9,fundsEnabled:true}
 const result=rebaseRestaurantSettingsDraft(state,remote);expect(result.conflicts).toEqual([]);expect(result.draft.dailyCapacity).toBe('47');expect(result.draft.slotCapacity).toBe('9');expect(result.draft.fundsEnabled).toBe(true);expect(result.draft.recipes.bowl[0].qty).toBe('');expect(result.baseline).toBe(canonicalSignature(remote))
})
test('same-field changes and delete-versus-edit require exact explicit choices',()=>{
 const state=editor();state.draft.dailyCapacity='47';delete state.draft.recipes.bowl;const remote={...config(),dailyCapacity:60,recipes:{bowl:[{id:'rice',qty:.3},{id:'box',qty:1}]}}
 const first=rebaseRestaurantSettingsDraft(state,remote);expect(first.conflicts.map(row=>row.path)).toEqual([['dailyCapacity'],['recipes','bowl']]);expect(state.baseline).toBe(canonicalSignature(config()))
 const choices=Object.fromEntries(first.conflicts.map(row=>[row.key,row.path[0]==='dailyCapacity'?'remote':'local'])),next=rebaseRestaurantSettingsDraft(state,remote,choices)
 expect(next.conflicts).toEqual([]);expect(next.draft.dailyCapacity).toBe('60');expect(next.draft.recipes).toEqual({});expect(compileRestaurantSettingsDraft({...state,draft:next.draft,baseline:next.baseline},products).dailyCapacity).toBe(60)
})
test('complete original result must bind receipt, actual owner, store, epoch and unchanged request digest',()=>{
 const request={id:'settings-original',kind:'restaurant',action:'configure',time:new Date().toISOString(),storeId:context.storeId,epoch:context.epoch,expectedConfig:canonicalSignature(config()),config:config()},receipt={id:request.id,kind:'restaurant',action:'configure',signature:canonicalSignature(request),actor:owner,productIds:[]},result={protocol:'pos-private-draft-original/v1',status:'matched',id:request.id,digest:privateDraftDigest(request),action:'configure',result:{success:true,receipt,config:config(),products:[]}}
 expect(assertRestaurantSettingsOriginal(result,context)).toEqual(request)
 for(const changed of [{...result,result:undefined},{...result,digest:'0'.repeat(64)},{...result,result:{...result.result,receipt:{...receipt,actor:staff}}},{...result,result:{...result.result,receipt:{...receipt,kind:'purchase'}}},{...result,result:{...result.result,receipt:{...receipt,productIds:['rice','rice']},products:[{id:'rice'},{id:'rice'}]}}])expect(()=>assertRestaurantSettingsOriginal(changed,context)).toThrow()
 expect(()=>assertRestaurantSettingsOriginal(result,{...context,epoch:'new-epoch'})).toThrow()
})
test('the production browser writer rejects a stale scope or forged owner without changing the complete book',async()=>{
 const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos2_products=products;data.pos_users=[owner,staff].map(row=>({id:row.userId,username:row.username,role:row.role}));storage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
 const scope=await getBrowserPrivateDraftContext(owner),current=browserRestaurantState().config,request={id:'scoped-settings',kind:'restaurant',action:'configure',time:new Date().toISOString(),storeId:scope.storeId,epoch:scope.epoch,expectedConfig:canonicalSignature(current),config:{...current,dailyCapacity:47}},before=storage.getItem(RECORD_KEY)
 for(const change of [{epoch:'replaced'},{storeId:'other-store'},{epoch:undefined}]){expect((await commitBrowserRestaurant({...request,...change},owner)).success).toBe(false);expect(storage.getItem(RECORD_KEY)).toBe(before)}
 expect((await commitBrowserRestaurant(request,{...owner,userId:'forged'})).success).toBe(false);expect((await commitBrowserRestaurant(request,staff)).success).toBe(false);expect(storage.getItem(RECORD_KEY)).toBe(before)
 expect((await commitBrowserRestaurant(request,owner)).success).toBe(true);const accepted=storage.getItem(RECORD_KEY);expect((await commitBrowserRestaurant(request,owner)).success).toBe(true);expect(storage.getItem(RECORD_KEY)).toBe(accepted)
 const original=await lookupBrowserPrivateDraftOriginal({context:scope,id:request.id,digest:privateDraftDigest(request)},owner);expect(assertRestaurantSettingsOriginal(original,scope)).toEqual(request);expect(storage.getItem(RECORD_KEY)).toBe(accepted)
 const later=browserRestaurantState().config;expect((await commitBrowserRestaurant({...request,id:'later-settings',config:{...later,slotCapacity:7},expectedConfig:canonicalSignature(later)},owner)).success).toBe(true)
 const latest=storage.getItem(RECORD_KEY),recovered=await lookupBrowserPrivateDraftOriginal({context:scope,id:request.id,digest:privateDraftDigest(request)},owner);expect(recovered.result.config.slotCapacity).toBe(7);expect(JSON.parse(recovered.result.receipt.signature).config.slotCapacity).toBe(current.slotCapacity);expect(storage.getItem(RECORD_KEY)).toBe(latest);expect(readRecords().data.pos_restaurant_operations).toHaveLength(2)
})
test('legacy activation with both scope fields undefined remains unscoped, while a partial declared scope cannot bypass the guard',async()=>{
 const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos2_products=products;data.pos_users=[{id:owner.userId,username:owner.username,role:owner.role}];storage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
 const initial=browserRestaurantState();expect(initial.epoch).toBeUndefined();expect(initial.storeId).toBeUndefined()
 const request={id:'legacy-funds-activation',kind:'restaurant',action:'configure',time:new Date().toISOString(),storeId:initial.storeId,epoch:initial.epoch,expectedConfig:canonicalSignature(initial.config),config:{...initial.config,enabled:true,fundsEnabled:true}}
 expect((await commitBrowserRestaurant(request,owner)).success).toBe(true);const current=browserRestaurantState();expect(current.storeId&&current.epoch).toBeTruthy()
 const before=storage.getItem(RECORD_KEY)
 for(const change of [{storeId:current.storeId,epoch:undefined},{storeId:undefined,epoch:current.epoch},{storeId:null,epoch:null},{storeId:'',epoch:''}])expect((await commitBrowserRestaurant({...request,...change,id:'invalid-partial-settings',expectedConfig:canonicalSignature(current.config)},owner)).success).toBe(false)
 expect(storage.getItem(RECORD_KEY)).toBe(before)
})
