import useDeviceDraft from '../../hooks/useDeviceDraft'
import {SUPPLIER_ACTIONS} from '../../../electron/supplierLedger.mjs'
import {supplierDraftKey} from '../../utils/supplierDraftReceipt.mjs'
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)
const fields=['action','supplierId','expectedSupplierName','storeId','epoch','ledgerRevision','date','amount','method','reference','note','reason','confirmed','paymentId','allocationId','refundId','proposalId','purchaseId','expectedPurchaseRevision','mode','items','agentDraftId','operationIdentity','submittedShiftId','expectedOpeningDigest','fundingKind']
export function validSupplierDraft(value){
 if(value===null)return true
 if(!object(value)||Object.keys(value).some(key=>!fields.includes(key))||!SUPPLIER_ACTIONS.includes(value.action)||!Number.isSafeInteger(value.ledgerRevision)||value.ledgerRevision<0||typeof value.confirmed!=='boolean'||!['cash','bank'].includes(value.method))return false
 if(value.expectedOpeningDigest!==undefined&&value.expectedOpeningDigest!==null&&(typeof value.expectedOpeningDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedOpeningDigest)))return false
 if(value.expectedOpeningDigest===null&&!value.operationIdentity)return false
 if(value.fundingKind!==undefined&&value.fundingKind!=='opening-credit')return false
 if(['storeId','epoch','date'].some(key=>typeof value[key]!=='string'||!value[key]||value[key].length>128))return false
 if(typeof value.supplierId!=='string'||value.supplierId.length>128||value.action!=='policy-set'&&!value.supplierId)return false
 if(['pay','payment-propose','allocate','unallocate','refund','refund-reverse','pay-reverse'].includes(value.action)&&(typeof value.expectedSupplierName!=='string'||!value.expectedSupplierName.trim()))return false
 for(const[key,max]of Object.entries({expectedSupplierName:2000,amount:40,reference:100,note:1000,reason:500,paymentId:128,allocationId:128,refundId:128,proposalId:128,purchaseId:128,agentDraftId:128,submittedShiftId:128}))if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>max))return false
 if(value.mode!==undefined&&!['simple','dual-owner'].includes(value.mode))return false
 if(value.expectedPurchaseRevision!==undefined&&(!Number.isSafeInteger(value.expectedPurchaseRevision)||value.expectedPurchaseRevision<1))return false
 if(value.operationIdentity!==undefined&&(!object(value.operationIdentity)||Object.keys(value.operationIdentity).some(key=>!['id','time'].includes(key))||typeof value.operationIdentity.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.operationIdentity.id)||typeof value.operationIdentity.time!=='string'||!Number.isFinite(Date.parse(value.operationIdentity.time))))return false
 if(value.items!==undefined&&(!Array.isArray(value.items)||value.items.length>100||value.items.some(row=>!object(row)||Object.keys(row).some(key=>!['purchaseId','invoiceId','expectedRevision','amount'].includes(key))||typeof row.purchaseId!=='string'||!row.purchaseId||row.purchaseId.length>128||typeof row.invoiceId!=='string'||!row.invoiceId||row.invoiceId.length>128||typeof row.amount!=='string'||row.amount.length>40||!Number.isSafeInteger(row.expectedRevision)||row.expectedRevision<1)))return false
 return true
}
export default function useSupplierDraft(state,session){
 const key=state?.storeId&&session.role==='owner'?supplierDraftKey(state.storeId,session.userId):''
 const value=useDeviceDraft(key,()=>null,form=>validSupplierDraft(form)&&(form===null||form.storeId===state?.storeId),{preserveUnreadable:true,unreadable:'這台裝置的供應商草稿讀不到，原內容已保留。請核對原紀錄後再開始。',unsaved:'無法自動保存供應商草稿，請保留畫面內容並先備份。',uncleared:'款項已保存，但舊草稿尚未清除；請先核對原編號。'})
 return {...value,draft:value.form,setDraft:value.setForm}
}
