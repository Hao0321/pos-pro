import {test,expect} from 'vitest'
import {initializeRestaurantFunds,summarizeRestaurantFunds} from '../../electron/restaurantFunds.mjs'
import {planFundedRestaurant,fundedRestaurantReceipt,expectedRestaurantFundedOrders,FUNDED_RESTAURANT_SOURCE} from '../../electron/restaurantFundedPlan.mjs'
import {restaurantFundsToJournalEntries,restaurantFundedOrderToJournalEntries} from '../../electron/restaurantFundsJournal.mjs'
const owner={userId:'owner',username:'Owner',role:'owner'}
function fixture(){
  const entry={id:'booking',version:1,channel:'walkin',day:'2026-10-17',slot:'12:00',customer:'Guest',contact:'',note:'',status:'reserved',startedAt:'',saleId:'',refundId:'',createdAt:'2026-10-17T01:00:00+08:00',items:[{id:'bowl',name:'Bowl',price:95,qty:2,cost:4},{id:'premium',name:'Premium',price:120,qty:1,cost:5}],quantity:3,total:310,allocations:[{id:'rice',name:'Rice',unitCost:10,qty:.4},{id:'box',name:'Box',unitCost:3,qty:3}]}
  entry.funds=initializeRestaurantFunds(entry,[{itemId:'bowl',rows:[{id:'rice',name:'Rice',unitCost:10,qty:.1},{id:'box',name:'Box',unitCost:3,qty:1}]},{itemId:'premium',rows:[{id:'rice',name:'Rice',unitCost:10,qty:.2},{id:'box',name:'Box',unitCost:3,qty:1}]}])
  return {storeId:'store-a',epoch:'epoch-one',now:Date.parse(entry.createdAt),date:'2026-10-17',products:[{id:'bowl',name:'Bowl',stock:0,price:95,cost:4},{id:'premium',name:'Premium',stock:0,price:120,cost:5},{id:'rice',name:'Rice',stock:.6,price:10,cost:10},{id:'box',name:'Box',stock:7,price:3,cost:3}],entries:[entry],operations:[],orders:[],waste:[],cashLogs:[],shifts:[{id:'shift-one',status:'open'},{id:'shift-two',status:'open'}],config:{enabled:true,fundsEnabled:true,recipes:{}}}
}
function harness(){
 let data=fixture(),ordinal=0
 return {
  get data(){return data},get entry(){return data.entries[0]},get balance(){return summarizeRestaurantFunds(data.entries[0].funds)},
  day(day){data={...data,date:day,now:Date.parse(day+'T12:00:00+08:00')}},
  call(action,fields={},who=owner){
   const input={id:'operation-'+(++ordinal),time:new Date(data.now).toISOString(),kind:'restaurant',action,entryId:'booking',expectedVersion:data.entries[0].version,storeId:data.storeId,epoch:data.epoch,...fields}
   const plan=planFundedRestaurant(input,data,who)
   data={...plan.next,operations:[...data.operations,plan.receipt]}
   return {plan,input}
  },
 }
}
const cash=(amount,shiftId='shift-one')=>({amount,paid:amount,payMethod:'cash',shiftId})
const bank=(amount,shiftId='shift-one')=>({amount,paid:amount,payMethod:'card',shiftId})
function fulfil(h){h.call('advance',{status:'cooking'});h.call('advance',{status:'ready'});return h.call('advance',{status:'completed'})}
const account=(journal,id)=>Math.round(journal.flatMap(row=>row.lines).filter(row=>row.account===id).reduce((sum,row)=>sum+row.debit-row.credit,0)*100)/100
function journals(h){return [...restaurantFundsToJournalEntries(h.data.entries),...h.data.orders.flatMap(order=>restaurantFundedOrderToJournalEntries(order,h.entry))]}
test('collections create cash or bank and contract liability, while fulfilment recognizes revenue once without new cash',()=>{
 const h=harness();h.call('funds-receive',cash(100));h.call('funds-receive',bank(210,'shift-two'))
 expect(h.data.orders).toEqual([]);expect(h.data.cashLogs).toHaveLength(1);expect(h.data.cashLogs[0]).toMatchObject({type:'in',amount:100,shiftId:'shift-one'})
 expect(account(journals(h),'1101')).toBe(100);expect(account(journals(h),'1103')).toBe(210);expect(account(journals(h),'2193')).toBe(-310);expect(account(journals(h),'4101')).toBe(0)
 h.day('2026-10-18');const completed=fulfil(h)
 expect(completed.plan.order).toMatchObject({source:FUNDED_RESTAURANT_SOURCE,total:310,shiftId:'',payMethod:'mixed',payments:[{method:'cash',amount:100},{method:'card',amount:210}]})
 const journal=journals(h);expect(account(journal,'1101')).toBe(100);expect(account(journal,'1103')).toBe(210);expect(account(journal,'2193')).toBe(0);expect(account(journal,'4101')).toBe(-310);expect(account(journal,'5101')).toBe(13)
 expect(journal.filter(row=>row.type==='auto_restaurant_funds').every(row=>row.date==='2026-10-17')).toBe(true)
 expect(journal.filter(row=>row.type==='auto_restaurant_sale').every(row=>row.date==='2026-10-18')).toBe(true)
 expect(h.data.cashLogs).toHaveLength(1)
})
test('unstarted selected cancellation returns only the chosen resources and keeps the original recipe evidence',()=>{
 const h=harness(),before=structuredClone(h.data),result=h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'one less'})
 expect(h.data.products.find(row=>row.id==='rice').stock).toBe(.7);expect(h.data.products.find(row=>row.id==='box').stock).toBe(8)
 expect(result.plan.entry).toMatchObject({quantity:2,total:215,status:'reserved'})
 expect(h.entry.funds.items).toEqual(before.entries[0].funds.items);expect(h.data.waste).toEqual([])
 expect(before.products.find(row=>row.id==='rice').stock).toBe(.6)
})
test('prepared selected cancellation records only the cancelled ingredient loss and keeps stock unavailable',()=>{
 const h=harness();h.call('advance',{status:'cooking'})
 const before=structuredClone(h.data.products);h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'prepared'})
 expect(h.data.products).toEqual(before);expect(h.data.waste).toHaveLength(2)
 expect(h.data.waste.map(row=>[row.productId,row.qty])).toEqual([['rice',.1],['box',1]])
 expect(h.entry).toMatchObject({quantity:2,total:215,status:'cooking'})
})
test('partial cancellation refunds only excess by original tender and drawer shift',()=>{
 const h=harness();h.call('funds-receive',cash(100));h.call('funds-receive',bank(200))
 h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'less',shiftId:'shift-two'})
 expect(h.data.cashLogs).toHaveLength(1)
 const result=h.call('cancel-part',{quantities:[{id:'premium',qty:1}],reason:'more',shiftId:'shift-two'})
 expect(result.plan.cashLog).toMatchObject({type:'out',amount:5,shiftId:'shift-two'})
 expect(h.balance).toMatchObject({totalCents:9500,retainedCents:9500,dueCents:0})
 expect(account(journals(h),'1101')).toBe(95);expect(account(journals(h),'1103')).toBe(0);expect(account(journals(h),'2193')).toBe(-95)
})
test('cancel after fulfilment keeps a separate dated revenue return and original tender evidence',()=>{
 const h=harness();h.call('funds-receive',cash(100));h.call('funds-receive',bank(210));h.day('2026-10-18');const sale=fulfil(h).plan.order
 h.day('2026-10-19');const result=h.call('cancel-part',{quantities:[{id:'premium',qty:1}],reason:'prepared return',shiftId:'shift-two'})
 expect(result.plan.order).toMatchObject({source:FUNDED_RESTAURANT_SOURCE,refundOf:sale.id,total:-120,payMethod:'card',payments:[{method:'card',amount:-120}],items:[{id:'premium',qty:-1}],fullRefund:false})
 expect(h.data.orders).toEqual(expect.arrayContaining(expectedRestaurantFundedOrders(h.entry)))
 const journal=journals(h);expect(account(journal,'1101')).toBe(100);expect(account(journal,'1103')).toBe(90);expect(account(journal,'2193')).toBe(0);expect(account(journal,'4101')).toBe(-190)
 expect(journal.filter(row=>row.orderId===result.plan.order.id).every(row=>row.date==='2026-10-19')).toBe(true)
 expect(h.data.waste).toHaveLength(2);expect(h.entry.status).toBe('completed')
})
test('full prepared cancellation preserves the original recognition and all refund originals',()=>{
 const h=harness();h.call('funds-receive',cash(310));const sale=fulfil(h).plan.order
 h.call('cancel-part',{quantities:[{id:'premium',qty:1}],reason:'first',shiftId:'shift-two'})
 const all=h.call('cancel',{reason:'all rest',shiftId:'shift-two'})
 expect(all.plan.original).toMatchObject({id:sale.id,status:'refunded'});expect(all.plan.order).toMatchObject({total:-190,fullRefund:true})
 expect(h.entry).toMatchObject({status:'cancelled',items:[],quantity:0,total:0,allocations:[]})
 expect(expectedRestaurantFundedOrders(h.entry)).toEqual(expect.arrayContaining(h.data.orders))
 expect(account(journals(h),'1101')).toBe(0);expect(account(journals(h),'2193')).toBe(0);expect(account(journals(h),'4101')).toBe(0)
})
test('late receipt lookup returns its original event and cash log after later collections and fulfilment',()=>{
 const h=harness(),first=h.call('funds-receive',cash(100))
 h.call('funds-receive',bank(210));fulfil(h)
 const result=fundedRestaurantReceipt(first.input,first.plan.receipt,h.data)
 expect(result.fundsEvent.id).toBe(first.input.id);expect(result.cashLog.amount).toBe(100);expect(result.funding.dueCents).toBe(0)
 expect(result.entry.version).toBeGreaterThan(first.plan.receipt.entityVersion);expect(result.order).toBeNull()
 expect(()=>fundedRestaurantReceipt({...first.input,amount:101},first.plan.receipt,h.data)).toThrow(/內容不同/)
})
test('missing original cash or recognition prevents a successful acknowledgement',()=>{
 const h=harness(),received=h.call('funds-receive',cash(310))
 expect(()=>fundedRestaurantReceipt(received.input,received.plan.receipt,{...h.data,cashLogs:[]})).toThrow(/流水/)
 const done=fulfil(h)
 expect(()=>fundedRestaurantReceipt(done.input,done.plan.receipt,{...h.data,orders:[]})).toThrow(/交付/)
})
test('wrong store, restore epoch, stale version or expired operation never changes the candidate book',()=>{
 for(const change of [{storeId:'another'},{epoch:'different'},{expectedVersion:0},{time:'2026-10-16T01:00:00Z'}]){
  const h=harness(),before=structuredClone(h.data)
  expect(()=>h.call('funds-receive',{...cash(10),...change})).toThrow();expect(h.data).toEqual(before)
 }
})
test('closed drawer, unsupported old entry and premature delivery are rejected without a partial plan',()=>{
 const h=harness(),before=structuredClone(h.data)
 expect(()=>h.call('funds-receive',cash(10,'closed'))).toThrow(/開班/)
 expect(()=>h.call('advance',{status:'completed'})).toThrow(/備餐/)
 const plain=fixture();delete plain.entries[0].funds
 expect(()=>planFundedRestaurant({id:'plain',kind:'restaurant',action:'funds-receive',entryId:'booking',expectedVersion:1,time:new Date(plain.now).toISOString(),storeId:plain.storeId,epoch:plain.epoch,...cash(10)},plain,owner)).toThrow(/舊式/)
 expect(h.data).toEqual(before)
})
test('recognition validation rejects forged original amounts and does not use current catalogue costs',()=>{
 const h=harness();h.call('funds-receive',cash(310));const order=fulfil(h).plan.order
 h.data.products.find(row=>row.id==='bowl').cost=999
 expect(account(restaurantFundedOrderToJournalEntries(order,h.entry),'5101')).toBe(13)
 expect(()=>restaurantFundedOrderToJournalEntries({...order,total:1},h.entry)).toThrow(/原單/)
})
test('an unrelated kind or hidden fields cannot advance the funded production state',()=>{
 for(const override of [{kind:'stocktake'},{actor:owner},{paid:1}]){
  const h=harness(),before=structuredClone(h.data)
  expect(()=>h.call('advance',{status:'cooking',...override})).toThrow()
  expect(h.data).toEqual(before)
 }
})
