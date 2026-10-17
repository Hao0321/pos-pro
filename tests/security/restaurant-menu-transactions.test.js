import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import legacy from '../fixtures/table-kitchen-v1.json'
import {restaurantMenuFixture,bowl,choose} from '../fixtures/restaurant-menu-v1.mjs'
import {DATA_KEYS,RECORD_KEY,readRecords,writeRecords} from '../../src/utils/browserStorage'
import {commitBrowserRestaurant,browserRestaurantState,browserRestaurantMenuQuote} from '../../src/utils/browserRestaurant'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {restaurantCapacityQuantity,summarizeRestaurantFunds} from '../../electron/restaurantFunds.mjs'
import {browserProtectionGraph} from '../../src/utils/browserProtection'
import {createCompleteBackup,readCompleteBackup,readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {quoteRestaurantMenu} from '../../electron/restaurantMenu.mjs'
import {automaticBusinessJournal} from '../../electron/businessJournal.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {getBrowserStockSetupState,previewBrowserStockSetup,commitBrowserStockSetup} from '../../src/utils/browserStockSetup'
import {getBrowserStockAccountingState} from '../../src/utils/browserStockReports'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {buildPnL} from '../../electron/accountingCore.mjs'
import {stockPeriodDisclosure} from '../../electron/stockAccounting.mjs'
import {previewRestore,applyRestorePreview} from '../../src/utils/browserRecovery'
import {stockLedgerDigest} from '../../electron/stockLedgerModel.mjs'
import {dbAddProduct,dbDeleteProduct} from '../../src/utils/dataAccess'

const owner=legacy.owner,cart=()=>[bowl(),bowl(1,{selections:[choose('extras','egg')]}),{offerId:'bowl-set',qty:2}]
let records,ordinal,quota,loseReply
const ok=result=>{expect(result.success,result.error).toBe(true);return result}
const state=()=>browserRestaurantState(),entry=()=>state().entries[0]
function command(action,fields={}){const s=state();return {id:'menu-txn-'+(++ordinal),kind:'restaurant',action,time:new Date().toISOString(),storeId:s.storeId,epoch:s.epoch,...fields}}
async function configure(config){const s=state();return commitBrowserRestaurant(command('configure',{expectedConfig:canonicalSignature(s.config),config}),owner)}
async function create(items=cart(),changes={}){const preview=await browserRestaurantMenuQuote({items},owner),s=state(),request=command('create',{fundsProtocol:'pos-restaurant-funds/v1',costMode:s.costMode,menuProtocol:'pos-restaurant-menu/v1',menuReview:preview.menuReview,day:s.today,slot:'12:00',channel:'walkin',customer:'選項測試',contact:'',note:'',...changes});return {request,result:await commitBrowserRestaurant(request,owner)}}
async function apply(action,fields={}){const e=entry();return commitBrowserRestaurant(command(action,{entryId:e.id,expectedVersion:e.version,...fields}),owner)}
beforeEach(async()=>{
 records=new Map();ordinal=0;quota=false;loseReply=false
 vi.stubGlobal('localStorage',{getItem:key=>records.get(key)??null,removeItem:key=>records.delete(key),setItem:(key,value)=>{if(key===RECORD_KEY&&quota)throw Error('fixture quota');records.set(key,String(value));if(key===RECORD_KEY&&loseReply){loseReply=false;throw Error('fixture lost reply')}}})
 vi.stubGlobal('navigator',{locks:{request:async(_key,fn)=>fn()}})
 const seed=restaurantMenuFixture(),data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]))
 data.pos2_products=seed.products;data.pos_users=structuredClone(legacy.before.users);data.pos2_shifts=[{id:'shift',status:'open',openCash:0}]
 records.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
 ok(await configure({...state().config,enabled:true,fundsEnabled:true,dailyCapacity:100,slotCapacity:100,recipes:seed.config.recipes,menu:seed.menu}))
})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})

test('saved owner definitions quote and commit distinct meal lines, raw use and exact original once',async()=>{
 const before=records.get(RECORD_KEY),preview=await browserRestaurantMenuQuote({items:cart()},owner)
 expect(records.get(RECORD_KEY)).toBe(before);expect(preview.menuReview.quote).toMatchObject({totalCents:44500,referenceCostCents:15200,capacity:6,quantity:4})
 const {request,result}=await create();ok(result);expect(entry()).toMatchObject({total:445,quantity:4});expect(entry().items).toHaveLength(3);expect(restaurantCapacityQuantity(entry())).toBe(6)
 const stocks=Object.fromEntries(readRecords().data.pos2_products.map(p=>[p.id,p.stock]));expect(stocks).toMatchObject({rice:9.2,beef:9.6,box:96,egg:19,tea:8})
 expect(readRecords().recovery.version).toBe(7)
 const once=records.get(RECORD_KEY);ok(await commitBrowserRestaurant(request,owner));expect(records.get(RECORD_KEY)).toBe(once)
 expect(await commitBrowserRestaurant({...request,note:'changed original'},owner)).toMatchObject({success:false});expect(records.get(RECORD_KEY)).toBe(once)
})

