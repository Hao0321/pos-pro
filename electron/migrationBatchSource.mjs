import {readMigrationBatchDraft,financialBatchAdapter,MIGRATION_BATCH_PROTOCOL} from './migrationBatchDraft.mjs'
import {projectOriginalFileSource,projectFinancialFileSource} from './financialFileSource.mjs'
import {parseAgentDocument} from './agentHandoff.mjs'

export function projectMigrationBatchSource(input,currency=''){
 const root=readMigrationBatchDraft(input),projected=projectOriginalFileSource(financialBatchAdapter(root),currency,{requireFinancial:false})
 return {...projected,source:{...projected.source,id:root.id},raw:root}
}
export function migrationBatchRoute(input,currency=''){
 const projected=projectMigrationBatchSource(input,currency)
 return projected.source.tables.some(row=>['opening-stock','opening-receivables','opening-payables'].includes(row.entity))?'opening-cutover':'masters'
}
export function projectMigrationBatchMasters(input){
 const projected=projectMigrationBatchSource(input)
 if(projected.source.tables.some(row=>!['products','suppliers','customers'].includes(row.entity)))throw Error('這批資料有庫存或未結帳款，請一起核對期初。')
 return projected.source
}
export function readOpeningRawSource(text,currency=''){
 const root=parseAgentDocument(text,{maxBytes:250000})
 return root?.protocol===MIGRATION_BATCH_PROTOCOL?projectMigrationBatchSource(root,currency):projectFinancialFileSource(root,currency)
}
