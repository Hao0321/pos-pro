import useLockedDraft from './useLockedDraft'
import {warehouseQuantity} from '../../electron/warehouseRules.mjs'
const fields=['productId','sourceId','quantity','code','expiryDate','timeZone','reason','lotId','locationId','action']
const empty=()=>Object.fromEntries(fields.map(key=>[key,key==='action'?'label':key==='locationId'?'main':'']))
const valid=form=>form&&Object.keys(form).length===fields.length&&fields.every(key=>typeof form[key]==='string'&&form[key].length<=256)
export default function useLotDraft(key){
 const draft=useLockedDraft(key,{empty,valid,maxLength:8192,message:"批次草稿讀不到，請保留原資料",prefix:"pos-lot-draft:",fileName:"lot-draft.json"})
 function finish(request){
  const {form:value,ready}=draft.current();if(!ready)return
  let match=request.action==='activate'
  if(request.action==='label')try{match=value.sourceId===request.sourceId&&warehouseQuantity(value.quantity)===request.quantityUnits&&value.code.trim().normalize('NFC')===request.code&&(value.expiryDate||null)===request.expiryDate}catch{}
  if(request.action==='correct')match=value.lotId===request.lotId&&value.code.trim().normalize('NFC')===request.code&&(value.expiryDate||null)===request.expiryDate&&value.reason.trim()===request.reason
  if(['release','dispose'].includes(request.action))try{match=value.lotId===request.lotId&&value.locationId===request.locationId&&warehouseQuantity(value.quantity)===request.quantityUnits&&value.reason.trim()===request.reason}catch{}
  if(!match)return
  draft.close({...empty(),productId:value.productId})
 }
 return {...draft,finish}
}
