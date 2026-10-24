import {draftObject,privateDraftDigest} from './privateDrafts.mjs'
import {readDelimitedTable} from './tabularMigration.mjs'
import {readWorkbook,workbookTable} from './workbookReader.mjs'
import {financialFileEntities,financialFileFields,financialAmountFormats,financialDateFormats,suggestFinancialFilePlan,isFinancialFileTable} from './financialFileColumns.mjs'
import {suggestTabularTablePlan} from './tabularMigration.mjs'
import {migrationColumnField,tabularEntityFields,protectedTabularFields} from './migrationColumns.mjs'

export const FINANCIAL_FILES_PROTOCOL='pos-financial-file-migration/v1'
export const FINANCIAL_FILES_FEATURE='financial-file-migration-v1'
export const FINANCIAL_FILES_FENCE='financialFileMigrationVersionFence'
export const financialFilePlanFields=['entity','externalId','mapping','unit','repairs','amountFormat','dateFormat']
const plain=(value,max)=>typeof value==='string'&&!value.includes('\0')&&value.length<=max
export const financialFileLegacyPlan=plan=>Object.fromEntries(['entity','externalId','mapping','unit','repairs'].map(key=>[key,structuredClone(plan[key])]))
export const financialFileIdentity=value=>({protocol:FINANCIAL_FILES_PROTOCOL,source:structuredClone(value.source),files:value.files.map(({kind,file})=>({kind,file:kind==='csv'?{name:file.name,text:file.text}:{name:file.name,base64:file.base64}})).map(file=>({file,key:privateDraftDigest(file)})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(row=>row.file)})
export function makeFinancialFileDraft(source,currency,files){const body={protocol:FINANCIAL_FILES_PROTOCOL,source:structuredClone(source),currency,files:structuredClone(files)};return {...body,id:'files-'+privateDraftDigest(financialFileIdentity(body)).slice(0,48)}}
export function isFinancialFileDraft(value){
 try{
  draftObject(value,['protocol','id','source','currency','files']);draftObject(value.source,['system','company'])
  if(value.protocol!==FINANCIAL_FILES_PROTOCOL||!/^files-[a-f0-9]{48}$/.test(value.id)||!['','TWD'].includes(value.currency)||![value.source.system,value.source.company].every(text=>plain(text,128))||!Array.isArray(value.files)||!value.files.length||value.files.length>20)return false
  if(new TextEncoder().encode(JSON.stringify(value)).length>250000)return false
  let sheets=0,bytes=0
  return value.files.every(entry=>{
   draftObject(entry,['kind','file','sheets']);if(!['csv','xlsx'].includes(entry.kind)||!Array.isArray(entry.sheets)||!entry.sheets.length||entry.sheets.length>50)return false
   draftObject(entry.file,entry.kind==='csv'?['name','text','delimiter']:['name','base64']);if(!plain(entry.file.name,256)||entry.kind==='csv'&&(!plain(entry.file.text,80000)||!['',',','\t',';'].includes(entry.file.delimiter))||entry.kind==='xlsx'&&!plain(entry.file.base64,160000))return false
   const size=new TextEncoder().encode(entry.kind==='csv'?entry.file.text:entry.file.base64).length;if(entry.kind==='csv'&&size>80000)return false;bytes+=size;if(bytes>200000)return false
   const seen=new Set()
   return entry.sheets.every(sheet=>{
    if(++sheets>50)return false;draftObject(sheet,['sheetId','headerRow','plan']);if(!plain(sheet.sheetId,128)||!sheet.sheetId||seen.has(sheet.sheetId)||!Number.isSafeInteger(sheet.headerRow)||sheet.headerRow<0||sheet.headerRow>1048576)return false;seen.add(sheet.sheetId)
    const p=sheet.plan;draftObject(p,financialFilePlanFields);if(!['',...financialFileEntities,...Object.keys(tabularEntityFields)].includes(p.entity)||!Number.isSafeInteger(p.externalId)||p.externalId< -1||p.externalId>=100||!Array.isArray(p.mapping)||p.mapping.length>100||p.mapping.some(field=>!plain(field,128)||field&&!financialFileFields.includes(field)&&!Object.values(tabularEntityFields).some(fields=>fields.includes(field))&&!protectedTabularFields.includes(field))||!plain(p.unit,128)||!financialAmountFormats.includes(p.amountFormat)||!financialDateFormats.includes(p.dateFormat)||!Array.isArray(p.repairs)||p.repairs.length>1000)return false
    return p.repairs.every(row=>{draftObject(row,['row','column','value']);return Number.isSafeInteger(row.row)&&row.row>=0&&row.row<5000&&Number.isSafeInteger(row.column)&&row.column>=0&&row.column<100&&plain(row.value,2048)})
   })
  })
 }catch{return false}
}
export function readFinancialFileDraft(value){if(!isFinancialFileDraft(value)||value.id!==makeFinancialFileDraft(value.source,value.currency,value.files).id)throw Error('原始財務表格的核對內容已變更，請保留原檔重新核對。');return value}
export function financialFileTable(entry,sheet){
 if(entry.kind==='csv'){if(entry.sheets.length!==1||sheet.sheetId!=='csv'||sheet.headerRow!==0)throw Error('原始表格的來源列需要核對。');return readDelimitedTable(entry.file.text,entry.file.delimiter,{physicalRows:true})}
 return workbookTable(readWorkbook(entry.file.base64),sheet.sheetId,sheet.headerRow)
}
export function financialFileSuggestedPlan(table,entity=null){
 if(entity&&financialFileEntities.includes(entity)||!entity&&isFinancialFileTable(table.headers))return suggestFinancialFilePlan(table.headers,entity||undefined)
 const candidates=['products','suppliers','customers'].filter(name=>{const fields=table.headers.map(header=>migrationColumnField(header,name));return fields.includes('name')&&fields.filter(field=>field==='externalId').length===1&&table.headers.some(header=>new RegExp(name==='products'?'product|item|商品|貨號':name==='suppliers'?'supplier|供應商':'customer|member|客戶|會員','i').test(header))})
 const choice=entity|| (candidates.length===1?candidates[0]:'');return {...(choice?suggestTabularTablePlan(table,choice):{entity:'',externalId:-1,mapping:table.headers.map(()=>''),unit:'',repairs:[]}),amountFormat:'decimal-dot',dateFormat:'iso'}
}
export function financialWorkbookSheets(file){
 const book=readWorkbook(file.base64),sheets=[]
 for(const sheet of book.sheets.filter(row=>!row.unsupported&&row.rows.length)){
  const candidates=sheet.rows.slice(0,20).filter(row=>{const headers=row.cells.map(cell=>cell.issue?'':cell.value);return isFinancialFileTable(headers)||['products','suppliers','customers'].some(entity=>{const fields=headers.map(header=>migrationColumnField(header,entity));return fields.includes('name')&&fields.filter(field=>field==='externalId').length===1})}),headerRow=candidates.length===1?candidates[0].number:0
  let plan={entity:'',externalId:-1,mapping:[],unit:'',repairs:[],amountFormat:'decimal-dot',dateFormat:'iso'};if(headerRow)plan=financialFileSuggestedPlan(workbookTable(book,sheet.id,headerRow));sheets.push({sheetId:sheet.id,headerRow,plan})
 }
 return sheets
}
export function financialWorkbookCanRoute(file){try{return readWorkbook(file.base64).sheets.some(sheet=>sheet.rows.slice(0,20).some(row=>isFinancialFileTable(row.cells.map(cell=>cell.issue?'':cell.value))))}catch{return false}}
