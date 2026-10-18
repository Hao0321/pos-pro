import {readMigrationDraft} from '../../electron/migrationSource.mjs'
export {MIGRATION_PROTOCOL,migrationEntities,emptyMigrationDraft,validMigrationInput,migrationHandoff,readMigrationDraft} from '../../electron/migrationSource.mjs'
import {decimalUnits} from '../../electron/decimalUnits.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
// AM3/AM4: deterministic preflight only. No storage adapter or business writer
// is imported here. Suggested aliases are shown to the owner, not identity proof.
import {migrationAliases as aliases,migrationColumnAliases} from '../../electron/migrationColumns.mjs'
export function previewMigration(draft){
 draft=readMigrationDraft(JSON.stringify(draft))
 const issues=[],seen=new Set(),barcodes=new Map(),phones=new Map(),tables=[]
 const issue=(table,row,code)=>issues.push({table,row,code})
 for(const [tableIndex,table]of draft.tables.entries()){
  const mapping=Object.fromEntries(Object.keys(aliases).flatMap(field=>{const names=migrationColumnAliases(field,table.entity),matches=table.columns.flatMap((column,index)=>names.includes(column.trim().toLowerCase())?[index]:[]);if(matches.length>1)issue(tableIndex,null,'ambiguous-column');return matches.length===1?[[field,matches[0]]]:[]}))
  if(table.entity==='products'&&!Object.hasOwn(mapping,'name'))issue(tableIndex,null,'missing-name-column')
  for(const [rowIndex,row]of table.rows.entries()){
   const key=canonicalSignature([draft.source.system,draft.source.company,table.entity,row.externalId])
   if(!row.externalId.trim())issue(tableIndex,rowIndex,'missing-source-id');else if(seen.has(key))issue(tableIndex,rowIndex,'duplicate-source-id');seen.add(key)
   if(table.entity==='products'){
    if(mapping.name!==undefined&&!row.values[mapping.name].trim())issue(tableIndex,rowIndex,'missing-name')
    for(const field of ['price','cost','stock'])if(mapping[field]!==undefined)try{decimalUnits(row.values[mapping[field]],field==='stock'?3:2,field==='stock'?1e12:1e11,'invalid')}catch{issue(tableIndex,rowIndex,'invalid-'+field)}
    if(mapping.unit===undefined||!row.values[mapping.unit]?.trim())issue(tableIndex,rowIndex,'missing-unit')
    const barcode=row.values[mapping.barcode];if(barcode){if(barcodes.has(barcode))issue(tableIndex,rowIndex,'duplicate-barcode');barcodes.set(barcode,key)}
   }
   if(table.entity==='customers'){
    const phone=row.values[mapping.phone]?.replace(/[\s()-]/g,'');if(phone){if(phones.has(phone))issue(tableIndex,rowIndex,'possible-shared-phone');phones.set(phone,key)}
   }
   if(!['products','suppliers','customers'].includes(table.entity))issue(tableIndex,rowIndex,'needs-ledger-mapping')
  }
  tables.push({entity:table.entity,count:table.rows.length,mapping:Object.fromEntries(Object.entries(mapping).map(([field,index])=>[field,table.columns[index]]))})
 }
 return {protocol:'pos-migration-preview/v1',source:draft.source,id:draft.id,rows:draft.tables.reduce((sum,table)=>sum+table.rows.length,0),tables,issues,businessCommit:false,status:'preview-only',raw:structuredClone(draft)}
}