test('selected unprepared and prepared cancellations keep original tenders, resources and capacity',async()=>{
 ok((await create()).result)
 ok(await apply('funds-receive',{amount:400,paid:400,payMethod:'cash',shiftId:'shift'}));ok(await apply('funds-receive',{amount:45,paid:45,payMethod:'card',shiftId:'shift'}))
 const added=entry().menu.quote.lineFacts.find(row=>row.offerId==='bowl-offer'&&row.selections.some(group=>group.groupId==='extras'&&group.choices.length)).lineId
 ok(await apply('cancel-part',{quantities:[{id:added,qty:1}],reason:'不要加蛋餐',shiftId:'shift'}))
 let e=entry(),event=e.funds.events.at(-1);expect(event.refunds.map(row=>[row.method,row.amountCents])).toEqual([['card',4500],['cash',7000]])
 expect(e.total).toBe(330);expect(restaurantCapacityQuantity(e)).toBe(5);expect(readRecords().data.pos2_products.find(p=>p.id==='egg').stock).toBe(20)
 ok(await apply('advance',{status:'cooking'}));const combo=entry().menu.quote.lineFacts.find(row=>row.offerId==='bowl-set').lineId,stockBefore=readRecords().data.pos2_products
 ok(await apply('cancel-part',{quantities:[{id:combo,qty:1}],reason:'做好後少一份',shiftId:'shift'}))
 expect(readRecords().data.pos2_products).toEqual(stockBefore);expect(entry().total).toBe(215);expect(restaurantCapacityQuantity(entry())).toBe(5)
 expect(readRecords().data.pos2_waste.reduce((sum,row)=>sum+row.qty*row.cost,0)).toBe(38)
 ok(await apply('advance',{status:'ready'}));const done=ok(await apply('advance',{status:'completed'}));expect(done.order.total).toBe(215)
 expect(summarizeRestaurantFunds(entry().funds).dueCents).toBe(0);expect(readRecords().data.pos2_orders).toHaveLength(1)
})

test('raw prices, unquoted base meals and forged actors cannot bypass saved selections',async()=>{
 const before=records.get(RECORD_KEY),s=state(),raw=command('create',{fundsProtocol:'pos-restaurant-funds/v1',costMode:s.costMode,day:s.today,slot:'12:00',channel:'walkin',customer:'',contact:'',note:'',items:[{id:'bowl',price:1,qty:1}]})
 expect(await commitBrowserRestaurant(raw,owner)).toMatchObject({success:false})
 await expect(browserRestaurantMenuQuote({items:cart()},{...owner,userId:'forged'})).rejects.toThrow(/權限/)
 const preview=await browserRestaurantMenuQuote({items:cart()},owner)
 const request={...raw,menuProtocol:'pos-restaurant-menu/v1',menuReview:preview.menuReview};expect(await commitBrowserRestaurant(request,owner)).toMatchObject({success:false})
 expect(records.get(RECORD_KEY)).toBe(before)
})

test('even an internally consistent quote from an unknown menu definition is rejected',async()=>{
 const seed=restaurantMenuFixture(),s=state();seed.menu.offers[0].variants[0].price=1
 const forged=quoteRestaurantMenu({...seed,config:s.config,storeId:s.storeId,epoch:s.epoch,costMode:s.costMode,now:Date.now()},cart()).quote
 const before=records.get(RECORD_KEY),review=await browserRestaurantMenuQuote({items:cart()},owner)
 const {result}=await create(cart(),{menuReview:{configurationId:review.menuReview.configurationId,quote:forged}})
 expect(result).toMatchObject({success:false});expect(records.get(RECORD_KEY)).toBe(before)
})

test('menu repricing requires a fresh review while the saved original survives later changes',async()=>{
 const {request,result}=await create();ok(result);const original=structuredClone(entry().menu),config=structuredClone(state().config);config.menu.offers[0].variants[0].price=110;ok(await configure(config))
 const before=records.get(RECORD_KEY),stale={...request,id:'new-with-old-review'};expect(await commitBrowserRestaurant(stale,owner)).toMatchObject({success:false});expect(records.get(RECORD_KEY)).toBe(before)
 ok(await commitBrowserRestaurant(request,owner));expect(entry().menu).toEqual(original)
 const fresh=ok((await create([bowl()])).result);expect(fresh.entry.total).toBe(110)
})

