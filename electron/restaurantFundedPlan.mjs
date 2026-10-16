import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex} from '@noble/hashes/utils.js'
import {canonicalSignature,moneyValue,operationHeader,quantityValue} from './operationRules.mjs'
import {initializeRestaurantFunds,planRestaurantFundsEvent,summarizeRestaurantFunds,RESTAURANT_FUNDS_PROTOCOL} from './restaurantFunds.mjs'
import {signature as checkoutSignature} from './checkoutSignature.mjs'

export const FUNDED_RESTAURANT_SOURCE='restaurant-funded'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const cents=value=>Math.round(moneyValue(value,'金額')*100)
const units=value=>Math.round(quantityValue(value,'原料數量')*1000)
const hashId=(kind,id)=>'rf-'+kind+'-'+bytesToHex(sha256(new TextEncoder().encode(id))).slice(0,40)
const copyActor=actor=>{
  if(!actor||!['owner','staff'].includes(actor.role)||typeof actor.userId!=='string'||!actor.userId||typeof actor.username!=='string')throw Error('權限不足')
  return {userId:actor.userId,username:actor.username,role:actor.role}
}
export function assertRestaurantFundsScope(request,data){
  operationHeader(request)
  if(request.kind!=='restaurant')throw Error('預訂操作類型不正確')
  if(request.fundsProtocol!==undefined&&request.fundsProtocol!==RESTAURANT_FUNDS_PROTOCOL)throw Error('預訂款項版本需要核對。')
  if(request.costMode!==undefined&&request.costMode!==data.costMode)throw Error('庫存成本設定已變更，請保留輸入重新核對。')
  if(!data.storeId||request.storeId!==data.storeId)throw Object.assign(Error('這張預訂屬於另一間店，請回原店面核對。'),{historyUncertain:true})
  if(!data.epoch||request.epoch!==data.epoch)throw Object.assign(Error('資料已還原或更換，請先核對原預訂，不要重新收款。'),{historyUncertain:true})
  if(!Number.isFinite(data.now)||Math.abs(data.now-Date.parse(request.time))>300000)throw Error('操作時間已過久，請重新核對預訂。')
}
export function initializeFundedRestaurant(plan,request,data,actor){
  assertRestaurantFundsScope(request,data);copyActor(actor)
  const perItem=plan.entry.items.map(item=>({
    itemId:item.id,
    rows:(data.config.recipes[item.id]||[{id:item.id,qty:1}]).map(row=>{
      const product=data.products.find(product=>product.id===row.id)
      if(!product)throw Error('預留原料已不存在，請重新核對。')
      return {id:row.id,name:product.name,qty:row.qty,unitCost:product.cost}
    }),
  }))
  plan.entry.funds=initializeRestaurantFunds(plan.entry,perItem)
  plan.receipt.fundsProtocol=RESTAURANT_FUNDS_PROTOCOL
  plan.receipt.fundsInitialSignature=canonicalSignature({entryId:plan.entry.id,items:plan.entry.funds.items,itemAllocations:plan.entry.funds.itemAllocations})
  return plan
}
function payments(rows,sign=1){
  const totals=new Map()
  for(const row of rows){const amount=row.availableCents??row.amountCents;totals.set(row.method,(totals.get(row.method)||0)+amount)}
  const result=['cash','card'].filter(method=>totals.get(method)>0).map(method=>({method,amount:sign*totals.get(method)/100}))
  return result.length?result:[{method:'cash',amount:0}]
}
function recognition(event,entry,saleId=null){
  const refund=!!saleId,items=refund?event.cancelledItems.map(row=>({...entry.funds.items.find(item=>item.id===row.id),qty:-row.qty})):event.fulfilment.items
  const total=(refund?-event.cancelledValueCents:event.fulfilment.totalCents)/100
  const tenders=payments(refund?event.refunds:event.fulfilment.tenders,refund?-1:1)
  if(Math.round(tenders.reduce((sum,row)=>sum+row.amount,0)*100)!==Math.round(total*100))throw Error('預訂交付與原收款來源不符。')
  const payMethod=tenders.length>1?'mixed':tenders[0].method
  return {
    id:hashId(refund?'return':'sale',event.id),time:event.time,
    source:FUNDED_RESTAURANT_SOURCE,status:'completed',items:items.map(({cost,...item})=>item),
    subtotal:total,total,discount:0,manualDiscount:0,balanceUsed:0,pointsUsed:0,pointsEarned:0,
    paid:total,change:0,payMethod,payments:tenders,memberId:'',taxId:'',cashier:event.actor.username,shiftId:'',
    itemCosts:Object.fromEntries(items.map(item=>[item.id,item.cost])),
    ...(refund?{refundOf:saleId,fullRefund:event.remainingQuantity===0}:{}),
  }
}
export function restaurantFundsCashLog(event){
  const receiving=event.input.action==='funds-receive'
  const amount=receiving?(event.input.payMethod==='cash'?event.amountCents:0):event.refunds.filter(row=>row.method==='cash').reduce((sum,row)=>sum+row.amountCents,0)
  if(!amount)return null
  return {id:hashId('cash',event.id),shiftId:event.input.shiftId,time:event.time,type:receiving?'in':'out',amount:amount/100,reason:(receiving?'預訂實收款 · ':'預訂退回款 · ')+event.entryId,cashier:event.actor.username}
}
export function restaurantFundsWaste(event){
  if(!event.prepared||!['cancel','cancel-part'].includes(event.input.action))return []
  return event.allocations.map((row,index)=>({id:hashId('waste-'+index,event.id),productId:row.id,productName:row.name,qty:row.qty,cost:row.unitCost,reason:'預訂部分取消：'+event.input.reason.trim(),time:event.time,cashier:event.actor.username}))
}
export function planFundedRestaurant(request,data,actor){
  assertRestaurantFundsScope(request,data)
  const who=copyActor(actor)
  const next={...data,products:data.products.map(row=>({...row})),entries:data.entries.map(row=>structuredClone(row)),orders:[...data.orders],waste:[...data.waste],cashLogs:[...data.cashLogs]}
  const entry=next.entries.find(row=>row.id===request.entryId)
  if(!entry?.funds)throw Error('這張舊式預訂請沿用原收款與取消流程。')
  if(entry.version!==request.expectedVersion)throw Error('預訂已由其他裝置更新，請保留輸入並重新核對。')
  if(entry.status==='cancelled')throw Error('這張預訂已全部取消。')
  let event=null,order=null,original=null,cashLog=null,waste=[]
  if(request.action==='advance'&&request.status!=='completed'){
    if(Object.keys(request).some(key=>!['id','time','kind','action','entryId','expectedVersion','storeId','epoch','fundsProtocol','costMode','status'].includes(key)))throw Error('預訂款項操作不正確。')
    const allowed={reserved:'cooking',cooking:'ready',ready:entry.channel==='delivery'?'dispatched':'completed',dispatched:'completed'}
    if(allowed[entry.status]!==request.status)throw Error('出餐狀態轉換不正確')
    if(request.status==='cooking')entry.startedAt=request.time
    entry.status=request.status
  }else{
    if(request.action==='advance'&&!((entry.status==='ready'&&entry.channel!=='delivery')||entry.status==='dispatched'))throw Error('請先完成備餐或配送，再交給客人。')
    const result=planRestaurantFundsEvent(entry.funds,request,{entryId:entry.id,version:entry.version+1,date:data.date,prepared:!!entry.startedAt,actor:who})
    event=result.event
    const s=result.summary
    if(event.amountCents&&!data.shifts.some(shift=>shift.id===request.shiftId&&shift.status==='open'))throw Error('請先開班，將實收或退款記入目前班別。')
    entry.funds=result.funds;entry.items=s.items;entry.allocations=s.allocations;entry.quantity=s.quantity;entry.total=s.totalCents/100
    if(['cancel','cancel-part'].includes(request.action)){
      if(entry.startedAt)waste=restaurantFundsWaste(event)
      else for(const row of event.allocations){
        const product=next.products.find(product=>product.id===row.id)
        if(!product)throw Error('預留原料已不存在，請重新核對。')
        product.stock=quantityValue((units(product.stock)+units(row.qty))/1000,'回補庫存')
      }
      if(s.fulfilled){
        const saved=next.orders.find(row=>row.id===entry.saleId)
        if(!saved||saved.source!==FUNDED_RESTAURANT_SOURCE)throw Error('找不到原交付紀錄，請保留原單核對。')
        order=recognition(event,entry,entry.saleId);entry.refundId=order.id
        original={...saved,status:s.quantity?'completed':'refunded'}
        next.orders=next.orders.map(row=>row.id===saved.id?original:row)
      }
      entry.status=s.quantity?entry.status:'cancelled';entry.cancelReason=request.reason.trim()
    }else if(request.action==='advance'){
      order=recognition(event,entry);entry.saleId=order.id;entry.status='completed'
    }
    cashLog=restaurantFundsCashLog(event)
    if(cashLog)next.cashLogs.unshift(cashLog)
  }
  entry.version++
  if(order){
    if(next.orders.some(row=>row.id===order.id))throw Error('預訂交付或退款編號已存在。')
    next.orders.unshift(order)
  }
  next.waste.unshift(...waste)
  const productIds=[...new Set([...entry.funds.items.map(row=>row.id),...entry.funds.itemAllocations.flatMap(row=>row.rows.map(row=>row.id))])]
  const receipt={id:request.id,kind:'restaurant',action:request.action,signature:canonicalSignature(request),entityId:entry.id,entityVersion:entry.version,productIds,saleId:entry.saleId||'',refundId:entry.refundId||'',time:request.time,actor:who,fundsProtocol:RESTAURANT_FUNDS_PROTOCOL,eventSignature:event?canonicalSignature(event):null,orderId:order?.id||null,cashLogId:cashLog?.id||null}
  return {next,entry,event,order,original,waste,cashLog,config:data.config,receipt}
}
export function fundedRestaurantReceipt(request,receipt,data){
  if(receipt.signature!==canonicalSignature(request)||receipt.id!==request.id)throw Object.assign(Error('原操作編號已存在且內容不同，請核對原預訂。'),{operationConflict:true})
  const entry=data.entries.find(row=>row.id===receipt.entityId)
  if(!entry?.funds||entry.version<receipt.entityVersion)throw Error('預訂回覆缺少原工作單或保存版本。')
  const event=entry.funds.events.find(row=>row.id===request.id)||null
  if((event?canonicalSignature(event):null)!==(receipt.eventSignature??null))throw Error('預訂回覆缺少原收付事件。')
  const products=receipt.productIds.map(id=>data.products.find(row=>row.id===id))
  if(products.some(row=>!row)||new Set(receipt.productIds).size!==products.length)throw Error('預訂回覆缺少原料結果。')
  const order=receipt.orderId?data.orders.find(row=>row.id===receipt.orderId):null
  const cashLog=receipt.cashLogId?data.cashLogs.find(row=>row.id===receipt.cashLogId):null
  if(receipt.orderId&&!order||receipt.cashLogId&&!cashLog||cashLog&&!same(cashLog,restaurantFundsCashLog(event)))throw Error('預訂回覆缺少原交付或現金流水。')
  const original=order?.refundOf?data.orders.find(row=>row.id===order.refundOf):null
  if(order?.refundOf&&!original)throw Error('預訂回覆缺少原交付紀錄。')
  return {success:true,receipt,entry,products,config:data.config,fundsEvent:event,cashLog,order,original,refund:order?.refundOf?order:null,funding:summarizeRestaurantFunds(entry.funds)}
}
export function expectedRestaurantFundedPostings(entry){
  const current=summarizeRestaurantFunds(entry.funds),fulfilled=entry.funds.events.find(event=>event.fulfilment)
  if(!fulfilled)return []
  const sale=recognition(fulfilled,entry)
  sale.status=current.quantity?'completed':'refunded'
  return [{eventId:fulfilled.id,date:fulfilled.date,order:sale},...entry.funds.events.filter(event=>event.version>fulfilled.version&&['cancel','cancel-part'].includes(event.input.action)).map(event=>({eventId:event.id,date:event.date,order:recognition(event,entry,sale.id)}))]
}
export const expectedRestaurantFundedOrders=entry=>expectedRestaurantFundedPostings(entry).map(row=>row.order)
export function sameRestaurantFundedOrder(expected,actual){
  try{
    if(!actual||actual.change_amount!==undefined&&actual.change_amount!==(actual.change??actual.change_amount))return false
    const identity=row=>({signature:checkoutSignature(row),source:row.source,status:row.status,refundOf:row.refundOf||'',fullRefund:!!row.fullRefund,itemCosts:row.itemCosts,tableNum:row.tableNum||'',note:row.note||'',trackingTokenHash:row.trackingTokenHash||'',requestSignature:row.requestSignature||'',tableId:row.tableId||'',tableSignature:row.tableSignature||'',trackingProof:row.trackingProof??null})
    return same(identity(expected),identity(actual))
  }catch{return false}
}
