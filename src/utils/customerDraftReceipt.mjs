import {CUSTOMER_KIND} from '../../electron/customerLedger.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
export const customerDraftKey=(storeId,userId)=>'pos_customer_draft_v1:'+encodeURIComponent(storeId)+':'+encodeURIComponent(userId)
export function customerDraftRequest(form,shiftId=''){
  const input={kind:CUSTOMER_KIND,action:form.action,storeId:form.storeId,epoch:form.epoch,date:form.date,expectedRevision:form.ledgerRevision,customerId:form.customerId}
  if(Object.hasOwn(form,'expectedOpeningDigest')&&form.expectedOpeningDigest!==undefined)input.expectedOpeningDigest=form.expectedOpeningDigest
  const receiptCash=form.method==='cash',actualShift=form.submittedShiftId??(receiptCash?shiftId:'')
  if(['customer-create','customer-update'].includes(form.action)){input.customer=form.customer;if(form.action==='customer-create')delete input.customerId;return input}
  if(form.action==='receive')Object.assign(input,{amount:Number(form.amount),method:form.method,shiftId:receiptCash?actualShift:'',reference:form.reference||'',note:form.note||'',confirmed:form.confirmed})
  if(['allocate','unallocate'].includes(form.action))Object.assign(input,{items:(form.items||[]).filter(row=>Number(row.amount)>0).map(row=>({...row,amount:Number(row.amount)})),reviewed:form.confirmed,...(form.action==='allocate'?{receiptId:form.receiptId}:{allocationId:form.allocationId,reason:form.reason})})
  if(form.action==='refund')Object.assign(input,{receiptId:form.receiptId,amount:Number(form.amount),reference:form.reference||'',reason:form.reason,shiftId:actualShift,confirmed:form.confirmed})
  if(form.action==='refund'&&form.fundingKind==='opening-credit')input.method=form.method
  if(form.action==='receipt-reverse')Object.assign(input,{receiptId:form.receiptId,reason:form.reason,shiftId:actualShift,confirmed:form.confirmed})
  if(form.action==='refund-reverse')Object.assign(input,{refundId:form.refundId,reason:form.reason,shiftId:actualShift,confirmed:form.confirmed})
  return input
}
export function matchingCustomerDraftEntry(form,entries){
  if(!form?.operationIdentity)return null
  const expected={...customerDraftRequest(form),...form.operationIdentity}
  return entries.find(event=>event.id===form.operationIdentity.id&&canonicalSignature(event.input)===canonicalSignature(expected))||null
}
export function finalizeCustomerDraft(result,userId){
  let warning=''
  for(const actor of new Set([userId,result.event.actor.userId])){
    if(!actor)continue
    const key=customerDraftKey(result.event.storeId,actor)
    try{const raw=localStorage.getItem(key);if(!raw)continue;const saved=JSON.parse(raw);if(saved.version===1&&matchingCustomerDraftEntry(saved.form,[result.event]))localStorage.removeItem(key)}
    catch{warning='款項已保存，但舊草稿尚未清除；請先核對原編號。'}
  }
  return warning
}
