import {canonicalSignature} from '../../electron/operationRules.mjs'
import {stockLedgerDigest} from '../../electron/stockLedgerModel.mjs'
import {validReceiptDraft} from './receiptLotDraft.mjs'
const prefix=key=>key+':kept:'
export function receiptArchives(storage,key){return Array.from({length:storage.length},(_,index)=>storage.key(index)).filter(value=>typeof value==='string'&&value.startsWith(prefix(key))).sort()}
export function keepReceiptArchive(storage,key,raw,form){
 if(typeof raw!=='string'||raw.length>1000000||!validReceiptDraft(form)||form.attempted)throw Error('請先核對上一筆操作')
 const value=JSON.parse(raw)
 if(value.version!==1||canonicalSignature(value.form)!==canonicalSignature(form)||storage.getItem(key)!==raw)throw Error('草稿已在其他頁面變更，請保留輸入重新讀取')
 const archiveKey=prefix(key)+stockLedgerDigest(raw).slice(7),saved=storage.getItem(archiveKey)
 if(saved!==null&&saved!==raw)throw Error('舊稿無法保留，請先下載原輸入')
 if(saved===null)storage.setItem(archiveKey,raw)
 if(storage.getItem(archiveKey)!==raw||storage.getItem(key)!==raw)throw Error('舊稿無法保留，請先下載原輸入')
 return archiveKey
}
