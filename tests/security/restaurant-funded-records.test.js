import {test,expect} from 'vitest'
import {planRestaurant} from '../../electron/restaurantRules.mjs'
import {planFundedRestaurant,expectedRestaurantFundedOrders} from '../../electron/restaurantFundedPlan.mjs'
import {validateFundedRestaurantRecords} from '../../electron/restaurantFundedRecords.mjs'
import {restaurantFundedOrderToJournalEntries} from '../../electron/restaurantFundsJournal.mjs'
const owner={userId:'owner',username:'Owner',role:'owner'},time='2026-10-17T01:00:00+08:00'
function fixture(){
 let ordinal=0,data={storeId:'store',epoch:'epoch',date:'2026-10-17',now:Date.parse(time),products:[{id:'bowl',name:'Bowl',price:95,cost:4,stock:0},{id:'premium',name:'Premium',price:120,cost:5,stock:0},{id:'rice',name:'Rice',price:10,cost:10,stock:1},{id:'box',name:'Box',price:3,cost:3,stock:10}],entries:[],operations:[],orders:[],waste:[],cashLogs:[],shifts:[{id:'shift',status:'open'}],settings:{},config:{enabled:true,fundsEnabled:true,dailyCapacity:10,slotCapacity:5,recipes:{bowl:[{id:'rice',qty:.1},{id:'box',qty:1}],premium:[{id:'rice',qty:.2},{id:'box',qty:1}]}}}
 const create={id:'booking',kind:'restaurant',action:'create',time,storeId:'store',epoch:'epoch',day:'2026-10-17',slot:'12:00',channel:'walkin',customer:' Guest ',contact:'',note:'',items:[{id:'bowl',qty:2,price:95},{id:'premium',qty:1,price:120}]}
 const initial=planRestaurant(create,data,owner,{})
 data={...initial.next,operations:[initial.receipt]}
 return {
  get data(){return data},
  call(action,fields={}){
   const input={id:'event-'+(++ordinal),kind:'restaurant',action,time,storeId:'store',epoch:'epoch',entryId:'booking',expectedVersion:data.entries[0].version,...fields}
   const plan=planFundedRestaurant(input,data,owner);data={...plan.next,operations:[...data.operations,plan.receipt]};return plan
  },
 }
}
function validate(data){return validateFundedRestaurantRecords(data.entries,data.operations,data.orders,data.products,{cashLogs:data.cashLogs,waste:data.waste,storeId:data.storeId})}
function paid(){const h=fixture();h.call('funds-receive',{amount:100,paid:100,payMethod:'cash',shiftId:'shift'});h.call('funds-receive',{amount:210,paid:210,payMethod:'card',shiftId:'shift'});return h}
function done(){const h=paid();h.call('advance',{status:'cooking'});h.call('advance',{status:'ready'});h.call('advance',{status:'completed'});return h}
test('every source version, collection and fulfilment is independently cross-checked',()=>{
 const h=fixture();expect(()=>validate(h.data)).not.toThrow()
 h.call('funds-receive',{amount:100,paid:100,payMethod:'cash',shiftId:'shift'});expect(()=>validate(h.data)).not.toThrow()
 h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'less'});expect(()=>validate(h.data)).not.toThrow()
 h.call('funds-receive',{amount:115,paid:115,payMethod:'card',shiftId:'shift'});expect(()=>validate(h.data)).not.toThrow()
 h.call('advance',{status:'cooking'});h.call('advance',{status:'ready'});h.call('advance',{status:'completed'});expect(()=>validate(h.data)).not.toThrow()
 h.call('cancel-part',{quantities:[{id:'premium',qty:1}],reason:'prepared',shiftId:'shift'});expect(()=>validate(h.data)).not.toThrow()
 h.call('cancel',{reason:'rest',shiftId:'shift'});expect(()=>validate(h.data)).not.toThrow()
 expect(h.data.orders).toEqual(expect.arrayContaining(expectedRestaurantFundedOrders(h.data.entries[0])))
})
test('loss of a source operation, event, cash row, product or recognition blocks the book',()=>{
 for(const mutate of [
  b=>b.operations.splice(1,1),
  b=>b.entries[0].funds.events.splice(0,1),
  b=>b.cashLogs.splice(0,1),
  b=>b.products.splice(0,1),
  b=>b.orders.splice(0,1),
  b=>b.entries[0].version++,
  b=>b.operations[1].entityVersion++,
 ]){
  const b=structuredClone(done().data);mutate(b);expect(()=>validate(b)).toThrow()
 }
})
test('a prepared cancellation requires every actual loss source and no false stock return',()=>{
 const h=done();h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'prepared',shiftId:'shift'})
 expect(()=>validate(h.data)).not.toThrow()
 const missing=structuredClone(h.data);missing.waste.pop();expect(()=>validate(missing)).toThrow()
 const changed=structuredClone(h.data);changed.waste[0].qty++;expect(()=>validate(changed)).toThrow()
})
test('changed original recipes, prices, versions, actors and pointer metadata cannot hide behind valid totals',()=>{
 for(const mutate of [
  b=>b.entries[0].funds.itemAllocations[0].rows[0].unitCost++,
  b=>b.entries[0].items[0].price++,
  b=>b.entries[0].startedAt='2026-10-18T00:00:00Z',
  b=>b.operations[1].actor.userId='forged',
  b=>b.operations[1].eventSignature='{}',
  b=>b.operations[1].productIds=[],
  b=>b.cashLogs[0].amount++,
  b=>b.orders[0].total++,
 ]){
  const b=structuredClone(done().data);mutate(b);expect(()=>validate(b)).toThrow()
 }
})
test('orphan funded orders, cash and loss rows are rejected rather than imported as unexplained money',()=>{
 const h=done()
 for(const mutate of [
  b=>b.orders.push({...b.orders[0],id:'orphan'}),
  b=>b.cashLogs.push({...b.cashLogs[0],id:'rf-cash-'+'0'.repeat(40)}),
  b=>b.waste.push({id:'rf-waste-0-'+'0'.repeat(40)}),
  b=>{delete b.entries[0].funds},
 ]){
  const b=structuredClone(h.data);mutate(b);expect(()=>validate(b)).toThrow()
 }
})
test('native SQLite default aliases compare by complete financial identity, including contradictory change aliases',()=>{
 const h=done(),source=h.data.orders[0]
 const native={...source,memberId:null,change_amount:0,tableNum:'',note:'',refundOf:'',fullRefund:false,trackingTokenHash:'',requestSignature:''}
 const b=structuredClone(h.data);b.orders[0]=native
 expect(()=>validate(b)).not.toThrow()
 expect(()=>restaurantFundedOrderToJournalEntries(native,b.entries[0])).not.toThrow()
 for(const override of [{change_amount:1},{refundOf:'another-sale'},{note:'foreign'},{source:'pos'},{shiftId:'shift'},{itemCosts:{bowl:0,premium:0}}])expect(()=>restaurantFundedOrderToJournalEntries({...native,...override},b.entries[0])).toThrow()
})
test('ordinary legacy books without funded data need no new collections or reinterpretation',()=>{
 expect(()=>validateFundedRestaurantRecords([],[],[],[],{})).not.toThrow()
})
