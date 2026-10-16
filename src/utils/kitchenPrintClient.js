import {browserStorage} from './browserStorage'
import {loadKitchenPrintState,applyKitchenPrintOperation,loadRestaurantState,applyRestaurantOperation} from './dataAccess'
import {canonicalSignature,operationHeader} from '../../electron/operationRules.mjs'
import {getRecoveryState} from './recoveryClient'
import {normalizeKitchenPrinting,validateKitchenJob} from '../../electron/kitchenPrint.mjs'
import messages from '../../public/i18n/messages.mjs'

export const KITCHEN_PRINT_PENDING='pos_pending_kitchen_print_v1'
const changed=()=>window.dispatchEvent(new Event('pos-kitchen-print-pending-changed'))
const invalid=()=>Error('這台裝置的列印原紀錄需要核對，資料已保留')
const scope=(state,actor)=>({storeId:state.storeId,userId:actor.userId,role:actor.role})
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const own=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key))
let running=false
export function kitchenPrintErrorMessage(error,pending=false){
 const message=String(error?.message||error||'').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'')
 return Object.hasOwn(messages,message)?message:pending?'':'列印暫時無法處理，請稍後再試。'
}
export function readKitchenPrintPending(){
 const raw=browserStorage.getItem(KITCHEN_PRINT_PENDING);if(raw===null)return null
 return decodePending(raw)
}
function decodePending(raw){
 try{const value=JSON.parse(raw),r=value?.request,s=value?.scope;operationHeader(r)
  if(!own(value,['version','kind','scope','request','signature'])||value.version!==1||!['kitchen-print','restaurant'].includes(value.kind)||!own(s,['storeId','userId','role'])||typeof s.storeId!=='string'||!s.storeId||typeof s.userId!=='string'||!s.userId||!['owner','staff'].includes(s.role)||r.kind!==value.kind||value.signature!==canonicalSignature(r)||r.operatorId!==s.userId||r.operatorRole!==s.role)throw invalid()
  if(value.kind==='restaurant'){if(s.role!=='owner'||r.action!=='configure'||typeof r.expectedConfig!=='string'||!own(r,['id','kind','action','time','expectedConfig','config','kitchenPaperAcknowledged','operatorId','operatorRole']))throw invalid();normalizeKitchenPrinting(r.config?.kitchenPrinting)}
  else if(!own(r,['id','kind','action','time','entryId','jobId','expectedVersion','acknowledgeDuplicateRisk','operatorId','operatorRole'])||!['request','send','confirm','reprint'].includes(r.action)||typeof r.entryId!=='string'||!r.entryId||r.action!=='request'&&(typeof r.jobId!=='string'||!r.jobId||!Number.isSafeInteger(r.expectedVersion)||r.expectedVersion<1)||r.action==='reprint'&&r.acknowledgeDuplicateRisk!==true||r.action!=='reprint'&&Object.hasOwn(r,'acknowledgeDuplicateRisk'))throw invalid()
  return value
 }catch{throw invalid()}
}
const immutable=job=>Object.fromEntries(['id','entryId','sourceOperationId','sourceSignature','kind','copy','parentId','epoch','ticket','createdAt','createdBy'].map(k=>[k,job[k]]))
export function assertKitchenPrintAcknowledgement(pending,result){
 const r=pending.request,receipt=result?.receipt,changes=receipt?.changes,jobs=result?.jobs
 if(pending.kind==='restaurant'){if(result?.success!==true||receipt?.id!==r.id||receipt.kind!=='restaurant'||receipt.action!=='configure'||receipt.signature!==pending.signature||!same(result.config?.kitchenPrinting,r.config.kitchenPrinting))throw Error('列印設定保存結果尚未確認，請沿用原編號核對');return result}
 if(result?.protocol!=='pos-kitchen-print/v1'||result.success!==true||receipt?.id!==r.id||receipt.kind!=='kitchen-print'||receipt.action!==r.action||receipt.signature!==pending.signature||!Array.isArray(changes)||!changes.length||!Array.isArray(jobs)||jobs.length!==changes.length||new Set(jobs.map(j=>j?.id)).size!==jobs.length)throw Error('列印保存結果尚未確認，請沿用原編號核對')
 if(receipt.internal!==false||receipt.actor?.userId!==pending.scope.userId||receipt.actor.role!==pending.scope.role||receipt.time!==r.time||new Set(changes.map(c=>c.id)).size!==changes.length)throw Error('列印回覆與原單不同，請保留原編號')
 for(const c of changes){const current=jobs.find(j=>j?.id===c.id),saved=c.job;validateKitchenJob(saved);validateKitchenJob(current);if(c.id!==saved.id||!Number.isSafeInteger(c.beforeVersion)||c.beforeVersion<0||saved.version!==c.beforeVersion+1||saved.entryId!==r.entryId||current.version<saved.version||!same(immutable(current),immutable(saved)))throw Error('列印回覆與原單不同，請保留原編號')}
 const only=changes[0]
 if(r.action==='request'&&(changes.length!==1||only.beforeVersion!==0||only.job.state!=='queued'||only.job.copy!==0||only.job.dispatch!=='manual'))throw Error('列印回覆與原單不同，請保留原編號')
 if(r.action==='send'&&(changes.length!==1||only.id!==r.jobId||only.beforeVersion!==r.expectedVersion||only.job.state!=='queued'||only.job.dispatch!=='manual'))throw Error('列印回覆與原單不同，請保留原編號')
 if(r.action==='confirm'&&(changes.length!==1||only.id!==r.jobId||only.beforeVersion!==r.expectedVersion||only.job.state!=='confirmed'||only.job.paper?.actor.userId!==pending.scope.userId||only.job.paper?.actor.role!==pending.scope.role))throw Error('紙張確認結果尚未保存，請核對原編號')
 if(r.action==='reprint'&&(changes.length!==2||changes.filter(c=>c.job.parentId===r.jobId&&c.job.copy>0&&c.beforeVersion===0&&c.job.state==='queued'&&c.job.dispatch==='manual').length!==1||!changes.some(c=>c.id===r.jobId&&c.beforeVersion===r.expectedVersion)))throw Error('補印副本尚未確認，請沿用原編號')
 return result
}
function assertContext(state,actor){if(state?.protocol!=='pos-kitchen-print-state/v1'||typeof state.storeId!=='string'||!state.storeId||state.actor?.userId!==actor.userId||state.actor.role!==actor.role||typeof state.now!=='string'||!Number.isFinite(Date.parse(state.now)))throw Error('列印店面或帳號需要重新核對')}
function clear(pending){const current=readKitchenPrintPending();if(!current||!same(current,pending))throw invalid();browserStorage.removeItem(KITCHEN_PRINT_PENDING);if(browserStorage.getItem(KITCHEN_PRINT_PENDING)!==null)throw invalid();changed()}
async function invoke(pending,actor){
 const result=await (pending.kind==='restaurant'?applyRestaurantOperation(pending.request,actor):applyKitchenPrintOperation(pending.request,actor))
 if(result?.success===false&&result.committed===false&&!result.receipt&&!result.jobs&&!result.config){clear(pending);throw Error(result.error||'列印操作未保存')}
 if(result?.success===false&&result.errorCode==='RECOVERY_REQUIRED')throw Error(result.error)
 assertKitchenPrintAcknowledgement(pending,result);clear(pending);if(pending.kind==='restaurant')window.dispatchEvent(new Event('pos-restaurant-operation'));return result
}
async function locked(action){if(running)throw Error('列印紀錄核對中，請稍候');running=true;try{if(globalThis.navigator?.locks?.request)return await navigator.locks.request('pos-kitchen-print-request-v1',action);if(window.electronAPI&&!window.electronAPI.sharedStore)return await action();throw Error('此瀏覽器缺少安全交易鎖。請使用新版瀏覽器的 HTTPS／localhost，或桌面版。')}finally{running=false}}
export async function submitKitchenPrint(input,actor){return locked(async()=>{
 if(readKitchenPrintPending())throw Error('請先核對上一筆列印')
 const state=await loadKitchenPrintState(actor);assertContext(state,actor)
 let body=input,kind='kitchen-print';if(input.action==='configure'){if(actor.role!=='owner')throw Error('請由老闆設定廚房列印');const latest=await loadRestaurantState();kind='restaurant';body={action:'configure',expectedConfig:canonicalSignature(latest.config),config:{...latest.config,kitchenPrinting:normalizeKitchenPrinting(input.policy)},kitchenPaperAcknowledged:input.kitchenPaperAcknowledged===true}}
 const request={...body,id:'kitchen-print-'+crypto.randomUUID(),kind,time:state.now,operatorId:actor.userId,operatorRole:actor.role},pending={version:1,kind,scope:scope(state,actor),request,signature:canonicalSignature(request)}
 if(browserStorage.getItem(KITCHEN_PRINT_PENDING)!==null)throw invalid();const raw=JSON.stringify(pending);decodePending(raw);browserStorage.setItem(KITCHEN_PRINT_PENDING,raw);if(browserStorage.getItem(KITCHEN_PRINT_PENDING)!==raw)throw invalid();readKitchenPrintPending();changed()
 return invoke(pending,actor)
})}
export async function retryKitchenPrint(actor,{recovered=false}={}){return locked(async()=>{
 const pending=readKitchenPrintPending();if(!pending)throw Error('沒有待核對的列印')
 const state=await loadKitchenPrintState(actor);assertContext(state,actor)
 if(state.storeId!==pending.scope.storeId)throw Error('店面已變更，請回原店面核對列印')
 if(recovered){const proof=await getRecoveryState(pending,actor);if(actor.role!=='owner'||proof.active!=='matched'||proof.storeId!==state.storeId)throw Error('原列印紀錄仍需要店主核對')}
 else if(!same(scope(state,actor),pending.scope))throw Error('列印帳號已變更，請保留原編號核對')
 return invoke(pending,actor)
})}
