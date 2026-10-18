// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import fixture from '../fixtures/lots-native-v1.json'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {unpackRecoveryGraph} from '../../electron/recoveryGraph.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {readRecords,writeRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {getBrowserLotState,commitBrowserLot} from '../../src/utils/browserLots'
import {commitBrowserSale,commitBrowserRefund} from '../../src/utils/browserSales'
import {prepareCheckout} from '../../src/utils/checkoutSafety.mjs'
import {executeFinancial,readPendingFinancial} from '../../src/utils/financialCommand'
const owner={userId:'owner',username:'Lot fixture',role:'owner'},staff={userId:'staff',username:'Lot staff',role:'staff'}
const ok=result=>{expect(result.success,result.error).toBe(true);return result},record=()=>readRecords(),book=()=>browserToBook(record().data),state=()=>validateStockCostBook(book());let serial=0
function seed(input=fixture.before){const portable=readPortableBackup(input,'browser'),rows=unpackRecoveryGraph(portable.protection,'browser');localStorage.setItem(RECORD_KEY,JSON.stringify({version:1,revision:1,salesEpoch:'browser-lots',data:portable.book,recovery:{version:portable.protection.version,snapshots:rows.snapshots.map(row=>({...row,data:row.storage==='sqlite'?row.data:JSON.parse(row.data)})),originalIds:rows.originalIds,events:rows.events.map(row=>({...row,receipt:JSON.parse(row.receipt)}))}}));return record()}
async function command(action,fields={}){const {context}=await getBrowserLotState(owner);return {protocol:'pos-stock-lots/v1',id:'browser-lot-'+(++serial),time:context.now,storeId:context.storeId,epoch:context.epoch,expectedStateDigest:context.stateDigest,action,...fields}}
async function apply(action,fields={},actor=owner){const input=await command(action,fields);return {input,result:ok(await commitBrowserLot(input,actor))}}
async function activate(){return apply('activate',{timeZone:'Asia/Taipei'})}
async function labels(){await activate();const [a,b]=state().projection.custody.sources;await apply('label',{sourceId:a.id,quantityUnits:3000,code:'later',expiryDate:'2026-10-19',receivedAt:null});await apply('label',{sourceId:b.id,quantityUnits:3000,code:'soon',expiryDate:'2026-10-18',receivedAt:null});await apply('track',{productId:'rice',required:true});return {a,b}}
beforeEach(()=>{localStorage.clear();serial=0;vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-17T15:55:00.000Z'));vi.stubGlobal('navigator',{locks:{request:async(_key,work)=>work()}});seed()})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('native original sources activate and unknown required stock is held without losing value',async()=>{
 const original=book().stockCostEntries;await activate();await apply('track',{productId:'rice',required:true});expect(book().products[0].stock).toBe(0);expect(state().valuation.ownedKnownValueCents).toBe(909);expect(state().valuation.categories.quarantined.knownValueCents).toBe(909)
 const source=state().projection.custody.sources[0];await apply('label',{sourceId:source.id,quantityUnits:1000,code:'partial',expiryDate:'2026-10-18',receivedAt:null});expect(book().products[0].stock).toBe(1);expect(state().valuation.ownedKnownValueCents).toBe(909);expect(book().stockCostEntries.slice(0,original.length)).toEqual(original)
})
it('quota before the one atomic record preserves all collections; after-write reply loss resolves the original receipt',async()=>{
 await activate();const source=state().projection.custody.sources[0],input=await command('label',{sourceId:source.id,quantityUnits:1000,code:'once',expiryDate:'2026-10-18',receivedAt:null}),before=record(),set=Storage.prototype.setItem
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key===RECORD_KEY)throw Error('fixture lot quota');return set.call(this,key,value)})
 const rejected=await commitBrowserLot(input,owner);expect(rejected.success).toBe(false);expect(rejected.committed).toBe(false);expect(record()).toEqual(before);spy.mockRestore()
 const lost=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){const result=set.call(this,key,value);if(key===RECORD_KEY)throw Error('fixture lot reply after save');return result})
 const {id,time,...fields}=input,result=await executeFinancial('lots',fields,request=>commitBrowserLot(request,owner),()=>{},{id,time});ok(result);lost.mockRestore();expect(readPendingFinancial()).toBe(null);expect(record().data.pos_stock_cost_entries.length).toBe(before.data.pos_stock_cost_entries.length+1);const saved=record();expect(await commitBrowserLot(input,owner)).toEqual(result);expect(record()).toEqual(saved)
})
it('same original lookup precedes the new clock sweep and new reads perform exactly one expiry event',async()=>{
 const saved=await activate();await apply('label',{sourceId:state().projection.custody.sources[1].id,quantityUnits:3000,code:'soon',expiryDate:'2026-10-18',receivedAt:null});const before=record();vi.setSystemTime(new Date('2026-10-18T16:01:00.000Z'));expect(await commitBrowserLot(saved.input,owner)).toEqual(saved.result);expect(record()).toEqual(before)
 const next=await getBrowserLotState(owner);expect(next.context.day).toBe('2026-10-19');expect(book().products[0].stock).toBe(3);expect(state().valuation.categories.quarantined.knownValueCents).toBe(606);expect(state().valuation.ownedKnownValueCents).toBe(909);const after=record();await getBrowserLotState(staff);expect(record()).toEqual(after)
})
it('real browser checkout uses FEFO and the original expired return remains held at its actual source cost',async()=>{
 const {b}=await labels();vi.setSystemTime(new Date('2026-10-17T16:05:00.000Z'));await getBrowserLotState(owner)
 const plan=prepareCheckout({id:'browser-sale',cart:[{id:'rice',qty:1,price:10}],products:book().products,members:[],activeMember:null,pointsRule:{earn:10,redeem:1},birthdayBonus:0,openShift:book().shifts[0],payMethod:'cash',paid:10,opts:{cashier:owner.username},now:new Date()});ok(await commitBrowserSale(plan.order,owner))
 const effect=state().projection.business.find(row=>row.id==='browser-sale').effects[0];expect(effect.segments[0].sourceId).toBe(b.id);expect(effect.cost.knownValueCents).toBe(202)
 vi.setSystemTime(new Date('2026-10-18T16:01:00.000Z'));await getBrowserLotState(owner);ok(await commitBrowserRefund({id:'browser-refund',refundOf:'browser-sale',items:[{id:'rice',qty:1}],time:new Date().toISOString(),reason:'Original package',cashier:owner.username,shiftId:'shift'},owner));expect(book().products[0].stock).toBe(3);expect(state().valuation.categories.quarantined.knownValueCents).toBe(606);expect(state().valuation.ownedKnownValueCents).toBe(909)
 const held=(await getBrowserLotState(owner)).lots.find(row=>row.code==='soon');await apply('dispose',{lotId:held.id,locationId:'main',quantityUnits:1000,reason:'Discarded expired package'},staff);expect(state().valuation.ownedKnownValueCents).toBe(707);expect(state().projection.journals.at(-1).lines[0].debitCents).toBe(202)
})
it('forged identities, public system-expiry actions, stale scope and direct marker changes cannot alter the record',async()=>{
 await labels();const input=await command('correct',{lotId:state().projection.lots.items[0].id,code:'later',expiryDate:'2026-10-20',receivedAt:null,reason:'Package checked'}),before=record()
 for(const actor of [null,{...owner,username:'forged'},staff])expect((await commitBrowserLot(input,actor)).success).toBe(false)
 for(const change of [{storeId:'other'},{epoch:'other'},{expectedStateDigest:'sha256:'+'0'.repeat(64)}])expect((await commitBrowserLot({...input,...change},owner)).success).toBe(false)
 expect((await commitBrowserLot(await command('expire',{day:'2026-10-17'}),owner)).success).toBe(false);expect(()=>writeRecords({pos_business_settings:record().data.pos_business_settings.filter(row=>row.key!=='stockLotVersionFence')},record().revision)).toThrow();expect(record()).toEqual(before)
 vi.setSystemTime(new Date('2026-10-18T16:01:00.000Z'));await expect(getBrowserLotState({...owner,username:'forged'})).rejects.toThrow();expect(record()).toEqual(before)
})
it('native six-state packet converts losslessly and preserves mandatory feature and marker checks',()=>{
 seed(fixture.packet);expect(state().projection.custody.version).toBe(2);expect(state().valuation.categories.quarantined.knownValueCents).toBe(404);expect(state().valuation.ownedKnownValueCents).toBe(707)
 const data=book();data.settings=data.settings.filter(row=>row.key!=='stockLotVersionFence');expect(()=>validateStockCostBook(data)).toThrow();expect(canonicalSignature(state().projection.lots)).toBe(canonicalSignature(validateStockCostBook(fixture.packet.book).projection.lots))
})
