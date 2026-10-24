import {canonicalSignature} from '../../electron/operationRules.mjs'
import {stockLedgerDigest} from '../../electron/stockLedgerModel.mjs'
export function keptDrafts(storage,key){return Array.from({length:storage.length},(_,index)=>storage.key(index)).filter(value=>typeof value==='string'&&value.startsWith(key+':kept:')).sort()}
export function keepDraftArchive(storage,key,raw,form,valid,maxLength=1000000){
 if(typeof raw!=='string'||raw.length>maxLength||!valid(form)||form.attempted)throw Error('請先核對上一筆操作')
 const value=JSON.parse(raw)
 if(value.version!==1||canonicalSignature(value.form)!==canonicalSignature(form)||storage.getItem(key)!==raw)throw Error('草稿已在其他頁面變更，請保留輸入重新讀取')
 const archiveKey=key+':kept:'+stockLedgerDigest(raw).slice(7),saved=storage.getItem(archiveKey)
 if(saved!==null&&saved!==raw)throw Error('舊稿無法保留，請先下載原輸入')
 if(saved===null)storage.setItem(archiveKey,raw)
 if(storage.getItem(archiveKey)!==raw||storage.getItem(key)!==raw)throw Error('舊稿無法保留，請先下載原輸入')
 return archiveKey
}
