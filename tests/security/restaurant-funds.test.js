import {test,expect} from 'vitest'
import {initializeRestaurantFunds,planRestaurantFundsEvent,summarizeRestaurantFunds,RESTAURANT_FUNDS_PROTOCOL} from '../../electron/restaurantFunds.mjs'

const owner={userId:'owner',username:'Owner',role:'owner'},staff={userId:'staff',username:'Staff',role:'staff'}
function fixture(){
  const entry={id:'booking',items:[{id:'bowl',name:'Bowl',price:95,qty:2,cost:4},{id:'premium',name:'Premium',price:120,qty:1,cost:5}],quantity:3,total:310,allocations:[{id:'rice',name:'Rice',unitCost:10,qty:.4},{id:'box',name:'Box',unitCost:3,qty:3}]}
  const perItem=[{itemId:'bowl',rows:[{id:'rice',name:'Rice',unitCost:10,qty:.1},{id:'box',name:'Box',unitCost:3,qty:1}]},{itemId:'premium',rows:[{id:'rice',name:'Rice',unitCost:10,qty:.2},{id:'box',name:'Box',unitCost:3,qty:1}]}]
  return {entry,perItem,funds:initializeRestaurantFunds(entry,perItem)}
}
function harness(seed=fixture().funds){
  let funds=seed,version=1,ordinal=0
  return {
    get funds(){return funds},get summary(){return summarizeRestaurantFunds(funds)},
    call(action,fields={},ctx={}){
      const context={entryId:'booking',version:version+1,date:'2026-10-17',prepared:false,actor:owner,...ctx}
      const input={id:'event-'+(++ordinal),kind:'restaurant',action,entryId:'booking',time:'2026-10-17T01:00:00+08:00',expectedVersion:version,...fields}
      const next=planRestaurantFundsEvent(funds,input,context);funds=next.funds;version=context.version;return next
    },
  }
}
const cash=(amount,paid=amount,shiftId='s')=>({amount,paid,payMethod:'cash',shiftId})
const card=(amount,shiftId='s')=>({amount,paid:amount,payMethod:'card',shiftId})
test('frozen original retains each portion recipe after external catalogue and source objects change',()=>{
  const {entry,perItem,funds}=fixture(),before=structuredClone(funds)
  entry.items[0].price=999;perItem[0].rows[0].qty=99
  expect(funds).toEqual(before)
  expect(summarizeRestaurantFunds(funds)).toMatchObject({totalCents:31000,retainedCents:0,dueCents:31000,quantity:3,allocations:[{id:'rice',qty:.4},{id:'box',qty:3}]})
})
test('deposit and mixed remaining payments preserve actual original tender, change and cross-day shifts',()=>{
  const h=harness();expect(h.call('funds-receive',cash(100,150,'day-one'),{date:'2026-10-16'}).event.changeCents).toBe(5000)
  h.call('funds-receive',card(150,'day-two'));h.call('funds-receive',cash(60,100,'day-two'))
  expect(h.summary).toMatchObject({receivedCents:31000,retainedCents:31000,dueCents:0,fulfilled:false})
  expect(h.funds.events.map(event=>[event.date,event.input.shiftId,event.amountCents])).toEqual([['2026-10-16','day-one',10000],['2026-10-17','day-two',15000],['2026-10-17','day-two',6000]])
  const fulfilled=h.call('advance',{status:'completed'},{prepared:true})
  expect(fulfilled.event).toMatchObject({amountCents:0,fulfilment:{totalCents:31000}})
  expect(h.summary.fulfilled).toBe(true)
  expect(()=>h.call('advance',{status:'completed'},{prepared:true})).toThrow()
  expect(()=>h.call('funds-receive',cash(1))).toThrow()
})
test('partial unpaid cancellation releases only the selected frozen portion resources',()=>{
  const h=harness(),result=h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'one less'},{actor:staff})
  expect(result.event).toMatchObject({amountCents:0,cancelledValueCents:9500,prepared:false,allocations:[{id:'rice',qty:.1},{id:'box',qty:1}],refunds:[]})
  expect(h.summary).toMatchObject({originalTotalCents:31000,totalCents:21500,dueCents:21500,quantity:2,allocations:[{id:'rice',qty:.3},{id:'box',qty:2}]})
})
test('partial cancellation retains a deposit covered by the remaining meals and calculates the new tail',()=>{
  const h=harness();h.call('funds-receive',cash(100))
  const result=h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'one less'})
  expect(result.event.refunds).toEqual([]);expect(h.summary).toMatchObject({totalCents:21500,retainedCents:10000,dueCents:11500})
})
test('partial to full cancellation refunds only overpayment, newest original first, without crossing source limits',()=>{
  const h=harness(),first=h.call('funds-receive',cash(100)).event.id,second=h.call('funds-receive',card(200)).event.id
  const one=h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'one less',shiftId:'refund-shift'})
  expect(one.event.refunds).toEqual([{paymentId:second,method:'card',amountCents:8500}])
  const two=h.call('cancel-part',{quantities:[{id:'premium',qty:1}],reason:'one more',shiftId:'refund-shift'})
  expect(two.event.refunds).toEqual([{paymentId:second,method:'card',amountCents:11500},{paymentId:first,method:'cash',amountCents:500}])
  const all=h.call('cancel',{reason:'all remaining',shiftId:'refund-shift'})
  expect(all.event.refunds).toEqual([{paymentId:first,method:'cash',amountCents:9500}])
  expect(h.summary).toMatchObject({totalCents:0,quantity:0,retainedCents:0,refundedCents:30000,dueCents:0,items:[],allocations:[]})
  expect(h.funds.items).toHaveLength(2)
})
test('full cancellation of a partly paid booking refunds actual receipts rather than the meal total',()=>{
  const h=harness();h.call('funds-receive',cash(50))
  expect(h.call('cancel',{reason:'cancel',shiftId:'s'}).event.amountCents).toBe(5000)
  expect(h.summary.refundedCents).toBe(5000)
})
test('manual pre-fulfilment refund retains the reservation and creates the correct new remaining balance',()=>{
  const h=harness();h.call('funds-receive',cash(100));h.call('funds-receive',card(150))
  const result=h.call('funds-refund',{amount:80,reason:'record actual return',shiftId:'today'})
  expect(result.event.refunds).toEqual([{paymentId:'event-2',method:'card',amountCents:8000}])
  expect(h.summary).toMatchObject({quantity:3,totalCents:31000,retainedCents:17000,dueCents:14000})
  expect(h.summary.allocations).toHaveLength(2)
})
test('cancellation after fulfilment preserves the original recognition and refunds only selected servings',()=>{
  const h=harness();h.call('funds-receive',cash(310,350));h.call('advance',{status:'completed'},{prepared:true})
  const cancelled=h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'prepared serving returned',shiftId:'today'},{prepared:true})
  expect(cancelled.event).toMatchObject({amountCents:9500,cancelledValueCents:9500,prepared:true})
  expect(h.summary).toMatchObject({fulfilled:true,totalCents:21500,retainedCents:21500,dueCents:0,fulfilment:{totalCents:31000,items:[{id:'bowl',qty:2},{id:'premium',qty:1}]}})
  expect(()=>h.call('funds-refund',{amount:1,reason:'without cancelling items',shiftId:'today'})).toThrow()
})
test.each([0,-1,.5,3,NaN])('invalid or excessive cancelled count %s never mutates the original ledger',qty=>{
  const h=harness(),before=structuredClone(h.funds)
  expect(()=>h.call('cancel-part',{quantities:[{id:'bowl',qty}],reason:'invalid'})).toThrow()
  expect(h.funds).toEqual(before)
})
test('duplicate and unknown item cancellation cannot be silently merged',()=>{
  const h=harness()
  for(const quantities of [[{id:'unknown',qty:1}],[{id:'bowl',qty:1},{id:'bowl',qty:1}],[]])expect(()=>h.call('cancel-part',{quantities,reason:'invalid'})).toThrow()
})
test.each([undefined,null,'',0,-1,.001,310.01,NaN])('missing, invalid or overpaid receipt amount %s is rejected',amount=>{
  const h=harness();expect(()=>h.call('funds-receive',cash(amount))).toThrow();expect(h.summary.retainedCents).toBe(0)
})
test('card value, insufficient cash, missing shift and forged input authority fail before any event',()=>{
  const h=harness()
  for(const input of [{...cash(100),paid:99},{...card(100),paid:150},{...cash(100),shiftId:''},{...cash(100),actor:owner},{...cash(100),total:1}])expect(()=>h.call('funds-receive',input)).toThrow()
  expect(h.funds.events).toEqual([])
})
test('staff may receive deposits but cannot refund or cancel a paid original',()=>{
  const h=harness();h.call('funds-receive',cash(100),{actor:staff})
  expect(()=>h.call('funds-refund',{amount:10,reason:'return',shiftId:'s'},{actor:staff})).toThrow(/老闆/)
  expect(()=>h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'less'},{actor:staff})).toThrow(/老闆/)
})
test('fulfilment requires a complete payment and prepared state; zero price needs no fictitious payment',()=>{
  const h=harness();expect(()=>h.call('advance',{status:'completed'},{prepared:true})).toThrow(/尾款/)
  h.call('funds-receive',cash(310));expect(()=>h.call('advance',{status:'completed'})).toThrow(/備餐/)
  const f=fixture();f.entry.items.forEach(item=>item.price=0);f.entry.total=0
  const free=harness(initializeRestaurantFunds(f.entry,f.perItem))
  expect(()=>free.call('funds-receive',cash(.01))).toThrow()
  const result=free.call('advance',{status:'completed'},{prepared:true})
  expect(result.summary).toMatchObject({totalCents:0,receivedCents:0,retainedCents:0,fulfilled:true})
})
test('every persisted event is reconstructed; changed totals, source, identity, authority and duplicate IDs fail',()=>{
  const h=harness();h.call('funds-receive',cash(100));h.call('cancel',{reason:'all',shiftId:'s'})
  const mutations=[
    f=>f.events[0].amountCents++,
    f=>f.events[1].refunds[0].paymentId='someone-else',
    f=>f.events[1].refunds[0].amountCents++,
    f=>f.events[1].actor.role='staff',
    f=>f.events[0].version++,
    f=>f.entryId='other-booking',
    f=>f.events[0].extra='unknown',
    f=>f.events.push(structuredClone(f.events[0])),
  ]
  for(const mutate of mutations){const copy=structuredClone(h.funds);mutate(copy);expect(()=>summarizeRestaurantFunds(copy)).toThrow()}
})
test('source rows and original allocations must agree exactly, including fractional ingredient quantities',()=>{
  for(const mutate of [f=>f.entry.allocations[0].qty=.401,f=>f.entry.total=311,f=>f.perItem[1].rows[0].unitCost=11,f=>f.perItem[1].rows.push({...f.perItem[1].rows[0]})]){
    const f=fixture();mutate(f);expect(()=>initializeRestaurantFunds(f.entry,f.perItem)).toThrow()
  }
})
test('large valid receipts can be refunded and collected again without capping lifetime gross at the contract amount',()=>{
  const f=fixture();f.entry.items=[{id:'bowl',name:'Large',price:1000000000,qty:1,cost:4}];f.entry.quantity=1;f.entry.total=1000000000;f.entry.allocations=[{id:'rice',name:'Rice',unitCost:10,qty:.1},{id:'box',name:'Box',unitCost:3,qty:1}];f.perItem=f.perItem.slice(0,1)
  const h=harness(initializeRestaurantFunds(f.entry,f.perItem))
  h.call('funds-receive',cash(1000000000));h.call('funds-refund',{amount:1000000000,reason:'return',shiftId:'s'});h.call('funds-receive',cash(1000000000))
  expect(h.summary).toMatchObject({receivedCents:200000000000,refundedCents:100000000000,retainedCents:100000000000,dueCents:0})
})
test('fractional sale prices keep their exact remaining cent through repeated one-piece cancellations',()=>{
  const f=fixture();f.entry.items=[{id:'bowl',name:'Small',price:.01,qty:3,cost:4}];f.entry.quantity=3;f.entry.total=.03;f.entry.allocations=[{id:'rice',name:'Rice',unitCost:10,qty:.3},{id:'box',name:'Box',unitCost:3,qty:3}];f.perItem=f.perItem.slice(0,1)
  const h=harness(initializeRestaurantFunds(f.entry,f.perItem));h.call('funds-receive',cash(.03))
  for(const expected of [2,1,0]){h.call('cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'one',shiftId:'s'});expect(h.summary.totalCents).toBe(expected);expect(h.summary.retainedCents).toBe(expected)}
  expect(h.summary.refundedCents).toBe(3)
  expect(h.funds.protocol).toBe(RESTAURANT_FUNDS_PROTOCOL)
})
