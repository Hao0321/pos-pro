import {updateLotCountReservations} from './lotCount.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {planCostCustody} from './stockCustody.mjs'
import {costSegmentValue,stockCostSummary} from './stockCost.mjs'
import {stockLedgerError} from './stockOpeningPlan.mjs'
import {planTradeStock} from './stockTradePlans.mjs'
import {planOperationalStock} from './stockOperationalPlans.mjs'
import {assertLotBusinessReady,planLotBusinessMove,lotAcquireTarget} from './lotBusinessPolicy.mjs'
import {receiptLots,placeReceiptLots} from './receiptLots.mjs'
import {hasReceiptLots} from './receiptReview.mjs'
import {lotRegistry,lotError} from './lotRules.mjs'
import {planSupplierLotReturn,SUPPLIER_LOT_RETURN} from './supplierLotReturn.mjs'

export const STOCK_BUSINESS_METHODS=['checkout','refundOrder','applyInventoryOperation','applyRestaurantOperation','applySalesOperation','addWaste','addProduct']
export const stockOwner=(stage,domain='',id='')=>({stage,locationId:'main',referenceId:stage==='available'?'':domain==='reservation'?id:canonicalSignature([domain,id])})
const owned=stage=>['available','reserved','quarantined'].includes(stage)
const expense=stage=>({consumed:'5101',wasted:'5208',supplierReturned:'5204'})[stage]
const safe=(value,min=0)=>{if(!Number.isSafeInteger(value)||value<min)throw stockLedgerError('HISTORY');return value}
export const stockUnits=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9||Math.abs(value-Math.round(value*1000)/1000)>1e-7)throw stockLedgerError('HISTORY');return Math.round(value*1000)}
export function stockLineValue(quantityUnits,rateCents){safe(quantityUnits);safe(rateCents);const result=(BigInt(quantityUnits)*BigInt(rateCents)+500n)/1000n;if(result>BigInt(Number.MAX_SAFE_INTEGER))throw stockLedgerError('BALANCE');return Number(result)}
export function stockLegacyInterval(originalUnits,valueCents,returnedUnits,takeUnits){return valueCents===null?null:costSegmentValue({id:'legacy-reference',productId:'legacy',unit:'reference',currency:'TWD',quantityUnits:originalUnits,valueCents},returnedUnits,takeUnits)}

