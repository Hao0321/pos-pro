// @vitest-environment jsdom
import {test,expect,beforeEach,afterEach,vi} from 'vitest'
import fixture from '../fixtures/lot-count-native-v1.json'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {unpackRecoveryGraph} from '../../electron/recoveryGraph.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {defaultReservationConfig} from '../../electron/reservationConfig.mjs'
import {reservationDiningOperationId,reservationDiningMetadata,reservationDiningSchedule} from '../../electron/reservationDining.mjs'
import {getBrowserReservationState,commitBrowserReservation} from '../../src/utils/browserReservations'
import {commitBrowserRestaurant} from '../../src/utils/browserRestaurant'
import {readRecords,restoreRecords,RECORD_KEY,DATA_KEYS,writeRecords} from '../../src/utils/browserStorage'
import {assertReceipt,executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'
import {restaurantMenuFixture,bowl} from '../fixtures/restaurant-menu-v1.mjs'
import {browserRestaurantState,browserRestaurantMenuQuote} from '../../src/utils/browserRestaurant'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {getAgentContext,loadRestaurantAgentPreview,loadPrivateDraftContext,getReservationDiningContext} from '../../src/utils/dataAccess'
import {AGENT_PROTOCOL,agentCommand} from '../../electron/agentDraftRules.mjs'
import {reviewedOrdinaryRestaurantDraft} from '../../electron/ordinaryRestaurantAgent.mjs'
import {assertReservationReception} from '../../electron/reservationReception.mjs'

const owner={userId:'owner',username:'Lot fixture',role:'owner'},set=Storage.prototype.setItem
const ok=result=>{expect(result.success,result.error).toBe(true);return result}
beforeEach(()=>{
 localStorage.clear();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-19T03:20:00.000Z'));vi.stubGlobal('navigator',{locks:{request:async(_name,fn)=>fn()}})
 const portable=readPortableBackup(fixture,'browser'),graph=unpackRecoveryGraph(portable.protection,'browser')
 localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'dining-browser-epoch',data:portable.book,recovery:{version:portable.protection.version,snapshots:graph.snapshots.map(row=>({...row,data:row.storage==='sqlite'?row.data:JSON.parse(row.data)})),originalIds:graph.originalIds,events:graph.events.map(row=>({...row,receipt:JSON.parse(row.receipt)}))}}))
})
afterEach(()=>{Storage.prototype.setItem=set;vi.useRealTimers();vi.unstubAllGlobals()})
async function request(action,fields={}){const state=await getBrowserReservationState(owner);return {protocol:'pos-reservation/v1',id:crypto.randomUUID(),storeId:state.storeId,epoch:state.epoch,expectedRevision:state.revision,time:new Date().toISOString(),action,reviewed:true,...fields}}
async function seated(){
 ok(await commitBrowserReservation(await request('configure',{config:{...defaultReservationConfig(),enabled:true,tables:[{id:'one',name:'窗邊一號桌',seats:2,online:true}]}}),owner))
 let booking=ok(await commitBrowserReservation(await request('book',{date:'2026-10-19',slot:'12:00',partySize:2,customer:{name:'到店客人',contact:'0900000000'},channel:'phone',tableIds:[],note:''}),owner)).state.bookings[0]
 vi.setSystemTime(new Date('2026-10-19T03:50:00.000Z'))
 for(const status of ['arrived','seated'])booking=ok(await commitBrowserReservation(await request('status',{bookingId:booking.id,expectedBookingRevision:booking.revision,status,reason:'客人已到店'}),owner)).state.bookings[0]
 return booking
}
async function meal(){const state=await getBrowserReservationState(owner),booking=state.bookings[0],childId='restaurant-'+crypto.randomUUID(),input=await request('dine',{bookingId:booking.id,expectedBookingRevision:booking.revision,memberId:null});input.id=reservationDiningOperationId(state.storeId,childId);input.order={id:childId,kind:'restaurant',action:'create',time:input.time,storeId:state.storeId,epoch:state.epoch,costMode:'active',channel:'walkin',...reservationDiningSchedule(input.time,state.config.timeZone),customer:booking.customer.name,contact:booking.customer.contact,note:'',items:[{id:'rice',price:10,qty:1}],reservationDining:reservationDiningMetadata(input,state)};return input}

