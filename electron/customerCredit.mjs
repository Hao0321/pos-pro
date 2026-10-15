import {moneyValue} from './operationRules.mjs'

export const customerClaimKey=(documentId,deliveryId)=>JSON.stringify([documentId,deliveryId])
export function customerAppliedCents(source,documentId,deliveryId){
  const key=customerClaimKey(documentId,deliveryId)
  if(source instanceof Map)return source.get(key)||0
  const entries=Array.isArray(source)?source:source?.entries||[]
  if(!Array.isArray(entries))throw Error('客戶抵付紀錄格式不正確')
  let total=0
  for(const entry of entries){
    if(!['allocate','unallocate'].includes(entry.action))continue
    for(const item of entry.items)if(item.documentId===documentId&&item.deliveryId===deliveryId)
      total+=(entry.action==='allocate'?1:-1)*Math.round(moneyValue(item.amount,'抵付金額',.01)*100)
  }
  if(total<0)throw Error('客戶抵付餘額不正確')
  return total
}
