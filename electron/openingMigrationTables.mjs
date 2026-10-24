import {parseAgentDocument} from './agentHandoff.mjs'
import {readMigrationDraft} from './migrationSource.mjs'
import {makeTabularDraft,isTabularDraftSetup,readDelimitedTable,projectMappedMigrationTable} from './tabularMigration.mjs'
import {makeWorkbookDraft,isWorkbookDraftSetup,workbookView} from './workbookMigration.mjs'
import {migrationColumnField} from './migrationColumns.mjs'
import {decimalUnits} from './decimalUnits.mjs'
const bad=message=>{throw Error(message)},norm=s=>s.trim().toLowerCase().replace(/[\s_-]/g,'')
const valueHeaders=['inventoryvalue','stockvalue','stockvaluationvalue','endingstockvalue','庫存價值','庫存總成本','庫存金額','期初庫存金額','期末庫存金額']
const rateHeaders=['valuationrate','stockvaluationrate','inventoryvaluationrate','openingunitcost','庫存評價單價','庫存單位成本','期初單位成本']
const dateHeaders=['cutoffdate','asofdate','postingdate','開帳日','切換日','庫存日期','截止日期']
const custodyHeaders=['batch','batchno','batchnumber','lot','lotno','lotnumber','serialno','serialnumber','warehouse','warehouseid','warehousecode','location','locationid','locationcode','expirydate','expirationdate','批號','批次','倉庫','倉庫編號','庫位','儲位','儲位編號','效期','到期日','序號']
export const isOpeningValueHeader=header=>valueHeaders.includes(norm(header))
export function openingDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))bad('請填寫確定的切換日期。');const date=new Date(value+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)bad('請填寫確定的切換日期。');return value}
// A number outside this book's supported precision/range is still a known
// numeric fact. It needs reconciliation, never an editable replacement zero.
const knownNumber=raw=>typeof raw==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())
const knownDate=raw=>{try{openingDate(raw);return true}catch{return false}}
export function openingValuationRateUnits(raw){
 if(typeof raw!=='string'||raw.trim().length>32||!/^(?:\d+(?:\.\d{0,12})?|\.\d{1,12})$/.test(raw.trim()))bad('期初單位成本需要核對，最多十二位小數。')
 const [whole,fraction='']=raw.trim().split('.');return BigInt((whole||'0')+fraction.padEnd(12,'0'))
}
function unique(headers,test){const matches=headers.flatMap((header,i)=>test(header)?[i]:[]);if(matches.length>1)bad('期初欄位用途重複，請核對來源欄位。');return matches[0]??-1}
export function rawOpeningTables(sourceText){
 const root=parseAgentDocument(sourceText,{maxBytes:250000});let parts=[]
 if(root.protocol==='pos-migration-draft/v1'){const source=readMigrationDraft(sourceText);return {root:source,kind:'agent',parts:source.tables.map((table,index)=>({entity:table.entity,table:{headers:table.columns,rows:table.rows.map(r=>r.values)},externalIds:table.rows.map(r=>r.externalId),origin:{kind:'agent',table:index}}))}}
 if(root.protocol==='pos-tabular-migration/v1'){
  if(!isTabularDraftSetup(root)||root.id!==makeTabularDraft(root.source,root.file,root.plan).id)bad('表格核對內容已變更，請重新看結果。')
  if(new TextEncoder().encode(root.file.text).length>80000)bad('表格太大，請拆成較小的檔案。')
  parts=[{entity:root.plan.entity,plan:root.plan,table:readDelimitedTable(root.file.text,root.file.delimiter,{physicalRows:true}),origin:{kind:root.file.delimiter==='\t'?'tsv':'csv'}}]
 }else if(root.protocol==='pos-workbook-migration/v1'){
  if(!isWorkbookDraftSetup(root)||root.id!==makeWorkbookDraft(root.source,root.file,root.currency,root.sheets).id)bad('Excel 核對內容已變更，請重新看結果。')
  if(!root.sheets.length)bad('請選擇要搬入的工作表。')
  parts=root.sheets.map(sheet=>({entity:sheet.plan.entity,plan:sheet.plan,table:workbookView(root,sheet.sheetId).table,origin:{kind:'xlsx',sheetId:sheet.sheetId,headerRow:sheet.headerRow}}))
 }else return null
 if([root.source.system,root.source.company].some(v=>!v.trim())||!root.file.name.trim())bad('請填入原系統與公司，才能保留正確的來源對照。')
 if(parts.reduce((n,p)=>n+p.table.rows.length,0)>5000)bad('Excel 資料太多，請拆成較小的檔案。')
 return {root,kind:root.protocol==='pos-workbook-migration/v1'?'xlsx':'table',parts}
}
function roles(part){const {headers}=part.table;return {quantity:unique(headers,h=>migrationColumnField(h,part.entity)==='stock'),value:unique(headers,isOpeningValueHeader),rate:unique(headers,h=>rateHeaders.includes(norm(h))),date:unique(headers,h=>dateHeaders.includes(norm(h))),currency:unique(headers,h=>migrationColumnField(h)==='currency')}}
export function openingSourceCanRoute(sourceText){try{const raw=rawOpeningTables(sourceText);if(!raw)return false;if(raw.kind==='agent')return raw.root.tables.some(t=>t.entity==='opening-stock');return raw.parts.some(p=>{const r=roles(p);return p.entity==='products'&&r.quantity>=0&&(r.value>=0||r.rate>=0)})}catch{return false}}
export function openingSourceNeedsCurrency(sourceText){try{const raw=rawOpeningTables(sourceText);if(!raw||raw.kind==='agent'||raw.root.currency==='TWD')return false;return raw.parts.some(p=>{const r=roles(p);return p.entity==='products'&&r.quantity>=0&&(r.value>=0||r.rate>=0)&&(r.currency<0||p.table.rows.some(v=>!v[r.currency].trim()))})}catch{return false}}
export function openingSourceDate(sourceText){try{const raw=rawOpeningTables(sourceText),dates=new Set();if(!raw)return '';for(const part of raw.parts){const index=unique(part.table.headers,h=>dateHeaders.includes(norm(h)));if(index>=0)part.table.rows.forEach((row,ri)=>{const value=part.plan?.repairs.find(r=>r.row===ri&&r.column===index)?.value??row[index];if(value.trim())dates.add(value)})}return dates.size===1?[...dates][0]:''}catch{return ''}}
export function openingSourceFacts(sourceText){
 try{
  const raw=rawOpeningTables(sourceText),facts=[];if(!raw||raw.kind==='agent')return facts
  raw.parts.forEach((part,partIndex)=>{const r=roles(part);if(part.entity!=='products'||r.quantity<0||r.value<0&&r.rate<0)return
   part.table.rows.forEach((row,rowIndex)=>{
    const current=column=>part.plan.repairs.find(item=>item.row===rowIndex&&item.column===column)?.value??row[column],hasTotal=r.value>=0&&current(r.value)!==''
    for(const column of [r.quantity,hasTotal||r.rate<0?r.value:r.rate,...(r.date>=0&&(row[r.date].trim()||part.table.issues?.some(i=>i.row===rowIndex&&i.column===r.date))?[r.date]:[])].filter(i=>i>=0)){
     const original=row[column],issue=part.table.issues?.find(item=>item.row===rowIndex&&item.column===column),repair=part.plan.repairs.find(item=>item.row===rowIndex&&item.column===column);let known=false
     known=column===r.date?knownDate(original):knownNumber(original);let supported=false
     try{if(column===r.date)openingDate(original);else if(column===r.rate)openingValuationRateUnits(original);else decimalUnits(original,column===r.quantity?3:2,column===r.quantity?1e12:Number.MAX_SAFE_INTEGER,'invalid');supported=true}catch{}
     if(known&&supported&&!issue&&!repair)continue
     const blockedReason=issue?.foreignCurrency?'currency':known&&!supported?'range':'',acknowledge=known&&supported&&!!issue&&!blockedReason&&!['formula','error'].includes(issue.issue)
     facts.push({part:partIndex,row:rowIndex,column,kind:column===r.date?'date':column===r.quantity?'quantity':column===r.value?'value':'rate',externalId:row[part.plan.externalId]||'',physicalRow:part.table.physicalRows[rowIndex],sheetId:part.origin.sheetId||'',label:part.table.headers[column],original,value:current(column),canEdit:!known&&!blockedReason,acknowledge,reviewed:!!repair,blocked:!!blockedReason,blockedReason})
    }
   })
  });return facts
 }catch{return []}
}
export function replaceOpeningSourceFact(sourceText,fact,value){
 const raw=rawOpeningTables(sourceText),part=raw?.parts[fact.part]
 if(!part||raw.kind==='agent'||!openingSourceFacts(sourceText).some(item=>item.part===fact.part&&item.row===fact.row&&item.column===fact.column&&(item.canEdit||item.acknowledge&&item.original===value)))bad('已知的期初數量與價值不能改成別的數字，請核對原資料。')
 const plan={...part.plan,repairs:[...part.plan.repairs.filter(item=>item.row!==fact.row||item.column!==fact.column),{row:fact.row,column:fact.column,value}]},root=raw.root
 return JSON.stringify(raw.kind==='xlsx'?makeWorkbookDraft(root.source,root.file,root.currency,root.sheets.map((sheet,index)=>index===fact.part?{...sheet,plan}:sheet)):makeTabularDraft(root.source,root.file,plan))
}
// A new policy applies to fresh master requests only. Historical source decoders
// and receipts keep their original vocabulary and meaning.
export function assertNoUnhandledOpeningValue(sourceText){
 const raw=rawOpeningTables(sourceText);if(!raw)return
 for(const p of raw.parts)for(const [column,header]of p.table.headers.entries())if(isOpeningValueHeader(header)){
  if(['price','cost'].includes(p.plan?.mapping[column]))bad('庫存價值欄位不能當成售價，請核對欄位用途。')
  if(p.plan?.repairs.some(r=>r.column===column))bad('來源還有庫存價值，請用期初庫存流程核對。')
  for(const row of p.table.rows){let zero=false;try{zero=decimalUnits(row[column],2,Number.MAX_SAFE_INTEGER,'invalid')===0}catch{}if(!zero)bad('來源還有庫存價值，請用期初庫存流程核對。')}
 }
}
function effectiveTable(part,r){
 const p=part.plan,{headers,rows,issues=[]}=part.table,financial=new Set([r.quantity,r.value,r.rate,r.date].filter(i=>i>=0)),effective=structuredClone(rows),ordinary=[],seen=new Set()
 for(const item of p.repairs){
  const key=item.row+':'+item.column;if(seen.has(key)||item.row>=rows.length||item.column>=headers.length)bad('表格修正需要核對，原文仍保留。');seen.add(key)
  if(financial.has(item.column)){
   const issue=issues.find(v=>v.row===item.row&&v.column===item.column),original=rows[item.row][item.column],known=item.column===r.date?knownDate(original):knownNumber(original)
   if(known&&(item.value!==original||!issue))bad('已知的期初數量與價值不能改成別的數字，請核對原資料。')
   if(issue?.foreignCurrency)bad('來源幣別不同，請先核對換算，原始金額仍保留。')
   effective[item.row][item.column]=item.value
  }else ordinary.push(item)
 }
 const mapped=projectMappedMigrationTable({headers,rows:effective},{...p,repairs:ordinary})
 for(const issue of issues){
  const openingUsed=issue.column===r.quantity||issue.column===r.value||issue.column===r.date||issue.column===r.rate&&(r.value<0||!effective[issue.row]?.[r.value]),masterUsed=issue.column===p.externalId||!!p.mapping[issue.column]&&!financial.has(issue.column)
  if(!openingUsed&&!masterUsed)continue
  const repair=p.repairs.find(v=>v.row===issue.row&&v.column===issue.column),monetary=openingUsed&&![r.quantity,r.date].includes(issue.column)||['price','cost'].includes(p.mapping[issue.column])
  if(issue.foreignCurrency&&monetary)bad('來源幣別不同，請先核對換算，原始金額仍保留。')
  if((issue.issue||issue.precisionRisk&&(openingUsed||issue.column===p.externalId||['barcode','phone'].includes(p.mapping[issue.column])))&&(!repair||['formula','error'].includes(issue.issue)&&repair.value===rows[issue.row][issue.column]))bad('有公式或不明格式的儲存格，請填入已核對的值。')
 }
 return {mapped,effective}
}
export function openingTablesFromSource(sourceText,currency=''){
 const raw=rawOpeningTables(sourceText);if(!raw)return null
 if(raw.kind==='agent')return {source:raw.root,origins:new Map(),masterOrigins:new Map()}
 const tables=[],origins=new Map(),masterOrigins=new Map(),globalCurrency=raw.root.currency||currency
 const retainMasterOrigin=(table,part,externalIdColumn)=>part.table.rows.forEach((_,row)=>masterOrigins.set(table+':'+row,{...part.origin,physicalRow:part.table.physicalRows[row],externalIdColumn}))
 for(const part of raw.parts){
  const r=roles(part),opening=part.entity==='products'&&r.quantity>=0&&(r.value>=0||r.rate>=0)
  if(!opening){retainMasterOrigin(tables.length,part,part.plan.externalId);tables.push(projectMappedMigrationTable(part.table,part.plan));continue}
  for(const [index,header]of part.table.headers.entries())if(custodyHeaders.includes(norm(header))&&part.table.rows.some(row=>row[index].trim()))bad('來源還有批號、倉庫或庫位，請先核對，整批尚未保存。')
  for(const index of [r.value,r.rate].filter(i=>i>=0))if(part.plan.mapping[index]&&!['cost'].includes(part.plan.mapping[index]))bad('庫存價值欄位不能當成售價，請核對欄位用途。')
  const {mapped,effective}=effectiveTable(part,r),removed=new Set([r.value,r.rate].filter(i=>i>=0)),master={...mapped,columns:mapped.columns.filter((_,i)=>!removed.has(i)),rows:mapped.rows.map(row=>({...row,values:row.values.filter((_,i)=>!removed.has(i))}))}
  for(const [index,field]of part.plan.mapping.entries())if(['balance','points','totalSpent'].includes(field))for(const row of effective){let zero=false;try{zero=decimalUnits(row[index],2,Number.MAX_SAFE_INTEGER,'invalid')===0}catch{}if(!zero)bad('這份資料還有帳款或歷史，請先另行對帳，整批尚未保存。')}
  // A valuation export often has no selling price. It can use an existing
  // permanent product mapping; it cannot manufacture a zero-priced product.
  if(part.plan.mapping.includes('price')){retainMasterOrigin(tables.length,part,part.plan.externalId-[...removed].filter(index=>index<part.plan.externalId).length);tables.push(master)}
  const tableIndex=tables.length,columns=['productExternalId','quantity','value','unit','currency',...(r.rate>=0?['unitCost']:[]),...(r.date>=0?['cutoffDate']:[])],unitColumn=part.plan.mapping.indexOf('unit')
  const rows=mapped.rows.map((row,index)=>{
   const original=effective[index],value=r.value>=0?original[r.value]:'',rate=r.rate>=0&&!value?original[r.rate]:'',unit=unitColumn>=0?row.values[unitColumn]:part.plan.unit,originalCurrency=r.currency>=0?original[r.currency]:'',code=originalCurrency.trim()?originalCurrency.trim().toUpperCase():globalCurrency
   if(!code)bad('請確認原庫存金額的幣別。')
   const values=[row.externalId,original[r.quantity],value,unit,code,...(r.rate>=0?[rate]:[]),...(r.date>=0?[original[r.date]]:[])]
   origins.set(tableIndex+':'+index,{...part.origin,physicalRow:part.table.physicalRows[index],...(part.origin.kind==='xlsx'?{}:{headerRow:part.table.headerRow}),quantityColumn:r.quantity,...(r.value>=0?{valueColumn:r.value}:{}),...(r.rate>=0?{valuationRateColumn:r.rate}:{}),basis:value?'source-total':'calculated-valuation-rate'})
   return {externalId:row.externalId,values}
  })
  tables.push({entity:'opening-stock',columns,rows})
 }
 return {source:{protocol:'pos-migration-draft/v1',id:raw.root.id,source:structuredClone(raw.root.source),tables},origins,masterOrigins}
}
