import {readWorkbookFile} from './workbookMigrationFile'
import {readTabularText} from './tabularMigrationFile'
import {detectTableDelimiter,readDelimitedTable} from '../../electron/tabularMigration.mjs'
import {makeFinancialFileDraft,isFinancialFileDraft,financialWorkbookSheets,financialFileSuggestedPlan} from '../../electron/financialFileDraft.mjs'
import {financialFileFields,financialFileField,financialFieldValue,financialCellCanFill} from '../../electron/financialFileColumns.mjs'
import {decimalUnits} from '../../electron/decimalUnits.mjs'
import {openingDate} from '../../electron/openingMigrationSource.mjs'

export async function readFinancialIntakeFiles(inputs){
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>20)throw Error('請一次選擇二十份以內的原始表格。')
 const entries=[]
 for(const file of inputs){
  if(/\.xlsx$/i.test(file.name)){const data=await readWorkbookFile(file);entries.push({kind:'xlsx',file:data,sheets:financialWorkbookSheets(data)});continue}
  if(!/\.(csv|tsv)$/i.test(file.name))throw Error('請選擇原始 CSV、TSV 或 XLSX 表格。')
  const text=await readTabularText(file),delimiter=detectTableDelimiter(text);let plan={entity:'',externalId:-1,mapping:[],unit:'',repairs:[],amountFormat:'decimal-dot',dateFormat:'iso'};if(delimiter)plan=financialFileSuggestedPlan(readDelimitedTable(text,delimiter));entries.push({kind:'csv',file:{name:file.name,text,delimiter},sheets:[{sheetId:'csv',headerRow:0,plan}]})
 }
 return entries
}
export function checkedFinancialDraft(source,currency,files){const draft=makeFinancialFileDraft(source,currency,files);if(!isFinancialFileDraft(draft))throw Error('這批原始表格太大或仍不支援，原草稿已保留。');return draft}
export function financialIntakeCells(table,plan,currency=''){
 const issues=new Map((table.issues||[]).map(row=>[row.row+':'+row.column,row])),repairs=new Map(plan.repairs.map(row=>[row.row+':'+row.column,row])),typeColumn=plan.mapping.indexOf('documentType'),result=[]
 for(const [row,values]of table.rows.entries())for(const [column,original]of values.entries()){
  const identity=column===plan.externalId,field=identity?'externalId':plan.mapping[column];if(!identity&&!financialFileFields.includes(field))continue
  const repair=repairs.get(row+':'+column),raw=repair?.value??original,issue=issues.get(row+':'+column),required=identity||['partyExternalId','invoiceNumber','documentType','invoiceDate','outstanding'].includes(field)||field==='dueDate'&&['invoice','發票','請款'].includes(values[typeColumn]?.trim().toLowerCase()),unknown=required&&!raw.trim();let invalid=false
  try{const value=financialFieldValue(raw,field,plan);if(['outstanding','originalAmount','paidAmount'].includes(field)&&value)decimalUnits(value.startsWith('-')&&field!=='paidAmount'?value.slice(1):value,2,1e11,'invalid');if(['invoiceDate','dueDate','cutoffDate'].includes(field)&&value)openingDate(value);if(field==='currency'&&raw&&raw!=='TWD')invalid=true;if(field==='currency'&&!raw&&!currency)invalid=true}catch{invalid=true}
  if(issue?.foreignCurrency&&['outstanding','originalAmount','paidAmount'].includes(field))invalid=true
  if(unknown||invalid||issue&&!repair||repair)result.push({row,column,field,original,raw,issue,unknown,invalid,resolved:!!repair&&!invalid&&!unknown,canFill:financialCellCanFill(original,field,issue),ack:!!issue&&!repair&&!['formula','error'].includes(issue.issue)&&!invalid&&!unknown})
 }
 return result
}
export function financialKnownColumn(header){return financialFileField(header)}
