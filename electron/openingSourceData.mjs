import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
import {openingTablesFromSource} from './openingMigrationTables.mjs'
import {projectOpeningStockTables,openingDate} from './openingMigrationSource.mjs'
import {projectOpeningBalanceTables,openingBalancePartyKey} from './openingBalanceSource.mjs'
import {parseAgentDocument} from './agentHandoff.mjs'
import {FINANCIAL_FILES_PROTOCOL} from './financialFileDraft.mjs'
import {readFinancialFileSource} from './financialFileSource.mjs'
import {MIGRATION_BATCH_PROTOCOL} from './migrationBatchDraft.mjs'
import {projectMigrationBatchSource} from './migrationBatchSource.mjs'

export const OPENING_SOURCE_PLAN='pos-opening-source-plan/v1'
const fail=message=>{throw Error(message||'整份搬家來源需要重新核對，原輸入仍保留。')}
export function readOpeningSourceData(input){
 draftObject(input,['protocol','sourceText','cutoffDate','currency','scope','masterChoices','partyChoices','declaredTotals','review'],['protocol','sourceText','cutoffDate','currency','scope','masterChoices','partyChoices','declaredTotals'])
 assertPrivateDraftContext(input.scope);openingDate(input.cutoffDate)
 if(input.protocol!==OPENING_SOURCE_PLAN||!['','TWD'].includes(input.currency)||!Array.isArray(input.masterChoices)||input.masterChoices.length>5000||!Array.isArray(input.partyChoices)||input.partyChoices.length>5000)fail()
 draftObject(input.declaredTotals,['stockValue','receivableInvoices','receivableCredits','payableInvoices','payableCredits'],[])
 for(const value of Object.values(input.declaredTotals))if(typeof value!=='string')fail()
 const root=parseAgentDocument(input.sourceText,{maxBytes:250000}),projected=root.protocol===MIGRATION_BATCH_PROTOCOL?projectMigrationBatchSource(root,input.currency):root.protocol===FINANCIAL_FILES_PROTOCOL?readFinancialFileSource(input.sourceText,input.currency):openingTablesFromSource(input.sourceText,input.currency)
 if(!projected)fail('請先核對原始檔案的欄位用途。')
 if(projected.source.tables.some(table=>table.entity==='history-reference'))fail('來源還有歷史資料，整批尚未完成；請保留原檔核對歷史搬入。')
 const stock=projectOpeningStockTables(projected,input.cutoffDate,{combined:true}),finance=projectOpeningBalanceTables(projected,input.cutoffDate,{allowEmpty:true})
 if(!stock.opening.length&&!finance.facts.length)fail('這份來源只有主檔，請用主檔搬家入口核對。')
 return {projected,stock,finance}
}
export function makeOpeningSourcePlanInput(sourceText,scope,cutoffDate,{currency='',masterChoices=[],partyChoices=[],declaredTotals={}}={}){
 const input={protocol:OPENING_SOURCE_PLAN,sourceText,cutoffDate,currency,scope:structuredClone(scope),masterChoices:structuredClone(masterChoices),partyChoices:structuredClone(partyChoices),declaredTotals:structuredClone(declaredTotals)};readOpeningSourceData(input);return input
}
export function openingSourceMasterWork(parsed,input){
 const financial=new Set(parsed.finance.parties.filter(row=>row.side==='receivable').map(row=>row.key)),bindings=[],tables=[]
 let masterIndex=0
 for(const [sourceTable,original]of parsed.projected.source.tables.entries()){
  if(!['products','customers','suppliers'].includes(original.entity))continue
  const table=parsed.stock.masterSource.tables[masterIndex++],rows=[]
  for(const [sourceRow,row]of table.rows.entries()){
   if(table.entity==='customers'&&financial.has(openingBalancePartyKey(parsed.projected.source.source,'receivable',row.externalId)))continue
   bindings.push({table:tables.length,row:rows.length,sourceTable,sourceRow});rows.push(structuredClone(row))
  }
  if(rows.length)tables.push({...structuredClone(table),rows})
 }
 const source={protocol:'pos-opening-master-projection/v2',id:'opening-planned-masters-'+privateDraftDigest([parsed.projected.source.source,parsed.projected.source.id]).slice(0,40),source:structuredClone(parsed.projected.source.source),tables},seen=new Set()
 const choices=input.masterChoices.map(choice=>{
  draftObject(choice,['table','row','targetId','resolution'],['table','row','targetId'])
  const binding=bindings.find(row=>row.sourceTable===choice.table&&row.sourceRow===choice.row),key=choice.table+':'+choice.row
  if(!binding||seen.has(key))fail('主檔選擇不屬於這份原始資料，請重新核對。');seen.add(key)
  return {...choice,table:binding.table,row:binding.row}
 })
 return {source,bindings,choices}
}
