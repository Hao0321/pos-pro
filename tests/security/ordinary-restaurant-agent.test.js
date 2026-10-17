import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {makeAgentContext,makeAgentContextSync,validateAgentDraft,agentCommand,AGENT_PROTOCOL} from '../../electron/agentDraftRules.mjs'
import {reviewedOrdinaryRestaurantDraft,validateOrdinaryRestaurantReview} from '../../electron/ordinaryRestaurantAgent.mjs'
import {browserRestaurantState,browserRestaurantAgentPreview,commitBrowserRestaurant} from '../../src/utils/browserRestaurant'
import {DATA_KEYS,RECORD_KEY,readRecords,writeRecords} from '../../src/utils/browserStorage'
import {executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'
import {prepareRestaurantCommand} from '../../src/utils/restaurantCommand.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {salesDate} from '../../electron/salesRules.mjs'

const owner={userId:'ordinary-owner',username:'Ordinary owner',role:'owner'},staff={userId:'ordinary-staff',username:'Ordinary staff',role:'staff'},storeId='ordinary-agent-store'
const products=[{id:'rice',name:'白米',price:0,cost:50,stock:1,unit:'kg'},{id:'bowl',name:'牛丼',price:100,cost:0,stock:0,unit:'碗'},{id:'soup',name:'湯飯',price:60,cost:0,stock:0,unit:'碗'},{id:'tea',name:'紅茶',price:20,cost:5,stock:10,unit:'杯'}],suppliers=[{id:'ordinary-supplier',name:'供應商'}]
let values,refuse,loseAfterWrite,ordinal
const ok=value=>{expect(value.success,value.error).toBe(true);return value}
async function current(actor=owner){const saved=readRecords();return makeAgentContext({storeId,role:actor.role,products:saved.data.pos2_products,suppliers:saved.data.pos_suppliers,restaurantConfig:browserRestaurantState().config})}
async function configure(fundsEnabled=true){const state=browserRestaurantState();return ok(await commitBrowserRestaurant({id:'ordinary-setup-'+(++ordinal),kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config:{...state.config,enabled:true,fundsEnabled,dailyCapacity:100,slotCapacity:100,recipes:{bowl:[{id:'rice',qty:.2}],soup:[{id:'rice',qty:.3}]}}},owner))}
async function draft(extra={},actor=owner){const context=await current(actor);return {protocol:AGENT_PROTOCOL,id:'ordinary-draft-'+(++ordinal),issuedAt:new Date(Date.now()-23*3600000).toISOString(),storeId,catalogueRevision:context.catalogueRevision,kind:'restaurant',items:[{productId:'bowl',qty:2},{productId:'tea',qty:1}],channel:'walkin',day:salesDate(new Date()),slot:'12:00',customer:'測試客人',contact:'',note:'保留原備註',...extra}}
async function prepared(d,actor=owner){const result=await browserRestaurantAgentPreview({draft:d},actor),preview=reviewedOrdinaryRestaurantDraft(result.draft,await current(actor),result),command=agentCommand(preview),request=prepareRestaurantCommand(command.input,{state:browserRestaurantState(),identity:command.identity});return {...request,result,command}}
const run=(operation,actor=owner,persist=request=>commitBrowserRestaurant(request,actor))=>executeFinancial('restaurant',operation.input,persist,()=>{},operation.identity)
function changeProduct(id,fields){const saved=readRecords();writeRecords({pos2_products:saved.data.pos2_products.map(row=>row.id===id?{...row,...fields}:row)},saved.revision)}
beforeEach(()=>{
 values=new Map();refuse=false;loseAfterWrite=false;ordinal=0
 vi.stubGlobal('localStorage',{getItem:key=>values.get(key)??null,removeItem:key=>values.delete(key),setItem:(key,value)=>{if(key===RECORD_KEY&&refuse)throw Error('fixture quota');values.set(key,String(value));if(key===RECORD_KEY&&loseAfterWrite){loseAfterWrite=false;throw Error('fixture reply lost after atomic save')}}})
 vi.stubGlobal('navigator',{locks:{request:async(_name,work)=>work()}})
 const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos2_products=structuredClone(products);data.pos_suppliers=structuredClone(suppliers);data.pos_users=[owner,staff].map(row=>({id:row.userId,username:row.username,role:row.role}));data.pos_business_settings=[{key:'sharedStoreId',value:JSON.stringify(storeId)}];values.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

test('sync authority catalogue revisions preserve the previous WebCrypto SHA-256 for owners, staff and private config',async()=>{
 for(const role of ['owner','staff'])for(const privateCost of [0,123.45]){
  const input={storeId,products:products.map(row=>({...row,cost:privateCost})),suppliers,restaurantConfig:{enabled:true,dailyCapacity:20,slotCapacity:5,recipes:{bowl:[{id:'rice',qty:.2}]}},role,mappings:{private:{sku:'bowl'}}},catalogue=input.products.map(p=>({id:p.id,sku:p.id,barcode:p.barcode||'',name:p.name,price:p.price,unit:p.unit||'個',...(role==='owner'?{unitCost:p.cost,supplierId:p.supplierId||''}:{})})),vendors=role==='owner'?suppliers:[],identity={storeId,role,catalogue,suppliers:vendors,restaurantConfig:input.restaurantConfig},digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalSignature(identity))),expected=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')
  expect(makeAgentContextSync(input).catalogueRevision).toBe(expected);expect(await makeAgentContext(input)).toEqual(makeAgentContextSync(input));expect(makeAgentContextSync({...input,products:input.products.map(row=>({...row,stock:99}))}).catalogueRevision).toBe(expected)
 }
})

test.each([true,false])('an ordinary23h draft receives current authority time and reserves exactly once, funded=%s',async funded=>{
 await configure(funded);const d=await draft(),before=values.get(RECORD_KEY),operation=await prepared(d)
 expect(values.get(RECORD_KEY)).toBe(before);expect(operation.identity.time).toBe(operation.result.ordinaryReview.issuedAt);expect(operation.identity.time).not.toBe(d.issuedAt)
 const result=await run(operation);expect(result.entry.total).toBe(220);expect(result.entry.createdAt).toBe(operation.identity.time);expect(JSON.parse(result.receipt.signature).agentDraft.issuedAt).toBe(d.issuedAt);expect(readRecords().data.pos2_products.find(row=>row.id==='rice').stock).toBe(.6);expect(readRecords().data.pos2_products.find(row=>row.id==='tea').stock).toBe(9);expect(readRecords().data.pos2_orders).toEqual([]);expect(result.entry.funds?.events??[]).toEqual([])
 const once=values.get(RECORD_KEY);await run(operation);expect(values.get(RECORD_KEY)).toBe(once);expect((await browserRestaurantAgentPreview({draft:d},owner)).status).toBe('accepted');expect(readPendingFinancial()).toBeNull()
})

test('ordinary commands require an authority review rather than accepting the old draft clock',async()=>{await configure();const d=await draft();expect(()=>agentCommand(validateAgentDraft(d,makeAgentContextSync({storeId,role:'owner',products:readRecords().data.pos2_products,suppliers,restaurantConfig:browserRestaurantState().config})))).toThrow(/核對/)} )

test('the whole ordinary recipe cart checks shared stock before confirmation',async()=>{
 await configure();const d=await draft({items:[{productId:'bowl',qty:3},{productId:'soup',qty:2}]}),before=values.get(RECORD_KEY),result=await browserRestaurantAgentPreview({draft:d},owner),context=await current()
 expect(result.availability).toEqual({available:false,shortages:[{productId:'rice',requiredUnits:1200,availableUnits:1000}]});expect(()=>agentCommand(reviewedOrdinaryRestaurantDraft(d,context,result))).toThrow(/不足/);expect(values.get(RECORD_KEY)).toBe(before)
})

test('source, review, identity, actor, time and ordinary intent tampering all reject without saving',async()=>{
 await configure();const d=await draft(),operation=await prepared(d),request={...operation.input,id:operation.identity.id,time:operation.identity.time},before=values.get(RECORD_KEY)
 for(const change of [{agentDraft:{...d,note:'changed'}},{agentDraft:{...d,items:[{productId:'bowl',qty:1}]}},{id:'wrong-ordinary-id'},{time:d.issuedAt},{epoch:'another-generation'},{ordinaryReview:{...request.ordinaryReview,totalCents:1}},{menuProtocol:'pos-restaurant-menu/v1'},{execute:'charge'}]){expect((await commitBrowserRestaurant({...request,...change},owner)).success).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)}
 for(const actor of [null,{...owner,role:'staff'},{...owner,userId:'missing'}])await expect(browserRestaurantAgentPreview({draft:d},actor)).rejects.toThrow(/權限/)
 for(const fields of [{issuedAt:'2026-02-30T00:00:00Z'},{issuedAt:new Date(Date.now()-25*3600000).toISOString()},{items:[{productId:'tea',qty:.5}]},{items:[{productId:'tea',qty:1,price:1}]},{items:[]},{execute:'charge'}])await expect(browserRestaurantAgentPreview({draft:{...d,...fields}},owner)).rejects.toThrow()
 expect(values.get(RECORD_KEY)).toBe(before)
})

