import useLockedDraft from './useLockedDraft'
const fields=['productId','unit','quantity','fromLocationId','toLocationId','locationLabel','packageUnit','baseQuantity']
const empty=()=>Object.fromEntries(fields.map(key=>[key,key==='fromLocationId'?'main':'']))
const valid=value=>value&&Object.keys(value).length===fields.length&&fields.every(key=>typeof value[key]==='string'&&value[key].length<=128)
export default function useWarehouseDraft(key){
 const draft=useLockedDraft(key,{empty,valid,maxLength:4096,message:"搬貨草稿讀不到，請保留原資料",prefix:"pos-warehouse-draft:",fileName:"warehouse-draft.json"})
 function finish(request){
  const {form:value,ready}=draft.current();if(!ready)return
  const match=request.action==='transfer'?['productId','unit','quantity','fromLocationId','toLocationId'].every(key=>value[key]===request[key]):request.action==='location'?value.locationLabel.trim().normalize('NFC')===request.label:value.productId===request.productId&&value.packageUnit.trim().normalize('NFC')===request.unit&&value.baseQuantity===request.baseQuantity
  if(!match)return
  draft.close({...value,...(request.action==='transfer'?{quantity:''}:request.action==='location'?{locationLabel:''}:{packageUnit:'',baseQuantity:''})})
 }
 return {...draft,finish}
}
