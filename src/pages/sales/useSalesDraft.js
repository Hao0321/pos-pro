import useDeviceDraft from '../../hooks/useDeviceDraft'
import {salesDate} from '../../../electron/salesRules.mjs'
export const emptySalesDraft=()=>({customer:{id:'',name:''},date:salesDate(new Date()),items:[],note:'',quoteRef:null,confirmed:false,step:1})
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)
function valid(form){
  if(!object(form)||Object.keys(form).some(key=>!['customer','date','items','note','quoteRef','confirmed','step'].includes(key))||!object(form.customer)||Object.keys(form.customer).some(key=>!['id','name'].includes(key))||typeof form.customer.id!=='string'||form.customer.id.length>128||typeof form.customer.name!=='string'||form.customer.name.length>100||typeof form.date!=='string'||form.date.length>10||typeof form.note!=='string'||form.note.length>1000||typeof form.confirmed!=='boolean'||![1,2,3].includes(form.step)||!Array.isArray(form.items)||form.items.length>100)return false
  if(form.quoteRef!==null&&(!object(form.quoteRef)||Object.keys(form.quoteRef).some(key=>!['id','revision'].includes(key))||typeof form.quoteRef.id!=='string'||form.quoteRef.id.length>128||!Number.isSafeInteger(form.quoteRef.revision)||form.quoteRef.revision<1))return false
  return form.items.every(row=>object(row)&&Object.keys(row).every(key=>['productId','qty','unitPrice','expectedProduct'].includes(key))&&typeof row.productId==='string'&&row.productId.length<=128&&typeof row.qty==='string'&&row.qty.length<=40&&typeof row.unitPrice==='string'&&row.unitPrice.length<=40&&object(row.expectedProduct)&&Object.keys(row.expectedProduct).every(key=>['name','unit','price'].includes(key))&&typeof row.expectedProduct.name==='string'&&row.expectedProduct.name.length<=200&&typeof row.expectedProduct.unit==='string'&&row.expectedProduct.unit.length<=30&&Number.isFinite(row.expectedProduct.price))
}
export default function useSalesDraft(context,session){
  const key=context?.storeId&&session?.role==='owner'?'pos_sales_draft_v1:'+encodeURIComponent(context.storeId)+':'+encodeURIComponent(session.userId):''
  return useDeviceDraft(key,emptySalesDraft,valid,{unreadable:'這個裝置的銷售草稿讀不到，原資料已保留。請核對銷售單後再重新開始。',unsaved:'這個裝置暫時無法保留銷售草稿，請先不要離開。',uncleared:'銷售單已保存，但這個裝置的舊草稿尚未清除。請先核對原單。'})
}
