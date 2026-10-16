import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js'
import {canonicalSignature} from './operationRules.mjs'
import {costCustodySummary} from './stockCustody.mjs'
import {planStockOpening,planOpeningCostPrice,stockCostCommand,stockLedgerError,STOCK_LEDGER_PROTOCOL} from './stockOpeningPlan.mjs'
import {planStockBusiness,clearStockReturnSuspense,STOCK_BUSINESS_METHODS} from './stockBusinessPlan.mjs'
import {assertStockSetupProjection} from './stockSetupReview.mjs'

export const STOCK_COST_METHOD='applyStockCostOperation'
// The same bytes and model verify native and browser backups. This remains an
// integrity checksum of the selected book, not a signature authenticating it.
export const stockLedgerDigest=value=>'sha256:'+bytesToHex(sha256(utf8ToBytes(typeof value==='string'?value:canonicalSignature(value))))
export function projectStockLedger(previous,body,digest=stockLedgerDigest){
 if(body.method&&body.method!==STOCK_COST_METHOD)return planStockBusiness(previous,body)
 const input=stockCostCommand(body.input)
 if(input.action==='open'){
  if(previous||typeof body.openingMaterial!=='string'||digest(body.openingMaterial)!==input.snapshotDigest)throw stockLedgerError('HISTORY')
  const material=JSON.parse(body.openingMaterial)
  if(material.profile!=='pos-stock-opening-preview/v1')throw stockLedgerError('HISTORY')
  const plan=planStockOpening(material.preview,input,body.date)
  const projection={version:1,custody:plan.custody,sourceEvidence:plan.sourceEvidence,legacyJournals:material.legacyJournal,legacyCostReviews:material.preview.legacyCostReviews,journals:[plan.journal],...(material.legacyOperationIds?{legacyOperationIds:material.legacyOperationIds}:{})}
  assertStockSetupProjection(input,body,projection,costCustodySummary(projection.custody));return projection
 }
 if(!previous||body.openingMaterial!==null)throw stockLedgerError('HISTORY')
 const plan=planOpeningCostPrice(previous,input,body.date)
 const projection=clearStockReturnSuspense({...previous,custody:plan.state,journals:[...previous.journals,plan.journal]},body.date,input.id)
 assertStockSetupProjection(input,body,projection,costCustodySummary(projection.custody),previous);return projection
}
export function stockLedgerAcknowledgement(body,hash,projection){
 const method=body.method||STOCK_COST_METHOD,common={protocol:STOCK_LEDGER_PROTOCOL,success:true,id:body.input.id,eventId:body.id,eventHash:hash,stateDigest:body.afterDigest,sequence:body.sequence}
 return method===STOCK_COST_METHOD?{...common,valuation:costCustodySummary(projection.custody)}:{...common,sourceMethod:method}
}
export function replayStockLedger(rawEntries=[],rawOperations=[],digest=stockLedgerDigest){
 try{
  if(!Array.isArray(rawEntries)||!Array.isArray(rawOperations)||rawEntries.length!==rawOperations.length)throw stockLedgerError('HISTORY')
  const entries=structuredClone(rawEntries).sort((a,b)=>a.sequence-b.sequence),operations=structuredClone(rawOperations).sort((a,b)=>a.id.localeCompare(b.id)),operationMap=new Map(operations.map(row=>[row.id,row]))
  if(operationMap.size!==operations.length||new Set(entries.map(row=>row.id)).size!==entries.length)throw stockLedgerError('HISTORY')
  let projection=null,previousHash=null
  for(let index=0;index<entries.length;index++){
   const {hash,...body}=entries[index],method=body.method||STOCK_COST_METHOD
   if(typeof body.id!=='string'||!body.id||method!==STOCK_COST_METHOD&&!STOCK_BUSINESS_METHODS.includes(method)||body.sequence!==index+1||body.previousHash!==previousHash||hash!==digest(body)||body.beforeDigest!==digest(projection)||!['owner',...(method===STOCK_COST_METHOD?[]:['staff'])].includes(body.actor?.role)||typeof body.actor.userId!=='string'||!body.actor.userId)throw stockLedgerError('HISTORY')
   const next=projectStockLedger(projection,body,digest)
   if(body.afterDigest!==digest(next))throw stockLedgerError('HISTORY')
   const operation=operationMap.get(canonicalSignature([method,body.input.id])),expectedReceipt=stockLedgerAcknowledgement(body,hash,next)
   if(!operation||operation.method!==method||operation.operationId!==body.input.id||operation.actorId!==body.actor.userId||operation.signature!==canonicalSignature(body.input)||canonicalSignature(operation.receipt)!==canonicalSignature(expectedReceipt))throw stockLedgerError('HISTORY')
   projection=next;previousHash=hash
  }
  return {entries,operations,projection,head:previousHash,stateDigest:digest(projection),valuation:projection?costCustodySummary(projection.custody):null}
 }catch(error){if(error.code==='STOCK_LEDGER_HISTORY')throw error;throw stockLedgerError('HISTORY')}
}
