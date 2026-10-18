import {warehouseRecord,warehouseText} from './warehouseRules.mjs'

// Canonical Agent data has no workbook/CSV dependency. File adapters share this
// vocabulary without making routine receipt/payment screens load a ZIP reader.
export const MIGRATION_PROTOCOL='pos-migration-draft/v1'
export const migrationEntities=['products','suppliers','customers','opening-stock','opening-receivables','opening-payables','history-reference']
const invalid=()=>Error('搬家草稿讀不到，原輸入仍保留')
const rawText=value=>{if(typeof value!=='string'||!value.trim()||value.length>128)throw invalid()}
export function readCanonicalMigrationDraft(draft){
 try{
  warehouseRecord(draft,['protocol','id','source','tables']);warehouseRecord(draft.source,['system','company'])
  if(draft.protocol!==MIGRATION_PROTOCOL)throw invalid()
  warehouseText(draft.id);for(const value of [draft.source.system,draft.source.company])rawText(value)
  if(!Array.isArray(draft.tables)||!draft.tables.length||draft.tables.length>50)throw invalid()
  let total=0
  for(const table of draft.tables){
   warehouseRecord(table,['entity','columns','rows'])
   if(!migrationEntities.includes(table.entity)||!Array.isArray(table.columns)||!table.columns.length||table.columns.length>100||new Set(table.columns).size!==table.columns.length||!Array.isArray(table.rows)||!table.rows.length||table.rows.length>5000)throw invalid()
   table.columns.forEach(rawText);total+=table.rows.length;if(total>5000)throw invalid()
   for(const row of table.rows){warehouseRecord(row,['externalId','values']);if(typeof row.externalId!=='string'||row.externalId.length>128||!Array.isArray(row.values)||row.values.length!==table.columns.length||row.values.some(value=>typeof value!=='string'||value.length>2048))throw invalid()}
  }
  return structuredClone(draft)
 }catch{throw invalid()}
}
