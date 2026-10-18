import {canonicalSignature} from './operationRules.mjs'
import {automaticBusinessJournal} from './businessJournal.mjs'
import {planStockOpening} from './stockOpeningPlan.mjs'
import {salesDate} from './salesRules.mjs'

const clone=value=>structuredClone(value)
// Read-only composition. Legacy snapshots win over regenerated estimates, and
// new actual cost journals replace their original automatic cost rows once.
export function composeStockJournal(projection,data){
 const automatic=automaticBusinessJournal(data),manual=data.manualJournal||[]
 if(!projection)return [...automatic,...manual]
 const frozen=projection.legacyJournals||[],ids=new Set(frozen.map(row=>row.id)),suppressed=new Set()
 if(ids.size!==frozen.length)throw Error('帳務分錄需要核對')
 for(const id of [...(projection.legacyOperationIds?.checkout||[]),...(projection.legacyOperationIds?.refundOrder||[])])suppressed.add('J'+id+'_cogs')
 for(const row of projection.business||[]){
  for(const id of row.replacedJournalIds)suppressed.add(id)
  for(const note of row.notes)if(note.kind==='legacy-receiving-financial-source-pending')suppressed.add('JP'+note.purchaseId)
 }
 const current=[...automatic,...manual].filter(row=>!ids.has(row.id)&&!suppressed.has(row.id))
 const result=[...clone(frozen),...current,...clone(projection.journals)]
 if(new Set(result.map(row=>row.id)).size!==result.length)throw Error('帳務分錄需要核對')
 return result
}

export function validateStockJournalSelection(journals){
 if(!Array.isArray(journals)||journals.some(row=>!row||typeof row.id!=='string'||!Array.isArray(row.lines)))throw Error('帳務分錄需要核對')
 if(new Set(journals.map(row=>row.id)).size!==journals.length)throw Error('帳務分錄需要核對')
 return canonicalSignature(journals)
}

// A legacy zero reference does not prove a zero-cost delivery. New actual zero
// receipts are distinguishable by their cost history and are not marked here.
export function stockLegacySalesReferences(projection,data){
 const frozen=new Set((projection.legacyJournals||[]).map(row=>row.id)),rows=[]
 for(const doc of data.salesDocuments||[])for(const event of [...doc.deliveries,...doc.returns]){
  const suffix=event.action==='deliver'?'-revenue':'-credit'
  if(!frozen.has('JS-'+event.id+suffix))continue
  const original=event.action==='deliver'?event:doc.deliveries.find(row=>row.id===event.deliveryId)
  doc.items.forEach((item,index)=>{if(event.quantities[index]>0&&original?.unitCosts[index]===0)rows.push({orderId:'business-report:'+event.id,productId:item.productId,date:event.date})})
 }
 return rows
}

export function stockAccountingTimeline(state,data){
 const first=state.entries[0],opening=planStockOpening(JSON.parse(first.openingMaterial).preview,first.input,first.date),sources=opening.custody.sources.map(row=>({sourceId:row.id,productId:row.productId,createdDate:first.date,unknownAtBirth:row.valueCents===null})),moves=[],confirmations=[]
 for(const node of opening.custody.positions)for(const segment of node.segments)moves.push({sourceId:segment.sourceId,date:first.date,from:null,to:node.owner.stage,quantityUnits:segment.quantityUnits})
 const byEvent=new Map([...(state.projection.lotEvents||[]),...(state.projection.business||[])].map(row=>[row.eventId,row]))
 for(const event of state.entries.slice(1)){
  if((!event.method||event.method==='applyStockCostOperation')&&event.input.action==='price'){confirmations.push({sourceId:event.input.sourceId,date:event.date});continue}
  if(event.method==='applyWarehouseOperation')continue
  const business=byEvent.get(event.id);if(!business)throw Error('庫存成本報表需要核對')
  for(const effect of business.effects)for(const segment of effect.segments||[]){
   if(['acquire','acquire-disposed','acquire-quarantined'].includes(effect.kind)){
    const source=state.projection.custody.sources.find(row=>row.id===segment.sourceId)
    sources.push({sourceId:source.id,productId:source.productId,createdDate:event.date,unknownAtBirth:!effect.cost.complete})
   }
   moves.push({sourceId:segment.sourceId,date:event.date,from:effect.from?.stage||null,to:effect.to.stage,quantityUnits:segment.quantityUnits})
  }
 }
 const orders=new Map(data.orders.map(row=>[row.id,row]))
 return {sources,moves,confirmations,legacyReferences:[...state.projection.legacyCostReviews.map(row=>({orderId:row.orderId,productId:row.productId,date:orders.get(row.orderId)?.time?salesDate(new Date(orders.get(row.orderId).time)):''})),...stockLegacySalesReferences(state.projection,data)]}
}

export function stockPeriodDisclosure(report,from,to){
 if(report?.status!=='active')return {profitComplete:true,assetsComplete:true,unknownProfitSources:0,unknownOwnedSources:0,legacyReferenceOrders:0,chronologyReview:false}
 const {sources,moves,confirmations,legacyReferences}=report.timeline,unknownOwned=new Set(),unknownProfit=new Set(),owned=stage=>['available','reserved','quarantined'].includes(stage)
 let chronologyReview=false
 for(const source of sources){
  const relevant=moves.filter(row=>row.sourceId===source.sourceId&&row.date<=to)
  if(relevant.some(row=>row.date<source.createdDate))chronologyReview=true
  if(!source.unknownAtBirth||confirmations.some(row=>row.sourceId===source.sourceId&&row.date<=to))continue
  const held=relevant.reduce((sum,row)=>sum+(owned(row.to)?row.quantityUnits:0)-(owned(row.from)?row.quantityUnits:0),0)
  if(held>0)unknownOwned.add(source.sourceId)
  if(held<0)chronologyReview=true
  if(relevant.some(row=>row.date>=from&&(!owned(row.to)||row.from&&!owned(row.from))))unknownProfit.add(source.sourceId)
 }
 const legacy=new Set(legacyReferences.filter(row=>row.date>=from&&row.date<=to).map(row=>row.orderId))
 return {profitComplete:!unknownProfit.size&&!legacy.size&&!chronologyReview,assetsComplete:!unknownOwned.size&&!chronologyReview,unknownProfitSources:unknownProfit.size,unknownOwnedSources:unknownOwned.size,legacyReferenceOrders:legacy.size,chronologyReview}
}

export function makeStockAccountingReport(state,data){
 if(!state.projection)return {status:'reference-only-not-activated'}
 const journals=composeStockJournal(state.projection,data);validateStockJournalSelection(journals)
 return {status:'active',sequence:state.entries.length,stateDigest:state.stateDigest,journals,timeline:stockAccountingTimeline(state,data),valuation:state.valuation,frozenManualIds:(state.projection.legacyJournals||[]).filter(row=>row.type==='manual').map(row=>row.id)}
}
