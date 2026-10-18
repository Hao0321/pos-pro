import {canonicalSignature} from '../../electron/operationRules.mjs'
export const receiptLotDraftKey=(storeId,userId,role,purchaseId)=>'pos_receipt_lots_draft_v1:'+JSON.stringify([storeId,userId,role,purchaseId])
export const supplierLotReturnDraftKey=(storeId,userId,role,purchaseId)=>'pos_supplier_lot_return_draft_v1:'+JSON.stringify([storeId,userId,role,purchaseId])
// A global original-ID retry may finish while the delivery form is closed.
// Clear only the exact reviewed input acknowledged by the financial adapter.
export function finalizeReceiptLotDraft(result,session){
 if(!['receive-lots','receive-reviewed','purchase-return-lots'].includes(result.receipt?.kind))return result
 try{
  const receipt=result.receipt,request=JSON.parse(receipt.signature),returning=receipt.kind==='purchase-return-lots',key=(returning?supplierLotReturnDraftKey:receiptLotDraftKey)(request.receiptReview?.storeId??request.lots.storeId,session.userId,session.role,request.purchaseId),raw=localStorage.getItem(key)
  if(raw===null)return result
  const saved=JSON.parse(raw),command=saved.form?.command
  if(saved.version!==1||!command||command.identity?.id!==receipt.id||canonicalSignature({...command.input,...command.identity})!==receipt.signature)return result
  if(returning&&command.draftSignature!==canonicalSignature({...saved.form,command:null,attempted:false}))return result
  if(localStorage.getItem(key)!==raw)throw Error('草稿已在其他頁面變更，請保留輸入重新讀取')
  localStorage.removeItem(key);return result
 }catch{return {...result,draftWarning:result.receipt.kind==='purchase-return-lots'?'退貨已保存，這個裝置的原草稿仍需核對':'收貨已保存，這個裝置的原草稿仍需核對'}}
}
