import {readRecords,restoreRecords,recoveryMetadata,withSalesLock,browserStorage,DATA_KEYS,RECORD_KEY} from './browserStorage'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {signature as checkoutSignature} from '../../electron/checkoutSignature.mjs'
import {refundSignature} from './refundSafety.mjs'
import {RECOVERY_PROTOCOL,browserToBook,bookToBrowser,protectedRestoreBook,recoveryStoreId,recoverySummary,materialSignature,operationRecords,pendingOperation,originalMatches} from '../../electron/recoveryRules.mjs'

const previews=new Map(),proof={checkoutSignature,refundSignature}
function owner(actor){if(actor?.role!=='owner'||!readRecords().data.pos_users.some(u=>u.id===actor.userId&&u.role==='owner'))throw Error('權限不足')}
function prior(id,signature,actor,record=readRecords()){
  const row=recoveryMetadata(record).events.find(e=>e.id===id)
  if(!row)return null
  if(row.signature!==signature||row.actorId!==actor.userId)throw Error('復原編號已存在且內容不同')
  return row.receipt
}
function source(id,record=readRecords()){
  const row=recoveryMetadata(record).snapshots.find(s=>s.id===id)
  if(!row||canonicalSignature(row.data)!==row.contentSignature)throw Error('保護副本需要核對，原資料已保留')
  return {...row,book:browserToBook(row.data)}
}
export async function previewRestore(input,actor){
  owner(actor);const record=readRecords(),current=browserToBook(record.data)
  let data,label
  if(input.kind==='backup'){
    const row=JSON.parse(browserStorage.getItem('pos_backups')||'[]').find(b=>b.id===input.id)
    if(!row?.data)throw Error('備份不存在')
    data=browserToBook(row.data);label=row.label
  }else if(input.kind==='import'){
    if(!input.data||Array.isArray(input.data)||!Array.isArray(input.data.pos2_products))throw Error('備份格式錯誤')
    if(Object.keys(input.data).some(key=>!DATA_KEYS.includes(key)))throw Error('備份含有目前版本不支援的資料，請保留原檔並使用相容版本')
    data=browserToBook(input.data);label='匯入備份'
  }
  else throw Error('還原來源不正確')
  const target=protectedRestoreBook(current,data),id='restore-'+crypto.randomUUID(),expiresAt=Date.now()+15*60*1000
  for(const [key,value]of previews)if(value.expiresAt<Date.now())previews.delete(key)
  if(previews.size>=20)throw Error('還原預覽過多，請稍後再試')
  const row={id,target,expectedRevision:record.revision,actorId:actor.userId,expiresAt,label,storeId:recoveryStoreId(target),originStoreId:recoveryStoreId(current)}
  previews.set(id,row)
  return {protocol:RECOVERY_PROTOCOL,id,label,kind:input.kind,backupId:input.id||null,expectedRevision:String(record.revision),expiresAt,storeId:row.storeId,originStoreId:row.originStoreId,current:recoverySummary(current),target:recoverySummary(target)}
}
export async function applyRestorePreview(id,actor){
  owner(actor);return withSalesLock(()=>{
    const signature=canonicalSignature({kind:'restore-preview',previewId:id}),old=prior(id,signature,actor);if(old)return old
    const row=previews.get(id)
    if(!row||row.actorId!==actor.userId||row.expiresAt<Date.now())throw Error('還原預覽已失效，請重新查看')
    const next=restoreRecords(bookToBrowser(row.target),row.expectedRevision,{id,actorId:actor.userId,signature})
    previews.delete(id)
    return prior(id,signature,actor,next)
  })
}
export async function lookupRestorePreview(id,actor){owner(actor);const receipt=prior(id,canonicalSignature({kind:'restore-preview',previewId:id}),actor);return {protocol:RECOVERY_PROTOCOL,success:true,id,found:!!receipt,receipt}}
export async function getRecoveryState(pending,actor){
  owner(actor);const record=readRecords(),current=browserToBook(record.data),operation=pendingOperation(pending)
  const active=operationRecords(current).find(row=>row.method===operation.method&&row.id===operation.id),meta=recoveryMetadata(record)
  const ids=new Set(meta.originalIds.filter(row=>row[0]===operation.method&&row[1]===operation.id).map(row=>row[2]))
  const sources=[...meta.snapshots].reverse().filter(row=>ids.has(row.id)).map(row=>{
    const saved=source(row.id,record),original=operationRecords(saved.book).find(row=>row.method===operation.method&&row.id===operation.id)
    const matches=!!original&&originalMatches(original,operation,proof),sameStore=saved.storeId===recoveryStoreId(current),unchanged=saved.afterMaterial===materialSignature(current)
    return {id:saved.id,createdAt:saved.createdAt,operationId:operation.id,matches,canRecover:!active&&matches&&sameStore&&unchanged,
      reason:active?'目前帳本已有這個原編號':!matches?'原編號內容不同':!sameStore?'店面不符':!unchanged?'還原後已有新的營運資料':'可以找回原紀錄',summary:recoverySummary(saved.book)}
  })
  return {protocol:RECOVERY_PROTOCOL,operationId:operation.id,revision:String(record.revision),storeId:recoveryStoreId(current),summary:recoverySummary(current),active:active?originalMatches(active,operation,proof)?'matched':'different':'missing',sources}
}
export async function applyRecoveryOperation(input,actor){
  owner(actor)
  if(typeof input?.id!=='string'||!/^recovery-[A-Za-z0-9_-]{1,128}$/.test(input.id))throw Error('復原請求需要核對')
  return withSalesLock(async()=>{
    const signature=canonicalSignature(input),old=prior(input.id,signature,actor);if(old)return old
    const state=await getRecoveryState(input.pending,actor),selected=state.sources.find(s=>s.id===input.sourceId)
    if(state.revision!==input.expectedRevision)throw Error('帳本已更新，請重新核對復原內容')
    if(!selected?.canRecover)throw Error('已有新資料或原編號內容不符，請保留兩份帳本核對')
    const next=restoreRecords(source(selected.id).data,Number(input.expectedRevision),{id:input.id,actorId:actor.userId,signature,restoredSourceId:selected.id,originalOperationId:state.operationId})
    return prior(input.id,signature,actor,next)
  })
}
export async function lookupRecoveryOperation(input,actor){owner(actor);const receipt=prior(input.id,canonicalSignature(input),actor);return {protocol:RECOVERY_PROTOCOL,success:true,id:input.id,found:!!receipt,receipt}}
export async function exportRecoverySource(id,actor){owner(actor);return source(id).data}
export async function exportRecoveryDiagnostics(_input,actor){
  // A standalone browser is device-local, not an authentication boundary. Keep
  // raw bytes available when parsing this device's record fails. No writes.
  if(actor?.role!=='owner')throw Error('權限不足')
  const keys=[RECORD_KEY,...DATA_KEYS,'pos_backups','pos_pending_financial_v1','pos_pending_checkout_v1','pos_pending_restore_v1','pos_pending_recovery_v1']
  return {format:'pos-recovery-diagnostics/v1',importable:false,createdAt:new Date().toISOString(),storage:'browser',raw:Object.fromEntries(keys.map(key=>[key,globalThis.localStorage.getItem(key)]))}
}