test('quota and a reply lost after the atomic write preserve the exact command semantics',async()=>{
 const preview=await browserRestaurantMenuQuote({items:cart()},owner),s=state(),request=command('create',{fundsProtocol:'pos-restaurant-funds/v1',costMode:s.costMode,menuProtocol:'pos-restaurant-menu/v1',menuReview:preview.menuReview,day:s.today,slot:'12:00',channel:'walkin',customer:'',contact:'',note:''}),before=records.get(RECORD_KEY)
 quota=true;expect(await commitBrowserRestaurant(request,owner)).toMatchObject({success:false,committed:false});expect(records.get(RECORD_KEY)).toBe(before)
 quota=false;loseReply=true;ok(await commitBrowserRestaurant(request,owner));const once=records.get(RECORD_KEY);ok(await commitBrowserRestaurant(request,owner));expect(records.get(RECORD_KEY)).toBe(once)
})

test('format7 backup binds definitions, original selections and their source receipt',async()=>{
 ok((await create()).result);const saved=readRecords(),packet=createCompleteBackup(saved.data,browserProtectionGraph(saved),'browser')
 expect(packet.features).toContain('restaurant-menu-v1');expect(packet.protection.version).toBe(7);expect(readCompleteBackup(packet,'browser').book).toEqual(saved.data)
 expect(()=>createCompleteBackup(saved.data,{...browserProtectionGraph(saved),version:6},'browser')).toThrow()
 const downgraded=structuredClone(packet);downgraded.protection.version=6;const {checksum,...body}=downgraded;downgraded.checksum=stockLedgerDigest(body)
 expect(()=>readCompleteBackup(downgraded,'browser')).toThrow()
 const configId=entry().menu.configurationId
 for(const mutate of [record=>record.data.pos_restaurant_operations=record.data.pos_restaurant_operations.filter(row=>row.id!==configId),record=>record.data.pos_business_settings=record.data.pos_business_settings.filter(row=>row.key!=='restaurantMenuConfigurationId'),record=>record.recovery.version=6]){
  const broken=structuredClone(saved);mutate(broken);records.set(RECORD_KEY,JSON.stringify(broken));expect(()=>readRecords()).toThrow();records.set(RECORD_KEY,JSON.stringify(saved))
 }
})

test('fractional menu reference cost rounds once and cumulative prepared refunds never create extra cents',async()=>{
 const saved=readRecords();writeRecords({pos2_products:saved.data.pos2_products.map(row=>row.id==='rice'?{...row,cost:.01}:row)},saved.revision)
 const config=structuredClone(state().config);config.recipes={bowl:[{id:'rice',qty:.5}]};config.menu.offers=[{...config.menu.offers[0],groups:[],variants:[config.menu.offers[0].variants[0]]}];ok(await configure(config))
 const result=ok((await create([bowl(3)])).result);expect(result.entry.menu.quote.referenceCostCents).toBe(2)
 ok(await apply('funds-receive',{amount:300,paid:300,payMethod:'card',shiftId:'shift'}));ok(await apply('advance',{status:'cooking'}));ok(await apply('advance',{status:'ready'}));ok(await apply('advance',{status:'completed'}))
 const journal=()=>{const book=browserToBook(readRecords().data);return automaticBusinessJournal({...book,restaurantEntries:book.restaurantOrders})}
 const cogs=()=>journal().filter(row=>row.type==='auto_cogs').reduce((sum,row)=>sum+Math.round(row.lines.find(line=>line.account==='5101').debit*100),0)
 const losses=()=>journal().filter(row=>row.type==='auto_waste').reduce((sum,row)=>sum+Math.round(row.lines.find(line=>line.account==='5208').debit*100),0)
 expect(cogs()).toBe(2)
 const id=entry().items[0].id
 for(const expected of [1,1,0]){ok(await apply('cancel-part',{quantities:[{id,qty:1}],reason:'fractional reference',shiftId:'shift'}));expect(cogs()).toBe(expected);expect(cogs()+losses()).toBe(2)}
})

