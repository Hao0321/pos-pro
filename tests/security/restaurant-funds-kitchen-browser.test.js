// @vitest-environment jsdom
import {test,expect,beforeEach,afterEach,vi} from 'vitest'
import reference from '../fixtures/kitchen-print-native-v1.json'
import active from '../fixtures/kitchen-print-cost-native-v1.json'
import {readPortableBackup,createCompleteBackup} from '../../electron/backupEnvelope.mjs'
import {readRecords,restoreRecords,RECORD_KEY} from '../../src/utils/browserStorage'
import {browserProtectionGraph} from '../../src/utils/browserProtection'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {commitBrowserRestaurant,browserRestaurantState} from '../../src/utils/browserRestaurant'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
let values,refuse,throwAfter,ordinal
const ok=result=>{expect(result.success,result.error).toBe(true);return result},book=()=>browserToBook(readRecords().data)
beforeEach(()=>{values=new Map();refuse=false;throwAfter=false;ordinal=0;vi.stubGlobal('localStorage',{getItem:key=>values.get(key)??null,removeItem:key=>values.delete(key),setItem:(key,value)=>{if(key===RECORD_KEY&&refuse)throw Error('fixture quota before commit');values.set(key,String(value));if(key===RECORD_KEY&&throwAfter){throwAfter=false;throw Error('fixture lost reply after commit')}}});vi.stubGlobal('navigator',{locks:{request:async(_name,fn)=>fn()}})})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
async function seed(source,productId){
 const incoming=readPortableBackup(source.packet,'browser');restoreRecords(incoming.book,0,null,incoming)
 const actor=source.owner,initial=book(),product=initial.products.find(row=>row.id===productId),shift=initial.shifts.find(row=>row.status==='open')
 expect(product&&shift).toBeTruthy()
 function command(action,fields={}){const state=browserRestaurantState(),entry=state.entries.find(row=>row.id==='browser-funded-kitchen');return {id:action==='create'?'browser-funded-kitchen':'browser-kitchen-'+(++ordinal),kind:'restaurant',action,time:new Date().toISOString(),storeId:state.storeId,epoch:state.epoch,fundsProtocol:'pos-restaurant-funds/v1',costMode:state.costMode,...(action==='configure'||action==='create'?{}:{entryId:entry.id,expectedVersion:entry.version}),...fields}}
 const config=browserRestaurantState().config
 ok(await commitBrowserRestaurant(command('configure',{expectedConfig:canonicalSignature(config),config:{...config,fundsEnabled:true}}),actor))
 ok(await commitBrowserRestaurant(command('create',{day:browserRestaurantState().today,slot:'12:00',channel:'walkin',customer:'Browser guest',contact:'',note:'',items:[{id:productId,qty:2,price:product.price}]}),actor))
 return {actor,product,shift,initial,command,apply:async(action,fields={})=>ok(await commitBrowserRestaurant(command(action,fields),actor)),jobs:()=>book().kitchenPrintJobs.filter(row=>row.entryId==='browser-funded-kitchen')}
}
test.each([['reference',reference,'ready'],['active',active,'bowl']])('standalone %s-cost selected and full cancellation preserve funds, source costs, historical tickets and a complete format6 packet',async(_name,source,id)=>{
 const f=await seed(source,id),original=structuredClone(f.jobs()[0])
 await f.apply('funds-receive',{amount:50,paid:100,payMethod:'cash',shiftId:f.shift.id})
 const request=f.command('cancel-part',{quantities:[{id,qty:1}],reason:'one fewer'}),result=ok(await commitBrowserRestaurant(request,f.actor))
 expect(f.jobs().find(row=>row.id===original.id)).toMatchObject({state:'voided',ticket:original.ticket})
 expect(f.jobs().find(row=>row.state==='queued').ticket).toMatchObject({items:[{id,name:f.product.name,qty:1}],total:f.product.price})
 const raw=values.get(RECORD_KEY);expect((await commitBrowserRestaurant(request,f.actor)).receipt).toEqual(result.receipt);expect(values.get(RECORD_KEY)).toBe(raw)
 await f.apply('cancel',{reason:'rest',shiftId:f.shift.id});expect(f.jobs().every(row=>row.state==='voided')).toBe(true);expect(f.jobs().some(row=>row.kind==='cancel')).toBe(false)
 expect(book().products).toEqual(f.initial.products);const saved=readRecords();expect(saved.recovery.version).toBe(6)
 const packet=createCompleteBackup(saved.data,browserProtectionGraph(saved),'browser'),converted=readPortableBackup(packet,'sqlite').book
 expect(converted.kitchenPrintJobs).toEqual(book().kitchenPrintJobs);expect(converted.restaurantOrders).toEqual(book().restaurantOrders);expect(converted.stockCostEntries).toEqual(book().stockCostEntries)
 if(_name==='active'){expect(result.costReceipt).toBeTruthy();expect(()=>validateStockCostBook(book())).not.toThrow()}
},60000)
test('atomic browser quota failure preserves all three books; a postwrite lost reply recovers the same cancellation once',async()=>{
 const f=await seed(active,'bowl'),request=f.command('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'atomic source'}),before=values.get(RECORD_KEY)
 refuse=true;expect(await commitBrowserRestaurant(request,f.actor)).toMatchObject({success:false,committed:false});expect(values.get(RECORD_KEY)).toBe(before)
 refuse=false;throwAfter=true;const saved=ok(await commitBrowserRestaurant(request,f.actor)),raw=values.get(RECORD_KEY)
 expect(saved.costReceipt).toBeTruthy();expect(saved.fundsEvent.cancelledItems).toEqual([{id:'bowl',qty:1}]);expect(f.jobs().filter(row=>row.state==='queued')).toHaveLength(1)
 expect((await commitBrowserRestaurant(request,f.actor)).receipt).toEqual(saved.receipt);expect(values.get(RECORD_KEY)).toBe(raw)
},60000)
