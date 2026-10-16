import {canonicalSignature,moneyValue,operationHeader,quantityValue} from './operationRules.mjs'

export const RESTAURANT_FUNDS_PROTOCOL='pos-restaurant-funds/v1'
export const RESTAURANT_FUNDS_FEATURE='restaurant-funds-v1'
const MAX_CENTS=100000000000n,MAX_UNITS=1000000000000n,MAX_HISTORY_CENTS=20000n*MAX_CENTS
const fail=()=>Error('預訂款項或原始明細需要核對，請保留原單。')
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)
function only(value,keys){if(!record(value)||Object.keys(value).some(key=>!keys.includes(key)))throw fail()}
function identifier(value){if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(value))throw fail();return value}
function text(value,max){if(typeof value!=='string'||value.length>max)throw fail();return value}
function count(value){if(!Number.isSafeInteger(value)||value<1||value>100000)throw Error('取消或訂購份數須為有效正整數。');return value}
const cents=value=>BigInt(Math.round(moneyValue(value,'金額')*100))
const units=value=>BigInt(Math.round(quantityValue(value,'原料數量',.001)*1000))
function bounded(value,max=MAX_CENTS){if(value<0n||value>max)throw Error('預訂數量或金額超過支援範圍。');return Number(value)}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw fail();return value}
function actor(value){only(value,['userId','username','role']);identifier(value.userId);text(value.username,100);if(!['owner','staff'].includes(value.role))throw Error('權限不足');return structuredClone(value)}
function rows(items){
  if(!Array.isArray(items)||!items.length||items.length>100)throw fail()
  const ids=new Set()
  return items.map(item=>{
    only(item,['id','name','price','qty','cost']);identifier(item.id);text(item.name,500);count(item.qty);cents(item.price);cents(item.cost)
    if(ids.has(item.id))throw fail();ids.add(item.id);return structuredClone(item)
  })
}
function allocations(items,perItem,quantities){
  if(!Array.isArray(perItem)||perItem.length!==items.length)throw fail()
  const result=new Map()
  items.forEach((item,index)=>{
    const source=perItem[index];only(source,['itemId','rows'])
    if(source.itemId!==item.id||!Array.isArray(source.rows)||!source.rows.length||source.rows.length>100)throw fail()
    const seen=new Set()
    for(const row of source.rows){
      only(row,['id','name','qty','unitCost']);identifier(row.id);text(row.name,500);cents(row.unitCost)
      const each=units(row.qty),take=quantities.get(item.id)??0
      if(seen.has(row.id))throw fail();seen.add(row.id)
      const old=result.get(row.id)
      if(old&&(old.name!==row.name||old.unitCost!==row.unitCost))throw fail()
      const amount=each*BigInt(take)+(old?.amount??0n);bounded(amount,MAX_UNITS)
      if(take||old)result.set(row.id,{id:row.id,name:row.name,unitCost:row.unitCost,amount})
    }
  })
  return [...result.values()].filter(row=>row.amount>0n).map(({amount,...row})=>({...row,qty:bounded(amount,MAX_UNITS)/1000}))
}
function original(funds){
  only(funds,['protocol','entryId','items','itemAllocations','events'])
  identifier(funds.entryId)
  if(funds.protocol!==RESTAURANT_FUNDS_PROTOCOL||!Array.isArray(funds.events)||funds.events.length>20000)throw fail()
  const items=rows(funds.items),counts=new Map(items.map(item=>[item.id,item.qty]))
  bounded(items.reduce((sum,item)=>sum+cents(item.price)*BigInt(item.qty),0n))
  bounded(items.reduce((sum,item)=>sum+cents(item.cost)*BigInt(item.qty),0n))
  allocations(items,funds.itemAllocations,counts)
  return items
}
export function initializeRestaurantFunds(entry,itemAllocations){
  const items=rows(entry.items),funds={protocol:RESTAURANT_FUNDS_PROTOCOL,entryId:identifier(entry.id),items,itemAllocations:structuredClone(itemAllocations),events:[]}
  original(funds)
  const quantities=new Map(items.map(item=>[item.id,item.qty])),frozen=allocations(items,funds.itemAllocations,quantities)
  if(!same(frozen,entry.allocations)||cents(entry.total)!==items.reduce((sum,item)=>sum+cents(item.price)*BigInt(item.qty),0n)||entry.quantity!==items.reduce((sum,item)=>sum+item.qty,0))throw fail()
  return funds
}
function summary(funds,state,details=true){
  const items=funds.items.flatMap(item=>{const qty=item.qty-(state.cancelled.get(item.id)||0);return qty?[{...item,qty}]:[]})
  const total=items.reduce((sum,item)=>sum+cents(item.price)*BigInt(item.qty),0n)
  const retained=state.received-state.refunded
  if(retained<0n||retained>total||state.fulfilled&&retained!==total)throw fail()
  return {
    originalTotalCents:bounded(funds.items.reduce((sum,item)=>sum+cents(item.price)*BigInt(item.qty),0n)),
    totalCents:bounded(total),receivedCents:bounded(state.received,MAX_HISTORY_CENTS),refundedCents:bounded(state.refunded,MAX_HISTORY_CENTS),
    retainedCents:bounded(retained),dueCents:bounded(total-retained),
    quantity:items.reduce((sum,item)=>sum+item.qty,0),items,
    ...(details?{allocations:allocations(funds.items,funds.itemAllocations,new Map(items.map(item=>[item.id,item.qty])))}:{}),
    fulfilled:!!state.fulfilled,...(details?{fulfilment:state.fulfilled?structuredClone(state.fulfilled):null}:{}),
    ...(details?{payments:state.payments.map(row=>({id:row.id,method:row.method,receivedCents:bounded(row.amount),refundedCents:bounded(row.refunded),availableCents:bounded(row.amount-row.refunded)}))}:{}),
  }
}
function refundSources(state,amount){
  let remaining=amount
  const refunds=[]
  for(let index=state.payments.length-1;index>=0&&remaining>0n;index--){
    const payment=state.payments[index],available=payment.amount-payment.refunded,take=available<remaining?available:remaining
    if(!take)continue
    payment.refunded+=take;remaining-=take
    refunds.push({paymentId:payment.id,method:payment.method,amountCents:bounded(take)})
  }
  if(remaining)throw fail()
  state.refunded+=amount
  return refunds
}
function cancelledItems(funds,state,input){
  const remaining=funds.items.filter(item=>item.qty>(state.cancelled.get(item.id)||0)).map(item=>({id:item.id,qty:item.qty-(state.cancelled.get(item.id)||0)}))
  if(input.action==='cancel')return remaining
  if(!Array.isArray(input.quantities)||!input.quantities.length||input.quantities.length>funds.items.length)throw Error('請選擇要取消的品項和份數。')
  const seen=new Set()
  return input.quantities.map(row=>{
    only(row,['id','qty']);identifier(row.id);count(row.qty)
    const item=remaining.find(item=>item.id===row.id)
    if(seen.has(row.id)||!item||row.qty>item.qty)throw Error('取消份數超過原單剩餘數量。')
    seen.add(row.id);return {id:row.id,qty:row.qty}
  })
}
function apply(funds,state,input,context){
  operationHeader(input)
  const extra=input.action==='funds-receive'?['amount','paid','payMethod','shiftId','reference']:input.action==='funds-refund'?['amount','reason','shiftId']:input.action==='cancel-part'?['quantities','reason','shiftId']:input.action==='cancel'?['reason','shiftId']:input.action==='advance'?['status']:[]
  only(input,['id','time','kind','action','entryId','expectedVersion','storeId','epoch','fundsProtocol','costMode',...extra])
  if(input.fundsProtocol!==undefined&&input.fundsProtocol!==RESTAURANT_FUNDS_PROTOCOL||input.costMode!==undefined&&!['active','reference'].includes(input.costMode))throw fail()
  for(const key of ['storeId','epoch'])if(input[key]!==undefined)identifier(input[key])
  if(input.reference!==undefined)text(input.reference,120)
  if(input.kind!=='restaurant'||input.entryId!==funds.entryId||input.entryId!==context.entryId||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||context.version!==input.expectedVersion+1)throw fail()
  identifier(context.entryId);date(context.date);const who=actor(context.actor)
  if(typeof context.prepared!=='boolean'||state.ids.has(input.id)||context.version<=state.lastVersion)throw fail()
  const before=summary(funds,state,false)
  const event={id:input.id,entryId:context.entryId,version:context.version,time:input.time,date:context.date,actor:who,prepared:context.prepared,input:structuredClone(input),amountCents:0,changeCents:0,cancelledValueCents:0,cancelledItems:[],allocations:[],refunds:[],fulfilment:null}
  if(input.action==='funds-receive'){
    if(before.fulfilled||!before.quantity)throw Error('這張預訂已交付或取消，請勿再次收款。')
    const amount=cents(input.amount),paid=cents(input.paid)
    if(amount<=0n||amount>BigInt(before.dueCents))throw Error('這次收款須大於零，且不可超過尾款。')
    if(!['cash','card'].includes(input.payMethod)||input.payMethod==='cash'&&paid<amount||input.payMethod==='card'&&paid!==amount)throw Error('請核對這次實收金額與付款方式。')
    identifier(input.shiftId)
    event.amountCents=bounded(amount);event.changeCents=input.payMethod==='cash'?bounded(paid-amount):0
    state.received+=amount;state.payments.push({id:input.id,method:input.payMethod,amount,refunded:0n})
  }else if(input.action==='funds-refund'){
    if(who.role!=='owner')throw Error('只有老闆能登記預訂退款。')
    if(before.fulfilled)throw Error('已交付餐點請選擇取消份數，再核對退款。')
    const amount=cents(input.amount)
    if(amount<=0n||amount>BigInt(before.retainedCents))throw Error('退款不可超過尚未退回的實收款。')
    if(!text(input.reason,1000).trim())throw Error('請填寫取消或退款原因。')
    identifier(input.shiftId);event.amountCents=bounded(amount);event.refunds=refundSources(state,amount)
  }else if(['cancel','cancel-part'].includes(input.action)){
    if(!before.quantity)throw Error('這張預訂已全部取消。')
    if((before.retainedCents>0||before.fulfilled)&&who.role!=='owner')throw Error('已收款或已交付預訂，請由老闆核對取消。')
    if(!text(input.reason,1000).trim())throw Error('請填寫取消或退款原因。')
    const cancelled=cancelledItems(funds,state,input)
    if(!cancelled.length)throw Error('這張預訂已全部取消。')
    const value=cancelled.reduce((sum,row)=>sum+cents(funds.items.find(item=>item.id===row.id).price)*BigInt(row.qty),0n)
    const remaining=BigInt(before.totalCents)-value,overpaid=BigInt(before.retainedCents)>remaining?BigInt(before.retainedCents)-remaining:0n
    if(overpaid)identifier(input.shiftId)
    event.amountCents=bounded(overpaid);event.cancelledValueCents=bounded(value);event.cancelledItems=cancelled
    event.allocations=allocations(funds.items,funds.itemAllocations,new Map(cancelled.map(row=>[row.id,row.qty])))
    event.refunds=refundSources(state,overpaid)
    for(const row of cancelled)state.cancelled.set(row.id,(state.cancelled.get(row.id)||0)+row.qty)
  }else if(input.action==='advance'&&input.status==='completed'){
    if(before.fulfilled||!before.quantity||before.dueCents)throw Error('請先收齊尾款，再完成交付。')
    if(!context.prepared)throw Error('請先完成備餐，再交給客人。')
    const current=summary(funds,state),tenders=new Map()
    for(const payment of current.payments)tenders.set(payment.method,(tenders.get(payment.method)||0)+payment.availableCents)
    event.fulfilment={items:structuredClone(current.items),allocations:structuredClone(current.allocations),totalCents:current.totalCents,tenders:['cash','card'].filter(method=>tenders.get(method)>0).map(method=>({method,amountCents:tenders.get(method)}))}
    state.fulfilled={eventId:input.id,version:context.version,time:input.time,date:context.date,...structuredClone(event.fulfilment)}
  }else throw Error('預訂款項操作不正確。')
  state.ids.add(input.id);state.lastVersion=context.version
  const after=summary(funds,state,false)
  event.remainingQuantity=after.quantity;event.remainingTotalCents=after.totalCents
  return event
}
function replay(funds){
  original(funds)
  const state={ids:new Set(),lastVersion:1,cancelled:new Map(),payments:[],received:0n,refunded:0n,fulfilled:null}
  for(const event of funds.events){
    if(!record(event)||!record(event.input))throw fail()
    const expected=apply(funds,state,event.input,{entryId:event.entryId,version:event.version,date:event.date,prepared:event.prepared,actor:event.actor})
    if(!same(expected,event))throw fail()
  }
  return state
}
export function summarizeRestaurantFunds(funds){return summary(funds,replay(funds))}
export function restaurantCapacityQuantity(entry){
  if(!entry.funds)return entry.quantity
  const used=entry.quantity+entry.funds.events.filter(event=>event.prepared&&['cancel','cancel-part'].includes(event.input.action)).reduce((sum,event)=>sum+event.cancelledItems.reduce((count,row)=>count+row.qty,0),0)
  if(!Number.isSafeInteger(used)||used<0)throw fail()
  return used
}
export function planRestaurantFundsEvent(funds,input,context){
  const state=replay(funds),event=apply(funds,state,input,context)
  const next={...structuredClone(funds),events:[...structuredClone(funds.events),event]}
  return {funds:next,event,summary:summary(next,state)}
}
export function usesRestaurantFunds(config,entries=[],orders=[]){
  return config?.fundsEnabled===true||entries.some(entry=>Object.hasOwn(entry,'funds'))||orders.some(order=>order.source==='restaurant-funded')
}
