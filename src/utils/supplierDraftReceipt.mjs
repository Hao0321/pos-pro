import {SUPPLIER_KIND} from '../../electron/supplierLedger.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
export const supplierDraftKey=(storeId,userId)=>'pos_supplier_draft_v1:'+encodeURIComponent(storeId)+':'+encodeURIComponent(userId)
export function supplierDraftRequest(form,shiftId=''){
 const input={kind:SUPPLIER_KIND,action:form.action,storeId:form.storeId,epoch:form.epoch,date:form.date,expectedRevision:form.ledgerRevision}
 if(Object.hasOwn(form,'expectedOpeningDigest')&&form.expectedOpeningDigest!==undefined)input.expectedOpeningDigest=form.expectedOpeningDigest
 const actualShift=form.submittedShiftId??(form.method==='cash'?shiftId:'')
 if(['pay','payment-propose','allocate','unallocate','refund','refund-reverse','pay-reverse'].includes(form.action))Object.assign(input,{supplierId:form.supplierId,expectedSupplierName:form.expectedSupplierName})
 if(form.action==='policy-set')Object.assign(input,{mode:form.mode,reason:form.reason,reviewed:form.confirmed})
 if(form.action.startsWith('purchase-'))Object.assign(input,{purchaseId:form.purchaseId,expectedPurchaseRevision:form.expectedPurchaseRevision,reviewed:form.confirmed,...(['purchase-reject','purchase-withdraw'].includes(form.action)?{reason:form.reason}:{})})
 if(form.action==='payment-propose')Object.assign(input,{amount:Number(form.amount),method:form.method,note:form.note||'',reference:form.reference||'',reviewed:form.confirmed})
 else if(form.action.startsWith('payment-'))Object.assign(input,{proposalId:form.proposalId,reviewed:form.confirmed,...(form.action==='payment-approve'?{}:{reason:form.reason})})
 if(form.action==='pay')Object.assign(input,{amount:Number(form.amount),method:form.method,reference:form.reference||'',note:form.note||'',shiftId:actualShift,confirmed:form.confirmed,...(form.proposalId?{proposalId:form.proposalId}:{})})
 if(['allocate','unallocate'].includes(form.action))Object.assign(input,{items:(form.items||[]).filter(row=>Number(row.amount)>0).map(row=>({...row,amount:Number(row.amount)})),reviewed:form.confirmed,...(form.action==='allocate'?{paymentId:form.paymentId}:{allocationId:form.allocationId,reason:form.reason})})
 if(form.action==='refund')Object.assign(input,{paymentId:form.paymentId,amount:Number(form.amount),reference:form.reference||'',reason:form.reason,shiftId:actualShift,confirmed:form.confirmed})
 if(form.action==='refund'&&form.fundingKind==='opening-credit')input.method=form.method
 if(form.action==='pay-reverse')Object.assign(input,{paymentId:form.paymentId,reason:form.reason,shiftId:actualShift,confirmed:form.confirmed})
 if(form.action==='refund-reverse')Object.assign(input,{refundId:form.refundId,reason:form.reason,shiftId:actualShift,confirmed:form.confirmed})
 return input
}
export function matchingSupplierDraftEntry(form,entries){
 if(!form?.operationIdentity)return null
 const expected={...supplierDraftRequest(form),...form.operationIdentity}
 return entries.find(event=>event.id===form.operationIdentity.id&&canonicalSignature(event.input)===canonicalSignature(expected))||null
}
export function finalizeSupplierDraft(result,userId){
 let warning=''
 for(const actor of new Set([userId,result.event.actor.userId])){
  if(!actor)continue
  try{const key=supplierDraftKey(result.event.storeId,actor),raw=localStorage.getItem(key);if(!raw)continue;const saved=JSON.parse(raw);if(saved.version===1&&matchingSupplierDraftEntry(saved.form,[result.event]))localStorage.removeItem(key)}catch{warning='款項已保存，但舊草稿尚未清除；請先核對原編號。'}
 }
 return warning
}
