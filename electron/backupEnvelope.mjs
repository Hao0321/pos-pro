import {stockLedgerDigest} from './stockLedgerModel.mjs'
import {recoveryBook,recoveryDataError,RECOVERY_FEATURES} from './recoveryBook.mjs'
import {validateRecoveryGraph} from './recoveryGraph.mjs'

export const FULL_BACKUP_FORMAT='pos-complete-backup/v1'
export function createCompleteBackup(book,protection,storage,{features=[],digest=stockLedgerDigest}={}){
 const current=recoveryBook(book,storage,{complete:true,digest}),graph=validateRecoveryGraph(protection,storage,{digest}),all=[...new Set([...features,...current.features,...graph.features])].sort()
 if(all.some(value=>!RECOVERY_FEATURES.includes(value)))throw recoveryDataError()
 const body={format:FULL_BACKUP_FORMAT,storage,storeId:current.storeId,features:all,book:structuredClone(book),protection:structuredClone(protection)}
 return {...body,checksum:digest(body)}
}
export function readCompleteBackup(input,storage,{digest=stockLedgerDigest}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw recoveryDataError()
 if(!Object.hasOwn(input,'format'))return {book:input,protection:null,features:[],legacy:true}
 const keys=['format','storage','storeId','features','book','protection','checksum']
 if(input.format!==FULL_BACKUP_FORMAT)throw Error('備份含有目前版本不支援的資料，請保留原檔並使用相容版本')
 if(Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key)))throw recoveryDataError()
 if(input.storage!==storage)throw Error(storage==='sqlite'?'請選擇桌面版匯出的備份':'請選擇瀏覽器版匯出的備份')
 const {checksum,...body}=input
 if(checksum!==digest(body)||!Array.isArray(input.features)||new Set(input.features).size!==input.features.length||input.features.some(value=>!RECOVERY_FEATURES.includes(value)))throw recoveryDataError()
 const current=recoveryBook(input.book,storage,{complete:true,digest}),graph=validateRecoveryGraph(input.protection,storage,{digest})
 if(input.storeId!==current.storeId||[...current.features,...graph.features].some(value=>!input.features.includes(value)))throw recoveryDataError()
 return {book:structuredClone(input.book),protection:structuredClone(input.protection),features:[...input.features],legacy:false}
}
export const recoveryGraphRevision=(graph,digest=stockLedgerDigest)=>digest(graph)
export function backupProtectionSummary(value){return {legacy:value.legacy,snapshots:value.protection?.snapshots.length||0,originalIds:value.protection?.originalIds.length||0,receipts:value.protection?.events.length||0}}
