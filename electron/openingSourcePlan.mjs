import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {decimalUnits} from './decimalUnits.mjs'
import {salesDate} from './salesRules.mjs'
import {openingTablesFromSource} from './openingMigrationTables.mjs'
import {projectOpeningStockTables,openingDate} from './openingMigrationSource.mjs'
import {projectOpeningBalanceTables,openingBalancePartyKey,openingBalanceBatchId,openingBalancesToJournalEntries} from './openingBalanceSource.mjs'
import {projectMasterMigrationRows,assertMasterOwner} from './masterMigration.mjs'
import {projectOpeningStockRows} from './openingMigration.mjs'
import {projectOpeningBalanceParties} from './openingBalanceParties.mjs'
import {openingBalanceClaimIds,openingBalanceTimeline} from './openingBalanceLedger.mjs'
import {validateCustomerLedgerRecords} from './customerLedger.mjs'

export const OPENING_SOURCE_PLAN='pos-opening-source-plan/v1'
const fail=message=>{throw Error(message||'整份搬家來源需要重新核對，原輸入仍保留。')}
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const totalKeys=['stockValue','receivableInvoices','receivableCredits','payableInvoices','payableCredits']
function readInput(input){
 draftObject(input,['protocol','sourceText','cutoffDate','currency','scope','masterChoices','partyChoices','declaredTotals','review'],['protocol','sourceText','cutoffDate','currency','scope','masterChoices','partyChoices','declaredTotals'])
 assertPrivateDraftContext(input.scope);openingDate(input.cutoffDate)
 if(input.protocol!==OPENING_SOURCE_PLAN||!['','TWD'].includes(input.currency)||!Array.isArray(input.masterChoices)||input.masterChoices.length>5000||!Array.isArray(input.partyChoices)||input.partyChoices.length>5000)fail()
 draftObject(input.declaredTotals,totalKeys,[])
 for(const value of Object.values(input.declaredTotals))if(typeof value!=='string')fail()
 const projected=openingTablesFromSource(input.sourceText,input.currency)
 if(!projected)fail('請先核對原始檔案的欄位用途。')
 if(projected.source.tables.some(table=>table.entity==='history-reference'))fail('來源還有歷史資料，整批尚未完成；請保留原檔核對歷史搬入。')
 const stock=projectOpeningStockTables(projected,input.cutoffDate,{combined:true}),finance=projectOpeningBalanceTables(projected,input.cutoffDate,{allowEmpty:true})
 if(!stock.opening.length&&!finance.facts.length)fail('這份來源只有主檔，請用主檔搬家入口核對。')
 return {projected,stock,finance}
}
export function makeOpeningSourcePlanInput(sourceText,scope,cutoffDate,{currency='',masterChoices=[],partyChoices=[],declaredTotals={}}={}){
 const input={protocol:OPENING_SOURCE_PLAN,sourceText,cutoffDate,currency,scope:structuredClone(scope),masterChoices:structuredClone(masterChoices),partyChoices:structuredClone(partyChoices),declaredTotals:structuredClone(declaredTotals)};readInput(input);return input
}
function masterWork(parsed,input){
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
 // Canonical normalized fields are already projected by the original-file
 // adapter. This private projection is never accepted by a public v1 writer.
 return {source,bindings,choices}
}
function compareTotals(input,stock,finance){
 const expected={stockValue:stock.totalValueCents,receivableInvoices:finance.totals.receivable.invoiceCents,receivableCredits:finance.totals.receivable.creditCents,payableInvoices:finance.totals.payable.invoiceCents,payableCredits:finance.totals.payable.creditCents}
 return totalKeys.map(key=>{
  const raw=input.declaredTotals[key]??'',declaredCents=raw===''?null:decimalUnits(raw,2,Number.MAX_SAFE_INTEGER,'請核對原報表的獨立合計。')
  return {key,expectedCents:expected[key],declaredCents,status:declaredCents===null?'not-provided':declaredCents===expected[key]?'matched':'mismatch'}
 })
}
function controlTrial(parsed,storeId,cutoffDate){
 const batch={id:openingBalanceBatchId(parsed.finance.source,storeId),cutoffDate},claims=parsed.finance.facts.map(fact=>({...fact,...openingBalanceClaimIds(storeId,fact),batchId:batch.id})),entries=openingBalancesToJournalEntries(batch,claims),lines=entries.flatMap(entry=>entry.lines.map(line=>({account:line.account,debitCents:Math.round(line.debit*100),creditCents:Math.round(line.credit*100)})))
 if(parsed.stock.totalValueCents)lines.push({account:'1211',debitCents:parsed.stock.totalValueCents,creditCents:0},{account:'3902',debitCents:0,creditCents:parsed.stock.totalValueCents})
 const sums=new Map()
 for(const line of lines)sums.set(line.account,(sums.get(line.account)||0n)+BigInt(line.debitCents)-BigInt(line.creditCents))
 const accounts=[...sums].map(([account,net])=>{if(net>BigInt(Number.MAX_SAFE_INTEGER)||net<-BigInt(Number.MAX_SAFE_INTEGER))fail('期初合計超過可核對範圍。');return {account,netCents:Number(net)}})
 if(accounts.reduce((sum,row)=>sum+BigInt(row.netCents),0n)!==0n)fail('期初分錄尚未平衡，整批尚未保存。')
 return {status:'source-controls-only',persisted:false,stockCostPostimageChecked:false,lines,accounts}
}
function financialRows(parsed,parties,book,storeId){
 const existing=['receivable','payable'].flatMap(side=>openingBalanceTimeline(book.openingBalanceContext,side,(side==='receivable'?book.customerEntries:book.supplierEntries)?.length||0,storeId).at((side==='receivable'?book.customerEntries:book.supplierEntries)?.length||0).claims)
 const keys=new Set(existing.map(row=>row.key)),economic=new Set(existing.map(row=>canonicalSignature([row.side,row.customerId||row.supplierId,row.type,row.number,row.date,row.currency]))),mappings=new Map(parties.rows.map(row=>[row.key,row]))
 return parsed.finance.facts.map(fact=>{
  const target=mappings.get(fact.partyKey),issues=[]
  if(keys.has(fact.key))issues.push('financial-source-already-saved')
  if(target?.targetId&&economic.has(canonicalSignature([fact.side,target.targetId,fact.type,fact.number,fact.date,fact.currency])))issues.push('financial-invoice-already-saved')
  return {...fact,targetId:target?.targetId||'',issues}
 })
}
export function projectOpeningSourcePlan(input,book,scope,actor,now=Date.now()){
 const parsed=readInput(input);assertMasterOwner(book,actor,input.scope)
 if(!same(input.scope,scope)||input.cutoffDate>salesDate(new Date(now)))fail('店面、帳號或切換日期已變更，請保留原輸入核對。')
 const work=masterWork(parsed,input),master=projectMasterMigrationRows(work.source,book,scope,work.choices)
 // The legacy master screen shows unused columns for separate review. A
 // combined plan cannot count their populated cells as completed work.
 for(const row of master.rows){
  const binding=work.bindings.find(item=>item.table===row.table&&item.row===row.row),source=parsed.projected.source.tables[binding.sourceTable],original=source.rows[binding.sourceRow],origin=parsed.projected.masterOrigins?.get(binding.sourceTable+':'+binding.sourceRow)
  if(row.unused.some(header=>{const column=source.columns.indexOf(header);return original.values[column]?.trim()&&!(origin?.externalIdColumn===column&&original.values[column]===original.externalId)})){row.issues.push('unhandled-master-field');row.action='blocked'}
 }
 const stock=projectOpeningStockRows(parsed.stock,book,master.rows,input.cutoffDate)
 const directory=validateCustomerLedgerRecords(book.customerEntries||[],book.customerOperations||[],{storeId:scope.storeId,epoch:scope.epoch,products:book.products||[],documents:book.salesDocuments||[],salesOperations:book.salesOperations||[],cashLogs:book.cashLog||[],openShift:null,openingBalanceContext:book.openingBalanceContext})
 const parties=projectOpeningBalanceParties(parsed.finance,{storeId:scope.storeId,customers:directory.customers,suppliers:book.suppliers||[],context:book.openingBalanceContext,masterRows:master.rows},input.partyChoices),totals=compareTotals(input,parsed.stock,parsed.finance)
 const masterRows=master.rows.map(row=>{const binding=work.bindings.find(item=>item.table===row.table&&item.row===row.row),origin=parsed.projected.masterOrigins?.get(binding.sourceTable+':'+binding.sourceRow);return {...row,...binding,...(origin?{origin}: {})}}),custody=parsed.projected.source.tables.flatMap((table,tableIndex)=>table.rows.map((row,rowIndex)=>{
  const financial=table.entity==='customers'&&parsed.finance.parties.some(p=>p.side==='receivable'&&p.externalId===row.externalId)
  return {table:tableIndex,row:rowIndex,entity:table.entity,externalId:row.externalId,role:financial?'financial-customer':['products','customers','suppliers'].includes(table.entity)?'master':table.entity==='opening-stock'?'stock':'financial-document'}
 }))
 const documents=financialRows(parsed,parties,book,scope.storeId),factsReady=master.rows.every(row=>!row.issues.length)&&parties.ready&&stock.rows.every(row=>!row.issues.length)&&documents.every(row=>!row.issues.length)&&totals.every(row=>row.status!=='mismatch'),trial=controlTrial(parsed,scope.storeId,input.cutoffDate),body={source:structuredClone(parsed.projected.source.source),sourceId:parsed.projected.source.id,cutoffDate:input.cutoffDate,masterRows,stockRows:stock.rows,financialRows:documents,parties,totals,custody,trial,factsReady,writeAvailable:false}
 const review={protocol:'pos-opening-source-plan-review/v1',createdAt:now,scope:structuredClone(scope),inputDigest:privateDraftDigest({...input,review:undefined}),dataDigest:privateDraftDigest(book),planDigest:privateDraftDigest(body)}
 return {protocol:OPENING_SOURCE_PLAN,id:'opening-plan-'+privateDraftDigest([scope.storeId,body.source,body.sourceId]).slice(0,48),...body,review}
}
// A valid review proves the same facts were displayed. It is not a receipt or a
// business authorization; no database/browser API accepts this protocol yet.
export function verifyOpeningSourcePlan(input,book,scope,actor,now=Date.now()){
 const plan=projectOpeningSourcePlan(input,book,scope,actor,now),review=input.review
 if(!plan.factsReady||!review||!Number.isFinite(review.createdAt)||review.createdAt>now+5000||now-review.createdAt>15*60*1000||!same(review,{...plan.review,createdAt:review.createdAt}))fail('整份來源已更新或仍有待確認資料，請重新核對。')
 return plan
}
