import {OPENING_SOURCE_PLAN,readOpeningSourceData,openingSourceMasterWork} from './openingSourceData.mjs'
import {OPENING_CUTOVER_PROTOCOL,OPENING_CUTOVER_MASTER,OPENING_RAW_CUTOVER_PROTOCOL,OPENING_RAW_CUTOVER_MASTER,openingCutoverId,readOpeningCutoverFacts,cutoverError} from './openingCutoverRules.mjs'
import {privateDraftDigest} from './privateDrafts.mjs'
import {migrationBatchSourceText} from './migrationBatchDraft.mjs'

export function openingCutoverPlanInput(input){const {id,...body}=input;return {...body,protocol:OPENING_SOURCE_PLAN}}
export function readOpeningCutoverInput(input){readOpeningCutoverFacts(input);const parsed=readOpeningSourceData(openingCutoverPlanInput(input));return {...parsed,work:openingSourceMasterWork(parsed,openingCutoverPlanInput(input))}}
export function makeOpeningCutoverInput(sourceText,scope,cutoffDate,{currency='',masterChoices=[],partyChoices=[],declaredTotals={}}={}){
 const planned={protocol:OPENING_SOURCE_PLAN,sourceText,cutoffDate,currency,scope:structuredClone(scope),masterChoices:structuredClone(masterChoices),partyChoices:structuredClone(partyChoices),declaredTotals:structuredClone(declaredTotals)},parsed=readOpeningSourceData(planned),input={...planned,protocol:parsed.projected.raw?OPENING_RAW_CUTOVER_PROTOCOL:OPENING_CUTOVER_PROTOCOL,id:openingCutoverId(parsed.projected.source,scope)};readOpeningCutoverInput(input);return input
}
export function openingCutoverMasterRequest(input){
 const {work}=readOpeningCutoverInput(input);if(!work.source.tables.length)return null
 return {protocol:input.protocol===OPENING_RAW_CUTOVER_PROTOCOL?OPENING_RAW_CUTOVER_MASTER:OPENING_CUTOVER_MASTER,id:'migration-'+privateDraftDigest([input.scope.storeId,work.source.source.system,work.source.source.company,work.source.id]).slice(0,48),parentId:input.id,sourceText:input.sourceText,cutoffDate:input.cutoffDate,currency:input.currency,choices:structuredClone(input.masterChoices),scope:structuredClone(input.scope)}
}
export function readOpeningCutoverMaster(input){
 const planned={protocol:OPENING_SOURCE_PLAN,sourceText:input.sourceText,cutoffDate:input.cutoffDate,currency:input.currency,scope:input.scope,masterChoices:input.choices,partyChoices:[],declaredTotals:{}},parsed=readOpeningSourceData(planned),work=openingSourceMasterWork(parsed,planned)
 if(input.protocol!==(parsed.projected.raw?OPENING_RAW_CUTOVER_MASTER:OPENING_CUTOVER_MASTER)||input.parentId!==openingCutoverId(parsed.projected.source,input.scope)||!work.source.tables.length||!parsed.finance.facts.length&&!(migrationBatchSourceText(input.sourceText)&&parsed.stock.opening.length))throw cutoverError()
 return work
}
