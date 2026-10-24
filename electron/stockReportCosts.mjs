import {planStockOpening,planOpeningCostPrice,stockOpeningKey} from './stockOpeningPlan.mjs'
import {clearStockReturnSuspense} from './stockBusinessPlan.mjs'
import {costSegmentValue} from './stockCost.mjs'
import {aggregateJournal,journalLineCents} from './journalAmounts.mjs'
import {restaurantCostShares,splitReportCents} from './stockReportBasis.mjs'
import {stockLegacySalesReferences} from './stockAccounting.mjs'
import {projectStockLedger} from './stockLedgerModel.mjs'

const netCost=journal=>journal.lines.filter(row=>row.account==='5101').reduce((sum,line)=>sum+journalLineCents(journal,line,'debit')-journalLineCents(journal,line,'credit'),0n)
const amountCents=value=>journalLineCents({}, {debit:value},'debit')
const scopeFor=method=>method==='applySalesOperation'?'business':['checkout','refundOrder','applyRestaurantOperation'].includes(method)?'pos':'adjustment'

// A read model of already validated receipts. Values are recognized on the date
// of their journal. Confirming a price never reprices an earlier posting.
export function stockReportCostPostings(state,data){
 if(!state.projection)return []
 const entries=state.entries,first=entries[0],material=JSON.parse(first.openingMaterial),opening=planStockOpening(material.preview,first.input,first.date),rows=[]
 const confirmations=new Map(entries.filter(row=>row.input.action==='price'&&(!row.method||row.method==='applyStockCostOperation')).map(row=>[row.input.sourceId,row.date]))
 const reservations=new Map((data.restaurantEntries||[]).map(row=>[row.id,{entry:row,basis:null}]))
 for(const event of entries)if(event.method==='applyRestaurantOperation'&&event.input.action==='create')reservations.set(event.evidence.entry.id,{entry:event.evidence.entry,basis:event.evidence.costBasis})
 const add=(date,scope,shares,sourceId=null,unresolved=false)=>{
  for(const share of shares)rows.push({date,scope,productId:share.productId,amountCents:share.amountCents,pendingTargets:share.pendingTargets||[],...(unresolved?{unknownUntil:confirmations.get(sourceId)||null}:{})})
 }
 const shares=(event,raw,value,effect=null)=>{
  if(event.method!=='applyRestaurantOperation')return [{productId:raw,amountCents:value.toString()}]
  if(event.evidence.entry.funds){
   const result=ownerShares(effect?.from?.stage==='consumed'?effect.from:effect?.to,raw,value)
   if(result.scope!=='pos')throw Error('成本分攤需要核對')
   return result.shares
  }
  return restaurantCostShares(event.evidence.entry||event.evidence.beforeEntry,reservations.get((event.evidence.entry||event.evidence.beforeEntry).id)?.basis,raw,value)
 }
 const ownerShares=(owner,raw,value)=>{
  let domain,id;try{[domain,id]=JSON.parse(owner.referenceId)}catch{return {scope:'adjustment',shares:[{productId:null,amountCents:value.toString()}]}}
  if(domain==='restaurant-funded-item'&&Array.isArray(id)&&id.length===2)return {scope:'pos',shares:[{productId:id[1],amountCents:value.toString()}]}
  if(domain==='restaurant'){const reservation=reservations.get(id);return {scope:'pos',shares:restaurantCostShares(reservation?.entry,reservation?.basis,raw,value)}}
  return {scope:domain==='checkout'?'pos':domain==='delivery'?'business':'adjustment',shares:[{productId:raw,amountCents:value.toString()}]}
 }
 let projection={version:1,custody:opening.custody,sourceEvidence:opening.sourceEvidence,legacyJournals:material.legacyJournal,legacyCostReviews:material.preview.legacyCostReviews,journals:[opening.journal],...(material.legacyOperationIds?{legacyOperationIds:material.legacyOperationIds}:{})}
 // Frozen old journals remain authoritative. These weights are only the frozen
 // reference allocation, never today's editable product cost.
 const frozen=new Map(projection.legacyJournals.map(row=>[row.id,row])),preview=new Map(material.preview.products.map(row=>[row.productId,row.referenceUnitCostCents])),claimed=new Set()
 for(const order of data.orders){
  const journal=frozen.get('J'+order.id+'_cogs');if(!journal)continue
  claimed.add(journal.id)
  let weights=(order.items||[]).map(item=>({productId:item.id,weight:(BigInt(Math.round(Math.abs(item.qty)*1000))*((order.itemCosts?.[item.id]!==undefined)?amountCents(order.itemCosts[item.id]):BigInt(preview.get(item.id)||0))).toString()}))
  const sum=weights.reduce((n,row)=>n+BigInt(row.weight),0n)
  const allocation=weights.length===1?[{productId:weights[0].productId,amountCents:netCost(journal).toString()}]:sum>0n?splitReportCents(netCost(journal),weights):[{productId:null,amountCents:netCost(journal).toString(),pendingTargets:weights.map(row=>row.productId)}]
  add(journal.date,'pos',allocation)
 }
 for(const doc of data.salesDocuments||[])for(const event of [...doc.deliveries,...doc.returns]){
  const journal=frozen.get('JS-'+event.id+(event.action==='deliver'?'-cost':'-cost-return'));if(!journal)continue
  claimed.add(journal.id)
  const weights=doc.items.map((item,index)=>({productId:item.productId,weight:amountCents(event.costAmounts[index]).toString()})),total=weights.reduce((n,row)=>n+BigInt(row.weight),0n)
  add(journal.date,'business',total>0n?splitReportCents(netCost(journal),weights):[{productId:null,amountCents:netCost(journal).toString()}])
 }
 for(const journal of frozen.values())if(!claimed.has(journal.id)&&netCost(journal)!==0n)add(journal.date,'adjustment',[{productId:null,amountCents:netCost(journal).toString()}])
 // Old missing/zero snapshots stay pending even when the frozen journal is zero.
 for(const review of projection.legacyCostReviews){const order=data.orders.find(row=>row.id===review.orderId);if(order)add(order.businessDate||localDay(order.time),'pos',[{productId:review.productId,amountCents:'0'}],null,true)}
 for(const review of stockLegacySalesReferences(projection,data))add(review.date,'business',[{productId:review.productId,amountCents:'0'}],null,true)
 let openingAssigned=0n
 for(const reservation of material.preview.paidLegacyReservations||[])for(const raw of reservation.allocations||[]){
  const key=stockOpeningKey('consumed',raw.productId,reservation.entryId),source=opening.custody.sources.find(row=>opening.sourceEvidence.some(origin=>origin.key===key&&origin.sourceId===row.id))
  if(!source)throw Error('成本分攤需要核對')
  const value=BigInt(source.valueCents??0)-BigInt(raw.referenceValueCents??0),target=ownerShares({referenceId:JSON.stringify(['restaurant',reservation.entryId])},raw.productId,value)
  openingAssigned+=value;add(first.date,target.scope,target.shares,source.id,source.valueCents===null)
 }
 add(first.date,'adjustment',[{productId:null,amountCents:(netCost(opening.journal)-openingAssigned).toString()}])
 const originFor=sourceId=>{const evidence=state.projection.sourceEvidence.find(row=>row.sourceId===sourceId);if(!evidence)return null;let key;try{key=JSON.parse(evidence.key)}catch{return null};return entries.find(row=>row.method===key[0]&&row.input.id===key[1])}
 for(const event of entries.slice(1)){
  if((!event.method||event.method==='applyStockCostOperation')&&event.input.action==='price'){
   const plan=planOpeningCostPrice(projection,event.input,event.date),source=plan.state.sources.find(row=>row.id===event.input.sourceId)
   for(const position of projection.custody.positions.filter(row=>row.owner.stage==='consumed')){
    const value=position.segments.filter(row=>row.sourceId===source.id).reduce((sum,segment)=>sum+BigInt(costSegmentValue(source,segment.offsetUnits,segment.quantityUnits)),0n)
    if(value){const target=ownerShares(position.owner,source.productId,value);add(event.date,target.scope,target.shares)}
   }
   if(projection.sourceEvidence.find(row=>row.sourceId===source.id)?.creditAccount==='5101'){
    const origin=originFor(source.id),effect=origin&&projection.business?.find(row=>row.eventId===origin.id)?.effects.find(row=>row.segments?.some(segment=>segment.sourceId===source.id));add(event.date,origin?scopeFor(origin.method):'adjustment',origin?shares(origin,source.productId,-BigInt(source.valueCents),effect):[{productId:null,amountCents:(-BigInt(source.valueCents)).toString()}])
   }
   projection=clearStockReturnSuspense({...projection,custody:plan.state,journals:[...projection.journals,plan.journal]},event.date,event.input.id)
   continue
  }
  const next=projectStockLedger(projection,event),business=next.business?.find(row=>row.eventId===event.id)||next.lotEvents?.find(row=>row.eventId===event.id)
  for(const effect of business?.effects||[]){
   const acquired=['acquire','acquire-disposed','acquire-quarantined'].includes(effect.kind),credit=acquired&&next.sourceEvidence.find(row=>row.sourceId===effect.segments[0].sourceId)?.creditAccount==='5101'
   const sign=(effect.to.stage==='consumed'?1:0)-(effect.from?.stage==='consumed'?1:0)-(credit?1:0)
   if(!sign)continue
   for(const segment of effect.segments){
    const source=next.custody.sources.find(row=>row.id===segment.sourceId),value=costSegmentValue(source,segment.offsetUnits,segment.quantityUnits)
    add(event.date,scopeFor(event.method),shares(event,source.productId,BigInt(value??0)*BigInt(sign),effect),source.id,value===null)
   }
  }
  projection=next
 }
 // A corrupted or omitted attribution must never quietly change the book total.
 const expected=BigInt(aggregateJournal([...state.projection.legacyJournals,...state.projection.journals]).accounts['5101']?.netDebitCents||0),actual=rows.reduce((sum,row)=>sum+BigInt(row.amountCents),0n)
 if(expected!==actual)throw Error('成本分攤需要核對')
 return rows
}

const localDay=time=>{const d=new Date(time);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
