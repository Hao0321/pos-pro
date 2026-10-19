import {readOpeningMigrationInput,projectOpeningStockTables,OPENING_MIGRATION_METHOD,OPENING_CLEARING_ACCOUNT} from './openingMigrationSource.mjs'
import {OPENING_CUTOVER_PROTOCOL,readOpeningCutoverFacts} from './openingCutoverRules.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {stockLedgerError} from './stockOpeningPlan.mjs'
import {masterSourceKey} from './masterMigration.mjs'

// Stock source creation is shared by the real cutover and the review projection.
// It is an opening asset, never a purchase, sale, tender or ordinary surplus.
export function planOpeningMigrationStock(c){
 const {input,evidence,previous}=c,{opening,source}=input.protocol===OPENING_CUTOVER_PROTOCOL?projectOpeningStockTables({source:readOpeningCutoverFacts(input).source,origins:new Map()},input.cutoffDate,{combined:true}):readOpeningMigrationInput(input)
 if(c.postingDate!==input.cutoffDate||previous.journals.some(row=>row.date>input.cutoffDate))throw stockLedgerError('HISTORY')
 if(!Array.isArray(evidence.opening)||evidence.opening.length!==opening.length||evidence.products.length!==opening.length)throw stockLedgerError('HISTORY')
 if(previous.business?.some(row=>row.method===OPENING_MIGRATION_METHOD&&row.id===input.id))throw stockLedgerError('HISTORY')
 const targets=new Set()
 for(let index=0;index<opening.length;index++){
  const fact=opening[index],row=evidence.opening[index]
  if(!row||canonicalSignature(row.fact)!==canonicalSignature(fact)||typeof row.productId!=='string'||targets.has(row.productId)||row.sourceProductKey!==masterSourceKey(source.source,'products',fact.productExternalId)||row.sourceRowKey!==masterSourceKey(source.source,'opening-stock',fact.externalId))throw stockLedgerError('HISTORY');targets.add(row.productId)
  const pair=c.product(row.productId)
  if(pair.unit!==fact.unit||pair.beforeUnits!==0||pair.afterUnits!==fact.quantityUnits||previous.custody.sources.some(source=>source.productId===row.productId)||previous.business?.some(entry=>entry.method===OPENING_MIGRATION_METHOD&&entry.notes.some(note=>note.kind==='migration-opening-source'&&note.sourceProductKey===row.sourceProductKey)))throw stockLedgerError('HISTORY')
  if(fact.quantityUnits)c.acquire(row.productId,fact.quantityUnits,fact.valueCents,OPENING_CLEARING_ACCOUNT,'migration-opening',row.sourceProductKey)
  c.note({kind:'migration-opening-source',sourceProductKey:row.sourceProductKey,sourceRowKey:row.sourceRowKey,productId:row.productId,externalId:fact.externalId,quantityUnits:fact.quantityUnits,valueCents:fact.valueCents,cutoffDate:input.cutoffDate})
 }
}
