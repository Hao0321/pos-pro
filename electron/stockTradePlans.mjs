import {stockLedgerError} from './stockOpeningPlan.mjs'

function referenceRate(context,order,productId){
 if(Object.hasOwn(order.itemCosts||{},productId)){const value=order.itemCosts[productId];if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw stockLedgerError('HISTORY');return value>0?Math.round(value*100):null}
 return context.previous.legacyCostReviews.find(row=>row.orderId===order.id&&row.productId===productId)?.referenceUnitCostCents||null
}
function legacyRefund(context,original,item,quantityUnits,returnedUnits,key,valueCents){
 const totalUnits=context.stockUnits(item.qty),value=valueCents===undefined?(referenceRate(context,original,item.id)===null?null:context.stockLineValue(totalUnits,referenceRate(context,original,item.id))):valueCents
 context.acquire(item.id,quantityUnits,context.stockLegacyInterval(totalUnits,value,returnedUnits,quantityUnits),'5101',value===null?'unknown-legacy-return':'legacy-reference-return',key)
}
export function planTradeStock(c,method){
 const {input,evidence,stockOwner:owner,stockUnits:units}=c
 if(method==='checkout'){
  const order=evidence.order
  if(!order||order.id!==input.id||order.source!=='pos'||order.refundOf)throw stockLedgerError('HISTORY')
  for(const item of order.items)c.move(owner('available'),owner('consumed','checkout',order.id),item.id,units(item.qty))
  c.replace('J'+order.id+'_cogs');return
 }
 if(method==='refundOrder'){
  const {order,original,previousRefunds}=evidence
  if(!order||!original||order.id!==input.id||order.refundOf!==original.id||input.refundOf!==original.id||!Array.isArray(previousRefunds))throw stockLedgerError('HISTORY')
  for(const item of order.items){
   const count=units(Math.abs(item.qty)),origin=owner('consumed','checkout',original.id)
   if(c.hasOrigin(origin,item.id))c.move(origin,owner('available'),item.id,count)
   else{
    // A post-cutover sale with missing consumption is never a legacy fallback.
    if(c.previous.business?.some(row=>row.method==='checkout'&&row.id===original.id))throw stockLedgerError('HISTORY')
    const sold=original.items.find(row=>row.id===item.id);if(!sold)throw stockLedgerError('HISTORY')
    const returned=previousRefunds.reduce((n,row)=>n+row.items.filter(line=>line.id===item.id).reduce((sum,line)=>sum+units(Math.abs(line.qty)),0),0)
    legacyRefund(c,original,sold,count,returned,item.id)
   }
  }
  c.replace('J'+order.id+'_cogs');return
 }
 const {action}=input,{event,document,originalDelivery,previousReturns}=evidence
 if(!['deliver','return'].includes(action))return
 if(!event||event.id!==input.id||!document)throw stockLedgerError('HISTORY')
 const origin=owner('consumed','delivery',action==='deliver'?event.id:event.deliveryId)
 document.items.forEach((item,index)=>{
  const count=units(event.quantities[index]);if(!count)return
  if(action==='deliver')c.move(owner('available'),origin,item.productId,count)
  else if(c.hasOrigin(origin,item.productId))c.move(origin,event.restock?owner('available'):owner('wasted','sales-return',event.id),item.productId,count)
  else{
   if(c.previous.business?.some(row=>row.method==='applySalesOperation'&&row.id===event.deliveryId)||!originalDelivery||!Array.isArray(previousReturns))throw stockLedgerError('HISTORY')
   const originalUnits=units(originalDelivery.quantities[index]),returned=previousReturns.reduce((sum,row)=>sum+units(row.quantities[index]),0)
   const originalValue=originalDelivery.unitCosts[index]>0?Math.round(originalDelivery.costAmounts[index]*100):null
   const cost=c.stockLegacyInterval(originalUnits,originalValue,returned,count)
   c.acquire(item.productId,count,cost,'5101',cost===null?'unknown-legacy-return':'legacy-delivery-reference-return',index,event.restock?owner('available'):owner('wasted','sales-return',event.id))
  }
 })
 c.replace('JS-'+event.id+(action==='deliver'?'-cost':'-cost-return'))
}
