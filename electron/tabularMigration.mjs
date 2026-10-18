import {draftObject,privateDraftDigest} from './privateDrafts.mjs'
import {tabularEntityFields,protectedTabularFields,migrationColumnField} from './migrationColumns.mjs'

export const TABULAR_MIGRATION_PROTOCOL='pos-tabular-migration/v1'
export const TABULAR_MIGRATION_FEATURE='agent-tabular-migration-v1'
export const TABULAR_MIGRATION_FENCE='agentTabularMigrationVersionFence'
const fail=message=>{throw Error(message)}
const bytes=text=>new TextEncoder().encode(text).length
const plain=value=>typeof value==='string'&&!value.includes('\0')
// A recoverable draft may lack source facts, but its display structure must be
// closed and typed before React renders dynamic field labels or cell controls.
export function isTabularDraftSetup(value){
 try{
  draftObject(value,['protocol','id','source','file','plan']);draftObject(value.source,['system','company']);draftObject(value.file,['name','text','delimiter']);draftObject(value.plan,['entity','externalId','mapping','unit','repairs'])
  const p=value.plan,fields=Object.hasOwn(tabularEntityFields,p.entity)?tabularEntityFields[p.entity]:null
  return value.protocol===TABULAR_MIGRATION_PROTOCOL&&typeof value.id==='string'&&/^table-[a-f0-9]{48}$/.test(value.id)&&[value.source.system,value.source.company].every(v=>plain(v)&&v.length<=128)&&plain(value.file.name)&&value.file.name.length<=256&&plain(value.file.text)&&value.file.text.length<=250000&&['',',','\t',';'].includes(value.file.delimiter)&&!!fields&&Number.isInteger(p.externalId)&&p.externalId>=-1&&p.externalId<100&&Array.isArray(p.mapping)&&p.mapping.length<=100&&p.mapping.every(field=>typeof field==='string'&&(field===''||fields.includes(field)||protectedTabularFields.includes(field)))&&plain(p.unit)&&p.unit.length<=128&&Array.isArray(p.repairs)&&p.repairs.length<=1000&&p.repairs.every(item=>{draftObject(item,['row','column','value']);return Number.isInteger(item.row)&&item.row>=0&&item.row<5000&&Number.isInteger(item.column)&&item.column>=0&&item.column<100&&plain(item.value)&&item.value.length<=2048})
 }catch{return false}
}
export function readDelimitedTable(text,delimiter){
 if(!plain(text)||bytes(text)>250000||!text.length||![',','\t',';'].includes(delimiter))fail('表格讀不到，請保留原檔並核對分隔符號。')
 const input=text.startsWith('\uFEFF')?text.slice(1):text,rows=[];let row=[],cell='',quoted=false,closed=false,started=false,syntax=false
 const endCell=()=>{if(cell.length>2048)fail('表格太大，請拆成較小的檔案。');row.push(cell);if(row.length>100)fail('表格太大，請拆成較小的檔案。');cell='';closed=false;started=false}
 const endRow=()=>{endCell();if(syntax||row.length!==1||row[0]!=='')rows.push(row);row=[];syntax=false;if(rows.length>5001)fail('表格太大，請拆成較小的檔案。')}
 for(let i=0;i<input.length;i++){
  const ch=input[i]
  if(quoted){if(ch==='"'){if(input[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=ch;continue}
  if(ch===delimiter){syntax=true;endCell();continue}
  if(ch==='\r'||ch==='\n'){endRow();if(ch==='\r'&&input[i+1]==='\n')i++;continue}
  if(closed||ch==='"'&&started)fail('表格引號不完整，請保留原檔並重新匯出。')
  if(ch==='"'){quoted=true;syntax=true;started=true}else{cell+=ch;started=true}
 }
 if(quoted)fail('表格引號不完整，請保留原檔並重新匯出。')
 if(started||closed||cell||row.length)endRow()
 if(rows.length<2||rows[0].some(value=>value.length>128)||rows.slice(1).some(value=>value.length!==rows[0].length))fail('表格每列的欄位數不同，請核對原檔。')
 return {headers:rows[0],rows:rows.slice(1)}
}
export function detectTableDelimiter(text){
 const candidates=[',','\t',';'].filter(delimiter=>{try{return readDelimitedTable(text,delimiter).headers.length>1}catch{return false}})
 return candidates.length===1?candidates[0]:''
}
export function suggestTabularPlan(text,delimiter,entity='products'){
 return suggestTabularTablePlan(readDelimitedTable(text,delimiter),entity)
}
export function suggestTabularTablePlan({headers},entity='products'){
 const fields=headers.map(header=>migrationColumnField(header,entity)),allowed=[...(tabularEntityFields[entity]||[]),...protectedTabularFields]
 return {entity,externalId:fields.filter(field=>field==='externalId').length===1?fields.indexOf('externalId'):-1,mapping:fields.map(field=>allowed.includes(field)&&fields.filter(value=>value===field).length===1?field:''),unit:'',repairs:[]}
}
export function makeTabularDraft(source,file,plan){
 const body={protocol:TABULAR_MIGRATION_PROTOCOL,source:structuredClone(source),file:structuredClone(file),plan:structuredClone(plan)}
 return {...body,id:'table-'+privateDraftDigest(body).slice(0,48)}
}
export function projectTabularDraft(input){
 draftObject(input,['protocol','id','source','file','plan']);draftObject(input.source,['system','company']);draftObject(input.file,['name','text','delimiter']);draftObject(input.plan,['entity','externalId','mapping','unit','repairs'])
 if(input.protocol!==TABULAR_MIGRATION_PROTOCOL||input.id!==makeTabularDraft(input.source,input.file,input.plan).id)fail('表格核對內容已變更，請重新看結果。')
 if([input.source.system,input.source.company].some(value=>!plain(value)||!value.trim()||value.length>128))fail('請填入原系統與公司，才能保留正確的來源對照。')
 if(!plain(input.file.name)||!input.file.name.trim()||input.file.name.length>256)fail('表格檔名需要核對。')
 return {...structuredClone(input),tables:[projectMappedMigrationTable(readDelimitedTable(input.file.text,input.file.delimiter),input.plan)]}
}
export function projectMappedMigrationTable({headers,rows},p){
 draftObject(p,['entity','externalId','mapping','unit','repairs'])
 if(!Array.isArray(headers)||!headers.length||headers.length>100||headers.some(h=>!plain(h)||h.length>128)||!Array.isArray(rows)||!rows.length||rows.length>5000||rows.some(row=>!Array.isArray(row)||row.length!==headers.length||row.some(v=>!plain(v)||v.length>2048)))fail('表格讀不到，請保留原檔並核對分隔符號。')
 const fields=tabularEntityFields[p.entity]
 if(!fields||!Number.isInteger(p.externalId)||p.externalId<0||p.externalId>=headers.length)fail('請選擇原系統編號欄，不能用列號代替。')
 if(!Array.isArray(p.mapping)||p.mapping.length!==headers.length||p.mapping.some(field=>typeof field!=='string'||field&&!fields.includes(field)&&!protectedTabularFields.includes(field))||new Set(p.mapping.filter(Boolean)).size!==p.mapping.filter(Boolean).length||p.mapping[p.externalId])fail('欄位用途重複或不完整，請核對對照。')
 if(!plain(p.unit)||p.unit.length>128||p.unit&&p.entity!=='products'||p.unit&&p.mapping.includes('unit'))fail('共同單位與來源單位重複，請選擇其中一種。')
 headers.forEach((header,index)=>{const field=migrationColumnField(header);if(protectedTabularFields.includes(field)&&p.mapping[index]!==field)fail('庫存、儲值與帳款欄位必須保留核對。')})
 if(!Array.isArray(p.repairs)||p.repairs.length>1000)fail('表格修正需要核對，原文仍保留。')
 const effective=structuredClone(rows),seen=new Set()
 for(const repair of p.repairs){
  draftObject(repair,['row','column','value']);const key=repair.row+':'+repair.column
  if(!Number.isInteger(repair.row)||!Number.isInteger(repair.column)||repair.row<0||repair.row>=rows.length||repair.column<0||repair.column>=headers.length||!plain(repair.value)||repair.value.length>2048||seen.has(key))fail('表格修正需要核對，原文仍保留。')
  if(protectedTabularFields.includes(p.mapping[repair.column]))fail('庫存、儲值與帳款要另行對帳，不能在主檔修成零。')
  seen.add(key);effective[repair.row][repair.column]=repair.value
 }
 if(effective.some(values=>values[p.externalId].length>128))fail('原系統編號太長，請核對來源欄位。')
 const columns=headers.map((header,index)=>p.mapping[index]||('來源欄 '+(index+1)+' · '+header).slice(0,128));if(p.unit)columns.push('unit')
 return {entity:p.entity,columns,rows:effective.map(values=>({externalId:values[p.externalId],values:p.unit?[...values,p.unit]:values}))}
}
