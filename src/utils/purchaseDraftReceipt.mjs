import {canonicalSignature} from '../../electron/operationRules.mjs'
import {PURCHASE_UNITS_KIND} from '../../electron/purchaseUnitPricing.mjs'
import {purchaseDraftKey,purchaseDraftSignature,validPurchaseDraft} from './purchaseDraftState.mjs'
export function purchaseDraftAcknowledged(form,result){
 const command=form.command,receipt=result?.receipt
 return validPurchaseDraft(form)&&!!command&&receipt?.kind===PURCHASE_UNITS_KIND&&command.identity.id===receipt.id&&canonicalSignature({...command.input,...command.identity})===receipt.signature&&command.draftSignature===purchaseDraftSignature(form)&&result.purchase?.id===form.id
}
export function finalizePurchaseDraft(result,session){
 if(result.receipt?.kind!==PURCHASE_UNITS_KIND)return result
 try{const request=JSON.parse(result.receipt.signature),key=purchaseDraftKey(request.supplierContext.storeId,session.userId,session.role),raw=localStorage.getItem(key);if(raw===null)return result;const saved=JSON.parse(raw)
  if(saved.version!==1||!purchaseDraftAcknowledged(saved.form,result))return result
  if(localStorage.getItem(key)!==raw)throw Error();localStorage.removeItem(key);return result
 }catch{return {...result,draftWarning:'採購已保存，這個裝置的原草稿仍需核對'}}
}
