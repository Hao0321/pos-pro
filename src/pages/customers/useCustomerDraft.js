import useDeviceDraft from '../../hooks/useDeviceDraft'
import {CUSTOMER_ACTIONS} from '../../../electron/customerLedger.mjs'
import {customerDraftKey} from '../../utils/customerDraftReceipt.mjs'
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)
const fields=['action','customerId','storeId','epoch','ledgerRevision','date','amount','method','reference','note','reason','confirmed','receiptId','allocationId','refundId','customer','items','agentDraftId','operationIdentity','submittedShiftId']
export function validCustomerDraft(value){
  if(value===null)return true
  if(!object(value)||Object.keys(value).some(key=>!fields.includes(key))||!CUSTOMER_ACTIONS.includes(value.action)||!Number.isSafeInteger(value.ledgerRevision)||value.ledgerRevision<0||typeof value.confirmed!=='boolean'||!['cash','bank'].includes(value.method))return false
  if(['customerId','storeId','epoch','date'].some(key=>typeof value[key]!=='string'||!value[key]||value[key].length>128))return false
  for(const[key,max]of Object.entries({amount:40,reference:100,note:1000,reason:500,receiptId:128,allocationId:128,refundId:128,agentDraftId:128,submittedShiftId:128}))if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>max))return false
  if(value.operationIdentity!==undefined&&(!object(value.operationIdentity)||Object.keys(value.operationIdentity).some(key=>!['id','time'].includes(key))||typeof value.operationIdentity.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.operationIdentity.id)||typeof value.operationIdentity.time!=='string'||!Number.isFinite(Date.parse(value.operationIdentity.time))))return false
  if(['customer-create','customer-update'].includes(value.action)&&(!object(value.customer)||typeof value.customer.id!=='string'||!value.customer.id||typeof value.customer.name!=='string'||value.customer.name.length>100||Object.keys(value.customer).some(key=>!['id','name','contact','phone','email','address','note'].includes(key))||Object.entries(value.customer).some(([key,text])=>typeof text!=='string'||text.length>(key==='note'?1000:300))))return false
  if(value.items!==undefined&&(!Array.isArray(value.items)||value.items.length>100||value.items.some(row=>!object(row)||Object.keys(row).some(key=>!['documentId','deliveryId','expectedRevision','amount'].includes(key))||typeof row.documentId!=='string'||row.documentId.length>128||typeof row.deliveryId!=='string'||row.deliveryId.length>128||typeof row.amount!=='string'||row.amount.length>40||!Number.isSafeInteger(row.expectedRevision)||row.expectedRevision<1)))return false
  return true
}
export default function useCustomerDraft(sales,session){
  const key=sales.storeId&&session.role==='owner'?customerDraftKey(sales.storeId,session.userId):''
  const state=useDeviceDraft(key,()=>null,value=>validCustomerDraft(value)&&(value===null||value.storeId===sales.storeId),{preserveUnreadable:true,unreadable:'這台裝置的客戶款項草稿讀不到，原內容已保留。請核對原紀錄後再開始。',unsaved:'無法自動保存客戶款項草稿，請保留畫面內容並先備份。',uncleared:'款項已保存，但舊草稿尚未清除；請先核對原編號。'})
  return {...state,draft:state.form,setDraft:state.setForm}
}
