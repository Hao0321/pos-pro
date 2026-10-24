import {browserStorage} from './browserStorage'
import {readPendingFinancial,assertReceipt} from './financialCommand'
import {PROCUREMENT_KINDS} from '../../electron/procurementRules.mjs'

const purchaseKinds=new Set([...PROCUREMENT_KINDS,'receive','receive-lots','receive-reviewed'])
const changed=()=>Object.assign(Error('待核對的紀錄已變更，請重新核對。'),{code:'PENDING_ORIGINAL_CHANGED'})
function checkoutOriginal(id){
 const raw=browserStorage.getItem('pos_pending_checkout_v1'),pending=raw?JSON.parse(raw):null
 if(!id||pending?.plan?.order?.id!==id)throw changed()
 return pending
}
export function canSaveOriginalCheckout(id){
 try{return checkoutOriginal(id).recoveryProtocol==='pos-recovery-v1'}catch{return false}
}
// UI intent is bound before calling the existing controllers. They retain the
// receipt, role/store, replay and protected-history authority.
export async function confirmPendingOriginal(original,store,save=false){
 if(original.family==='financial'){
  const pending=readPendingFinancial()
  if(!original.id||pending?.request.id!==original.id||pending.kind!==original.kind)throw changed()
  const result=await store.retryFinancial()
  assertReceipt(pending.kind,pending.request,result)
  return {...original,result,openPurchaseId:purchaseKinds.has(pending.kind)?result.purchase?.id:null}
 }
 if(original.family!=='checkout')throw changed()
 const pending=checkoutOriginal(original.id)
 if(save&&pending.recoveryProtocol!=='pos-recovery-v1')throw changed()
 try{
  const order=await(save?store.retryCheckout():store.reconcileCheckout())
  if(order?.id!==original.id)throw Error('還沒有可確認的原紀錄，請保留資料核對。')
  return {...original,result:order}
 }catch(error){
  if(error?.code==='NOT_COMMITTED'){error.notCommitted=true;error.operationId=original.id}
  // A lookup never silently becomes a write. Only an explicit second action
  // may resume a current protected original through the verified controller.
  if(!save&&error?.cause?.code==='NOT_FOUND'&&pending.recoveryProtocol==='pos-recovery-v1')error.canSaveOriginal=true
  throw error
 }
}
