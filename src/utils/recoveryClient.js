import {browserStorage} from './browserStorage'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {FULL_BACKUP_FORMAT} from '../../electron/backupEnvelope.mjs'
import {RECOVERY_PROTOCOL} from '../../electron/recoveryRules.mjs'

const keys={restore:'pos_pending_restore_v1',recover:'pos_pending_recovery_v1'}
const isNative=()=>!!globalThis.window?.electronAPI
const changed=()=>globalThis.window?.dispatchEvent(new Event('pos-recovery-pending-changed'))
const invoke=async(method,input,session)=>isNative()?window.electronAPI.db[method](input):(await import('./browserRecovery'))[method](input,session)
export function readRecoveryCommand(kind){
  const raw=browserStorage.getItem(keys[kind]);if(!raw)return null
  const entry=JSON.parse(raw)
  if(entry?.version!==1||entry.kind!==kind||typeof entry.id!=='string'||typeof entry.scope?.userId!=='string'||typeof entry.scope?.storeId!=='string'
    ||entry.signature!==canonicalSignature(entry.input))throw Error('待確認復原紀錄損壞，請保留原資料核對')
  return entry
}
function clear(entry){
  const current=readRecoveryCommand(entry.kind)
  if(current?.id!==entry.id||current.signature!==entry.signature)throw Error('待確認復原編號已改變，請保留紀錄核對')
  browserStorage.removeItem(keys[entry.kind]);changed()
}
function acknowledge(entry,result){
  if(result?.protocol!==RECOVERY_PROTOCOL||result.success!==true||result.id!==entry.id||result.storeId!==entry.scope.storeId
    ||typeof result.revision!=='string'||typeof result.sourceId!=='string')throw Error('復原結果尚未確認，請保留原編號核對')
  if(entry.kind==='recover'&&(result.restoredSourceId!==entry.input.sourceId||result.originalOperationId!==(entry.input.pending.kind==='checkout'?entry.input.pending.plan.order.id:entry.input.pending.request.id)))
    throw Error('復原回覆缺少正確的原始紀錄，請保留原編號核對')
}
async function execute(kind,input,scope,session){
  if(session?.role!=='owner'||session.userId!==scope.userId)throw Error('請由原店主核對復原紀錄')
  const action=async()=>{
    let entry=readRecoveryCommand(kind)
    if(entry){if(canonicalSignature(entry.scope)!==canonicalSignature(scope)||entry.signature!==canonicalSignature(input))throw Error('上次復原結果尚未確認，請先核對原編號')}
    else{
      entry={version:1,kind,id:kind==='restore'?input.previewId:input.id,input,scope,signature:canonicalSignature(input)}
      browserStorage.setItem(keys[kind],JSON.stringify(entry));changed()
    }
    const call=kind==='restore'?'applyRestorePreview':'applyRecoveryOperation',lookup=kind==='restore'?'lookupRestorePreview':'lookupRecoveryOperation'
    const payload=kind==='restore'?input.previewId:input
    let result
    try{result=await invoke(call,payload,session);acknowledge(entry,result)}
    catch(error){
      let status
      try{status=await invoke(lookup,payload,session)}catch{throw error}
      if(status?.protocol!==RECOVERY_PROTOCOL||status.success!==true||status.id!==entry.id)throw error
      if(status.found===false){clear(entry);throw error}
      if(status.found!==true)throw error
      result=status.receipt;acknowledge(entry,result)
    }
    clear(entry);return result
  }
  if(globalThis.navigator?.locks?.request)return navigator.locks.request('pos-recovery-write-v1',action)
  if(isNative()&&!window.electronAPI.sharedStore)return action()
  throw Error('此瀏覽器缺少安全交易鎖。請使用新版瀏覽器的 HTTPS／localhost，或桌面版。')
}
export const previewRestore=(input,session)=>invoke('previewRestore',input,session)
export const getRecoveryState=(pending,session)=>invoke('getRecoveryState',pending,session)
export const applyRestorePreview=(preview,session)=>execute('restore',{previewId:preview.id},{storeId:preview.storeId,userId:session.userId},session)
export function applyProtectedRecovery(state,source,pending,session){
  return execute('recover',{id:'recovery-'+crypto.randomUUID(),sourceId:source.id,expectedRevision:state.revision,pending},{storeId:state.storeId,userId:session.userId},session)
}
export const retryRecoveryCommand=(entry,session)=>execute(entry.kind,entry.input,entry.scope,session)
export function downloadRecoveryData(data,name){
  const value=data?.format===FULL_BACKUP_FORMAT?data:{version:'3.1',storage:isNative()?'sqlite':'browser',data}
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}))
  const anchor=document.createElement('a');anchor.href=url;anchor.download=name.replace(/[^A-Za-z0-9_.-]/g,'_')+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export async function exportRecoverySource(id,session){downloadRecoveryData(await invoke('exportRecoverySource',id,session),'protected-'+id)}
export async function exportRecoveryDiagnostics(session){downloadRecoveryData(await invoke('exportRecoveryDiagnostics',null,session),'recovery-original-data')}