test('active browser FIFO uses the same saved menu, receipt and line owners through prepared refunds',async()=>{
 vi.stubEnv('VITE_POS_STOCK_SETUP','isolated-fixture')
 const current=await getBrowserStockSetupState(owner),{now,...context}=current.context,preview=await previewBrowserStockSetup({context,entries:[],useReferences:true},owner)
 ok(await commitBrowserStockSetup({...preview.input,id:'menu-cost-opening',time:preview.input.review.issuedAt},owner))
 expect(state().costMode).toBe('active')
 const config=structuredClone(state().config);config.slotCapacity=99;ok(await configure(config))
 const {request,result}=await create();ok(result);expect(result.costReceipt).toMatchObject({sourceMethod:'applyRestaurantOperation',id:request.id})
 ok(await apply('funds-receive',{amount:445,paid:445,payMethod:'cash',shiftId:'shift'}));ok(await apply('advance',{status:'cooking'}));ok(await apply('advance',{status:'ready'}));ok(await apply('advance',{status:'completed'}))
 const pnl=()=>{const report=getBrowserStockAccountingState(owner),day=state().today;return buildPnL(report.journals,day,day,stockPeriodDisclosure(report,day,day))}
 expect(pnl()).toMatchObject({revenue:445,cogs:152,opExpenses:0})
 const added=entry().menu.quote.lineFacts.find(row=>row.offerId==='bowl-offer'&&row.selections.some(group=>group.groupId==='extras'&&group.choices.length)).lineId,stock=readRecords().data.pos2_products
 ok(await apply('cancel-part',{quantities:[{id:added,qty:1}],reason:'prepared modified meal',shiftId:'shift'}))
 expect(pnl()).toMatchObject({revenue:330,cogs:109,opExpenses:43});expect(readRecords().data.pos2_products).toEqual(stock)
 validateStockCostBook(browserToBook(readRecords().data))
 const once=records.get(RECORD_KEY);ok(await commitBrowserRestaurant(request,owner));expect(records.get(RECORD_KEY)).toBe(once)
})

test('a complete native-format transfer restores browser source lineage atomically and permits a fresh scoped order',async()=>{
 const {request,result}=await create();ok(result);const original=structuredClone(entry().menu),saved=readRecords(),browserPacket=createCompleteBackup(saved.data,browserProtectionGraph(saved),'browser')
 const native=readPortableBackup(JSON.parse(JSON.stringify(browserPacket)),'sqlite'),nativePacket=createCompleteBackup(native.book,native.protection,'sqlite',{features:native.features})
 const preview=await previewRestore({kind:'import',data:JSON.parse(JSON.stringify(nativePacket))},owner),before=records.get(RECORD_KEY),oldEpoch=state().epoch
 quota=true;await expect(applyRestorePreview(preview.id,owner)).rejects.toThrow(/quota/);expect(records.get(RECORD_KEY)).toBe(before)
 quota=false;ok(await applyRestorePreview(preview.id,owner));expect(state().epoch).not.toBe(oldEpoch);expect(entry().menu).toEqual(original);expect(readRecords().recovery.version).toBe(7)
 const restored=records.get(RECORD_KEY);ok(await commitBrowserRestaurant(request,owner));expect(records.get(RECORD_KEY)).toBe(restored)
 expect(await commitBrowserRestaurant({...request,id:'old-review-new-id'},owner)).toMatchObject({success:false});expect(records.get(RECORD_KEY)).toBe(restored)
 ok((await create([bowl()])).result);expect(state().entries).toHaveLength(2)
 const packet=createCompleteBackup(readRecords().data,browserProtectionGraph(readRecords()),'browser');expect(packet.protection.version).toBe(7);expect(readCompleteBackup(packet,'browser').features).toContain('restaurant-menu-v1')
})

test('menu choices and fully cancelled originals retain their real catalogue products while unrelated deletion works',async()=>{
 ok(await dbAddProduct({id:'unrelated',name:'Unrelated',unit:'個',stock:0,price:1,cost:0},owner));ok(await dbDeleteProduct('unrelated',owner))
 const before=records.get(RECORD_KEY);await expect(dbDeleteProduct('egg',owner)).rejects.toThrow(/使用/);expect(records.get(RECORD_KEY)).toBe(before)
 ok((await create([bowl(1,{selections:[choose('extras','egg')]} )])).result);ok(await apply('cancel',{reason:'cancel before cooking'}))
 const {menu,...config}=state().config;ok(await configure({...config,recipes:{}}))
 const cancelled=records.get(RECORD_KEY)
 for(const id of ['bowl','egg','rice']){await expect(dbDeleteProduct(id,owner)).rejects.toThrow(/使用/);expect(records.get(RECORD_KEY)).toBe(cancelled)}
})
