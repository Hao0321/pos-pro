import {privateDraftDigest} from './privateDrafts.mjs'
import {parseAgentDocument} from './agentHandoff.mjs'
import {MIGRATION_PROTOCOL,readCanonicalMigrationDraft} from './migrationDraftSource.mjs'
import {readWorkbook} from './workbookReader.mjs'
import {makeTabularDraft} from './tabularMigration.mjs'
import {makeWorkbookDraft} from './workbookMigration.mjs'
import {openingTablesFromSource} from './openingMigrationTables.mjs'
import {readFinancialFileDraft,financialFileTable,financialFileLegacyPlan} from './financialFileDraft.mjs'
import {financialFileEntities,financialFileFields,financialFileField,assertFinancialPartyColumns,financialCellCanFill,financialFieldValue} from './financialFileColumns.mjs'

const fail=message=>{throw Error(message)},used=(p,column)=>column===p.externalId||!!p.mapping[column]
export function financialFileEffectiveTable(table,p){
 const {headers,rows}=table;if(!financialFileEntities.includes(p.entity))fail('請先確認這份是未收款還是未付款。')
 assertFinancialPartyColumns(headers,p.entity)
 if(!Number.isSafeInteger(p.externalId)||p.externalId<0||p.externalId>=headers.length)fail('請選擇原系統單據編號，不能用列號代替。')
 if(p.unit||p.mapping.length!==headers.length||p.mapping.some(field=>field&&!financialFileFields.includes(field))||new Set(p.mapping.filter(Boolean)).size!==p.mapping.filter(Boolean).length)fail('原單欄位用途重複或不完整，請核對對照。')
 for(const field of ['partyExternalId','invoiceNumber','documentType','invoiceDate','outstanding'])if(!p.mapping.includes(field))fail('請核對原單的往來編號、單號、種類、日期與未結清金額欄。')
 headers.forEach((header,column)=>{const known=financialFileField(header);if(known&&known!=='externalId'&&p.mapping[column]!==known)fail('原單已知的帳款欄位不能略過或改成其他用途。');if(!p.mapping[column]&&column!==p.externalId&&rows.some(row=>row[column].trim()))fail('原單還有未處理的欄位，整批仍保留。')})
 const effective=structuredClone(rows),seen=new Set(),issues=table.issues||[]
 for(const repair of p.repairs){
  const key=repair.row+':'+repair.column;if(seen.has(key)||!effective[repair.row]||repair.column>=headers.length||!used(p,repair.column))fail('表格修正不屬於這份來源，原文仍保留。');seen.add(key)
  const original=rows[repair.row][repair.column],field=repair.column===p.externalId?'externalId':p.mapping[repair.column],issue=issues.find(row=>row.row===repair.row&&row.column===repair.column),ack=issue&&!['formula','error'].includes(issue.issue)&&repair.value===original
  if(!ack&&!financialCellCanFill(original,field,issue)||['formula','error'].includes(issue?.issue)&&repair.value===original)fail('這格是原檔已知的數字、日期或編號，不能改成零或另一筆資料。')
  effective[repair.row][repair.column]=repair.value
 }
 for(const issue of issues){
  if(!used(p,issue.column))continue
  if(issue.foreignCurrency&&['outstanding','originalAmount','paidAmount'].includes(p.mapping[issue.column]))fail('原檔儲存格使用其他幣別，需核對換算，不能直接當新台幣。')
  if(!p.repairs.some(row=>row.row===issue.row&&row.column===issue.column))fail('有公式或不明格式的原單儲存格，請填入已核對的值。')
 }
 return effective
}
function financialTable(table,p,currency,origin,origins,tableIndex){
 const effective=financialFileEffectiveTable(table,p),columns=p.mapping.filter(Boolean),indices=p.mapping.flatMap((field,column)=>field?[column]:[]),hasCurrency=columns.includes('currency')
 if(!hasCurrency&&!currency)fail('請確認原單金額的幣別，系統不會猜成新台幣。')
 if(!hasCurrency)columns.push('currency')
 const rows=effective.map((values,row)=>{
  const cells=indices.map(column=>financialFieldValue(values[column],p.mapping[column],p));if(hasCurrency){const index=columns.indexOf('currency');if(!cells[index]&&currency)cells[index]=currency}else cells.push(currency)
  const mapping=Object.fromEntries(p.mapping.flatMap((field,column)=>field?[[field,column]]:[]));origins.set(tableIndex+':'+row,{...origin,physicalRow:table.physicalRows[row],externalIdColumn:p.externalId,columns:mapping,amountFormat:p.amountFormat,dateFormat:p.dateFormat})
  return {externalId:values[p.externalId],values:cells}
 });return {entity:p.entity,columns,rows}
}
export function projectFinancialFileSource(input,currency=''){
 const root=readFinancialFileDraft(input);if([root.source.system,root.source.company].some(value=>!value.trim()))fail('請填入原系統與公司，才能保留正確的來源對照。')
 if(!['','TWD'].includes(currency)||root.currency&&currency&&root.currency!==currency)fail('原表格幣別與核對選擇不同，請保留原檔核對。')
 const globalCurrency=root.currency||currency,tables=[],origins=new Map(),masterOrigins=new Map(),fileSources=[];let count=0,financial=0
 for(const [fileIndex,entry]of root.files.entries()){
  if(!entry.file.name.trim())fail('原始財務檔名需要核對。')
  if(entry.kind==='xlsx'){
   const actual=readWorkbook(entry.file.base64).sheets.filter(sheet=>!sheet.unsupported&&sheet.rows.length),ids=new Set(entry.sheets.map(sheet=>sheet.sheetId));if(actual.length!==ids.size||actual.some(sheet=>!ids.has(sheet.id)))fail('原檔還有未核對的工作表，不能略過帳款或歷史。')
  }
  for(const sheet of entry.sheets){
   const table=financialFileTable(entry,sheet),plan=sheet.plan,origin={kind:entry.kind==='xlsx'?'xlsx':entry.file.delimiter==='\t'?'tsv':'csv',fileIndex,fileName:entry.file.name,fileDigest:privateDraftDigest(entry.file),headerRow:entry.kind==='xlsx'?sheet.headerRow:table.headerRow,...(entry.kind==='xlsx'?{sheetId:sheet.sheetId}:{})};count+=table.rows.length;if(count>5000)fail('原始表格資料太多，請拆成較小的來源批次。')
   if(financialFileEntities.includes(plan.entity)){financial++;fileSources.push({table:tables.length,...origin});tables.push(financialTable(table,plan,globalCurrency,origin,origins,tables.length));continue}
   if(!['products','customers','suppliers'].includes(plan.entity))fail('原檔還有未分類的資料，請先核對每張表的用途。')
   const legacy=entry.kind==='csv'?makeTabularDraft(root.source,entry.file,financialFileLegacyPlan(plan)):makeWorkbookDraft(root.source,entry.file,globalCurrency,[{sheetId:sheet.sheetId,headerRow:sheet.headerRow,plan:financialFileLegacyPlan(plan)}]),projected=openingTablesFromSource(JSON.stringify(legacy),globalCurrency);if(!projected)fail('原主檔或庫存欄位需要核對，整批仍保留。')
   const base=tables.length;for(const [index,value]of projected.source.tables.entries()){tables.push(value);fileSources.push({table:base+index,...origin})}for(const [key,value]of projected.origins){const [index,row]=key.split(':');origins.set((base+Number(index))+':'+row,value)}for(const [key,value]of projected.masterOrigins||[]){const [index,row]=key.split(':');masterOrigins.set((base+Number(index))+':'+row,value)}
  }
 }
 if(!financial)fail('這份原檔沒有未收或未付款，請使用主檔與庫存搬家入口。')
 const source=readCanonicalMigrationDraft({protocol:MIGRATION_PROTOCOL,id:root.id,source:root.source,tables});return {source,origins,masterOrigins,fileSources,raw:root}
}
export function readFinancialFileSource(text,currency=''){return projectFinancialFileSource(parseAgentDocument(text,{maxBytes:250000}),currency)}
