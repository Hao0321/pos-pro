import {assertRefundReviewShape} from '../../electron/refundReview.mjs'
const PREFIX='pos_refund_draft_v1:'
export const refundDraftKey=(context,session,orderId)=>PREFIX+JSON.stringify([context.storeId,session.userId,session.role,orderId])
export function readRefundDraft(key){
  const raw=localStorage.getItem(key)
  if(!raw)return {raw:null,value:null}
  try{
    if(raw.length>300000)throw Error()
    const value=JSON.parse(raw)
    if(value.protocol!=='pos-refund-draft/v1'||!value.quantities||typeof value.quantities!=='object'||Array.isArray(value.quantities)||Object.keys(value.quantities).length>1000||Object.values(value.quantities).some(v=>typeof v!=='string'||v.length>64)||typeof value.reason!=='string'||value.reason.length>1000)throw Error()
    if(value.preview){assertRefundReviewShape(value.preview.review);if(!Array.isArray(value.preview.input?.items))throw Error()}
    return {raw,value}
  }catch{throw Object.assign(Error('退貨草稿需要核對，請先下載保留'),{draftRaw:raw})}
}
export function saveRefundDraft(key,value){
  const raw=JSON.stringify({protocol:'pos-refund-draft/v1',...value})
  localStorage.setItem(key,raw)
  if(localStorage.getItem(key)!==raw)throw Error('退貨草稿尚未保存，請重試')
  return raw
}
export function clearRefundDraft(key,expectedRaw){
  if(key&&localStorage.getItem(key)===expectedRaw)localStorage.removeItem(key)
}
export function parseRefundQuantity(raw,remaining){
  if(raw===''||raw==='0')return 0
  if(!/^\d+(?:\.\d{1,3})?$/.test(raw)||raw.length>20)throw Error('請填零以上的數量，最多三位小數')
  const value=Number(raw),milli=Math.round(value*1000)
  if(!Number.isSafeInteger(milli)||milli>remaining)throw Error('退貨數量超過剩餘可退數量')
  return milli/1000
}
