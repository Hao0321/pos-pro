import {test,expect} from 'vitest'
import fixture from '../fixtures/table-kitchen-v1.json'
import {planRestaurant,validateRestaurantRecords} from '../../electron/restaurantRules.mjs'
import {makeCustomerIntake,customerOrderView} from '../../electron/tableOrdering.mjs'
const time='2026-10-16T10:00:00Z',owner=fixture.owner
function harness(){
 const source=structuredClone(fixture.beforeAccept.orders.find(row=>row.id===fixture.response.orderId))
 source.items[0].qty=2;source.total=160;source.subtotal=160
 let data={storeId:'store',epoch:'epoch',costMode:'reference',date:'2026-10-16',now:Date.parse(time),products:structuredClone(fixture.beforeAccept.products),entries:[],operations:[],orders:[source],waste:[],cashLogs:[],shifts:[{id:'shift',status:'open'}],settings:{},config:{...fixture.config,fundsEnabled:true}},ordinal=0
 function call(action,fields={}){
  const request={id:'table-funds-'+(++ordinal),kind:'restaurant',action,time,storeId:data.storeId,epoch:data.epoch,...(action==='create'?{}:{entryId:data.entries[0].id,expectedVersion:data.entries[0].version}),...fields},plan=planRestaurant(request,data,owner,{})
  data={...plan.next,operations:[...data.operations,plan.receipt]};return plan
 }
 call('create',makeCustomerIntake(source,new Date(time)))
 return {call,source,get data(){return data},view:()=>customerOrderView(source,data.entries),validate:()=>validateRestaurantRecords(data.entries,data.operations,data.orders,data.products,{cashLogs:data.cashLogs,waste:data.waste,storeId:data.storeId})}
}
test('selected cancellation keeps the signed table original unchanged while showing the current contract and actual money',()=>{
 const h=harness(),source=JSON.stringify(h.source)
 h.call('funds-receive',{amount:50,paid:50,payMethod:'cash',shiftId:'shift'});h.call('cancel-part',{quantities:[{id:'ready',qty:1}],reason:'one fewer'})
 expect(()=>h.validate()).not.toThrow();expect(JSON.stringify(h.source)).toBe(source)
 expect(h.view()).toMatchObject({total:160,currentTotal:80,amountReceived:50,amountDue:30,amountRefunded:0,paymentReceived:false,status:'accepted'})
 h.call('funds-receive',{amount:30,paid:30,payMethod:'card',shiftId:'shift'})
 expect(h.view()).toMatchObject({currentTotal:80,amountReceived:80,amountDue:0,paymentReceived:true,status:'accepted'})
 expect(h.data.orders.filter(row=>row.source==='restaurant-funded')).toEqual([])
})
test('full cancellation after preparation preserves table identity, original items and the complete source chain',()=>{
 const h=harness();h.call('funds-receive',{amount:160,paid:160,payMethod:'cash',shiftId:'shift'});h.call('advance',{status:'cooking'});h.call('cancel',{reason:'all prepared',shiftId:'shift'})
 expect(()=>h.validate()).not.toThrow();expect(h.data.entries[0].items).toEqual([]);expect(h.source.items[0].qty).toBe(2)
 expect(h.view()).toMatchObject({status:'rejected',currentTotal:0,amountReceived:0,amountDue:0,amountRefunded:160,paymentReceived:false})
 expect(h.view().tableNum).toBe(h.source.tableNum)
})
