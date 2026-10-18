import {draftObject,privateDraftDigest} from './privateDrafts.mjs'
import {makeTabularDraft,isTabularDraftSetup,projectMappedMigrationTable,suggestTabularTablePlan} from './tabularMigration.mjs'
import {readWorkbook,workbookTable} from './workbookReader.mjs'
import {protectedTabularFields,migrationColumnField} from './migrationColumns.mjs'

export const WORKBOOK_MIGRATION_PROTOCOL='pos-workbook-migration/v1'
export const WORKBOOK_MIGRATION_FEATURE='agent-workbook-migration-v1'
export const WORKBOOK_MIGRATION_FENCE='agentWorkbookMigrationVersionFence'
const fail=message=>{throw Error(message)}
const plain=value=>typeof value==='string'&&!value.includes('\0')
export const emptyWorkbookPlan=(entity='products')=>({entity,externalId:-1,mapping:[],unit:'',repairs:[]})
export function makeWorkbookDraft(source,file,currency,sheets){const body={protocol:WORKBOOK_MIGRATION_PROTOCOL,source:structuredClone(source),file:structuredClone(file),currency,sheets:structuredClone(sheets)};return {...body,id:'workbook-'+privateDraftDigest(body).slice(0,48)}}
export function isWorkbookDraftSetup(value){
 try{
  draftObject(value,['protocol','id','source','file','currency','sheets']);draftObject(value.file,['name','base64']);draftObject(value.source,['system','company'])
  if(value.protocol!==WORKBOOK_MIGRATION_PROTOCOL||typeof value.id!=='string'||!/^workbook-[a-f0-9]{48}$/.test(value.id)||!plain(value.file.name)||value.file.name.length>256||!plain(value.file.base64)||value.file.base64.length>160000||!['','TWD'].includes(value.currency)||!Array.isArray(value.sheets)||value.sheets.length>50||[value.source.system,value.source.company].some(v=>!plain(v)||v.length>128))return false
  const ids=new Set()
  return value.sheets.every(sheet=>{draftObject(sheet,['sheetId','headerRow','plan']);if(!plain(sheet.sheetId)||!sheet.sheetId||sheet.sheetId.length>128||ids.has(sheet.sheetId)||!Number.isSafeInteger(sheet.headerRow)||sheet.headerRow<0||sheet.headerRow>1048576)return false;ids.add(sheet.sheetId);return isTabularDraftSetup({protocol:'pos-tabular-migration/v1',id:'table-'+'0'.repeat(48),source:value.source,file:{name:value.file.name,text:'',delimiter:','},plan:sheet.plan})})
 }catch{return false}
}
export function workbookView(value,sheetId){const book=readWorkbook(value.file.base64),selection=value.sheets.find(s=>s.sheetId===sheetId);if(!selection)fail('請選擇要搬入的工作表。');const table=workbookTable(book,sheetId,selection.headerRow),file={name:value.file.name,text:'',delimiter:','};return {book,table,tabular:makeTabularDraft(value.source,file,selection.plan)}}
export function workbookSheetPlan(value,sheetId,headerRow,entity='products'){
 let plan=emptyWorkbookPlan(entity)
 try{const table=workbookTable(readWorkbook(value.file.base64),sheetId,headerRow);plan=suggestTabularTablePlan(table,entity)}catch{}
 return {sheetId,headerRow,plan}
}
export function suggestedWorkbookHeader(book,sheetId){
 const sheet=book.sheets.find(s=>s.id===sheetId),candidates=sheet?.rows.slice(0,20).filter(row=>['products','suppliers','customers'].some(entity=>{const fields=row.cells.map(cell=>cell.issue?'':migrationColumnField(cell.value,entity));return fields.includes('name')&&fields.filter(f=>f==='externalId').length===1}))||[]
 return candidates.length===1?candidates[0].number:0
}
export function initialWorkbookSheets(file){
 const book=readWorkbook(file.base64),sheets=[]
 for(const sheet of book.sheets.filter(s=>s.state==='visible'&&!s.unsupported)){
  const headerRow=suggestedWorkbookHeader(book,sheet.id),header=sheet.rows.find(row=>row.number===headerRow)
  if(!header)continue
  const candidates=['products','suppliers','customers'].filter(entity=>{const fields=header.cells.map(cell=>migrationColumnField(cell.value,entity));return fields.includes('name')&&fields.filter(f=>f==='externalId').length===1&&header.cells.some(cell=>/product|item|supplier|customer|member|商品|貨號|供應商|客戶|會員/i.test(cell.value))})
  if(candidates.length===1)sheets.push(workbookSheetPlan({file},sheet.id,headerRow,candidates[0]))
 }
 return sheets
}
export function workbookCellNeedsReview(issue,plan){
 const field=plan.mapping[issue.column],used=issue.column===plan.externalId||!!field
 return used&&!!(issue.issue||issue.precisionRisk&&[plan.externalId===issue.column?'externalId':field].some(f=>['externalId','barcode','phone'].includes(f))||issue.foreignCurrency&&['price','cost'].includes(field))
}
export function projectWorkbookDraft(value){
 if(!isWorkbookDraftSetup(value)||value.id!==makeWorkbookDraft(value.source,value.file,value.currency,value.sheets).id)fail('Excel 核對內容已變更，請重新看結果。')
 if([value.source.system,value.source.company].some(v=>!v.trim()))fail('請填入原系統與公司，才能保留正確的來源對照。')
 if(!value.file.name.trim())fail('表格檔名需要核對。')
 if(!value.sheets.length)fail('請選擇要搬入的工作表。')
 const tables=[]
 for(const selection of value.sheets){
  const {table}=workbookView(value,selection.sheetId),p=selection.plan
  if(p.entity==='products'&&!p.mapping.includes('currency')&&value.currency!=='TWD')fail('請核對來源幣別，目前主檔金額使用新台幣。')
  for(const issue of table.issues){
   if(!workbookCellNeedsReview(issue,p))continue
   if(protectedTabularFields.includes(p.mapping[issue.column])||protectedTabularFields.includes(migrationColumnField(table.headers[issue.column])))fail('這格涉及庫存或帳款，請先另行對帳。')
   if(issue.foreignCurrency&&['price','cost'].includes(p.mapping[issue.column]))fail('來源幣別不同，請先核對換算，原始金額仍保留。')
   const repair=p.repairs.find(r=>r.row===issue.row&&r.column===issue.column)
   if(!repair||['formula','error'].includes(issue.issue)&&repair.value===table.rows[issue.row][issue.column])fail('有公式或不明格式的儲存格，請填入已核對的值。')
  }
  tables.push(projectMappedMigrationTable(table,p))
 }
 if(tables.reduce((n,t)=>n+t.rows.length,0)>5000)fail('Excel 資料太多，請拆成較小的檔案。')
 return {...structuredClone(value),tables}
}
