import {ordinaryRestaurantOperations} from './reservationBarrier.mjs'
import {canonicalSignature,operationHeader} from './operationRules.mjs'
import {summarizeRestaurantFunds,RESTAURANT_FUNDS_PROTOCOL} from './restaurantFunds.mjs'
import {expectedRestaurantFundedPostings,restaurantFundsCashLog,restaurantFundsWaste,sameRestaurantFundedOrder,FUNDED_RESTAURANT_SOURCE} from './restaurantFundedPlan.mjs'
import {validateRestaurantMenuBook,fundedRestaurantProductIds,assertMenuCreateResult} from './restaurantMenuOriginal.mjs'
import {assertPrivateDraftOperation} from './privateDrafts.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const invalid=()=>Error('預訂款項、交付或原料來源不完整，請保留原單核對。')
const states=['reserved','cooking','ready','dispatched','completed','cancelled']
function one(rows,id){const found=rows.filter(row=>row.id===id);if(found.length!==1)throw invalid();return found[0]}
function request(receipt){
  let input;try{input=JSON.parse(receipt.signature)}catch{throw invalid()}
  operationHeader(input)
  if(receipt.kind!=='restaurant'||input.kind!=='restaurant'||receipt.id!==input.id||receipt.action!==input.action||receipt.time!==input.time||canonicalSignature(input)!==receipt.signature)throw invalid()
  assertPrivateDraftOperation(input,{receiptActor:receipt.actor})
  return input
}
// A cost receipt is a historical snapshot. Later partial cancellations must not
// rewrite it, nor make it look corrupt merely because today's amounts changed.
export function fundedRestaurantSnapshot(entry,operations,version){
 if(!entry?.funds||!Number.isSafeInteger(version)||version<1||version>entry.version)throw invalid()
 const history=operations.filter(row=>row.entityId===entry.id&&row.entityVersion<=version).sort((a,b)=>a.entityVersion-b.entityVersion)
 if(history.length!==version||history.some((row,index)=>row.entityVersion!==index+1))throw invalid()
 const funds={...structuredClone(entry.funds),events:entry.funds.events.filter(event=>event.version<=version).map(event=>structuredClone(event))},summary=summarizeRestaurantFunds(funds)
 const snapshot={...structuredClone(entry),version,funds,items:summary.items,allocations:summary.allocations,quantity:summary.quantity,total:summary.totalCents/100,status:'reserved',startedAt:'',saleId:'',refundId:''}
 delete snapshot.cancelReason
 for(const receipt of history.slice(1)){
  const input=request(receipt)
  if(input.action==='advance'){snapshot.status=input.status;if(input.status==='cooking')snapshot.startedAt=input.time}
  if(['cancel','cancel-part'].includes(input.action)){
   const event=funds.events.find(row=>row.id===input.id);if(!event)throw invalid()
   if(!event.remainingQuantity)snapshot.status='cancelled'
   snapshot.cancelReason=input.reason.trim()
  }
 }
 const postings=expectedRestaurantFundedPostings(snapshot)
 snapshot.saleId=postings.find(row=>!row.order.refundOf)?.order.id||''
 snapshot.refundId=postings.filter(row=>row.order.refundOf).at(-1)?.order.id||''
 return snapshot
}
export function validateFundedRestaurantRecords(entries,operations,orders,products,{cashLogs,waste,storeId,config,menuConfigurationId,menuReceiptKey}={}){
  operations=ordinaryRestaurantOperations(operations)
  validateRestaurantMenuBook(config,entries,operations,menuConfigurationId,orders,menuReceiptKey)
  const modern=entries.filter(entry=>Object.hasOwn(entry,'funds')),sources=orders.filter(order=>order.source===FUNDED_RESTAURANT_SOURCE)
  if(!modern.length){if(sources.length)throw invalid();return}
  if(!Array.isArray(cashLogs)||!Array.isArray(waste))throw invalid()
  const referencedOrders=new Set(),referencedCash=new Set(),referencedWaste=new Set(),entryIds=new Set()
  for(const entry of modern){
    operationHeader({id:entry.id,time:entry.createdAt})
    if(entryIds.has(entry.id)||!states.includes(entry.status)||!['preorder','walkin','delivery'].includes(entry.channel)||!Number.isSafeInteger(entry.version)||entry.version<1)throw invalid()
    if(typeof entry.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(entry.day)||!Number.isFinite(Date.parse(entry.day+'T00:00:00Z'))||new Date(entry.day+'T00:00:00Z').toISOString().slice(0,10)!==entry.day||!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(entry.slot))throw invalid()
    if(entry.channel!=='walkin'&&!entry.contact||entry.channel==='delivery'&&!entry.note)throw invalid()
    entryIds.add(entry.id)
    if(entry.funds.entryId!==entry.id)throw invalid()
    const summary=summarizeRestaurantFunds(entry.funds)
    if(!same(entry.items,summary.items)||!same(entry.allocations,summary.allocations)||entry.total!==summary.totalCents/100||entry.quantity!==summary.quantity)throw invalid()
    const productIds=new Set(fundedRestaurantProductIds(entry))
    if([...productIds].some(id=>products.filter(product=>product.id===id).length!==1))throw invalid()
    const history=operations.filter(row=>row.entityId===entry.id).sort((a,b)=>a.entityVersion-b.entityVersion)
    if(history.length!==entry.version||history.some((row,index)=>row.entityVersion!==index+1||row.fundsProtocol!==RESTAURANT_FUNDS_PROTOCOL))throw invalid()
    if(new Set(history.map(row=>row.id)).size!==history.length||history.some(row=>!row.actor?.userId||typeof row.actor.username!=='string'||!['owner','staff'].includes(row.actor.role)||!Array.isArray(row.productIds)||row.productIds.length!==productIds.size||new Set(row.productIds).size!==row.productIds.length||row.productIds.some(id=>!productIds.has(id))))throw invalid()
    const initial=history[0],created=request(initial),facts={entryId:entry.id,items:entry.funds.items,itemAllocations:entry.funds.itemAllocations}
    if(created.action!=='create'||created.id!==entry.id||created.time!==entry.createdAt||initial.fundsInitialSignature!==canonicalSignature(facts)||!entry.menu&&!same(created.items.map(row=>({id:row.id,price:row.price,qty:row.qty})),entry.funds.items.map(row=>({id:row.id,price:row.price,qty:row.qty}))))throw invalid()
    assertMenuCreateResult(created,entry,initial)
    if(!created.storeId||created.storeId!==storeId||!created.epoch||initial.eventSignature||initial.orderId||initial.cashLogId)throw invalid()
    for(const key of ['day','slot','channel'])if(created[key]!==entry[key])throw invalid()
    for(const key of ['customer','contact','note'])if(typeof created[key]!=='string'||created[key].trim()!==entry[key])throw invalid()
    const events=new Map(entry.funds.events.map(event=>[event.id,event]))
    let status='reserved',startedAt='',lastReason=''
    for(const receipt of history.slice(1)){
      const input=request(receipt),event=events.get(receipt.id)||null
      if(input.entryId!==entry.id||input.expectedVersion!==receipt.entityVersion-1||input.storeId!==created.storeId||!input.epoch||status==='cancelled')throw invalid()
      if(input.action==='advance'){
        const allowed={reserved:'cooking',cooking:'ready',ready:entry.channel==='delivery'?'dispatched':'completed',dispatched:'completed'}
        if(allowed[status]!==input.status)throw invalid()
        if(input.status==='cooking')startedAt=input.time
        status=input.status
      }else if(['cancel','cancel-part'].includes(input.action)){
        if(!event)throw invalid()
        status=event.remainingQuantity?status:'cancelled';lastReason=input.reason.trim()
      }else if(!['funds-receive','funds-refund'].includes(input.action))throw invalid()
      const requiresEvent=input.action!=='advance'||input.status==='completed'
      if(requiresEvent!==!!event||(receipt.eventSignature??null)!==(event?canonicalSignature(event):null))throw invalid()
      if(event){
        if(event.version!==receipt.entityVersion||event.entryId!==entry.id||!same(event.input,input)||!same(event.actor,receipt.actor)||event.prepared!==!!startedAt)throw invalid()
        const cash=restaurantFundsCashLog(event)
        if((receipt.cashLogId??null)!==(cash?.id??null))throw invalid()
        if(cash){if(!same(one(cashLogs,cash.id),cash)||referencedCash.has(cash.id))throw invalid();referencedCash.add(cash.id)}
        for(const loss of restaurantFundsWaste(event)){if(!same(one(waste,loss.id),loss)||referencedWaste.has(loss.id))throw invalid();referencedWaste.add(loss.id)}
      }else if(receipt.cashLogId||receipt.orderId)throw invalid()
    }
    if(events.size!==history.slice(1).filter(row=>row.eventSignature).length||entry.status!==status||entry.startedAt!==startedAt||(entry.cancelReason||'')!==lastReason)throw invalid()
    const postings=expectedRestaurantFundedPostings(entry),sale=postings.find(row=>!row.order.refundOf)?.order,refunds=postings.filter(row=>row.order.refundOf)
    if((entry.saleId||'')!==(sale?.id||'')||(entry.refundId||'')!==(refunds.at(-1)?.order.id||''))throw invalid()
    for(const posting of postings){
      const receipt=one(history,posting.eventId)
      if(receipt.orderId!==posting.order.id||!sameRestaurantFundedOrder(posting.order,one(orders,posting.order.id))||referencedOrders.has(posting.order.id))throw invalid()
      referencedOrders.add(posting.order.id)
    }
    for(const receipt of history)if(receipt.orderId&&!postings.some(row=>row.order.id===receipt.orderId))throw invalid()
  }
  if(sources.some(order=>!referencedOrders.has(order.id)))throw invalid()
  if(cashLogs.some(row=>/^rf-cash-[a-f0-9]{40}$/.test(row.id)&&!referencedCash.has(row.id)))throw invalid()
  if(waste.some(row=>/^rf-waste-\d+-[a-f0-9]{40}$/.test(row.id)&&!referencedWaste.has(row.id)))throw invalid()
}