function available(custody,id,unit){const sources=new Map(custody.sources.map(row=>[row.id,row]));return custody.positions.filter(row=>row.owner.stage==='available'&&row.owner.locationId==='main').flatMap(row=>row.segments).filter(row=>{const source=sources.get(row.sourceId);return source.productId===id&&source.unit===unit}).reduce((sum,row)=>sum+row.quantityUnits,0)}
export function planStockBusiness(previous,body){
 const {method,input,evidence,date,id:eventId}=body
 if(!previous||!STOCK_BUSINESS_METHODS.includes(method)||!input||typeof input.id!=='string'||!input.id||!evidence||!Array.isArray(evidence.products))throw stockLedgerError('INPUT')
 if(date<previous.journals[0].date)throw stockLedgerError('STALE')
 assertLotBusinessReady(previous,body)
 const arrival=method==='applyInventoryOperation'&&hasReceiptLots(input)?receiptLots(input):null
 if(arrival&&(!previous.lots||body.actor?.role!=='owner'||arrival.expectedStateDigest!==body.beforeDigest))throw lotError('STALE')
 const arrivalItems=[]
 const supplierReturn=method==='applyInventoryOperation'&&input.kind===SUPPLIER_LOT_RETURN?planSupplierLotReturn(previous,body):null
 const pairs=new Map(),steps=[],sourceEvidence=[],replaced=new Set(),extraLines=[],notes=[]
 for(const pair of evidence.products){if(!pair||pairs.has(pair.id)||typeof pair.id!=='string'||typeof pair.unit!=='string')throw stockLedgerError('HISTORY');safe(pair.beforeUnits);safe(pair.afterUnits);if(available(previous.custody,pair.id,pair.unit)!==pair.beforeUnits)throw stockLedgerError('HISTORY');pairs.set(pair.id,pair)}
 let ordinal=0,virtual=previous.custody;const blocked=new Map(),append=next=>{steps.push(...next);if(previous.lots&&next.length)virtual=planCostCustody(virtual,{expectedSequence:virtual.sequence,steps:next}).state}
 const context={previous,input,evidence,stockOwner,stockUnits,stockLineValue,stockLegacyInterval,supplierReturn,selected:append,
  product:id=>{const row=pairs.get(id);if(!row)throw stockLedgerError('HISTORY');return row},
  move:(from,to,productId,quantityUnits,unused=false)=>{safe(quantityUnits,1);const product=context.product(productId);if(previous.lots){const plan=planLotBusinessMove(virtual,previous.lots,from,to,productId,product.unit,quantityUnits,unused);append(plan.steps);blocked.set(productId,(blocked.get(productId)||0)+plan.blockedUnits)}else append([{kind:unused?'release-unused':'move',from,to,productId,unit:product.unit,quantityUnits}])},
  acquire:(productId,quantityUnits,valueCents,creditAccount,basis,key,to=stockOwner('available'))=>{safe(quantityUnits,1);if(valueCents!==null)safe(valueCents);if(!['3901','4191','5101','2102','2291'].includes(creditAccount))throw stockLedgerError('HISTORY');const product=context.product(productId),sourceId='business:'+eventId+':'+ordinal++,target=previous.lots&&!arrival?lotAcquireTarget(previous.lots,to,productId,sourceId):to;const source={id:sourceId,productId,unit:product.unit,currency:'TWD',quantityUnits,valueCents};if(to.stage==='available'&&to.locationId==='main'&&target.stage==='quarantined')blocked.set(productId,(blocked.get(productId)||0)+quantityUnits);append([{kind:target.stage==='wasted'?'acquire-disposed':target.stage==='quarantined'?'acquire-quarantined':'acquire',to:target,sources:[source]}]);sourceEvidence.push({sourceId,key:canonicalSignature([method,input.id,key]),basis,creditAccount});if(arrival){const placed=placeReceiptLots(previous,body,source,productId,key,virtual.positions.flatMap(row=>row.segments).find(row=>row.sourceId===sourceId).queueOrder);append(placed.steps);arrivalItems.push(...placed.items);blocked.set(productId,(blocked.get(productId)||0)+placed.blockedUnits)}},
  hasOrigin:(owner,productId)=>{const sources=new Map(previous.custody.sources.map(row=>[row.id,row]));return previous.custody.positions.some(row=>canonicalSignature(row.owner)===canonicalSignature(owner)&&row.segments.some(segment=>sources.get(segment.sourceId).productId===productId))},
  replace:id=>replaced.add(id),
  line:(account,debitCents,creditCents)=>extraLines.push({account,debitCents:safe(debitCents),creditCents:safe(creditCents)}),
  note:row=>notes.push(row),
 }
 if(['checkout','refundOrder','applySalesOperation'].includes(method))planTradeStock(context,method)
 else planOperationalStock(context,method)
 const plan=planCostCustody(previous.custody,{expectedSequence:previous.custody.sequence,steps}),lines=[...extraLines]
 for(const effect of plan.effects){
  const value=effect.cost?.knownValueCents||0;if(!value)continue
  if(['acquire','acquire-disposed','acquire-quarantined'].includes(effect.kind)){
   const origin=sourceEvidence.find(row=>row.sourceId===effect.segments[0].sourceId);lines.push({account:owned(effect.to.stage)?'1211':expense(effect.to.stage),debitCents:value,creditCents:0},{account:origin.creditAccount,debitCents:0,creditCents:value})
  }else{
   const from=effect.from.stage,to=effect.to.stage
   if(owned(from)&&owned(to))continue
   const debit=owned(to)?'1211':expense(to),credit=owned(from)?'1211':expense(from)
   if(!debit||!credit)throw stockLedgerError('HISTORY')
   lines.push({account:debit,debitCents:value,creditCents:0},{account:credit,debitCents:0,creditCents:value})
  }
 }
 for(const pair of pairs.values())if(available(plan.state,pair.id,pair.unit)!==pair.afterUnits-(blocked.get(pair.id)||0))throw stockLedgerError('HISTORY')
 if(previous.lots)notes.push({kind:'lot-stock-result',products:[...pairs.values()].map(pair=>({id:pair.id,originalAfterUnits:pair.afterUnits,availableAfterUnits:available(plan.state,pair.id,pair.unit)}))})
 const total=lines.reduce((sum,row)=>sum+BigInt(row.debitCents)-BigInt(row.creditCents),0n);if(total!==0n)throw stockLedgerError('BALANCE')
 const complete=plan.effects.every(effect=>effect.cost?.complete!==false)
 const journal={id:'stock-business:'+method+':'+input.id,date,type:'stock-cost',amountUnit:'cents',description:'庫存成本異動',costComplete:complete,lines}
 const business={method,id:input.id,eventId,effects:plan.effects,journalId:journal.id,replacedJournalIds:[...replaced],notes}
 let next={...previous,custody:plan.state,sourceEvidence:[...previous.sourceEvidence,...sourceEvidence],journals:[...previous.journals,journal],business:[...(previous.business||[]),business]}
 if(arrival)next={...next,receiptLotsVersion:1,lots:lotRegistry({...previous.lots,items:[...previous.lots.items,...arrivalItems]},plan.state)}
 if(supplierReturn)next={...next,supplierLotReturnsVersion:1}
 if(previous.lotCountVersion===1)next={...next,lotCountReservations:updateLotCountReservations(previous,next.custody,method==='applyRestaurantOperation'?evidence.entry:null)}
 next=clearStockReturnSuspense(next,date,input.id)
 return next
}

// A supplier credit is held in a clearing account while actual outgoing cost is
// unknown. Only a fully valued original return can release its credit to variance.
export function clearStockReturnSuspense(projection,date,operationId){
 let changed=false;const journals=[]
 const business=(projection.business||[]).map(row=>{
  const notes=row.notes.map(note=>{
   if(!['supplier-return-clearing','supplier-lot-return-clearing'].includes(note.kind)||note.cleared)return note
   const owners=note.kind==='supplier-lot-return-clearing'?note.owners:[note.owner]
   if(!owners.length||owners.some(owner=>{const node=projection.custody.positions.find(position=>canonicalSignature(position.owner)===canonicalSignature(owner));return !node||!stockCostSummary(projection.custody.sources,node.segments).complete}))return note
   const amount=note.creditCents
   journals.push({id:'stock-clear:'+row.eventId+':'+operationId,date,type:'stock-cost',amountUnit:'cents',description:'供應商退貨成本差額',costComplete:true,lines:amount?[{account:'2291',debitCents:amount,creditCents:0},{account:'5204',debitCents:0,creditCents:amount}]:[]})
   changed=true;return {...note,cleared:true}
  });return {...row,notes}
 })
 return changed?{...projection,business,journals:[...projection.journals,...journals]}:projection
}