test('an expired private review is rejected while an explicit recheck preserves the source ID and time',async()=>{
 await configure();const d=await draft(),operation=await prepared(d),before=values.get(RECORD_KEY),now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+301000)
 const request={...operation.input,id:operation.identity.id,time:operation.identity.time},result=await commitBrowserRestaurant(request,owner);expect(result.committed).toBe(false);expect(values.get(RECORD_KEY)).toBe(before)
 const fresh=await browserRestaurantAgentPreview({draft:d,refresh:true},owner);expect(fresh.draft.id).toBe(d.id);expect(fresh.draft.issuedAt).toBe(d.issuedAt);expect(fresh.ordinaryReview.issuedAt).not.toBe(operation.identity.time)
})

test('stale prices need explicit review, and accepted originals are found before price, expiry and disabled config',async()=>{
 await configure();const d=await draft(),operation=await prepared(d);changeProduct('tea',{price:30});const afterPrice=values.get(RECORD_KEY)
 expect((await commitBrowserRestaurant({...operation.input,id:operation.identity.id,time:operation.identity.time},owner)).committed).toBe(false);expect(values.get(RECORD_KEY)).toBe(afterPrice);await expect(browserRestaurantAgentPreview({draft:d},owner)).rejects.toThrow(/更新/)
 const refreshed=await browserRestaurantAgentPreview({draft:d,refresh:true},owner);expect(refreshed.draft.id).toBe(d.id);expect(refreshed.draft.note).toBe(d.note);expect(refreshed.ordinaryReview.totalCents).toBe(23000);await run(await prepared(refreshed.draft))
 const state=browserRestaurantState();ok(await commitBrowserRestaurant({id:'ordinary-disabled',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config:{...state.config,enabled:false}},owner));const before=values.get(RECORD_KEY),now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+2*3600000)
 expect((await browserRestaurantAgentPreview({draft:d},owner)).original.totalCents).toBe(23000);for(const change of [{issuedAt:new Date(now).toISOString()},{note:'changed'},{items:[{productId:'tea',qty:1}]},{storeId:'another'}])await expect(browserRestaurantAgentPreview({draft:{...d,...change}},owner)).rejects.toThrow();expect(values.get(RECORD_KEY)).toBe(before)
})

