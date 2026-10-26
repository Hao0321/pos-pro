import {makeFinancialFileDraft,readFinancialFileDraft,financialFileIdentity,FINANCIAL_FILES_PROTOCOL} from './financialFileDraft.mjs'
import {parseAgentDocument} from './agentHandoff.mjs'
import {privateDraftDigest} from './privateDrafts.mjs'

export const MIGRATION_BATCH_PROTOCOL='pos-migration-batch/v1'
export const MIGRATION_BATCH_FEATURE='migration-source-batch-v1'
export const MIGRATION_BATCH_FENCE='migrationSourceBatchVersionFence'
export function makeMigrationBatchDraft(source,currency,files){const draft=makeFinancialFileDraft(source,currency,files);return {...draft,protocol:MIGRATION_BATCH_PROTOCOL,id:draft.id.replace(/^files-/,'batch-')}}
export function financialBatchAdapter(value){
 if(value?.protocol!==MIGRATION_BATCH_PROTOCOL||typeof value.id!=='string'||!/^batch-[a-f0-9]{48}$/.test(value.id))throw Error('這批原始檔案已變更，請保留原檔重新核對。')
 return readFinancialFileDraft({...value,protocol:FINANCIAL_FILES_PROTOCOL,id:value.id.replace(/^batch-/,'files-')})
}
export function readMigrationBatchDraft(value){const normalized=financialBatchAdapter(value),files=financialFileIdentity(normalized).files;if(new Set(files.map(privateDraftDigest)).size!==files.length)throw Error('同一份檔案選了兩次，請保留一份。');return value}
export function isMigrationBatchDraft(value){try{readMigrationBatchDraft(value);return true}catch{return false}}
export function migrationBatchSourceText(text){try{return parseAgentDocument(text,{maxBytes:250000}).protocol===MIGRATION_BATCH_PROTOCOL}catch{return false}}
export const migrationBatchIdentity=value=>({...financialFileIdentity(financialBatchAdapter(value)),protocol:MIGRATION_BATCH_PROTOCOL})
export function retainMigrationBatchFeature(book){
 const settings=new Map(book.settings.map(row=>[row.key,row]));for(const key of [MIGRATION_BATCH_FENCE,'financialFileMigrationVersionFence'])settings.set(key,{key,value:'1'});return {...book,settings:[...settings.values()]}
}
