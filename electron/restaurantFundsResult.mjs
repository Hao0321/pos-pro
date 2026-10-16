import {canonicalSignature} from './operationRules.mjs'
import {RESTAURANT_FUNDS_PROTOCOL,summarizeRestaurantFunds} from './restaurantFunds.mjs'
import {restaurantFundsCashLog,expectedRestaurantFundedPostings,sameRestaurantFundedOrder} from './restaurantFundedPlan.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const invalid=()=>Error('預訂款項回覆尚未確認，請保留原編號核對。')
export const needsRestaurantFundsResult=(request,result)=>request.fundsProtocol!==undefined||['funds-receive','funds-refund','cancel-part'].includes(request.action)||result?.receipt?.fundsProtocol!==undefined||result?.entry?.funds!==undefined
export function assertRestaurantFundsResult(request,result){
 try{
  const {receipt,entry}=result||{},version=request.action==='create'?1:request.expectedVersion+1
  if(result?.success!==true||receipt?.fundsProtocol!==RESTAURANT_FUNDS_PROTOCOL||receipt.id!==request.id||receipt.kind!=='restaurant'||receipt.action!==request.action||receipt.signature!==canonicalSignature(request)||receipt.entityId!==(request.action==='create'?request.id:request.entryId)||receipt.entityVersion!==version||entry?.id!==receipt.entityId||!Number.isSafeInteger(entry.version)||entry.version<version||entry.funds?.entryId!==entry.id||typeof receipt.actor?.userId!=='string'||!receipt.actor.userId||typeof receipt.actor.username!=='string'||!['owner','staff'].includes(receipt.actor.role))throw invalid()
  const summary=summarizeRestaurantFunds(entry.funds)
  if(!same(result.funding,summary)||entry.total!==summary.totalCents/100||entry.quantity!==summary.quantity||!same(entry.items,summary.items)||!same(entry.allocations,summary.allocations))throw invalid()
  const productIds=[...new Set([...entry.funds.items.map(row=>row.id),...entry.funds.itemAllocations.flatMap(row=>row.rows.map(row=>row.id))])]
  if(!Array.isArray(receipt.productIds)||!Array.isArray(result.products)||receipt.productIds.length!==productIds.length||new Set(receipt.productIds).size!==productIds.length||productIds.some(id=>!receipt.productIds.includes(id)||result.products.filter(product=>product.id===id).length!==1)||result.products.length!==productIds.length)throw invalid()
  const event=entry.funds.events.find(row=>row.id===request.id)||null,requiresEvent=request.action!=='create'&&(request.action!=='advance'||request.status==='completed')
  if(requiresEvent!==!!event||!same(result.fundsEvent??null,event)||(receipt.eventSignature??null)!==(event?canonicalSignature(event):null)||event&&(!same(event.input,request)||event.version!==version||!same(event.actor,receipt.actor)))throw invalid()
  if(request.action==='create'){
   if(entry.createdAt!==request.time||!same(request.items.map(row=>({id:row.id,price:row.price,qty:row.qty})),entry.funds.items.map(row=>({id:row.id,price:row.price,qty:row.qty})))||receipt.fundsInitialSignature!==canonicalSignature({entryId:entry.id,items:entry.funds.items,itemAllocations:entry.funds.itemAllocations}))throw invalid()
   for(const key of ['day','slot','channel'])if(entry[key]!==request[key])throw invalid()
   for(const key of ['customer','contact','note'])if(entry[key]!==request[key].trim())throw invalid()
  }
  const cash=event?restaurantFundsCashLog(event):null
  if((receipt.cashLogId??null)!==(cash?.id??null)||!same(result.cashLog??null,cash))throw invalid()
  const postings=expectedRestaurantFundedPostings(entry),posting=postings.find(row=>row.eventId===request.id),order=posting?.order||null
  if((receipt.orderId??null)!==(order?.id??null)||(order?!sameRestaurantFundedOrder(order,result.order):result.order!=null)||!same(result.refund??null,order?.refundOf?result.order:null))throw invalid()
  if(order?.refundOf){const original=postings.find(row=>row.order.id===order.refundOf)?.order;if(!original||!sameRestaurantFundedOrder(original,result.original))throw invalid()}
  else if(result.original!=null)throw invalid()
  const historical={...entry,funds:{...entry.funds,events:entry.funds.events.filter(row=>row.version<=version)}},previous=expectedRestaurantFundedPostings(historical)
  if((receipt.saleId||'')!==(previous.find(row=>!row.order.refundOf)?.order.id||'')||(receipt.refundId||'')!==(previous.filter(row=>row.order.refundOf).at(-1)?.order.id||''))throw invalid()
  if(request.fundsProtocol!==undefined&&request.fundsProtocol!==RESTAURANT_FUNDS_PROTOCOL)throw invalid()
  if(request.costMode==='active'){
   const cost=result.costReceipt
   if(cost?.protocol!=='pos-stock-cost/v1'||cost.success!==true||cost.sourceMethod!=='applyRestaurantOperation'||cost.id!==request.id||!Number.isSafeInteger(cost.sequence)||cost.sequence<1||typeof cost.eventId!=='string'||!cost.eventId||['eventHash','stateDigest'].some(key=>!/^sha256:[a-f0-9]{64}$/.test(cost[key])))throw invalid()
  }
  return result
 }catch{throw invalid()}
}
