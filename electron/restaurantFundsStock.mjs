import {canonicalSignature} from './operationRules.mjs'
import {summarizeRestaurantFunds} from './restaurantFunds.mjs'
import {restaurantFundsWaste,expectedRestaurantFundedPostings} from './restaurantFundedPlan.mjs'
import {stockLedgerError} from './stockOpeningPlan.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
export function planFundedRestaurantStock(c){
 const {input,evidence,stockOwner:owner,stockUnits:units}=c,{beforeEntry:before,entry}=evidence
 if(!entry?.funds)throw stockLedgerError('HISTORY')
 summarizeRestaurantFunds(entry.funds)
 const held=owner('reserved','reservation',entry.id)
 const portions=items=>items.flatMap(item=>{
  const allocation=entry.funds.itemAllocations.find(row=>row.itemId===item.id)
  if(!allocation)throw stockLedgerError('HISTORY')
  return allocation.rows.map(raw=>{
   const quantity=BigInt(units(raw.qty))*BigInt(item.qty)
   if(quantity<=0n||quantity>BigInt(Number.MAX_SAFE_INTEGER))throw stockLedgerError('HISTORY')
   return {itemId:item.id,raw,quantityUnits:Number(quantity)}
  })
 })
 if(input.action==='create'){
  if(before||entry.version!==1||entry.id!==input.id||entry.funds.events.length)throw stockLedgerError('HISTORY')
  for(const raw of entry.allocations)c.move(owner('available'),held,raw.id,units(raw.qty))
  return
 }
 if(!before?.funds||entry.id!==before.id||entry.version!==before.version+1||input.expectedVersion!==before.version||input.entryId!==entry.id||!same(entry.funds.items,before.funds.items)||!same(entry.funds.itemAllocations,before.funds.itemAllocations)||!same(entry.funds.events.slice(0,before.funds.events.length),before.funds.events))throw stockLedgerError('HISTORY')
 summarizeRestaurantFunds(before.funds)
 const added=entry.funds.events.slice(before.funds.events.length),event=added[0]
 const monetary=input.action!=='advance'||input.status==='completed'
 if(added.length!==(monetary?1:0)||event&&(!same(event.input,input)||event.version!==entry.version))throw stockLedgerError('HISTORY')
 if(input.action==='funds-receive'||input.action==='funds-refund'||input.action==='funds-deposit-apply')return
 if(input.action==='advance'){
  if(input.status!=='completed')return
  if(before.saleId||!entry.saleId||!event.fulfilment)throw stockLedgerError('HISTORY')
  for(const portion of portions(event.fulfilment.items))c.move(held,owner('consumed','restaurant-funded-item',[entry.id,portion.itemId]),portion.raw.id,portion.quantityUnits)
  c.replace('J'+entry.saleId+'_cogs')
  c.note({kind:'restaurant-funded-delivered',entryId:entry.id,saleId:entry.saleId})
  return
 }
 if(!['cancel','cancel-part'].includes(input.action)||!event)throw stockLedgerError('HISTORY')
 if(before.saleId){
  for(const [index,portion] of portions(event.cancelledItems).entries()){
   const from=owner('consumed','restaurant-funded-item',[entry.id,portion.itemId]),to=owner('wasted','restaurant-funded-item',[entry.id,portion.itemId])
   if(!c.hasOrigin(from,portion.raw.id)){
    if(c.previous.business?.some(row=>row.notes.some(note=>note.kind==='restaurant-funded-delivered'&&note.entryId===entry.id)))throw stockLedgerError('HISTORY')
    // A fulfilment preceding cost opening has no actual FIFO identity. Retain
    // an explicitly unvalued return rather than inventing a historical layer.
    c.acquire(portion.raw.id,portion.quantityUnits,null,'5101','unknown-historic-funded-return',[portion.itemId,index],to)
   }else c.move(from,to,portion.raw.id,portion.quantityUnits)
  }
  const posting=expectedRestaurantFundedPostings(entry).find(row=>row.eventId===input.id)
  if(!posting)throw stockLedgerError('HISTORY')
  c.replace('J'+posting.order.id+'_cogs')
 }else for(const raw of event.allocations)c.move(held,event.prepared?owner('wasted','restaurant-cancel',entry.id):owner('available'),raw.id,units(raw.qty))
 for(const row of restaurantFundsWaste(event))c.replace('JW'+row.id)
}
