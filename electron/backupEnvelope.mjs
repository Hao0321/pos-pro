import {stockLedgerDigest} from './stockLedgerModel.mjs'
import {recoveryBook,recoveryDataError,RECOVERY_FEATURES,recoveryFeatureFloor} from './recoveryBook.mjs'
import {validateRecoveryGraph,portableRecoveryGraph,emptyRecoveryGraph} from './recoveryGraph.mjs'
import {detectBookStorage,convertStorageBook,assertConversionReversible} from './storageConversion.mjs'
import {bookToBrowser} from './recoveryRules.mjs'

export const FULL_BACKUP_FORMAT='pos-complete-backup/v1'
export function createCompleteBackup(book,protection,storage,{features=[],digest=stockLedgerDigest}={}){
 const current=recoveryBook(book,storage,{complete:true,digest}),graph=validateRecoveryGraph(protection,storage,{digest}),all=[...new Set([...features,...current.features,...graph.features])].sort()
 if(all.some(value=>!RECOVERY_FEATURES.includes(value)))throw recoveryDataError()
 if(all.includes('restaurant-menu-v1')&&protection.version<7)throw recoveryDataError()
 if(all.includes('restaurant-public-menu-v1')&&protection.version<8)throw recoveryDataError()
 if(all.includes('agent-master-migration-v1')&&protection.version<10)throw recoveryDataError()
 if(all.includes('opening-cutover-v1')&&protection.version<14)throw recoveryDataError()
 if(all.includes('stock-opening-migration-v1')&&protection.version<13)throw recoveryDataError()
 if(all.includes('agent-workbook-migration-v1')&&protection.version<12)throw recoveryDataError()
 if(all.includes('agent-tabular-migration-v1')&&protection.version<11)throw recoveryDataError()
 if(all.includes('private-quick-drafts-v1')&&protection.version<9)throw recoveryDataError()
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
 if(input.features.includes('restaurant-menu-v1')&&input.protection.version<7)throw recoveryDataError()
 if(input.features.includes('restaurant-public-menu-v1')&&input.protection.version<8)throw recoveryDataError()
 if(input.features.includes('agent-master-migration-v1')&&input.protection.version<10)throw recoveryDataError()
 if(input.features.includes('opening-cutover-v1')&&input.protection.version<14)throw recoveryDataError()
 if(input.features.includes('stock-opening-migration-v1')&&input.protection.version<13)throw recoveryDataError()
 if(input.features.includes('agent-workbook-migration-v1')&&input.protection.version<12)throw recoveryDataError()
 if(input.features.includes('agent-tabular-migration-v1')&&input.protection.version<11)throw recoveryDataError()
 if(input.features.includes('private-quick-drafts-v1')&&input.protection.version<9)throw recoveryDataError()
 if(input.storeId!==current.storeId||[...current.features,...graph.features].some(value=>!input.features.includes(value)))throw recoveryDataError()
 return {book:structuredClone(input.book),protection:structuredClone(input.protection),features:[...input.features],legacy:false}
}
export const recoveryGraphRevision=(graph,digest=stockLedgerDigest)=>digest(graph)
export function readPortableBackup(input,storage,options={}){
 const origin=Object.hasOwn(input??{},'format')?input.storage:detectBookStorage(input)
 if(!['sqlite','browser'].includes(origin)||!['sqlite','browser'].includes(storage))throw recoveryDataError()
 const incoming=readCompleteBackup(input,origin,options),checked=recoveryBook(incoming.book,origin,{complete:!incoming.legacy,...options})
 const features=[...new Set([...incoming.features,...checked.features])].sort()
 if(origin===storage)return {...incoming,features,protection:incoming.protection??(features.includes('cross-storage-v1')?emptyRecoveryGraph(2):null),sourceStorage:origin,converted:false}
 const normalized=origin==='sqlite'?checked.book:bookToBrowser(checked.book),book=assertConversionReversible(normalized,convertStorageBook(normalized,origin,storage),origin,storage)
 recoveryBook(book,storage,{complete:true,...options})
 const version=recoveryFeatureFloor(features,3),protection=incoming.protection?portableRecoveryGraph(incoming.protection,origin,{...options,version}):emptyRecoveryGraph(version)
 validateRecoveryGraph(protection,storage,options)
 return {...incoming,book,protection,features:[...new Set([...features,'cross-storage-v1','record-shapes-v1'])].sort(),sourceStorage:origin,converted:true}
}
export function backupProtectionSummary(value){return {legacy:value.legacy,snapshots:value.protection?.snapshots.length||0,originalIds:value.protection?.originalIds.length||0,receipts:value.protection?.events.length||0,...(value.sourceStorage?{sourceStorage:value.sourceStorage,converted:value.converted}: {})}}