test('staff private cost and recipe changes invalidate the private review without exposing cost in the catalogue',async()=>{
 await configure();const d=await draft({},staff),operation=await prepared(d,staff),old=await current(staff);changeProduct('rice',{cost:55});expect((await current(staff)).catalogueRevision).toBe(old.catalogueRevision);const before=values.get(RECORD_KEY),result=await commitBrowserRestaurant({...operation.input,id:operation.identity.id,time:operation.identity.time},staff);expect(result.committed).toBe(false);expect(result.error).toMatch(/變更/);expect(values.get(RECORD_KEY)).toBe(before)
})

test('quota rejection preserves all books and postcommit reply loss recovers one durable ordinary original',async()=>{
 await configure();const d=await draft(),operation=await prepared(d),before=values.get(RECORD_KEY);refuse=true
 const result=await commitBrowserRestaurant({...operation.input,id:operation.identity.id,time:operation.identity.time},owner);expect(result.committed).toBe(false);expect(values.get(RECORD_KEY)).toBe(before);refuse=false;loseAfterWrite=true
 const committed=await run(operation);expect(committed.entry.id).toBe('agent-'+d.id);const once=values.get(RECORD_KEY);await run(operation);expect(values.get(RECORD_KEY)).toBe(once)
})

test('an unknown reply keeps the original journal until exact retry and a changed draft cannot reuse its ID',async()=>{
 await configure();const d=await draft(),operation=await prepared(d);await expect(run(operation,owner,async request=>{ok(await commitBrowserRestaurant(request,owner));throw Error('lost transport reply')})).rejects.toThrow(/尚未確認/)
 const pending=readPendingFinancial(),once=values.get(RECORD_KEY);expect(pending.request.agentDraft.issuedAt).toBe(d.issuedAt);expect(pending.request.ordinaryReview.signature).toBe(operation.result.ordinaryReview.signature)
 await executeFinancial('restaurant',JSON.parse(pending.signature).input,request=>commitBrowserRestaurant(request,owner),()=>{});expect(values.get(RECORD_KEY)).toBe(once);expect(readPendingFinancial()).toBeNull();await expect(browserRestaurantAgentPreview({draft:{...d,items:[{productId:'tea',qty:2}]}},owner)).rejects.toThrow(/內容/)
})

test('zero prices stay zero and ordinary raw products cannot bypass configured meal choices',async()=>{
 await configure();changeProduct('tea',{price:0});const d=await draft({items:[{productId:'tea',qty:2}]}),operation=await prepared(d);expect((await run(operation)).entry.total).toBe(0)
 const {restaurantMenuFixture}=await import('../fixtures/restaurant-menu-v1.mjs'),state=browserRestaurantState(),seed=restaurantMenuFixture();const saved=readRecords(),merged=[...saved.data.pos2_products,...seed.products.filter(row=>!saved.data.pos2_products.some(current=>current.id===row.id))];writeRecords({pos2_products:merged},saved.revision);ok(await commitBrowserRestaurant({id:'ordinary-with-menu',kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(state.config),config:{...state.config,menu:seed.menu,recipes:seed.config.recipes}},owner))
 await expect(browserRestaurantAgentPreview({draft:await draft({items:[{productId:'bowl',qty:1}]})},owner)).rejects.toThrow(/份量與加料/)
})