test('one actual browser record commits the seated party, real ingredient allocation and source-cost receipt exactly once',async()=>{
 await seated();const input=await meal(),before=readRecords(),saved=ok(await commitBrowserReservation(input,owner));assertReceipt('reservation',input,saved)
 const record=readRecords(),book=browserToBook(record.data);expect(record.revision).toBe(before.revision+1);expect(record.recovery.version).toBe(17);expect(book.products.find(row=>row.id==='rice').stock).toBe(2);expect(saved.dining.entry.tableNum).toBe('窗邊一號桌');expect(saved.state.bookings[0].restaurantOrderIds).toEqual([input.order.id]);expect(book.stockCostEntries).toHaveLength(before.data.pos_stock_cost_entries.length+1)
 const raw=localStorage.getItem(RECORD_KEY);expect(ok(await commitBrowserReservation(input,owner)).dining.receipt).toEqual(saved.dining.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw);expect(ok(await commitBrowserRestaurant(input.order,owner)).receipt).toEqual(saved.dining.receipt);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
test('a late quota failure leaves every parent, child, stock, cost, print and protection byte unchanged',async()=>{
 await seated();const input=await meal(),before=localStorage.getItem(RECORD_KEY);Storage.prototype.setItem=function(key,value){if(key===RECORD_KEY)throw Error('owned late dining quota');return set.call(this,key,value)}
 const result=await commitBrowserReservation(input,owner);expect(result.success).toBe(false);expect(result.committed).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(before)
})
test('a lost atomic storage acknowledgement recovers both originals and never allocates the meal twice',async()=>{
 await seated();const input=await meal();let lost=false;Storage.prototype.setItem=function(key,value){set.call(this,key,value);if(key===RECORD_KEY&&!lost){lost=true;throw Error('owned lost joint acknowledgement')}}
 const saved=ok(await commitBrowserReservation(input,owner));assertReceipt('reservation',input,saved);Storage.prototype.setItem=set;const raw=localStorage.getItem(RECORD_KEY);ok(await commitBrowserReservation(input,owner));expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
test('a competing device with the old booking revision cannot create a second meal or reserve another ingredient',async()=>{
 await seated();const first=await meal(),rival=await meal();ok(await commitBrowserReservation(first,owner));const raw=localStorage.getItem(RECORD_KEY);expect((await commitBrowserReservation(rival,owner)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
test('the normal restaurant port cannot invent a reservation source, and a changed original is rejected read-only',async()=>{
 await seated();const input=await meal(),before=localStorage.getItem(RECORD_KEY);expect((await commitBrowserRestaurant(input.order,owner)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(before);ok(await commitBrowserReservation(input,owner));const raw=localStorage.getItem(RECORD_KEY);expect((await commitBrowserReservation({...input,order:{...input.order,note:'changed original'}},owner)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
test('restore before a promised meal retains its original and pauses without recreating stock or allowing a partial recovery',async()=>{
 await seated();const earlier=structuredClone(readRecords().data),input=await meal();ok(await commitBrowserReservation(input,owner));restoreRecords(earlier,readRecords().revision);expect((await getBrowserReservationState(owner)).needsRecovery).toBe(true);const raw=localStorage.getItem(RECORD_KEY);expect((await commitBrowserReservation(await request('recover'),owner)).success).toBe(false);expect((await commitBrowserReservation(input,owner)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
test('a reply missing the actual child or cost proof retains the financial original for reconciliation',async()=>{
 await seated();const request=await meal(),{id,time,...input}=request
 await expect(executeFinancial('reservation',input,async value=>{const result=ok(await commitBrowserReservation(value,owner));delete result.dining.costReceipt;return result},()=>{},{id,time})).rejects.toThrow();expect(readPendingFinancial().request.id).toBe(id)
 const saved=await executeFinancial('reservation',input,value=>commitBrowserReservation(value,owner));expect(saved.dining.entry.id).toBe(request.order.id);expect(readPendingFinancial()).toBe(null)
})
test('failed dining after a lot expires does not separately commit expiry or an empty meal',async()=>{
 await seated();vi.setSystemTime(new Date('2026-10-20T03:50:00.000Z'));const input=await meal(),raw=localStorage.getItem(RECORD_KEY);expect((await commitBrowserReservation(input,owner)).success).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
async function referenceMenu(){
 const seed=restaurantMenuFixture(),data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos2_products=seed.products;data.pos_users=structuredClone(fixture.book.users);data.pos2_shifts=[{id:'reference-shift',status:'open',openCash:0}];data.pos2_members=[{id:'member-a',name:'熟客',phone:'0900000001',points:20,balance:0,totalSpent:0,tier:'normal'}]
 set.call(localStorage,RECORD_KEY,JSON.stringify({version:1,revision:1,data,salesEpoch:'reference-dining-epoch'}))
 const current=browserRestaurantState();ok(await commitBrowserRestaurant({id:crypto.randomUUID(),kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(current.config),config:{...current.config,enabled:true,fundsEnabled:true,dailyCapacity:100,slotCapacity:100,recipes:seed.config.recipes,menu:seed.menu}},owner));await seated()
}
test('the existing real menu quote and funded restaurant planner commit table metadata and explicit membership without granting benefits',async()=>{
 await referenceMenu();const input=await meal(),state=await getBrowserReservationState(owner),quote=await browserRestaurantMenuQuote({items:[bowl()]},owner);input.memberId='member-a';input.order={...input.order,costMode:'reference',fundsProtocol:'pos-restaurant-funds/v1',menuProtocol:'pos-restaurant-menu/v1',menuReview:quote.menuReview,reservationDining:reservationDiningMetadata(input,state)};delete input.order.items
 const members=structuredClone(readRecords().data.pos2_members),saved=ok(await commitBrowserReservation(input,owner));assertReceipt('reservation',input,saved);expect(saved.dining.entry.menu.quote.input[0].offerId).toBe('bowl-offer');expect(saved.dining.entry.tableNum).toBe('窗邊一號桌');expect(saved.state.bookings[0].memberId).toBe('member-a');expect(readRecords().data.pos2_members).toEqual(members)
 const record=readRecords(),raw=localStorage.getItem(RECORD_KEY);expect(()=>writeRecords({pos2_members:[]},record.revision)).toThrow();expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
 const context=await getReservationDiningContext({bookingId:input.bookingId},owner);expect(context.members).toEqual([{id:'member-a',name:'熟客',phone:'0900000001'}]);expect(context.booking.memberId).toBe('member-a')
})
test('the existing ordinary Agent review commits its full original under the joint reservation authority',async()=>{
 await referenceMenu();const parent=await meal(),context=await getAgentContext(owner),scope=await loadPrivateDraftContext(owner),draft={protocol:AGENT_PROTOCOL,id:crypto.randomUUID(),issuedAt:new Date().toISOString(),storeId:context.storeId,catalogueRevision:context.catalogueRevision,kind:'restaurant',items:[{productId:'tea',qty:1}],day:parent.order.day,slot:parent.order.slot,channel:'walkin',customer:parent.order.customer,contact:parent.order.contact,note:''},preview=await loadRestaurantAgentPreview({draft},owner),reviewed=reviewedOrdinaryRestaurantDraft(draft,context,preview,Date.now()),command=agentCommand(reviewed)
 parent.order={...command.input,...command.identity,kind:'restaurant',draftContext:scope,reservationDining:{...parent.order.reservationDining,parentId:reservationDiningOperationId(parent.storeId,command.identity.id)}};parent.id=parent.order.reservationDining.parentId
 const result=ok(await commitBrowserReservation(parent,owner));assertReceipt('reservation',parent,result);expect(result.dining.entry.items[0].id).toBe('tea');expect(result.dining.entry.tableNum).toBe('窗邊一號桌')
})
async function memberMenuMeal(){const input=await meal(),state=await getBrowserReservationState(owner),quote=await browserRestaurantMenuQuote({items:[bowl()]},owner);input.memberId='member-a';input.order={...input.order,costMode:'reference',fundsProtocol:'pos-restaurant-funds/v1',menuProtocol:'pos-restaurant-menu/v1',menuReview:quote.menuReview,reservationDining:reservationDiningMetadata(input,state)};delete input.order.items;return input}
test('retained future dining identity blocks member deletion after an old restore, while an unrelated member remains removable',async()=>{
 await referenceMenu();const earlier=structuredClone(readRecords().data),input=await memberMenuMeal();ok(await commitBrowserReservation(input,owner));restoreRecords(earlier,readRecords().revision)
 const state=await getBrowserReservationState(owner),summary=state.reception.bookings.find(row=>row.bookingId===input.bookingId);expect(state.needsRecovery).toBe(true);expect(state.reception.needsFullRestore).toBe(true);expect(summary).toMatchObject({orderCount:1,missingCount:1,dueCents:null,totalCents:null});expect(()=>assertReservationReception({...state,reception:{...state.reception,orders:state.reception.orders.map(row=>({...row,dueCents:0}))}})).toThrow()
 const raw=localStorage.getItem(RECORD_KEY);expect(()=>writeRecords({pos2_members:[]},readRecords().revision)).toThrow('會員已有訂位與餐飲紀錄');expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
 let record=readRecords();writeRecords({pos2_members:[...record.data.pos2_members,{...record.data.pos2_members[0],id:'unrelated',name:'其他會員',points:0}]},record.revision);record=readRecords();writeRecords({pos2_members:record.data.pos2_members.filter(row=>row.id!=='unrelated')},record.revision);expect(readRecords().data.pos2_members.map(row=>row.id)).toEqual(['member-a'])
})
test('reception reads actual partial receipts, refunds and cancellation; original retry returns current outstanding money',async()=>{
 await referenceMenu();const input=await memberMenuMeal();ok(await commitBrowserReservation(input,owner));const due=async()=>{const state=await getBrowserReservationState(owner);assertReservationReception(state);return state.reception.bookings.find(row=>row.bookingId===input.bookingId)}
 expect((await due()).dueCents).toBe(10000)
 async function funds(action,fields={}){const state=browserRestaurantState(),entry=state.entries.find(row=>row.id===input.order.id);return ok(await commitBrowserRestaurant({id:crypto.randomUUID(),kind:'restaurant',action,time:new Date().toISOString(),storeId:state.storeId,epoch:state.epoch,costMode:state.costMode,fundsProtocol:'pos-restaurant-funds/v1',entryId:entry.id,expectedVersion:entry.version,shiftId:'reference-shift',...fields},owner))}
 await funds('funds-receive',{amount:40,paid:40,payMethod:'cash'});expect(await due()).toMatchObject({dueCents:6000,retainedCents:4000})
 const retry=ok(await commitBrowserReservation(input,owner));expect(retry.state.reception.bookings.find(row=>row.bookingId===input.bookingId).dueCents).toBe(6000)
 await funds('funds-refund',{amount:20,reason:'原收款退回'});expect(await due()).toMatchObject({dueCents:8000,retainedCents:2000});await funds('cancel',{reason:'客人取消'});expect(await due()).toMatchObject({dueCents:0,retainedCents:0,totalCents:0})
})
test('reception refuses a tampered payment source rather than showing a fabricated paid amount',async()=>{
 await referenceMenu();const input=await memberMenuMeal();ok(await commitBrowserReservation(input,owner));const state=browserRestaurantState(),entry=state.entries.find(row=>row.id===input.order.id)
 ok(await commitBrowserRestaurant({id:crypto.randomUUID(),kind:'restaurant',action:'funds-receive',time:new Date().toISOString(),storeId:state.storeId,epoch:state.epoch,costMode:state.costMode,fundsProtocol:'pos-restaurant-funds/v1',entryId:entry.id,expectedVersion:entry.version,shiftId:'reference-shift',amount:100,paid:100,payMethod:'cash'},owner))
 expect((await getBrowserReservationState(owner)).reception.bookings.find(row=>row.bookingId===input.bookingId).dueCents).toBe(0);const record=readRecords();expect(record.data.pos2_cash_log.length).toBeGreaterThan(0);record.data.pos2_cash_log=[];set.call(localStorage,RECORD_KEY,JSON.stringify(record));await expect(getBrowserReservationState(owner)).rejects.toThrow()
})
test('a normal departure after a funded dining original acknowledges its full history and keeps the real unpaid bill',async()=>{
 await referenceMenu();const meal=await memberMenuMeal();ok(await commitBrowserReservation(meal,owner));const command=await request('status',{bookingId:meal.bookingId,expectedBookingRevision:(await getBrowserReservationState(owner)).bookings[0].revision,status:'completed',reason:'客人已走，保留待收款'}),{id,time,...input}=command,before=browserToBook(readRecords().data)
 const saved=await executeFinancial('reservation',input,value=>commitBrowserReservation(value,owner),()=>{},{id,time});expect(readPendingFinancial()).toBe(null);expect(saved.state.bookings[0].status).toBe('completed');expect(saved.state.reception.bookings.find(row=>row.bookingId===meal.bookingId).dueCents).toBe(10000);const after=browserToBook(readRecords().data);for(const key of ['products','orders','cashLog','members','restaurantOrders','stockCostEntries'])expect(after[key]).toEqual(before[key])
})
test('older dining restore pauses a fresh correctly scoped ordinary order through the real browser restaurant port',async()=>{
 await referenceMenu();const earlier=structuredClone(readRecords().data),input=await memberMenuMeal();ok(await commitBrowserReservation(input,owner));restoreRecords(earlier,readRecords().revision);const current=browserRestaurantState(),request={id:crypto.randomUUID(),kind:'restaurant',action:'create',time:new Date().toISOString(),storeId:current.storeId,epoch:current.epoch,costMode:current.costMode,fundsProtocol:'pos-restaurant-funds/v1',day:current.today,slot:'12:00',channel:'walkin',customer:'新現場客',contact:'',note:'',items:[{id:'tea',price:20,qty:1}]},raw=localStorage.getItem(RECORD_KEY),result=await commitBrowserRestaurant(request,owner);expect(result.success).toBe(false);expect(result.committed).toBe(false);expect(localStorage.getItem(RECORD_KEY)).toBe(raw)
})
