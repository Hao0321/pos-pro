import useDeviceDraft from '../../hooks/useDeviceDraft'
import {agentBusinessDay} from '../../../electron/agentDraftRules.mjs'

export const emptyQuoteForm=()=>({recipient:{id:'',name:''},quoteId:'',expectedQuoteRevision:0,validDay:agentBusinessDay({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone},new Date(),7),items:[],note:'',rememberPrices:true,confirmed:false})
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)
function validForm(form){
  if(!object(form)||Object.keys(form).some(k=>!['recipient','quoteId','expectedQuoteRevision','validDay','items','note','rememberPrices','confirmed'].includes(k))||!object(form.recipient)||Object.keys(form.recipient).some(k=>!['id','name'].includes(k))||typeof form.recipient.id!=='string'||form.recipient.id.length>128||typeof form.recipient.name!=='string'||form.recipient.name.length>100||typeof form.quoteId!=='string'||form.quoteId.length>128||!Number.isSafeInteger(form.expectedQuoteRevision)||form.expectedQuoteRevision<0||typeof form.validDay!=='string'||form.validDay.length>10||typeof form.note!=='string'||form.note.length>500||typeof form.rememberPrices!=='boolean'||typeof form.confirmed!=='boolean'||!Array.isArray(form.items)||form.items.length>100)return false
  return form.items.every(row=>object(row)&&Object.keys(row).every(k=>['productId','qty','unitPrice','expectedProduct'].includes(k))&&typeof row.productId==='string'&&row.productId.length<=128&&typeof row.qty==='string'&&row.qty.length<=40&&typeof row.unitPrice==='string'&&row.unitPrice.length<=40&&object(row.expectedProduct)&&Object.keys(row.expectedProduct).every(k=>['name','unit','price'].includes(k))&&typeof row.expectedProduct.name==='string'&&typeof row.expectedProduct.unit==='string'&&Number.isFinite(row.expectedProduct.price))
}
export default function useQuoteDraft(context,session){
  const key=context?.storeId&&session?.role==='owner'?'pos_quote_draft_v1:'+encodeURIComponent(context.storeId)+':'+encodeURIComponent(session.userId):''
  return useDeviceDraft(key,emptyQuoteForm,validForm,{unreadable:'這個裝置的報價草稿讀不到，原資料已保留。請先核對已保存報價，再選擇重新開始。',unsaved:'這個裝置暫時無法保留報價草稿，請先不要離開。',uncleared:'報價已保存，但這個裝置的舊草稿還沒清除。請先核對已保存報價。'})
}
