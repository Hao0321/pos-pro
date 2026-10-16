import {canonicalSignature,moneyValue} from './operationRules.mjs'
import {fundedRestaurantSnapshot} from './restaurantFundedRecords.mjs'
import {RESTAURANT_FUNDS_PROTOCOL} from './restaurantFunds.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const invalid=()=>Error('廚房列印紀錄需要核對，請保留原單')
const items=entry=>entry.items.map(({id,name,qty})=>({id,name,qty}))
export function fundedKitchenTicketDetails(entry,kind,source,operations){
 if(source?.fundsProtocol!==RESTAURANT_FUNDS_PROTOCOL||source.entityId!==entry.id||source.kind!=='restaurant'||!['create','cancel-part',...(kind==='cancel'?['cancel']:[])].includes(source.action))throw invalid()
 const snapshot=fundedRestaurantSnapshot(entry,operations,source.entityVersion)
 if(kind==='prepare'){
  if(!snapshot.quantity)throw invalid()
  return {items:items(snapshot),total:snapshot.total,cancelReason:''}
 }
 const event=snapshot.funds.events.find(row=>row.id===source.id)
 if(!event||!['cancel','cancel-part'].includes(event.input.action)||!event.cancelledItems.length)throw invalid()
 return {items:event.cancelledItems.map(row=>({id:row.id,name:entry.funds.items.find(item=>item.id===row.id).name,qty:row.qty})),total:event.cancelledValueCents/100,cancelReason:event.input.reason.trim()}
}
export function isCurrentKitchenPreparation(job,entry){return !!job&&job.kind==='prepare'&&same(job.ticket.items,items(entry))&&job.ticket.total===entry.total}
export function kitchenPreparationReview(entry){return {protocol:'pos-kitchen-preparation-review/v1',entryId:entry.id,entryVersion:entry.version,items:items(entry),total:entry.total}}
export function validateKitchenPreparationReview(review){
 if(!review||Object.keys(review).sort().join(',')!=='entryId,entryVersion,items,protocol,total'||review.protocol!=='pos-kitchen-preparation-review/v1'||typeof review.entryId!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(review.entryId)||!Number.isSafeInteger(review.entryVersion)||review.entryVersion<1||!Array.isArray(review.items)||!review.items.length||review.items.length>100)throw invalid()
 const seen=new Set()
 for(const item of review.items){if(!item||Object.keys(item).sort().join(',')!=='id,name,qty'||typeof item.id!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(item.id)||typeof item.name!=='string'||!item.name||item.name.length>500||!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>1000000||seen.has(item.id))throw invalid();seen.add(item.id)}
 moneyValue(review.total,'訂單金額');return review
}
export function assertKitchenPreparationReview(review,entry){
 validateKitchenPreparationReview(review)
 if(!same(review,kitchenPreparationReview(entry)))throw Error('工作單已更新，請重新核對目前餐點。')
}
