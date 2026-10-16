export const newCostLine=()=>({id:crypto.randomUUID(),label:'',packagePrice:'',packCount:'1',packageQuantity:'',packageUnit:'g',portionQuantity:'',portionUnit:'g',usablePercent:'100'})
export const newCostDraft=unit=>({protocol:'pos-cost-pricing/v1',currency:'TWD',outputUnit:unit,lines:[newCostLine()],otherCost:'0',targetMargin:'',feePercent:'0',orderFee:'0',portionsPerOrder:'1',roundTo:'1'})
const fields=['protocol','currency','outputUnit','otherCost','targetMargin','feePercent','orderFee','portionsPerOrder','roundTo'],lineFields=['id','label','packagePrice','packCount','packageQuantity','packageUnit','portionQuantity','portionUnit','usablePercent']
export function validateCostDraft(value){
 const strings=(row,keys)=>row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===keys.length&&keys.every(key=>typeof row[key]==='string'&&row[key].length<=100)
 if(!value||!strings(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='lines')),fields)||value.protocol!=='pos-cost-pricing/v1'||value.currency!=='TWD'||!Array.isArray(value.lines)||!value.lines.length||value.lines.length>100||value.lines.some(row=>!strings(row,lineFields))||new Set(value.lines.map(row=>row.id)).size!==value.lines.length)throw Error('試算草稿讀不到，請保留原檔並重新核對')
 return structuredClone(value)
}
export function costDraftKey(context,session,productId){
 if(!context?.storeId||!session?.userId||!['owner','staff'].includes(session.role)||!productId)return null
 return 'pos_cost_pricing_draft_v1:'+ [context.storeId,session.userId,session.role,productId].map(encodeURIComponent).join(':')
}
export function readCostDraft(storage,key,unit){
 if(!key)return newCostDraft(unit)
 const raw=storage.getItem(key)
 if(raw===null)return newCostDraft(unit)
 if(raw.length>131072)throw Error('試算草稿讀不到，請保留原檔並重新核對')
 return validateCostDraft(JSON.parse(raw))
}
export function writeCostDraft(storage,key,input){
 if(!key)throw Error('試算草稿尚未保存，請先下載計算紀錄')
 const validated=validateCostDraft(input),raw=JSON.stringify(validated)
 if(raw.length>131072)throw Error('試算草稿內容太多，請下載計算紀錄')
 storage.setItem(key,raw)
}
