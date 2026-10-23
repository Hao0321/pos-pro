import {parseAgentDocument} from '../../electron/agentHandoff.mjs'
import {draftObject} from '../../electron/privateDrafts.mjs'
import {openingDate} from '../../electron/openingMigrationSource.mjs'
import {openingSourceDate} from '../../electron/openingMigrationTables.mjs'
import {makeOpeningCutoverInput,openingCutoverPlanInput,readOpeningCutoverInput} from '../../electron/openingCutoverSource.mjs'
import {readOpeningSourceData} from '../../electron/openingSourceData.mjs'
import {openingCutoverSourceDigest} from '../../electron/openingCutoverRules.mjs'
import {assertOpeningCutoverResult} from '../../electron/openingCutoverReceipt.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'

export const cutoverTotalKeys=['stockValue','receivableInvoices','receivableCredits','payableInvoices','payableCredits']
export const emptyCutoverDraft=()=>({text:'',cutoffDate:'',currency:'',masterChoices:[],partyChoices:[],declaredTotals:{}})
export {cutoverSourceCanRoute} from '../../electron/migrationSource.mjs'
export function cutoverSourceDate(text){
 try{const value=parseAgentDocument(text,{maxBytes:250000}),dates=new Set(),stockDate=openingSourceDate(text);if(stockDate)dates.add(openingDate(stockDate));for(const table of value.tables||[]){if(!['opening-receivables','opening-payables'].includes(table.entity))continue;const indices=table.columns.flatMap((name,index)=>['cutoffdate','asofdate','切換日','截止日期'].includes(name.trim().toLowerCase().replace(/[\s_-]/g,''))?[index]:[]);for(const row of table.rows)for(const index of indices)if(row.values[index])dates.add(openingDate(row.values[index]))}return dates.size===1?[...dates][0]:''}catch{return ''}
}
export function validCutoverDraft(value){
 try{
  draftObject(value,['text','cutoffDate','currency','masterChoices','partyChoices','declaredTotals','attempted'],['text','cutoffDate','currency','masterChoices','partyChoices','declaredTotals']);draftObject(value.declaredTotals,cutoverTotalKeys,[])
  if(typeof value.text!=='string'||value.text.length>250000||typeof value.cutoffDate!=='string'||value.cutoffDate.length>10||!['','TWD'].includes(value.currency)||Object.values(value.declaredTotals).some(raw=>typeof raw!=='string'||raw.length>32))return false
  for(const key of ['masterChoices','partyChoices'])if(!Array.isArray(value[key])||value[key].length>5000)return false
  for(const row of value.masterChoices){draftObject(row,['table','row','targetId','resolution'],['table','row','targetId']);if(!Number.isSafeInteger(row.table)||row.table<0||!Number.isSafeInteger(row.row)||row.row<0||typeof row.targetId!=='string'||row.targetId.length>128||row.resolution!==undefined&&!['keep','source'].includes(row.resolution))return false}
  for(const row of value.partyChoices){draftObject(row,['key','action','targetId','expectedName'],['key','action']);if(typeof row.key!=='string'||row.key.length>1000||!['new','existing'].includes(row.action)||row.action==='existing'&&(typeof row.targetId!=='string'||row.targetId.length>128||typeof row.expectedName!=='string'||row.expectedName.length>100)||row.action==='new'&&(Object.hasOwn(row,'targetId')||Object.hasOwn(row,'expectedName')))return false}
  if(Object.hasOwn(value,'attempted')){readOpeningCutoverInput(value.attempted);for(const [form,input]of [['text','sourceText'],['cutoffDate','cutoffDate'],['currency','currency'],['masterChoices','masterChoices'],['partyChoices','partyChoices'],['declaredTotals','declaredTotals']])if(canonicalSignature(value[form])!==canonicalSignature(value.attempted[input]))return false}
  return true
 }catch{return false}
}
export function cutoverDraftInput(form,scope){if(!validCutoverDraft(form))throw Error('搬家草稿讀不到，原輸入仍保留');return makeOpeningCutoverInput(form.text,scope,form.cutoffDate,{currency:form.currency,masterChoices:form.masterChoices,partyChoices:form.partyChoices,declaredTotals:form.declaredTotals})}
export function assertCutoverPreview(input,value){
 const fail=()=>{throw Error('搬家試算回覆需要核對，原輸入仍保留。')}
 if(value?.protocol!=='pos-opening-cutover-preview/v1'||value.id!==input.id||typeof value.ready!=='boolean')fail()
 if(value.saved){let original;try{original=JSON.parse(value.saved.signature);assertOpeningCutoverResult(original,{success:true,receipt:value.saved})}catch{fail()}if(value.ready||openingCutoverSourceDigest(original)!==openingCutoverSourceDigest(input))fail();return value}
 const source=parseAgentDocument(input.sourceText,{maxBytes:250000}),plan=value.plan
 if(plan?.protocol!=='pos-opening-source-plan/v1'||canonicalSignature(plan.source)!==canonicalSignature(source.source)||plan.sourceId!==source.id||plan.cutoffDate!==input.cutoffDate||!Array.isArray(plan.masterRows)||!Array.isArray(plan.stockRows)||!Array.isArray(plan.financialRows)||!Array.isArray(plan.parties?.rows)||!Array.isArray(plan.totals))fail()
 if(plan.totals.length!==5||new Set(plan.totals.map(row=>row.key)).size!==5||plan.totals.some(row=>!cutoverTotalKeys.includes(row.key)||!Number.isSafeInteger(row.expectedCents)||row.expectedCents<0||row.declaredCents!==null&&(!Number.isSafeInteger(row.declaredCents)||row.declaredCents<0)||!['not-provided','matched','mismatch'].includes(row.status)))fail()
 if(plan.financialRows.some(row=>!Number.isSafeInteger(row.outstandingCents)||row.outstandingCents<0||!Array.isArray(row.issues))||plan.stockRows.some(row=>!Number.isSafeInteger(row.fact?.valueCents)||row.fact.valueCents<0||!Array.isArray(row.issues)))fail()
 if(value.ready&&(plan.factsReady!==true||value.review?.protocol!=='pos-opening-cutover-review/v1'||value.review.inputDigest!==openingCutoverSourceDigest(input)||canonicalSignature(value.review.scope)!==canonicalSignature(input.scope)))fail()
 return value
}
export function cutoverDisplayTotals(input){const {stock,finance}=readOpeningSourceData(openingCutoverPlanInput(input));return {stockValue:stock.totalValueCents,receivableInvoices:finance.totals.receivable.invoiceCents,receivableCredits:finance.totals.receivable.creditCents,payableInvoices:finance.totals.payable.invoiceCents,payableCredits:finance.totals.payable.creditCents}}
