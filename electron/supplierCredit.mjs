import {moneyValue} from './operationRules.mjs'
export const supplierClaimKey=(purchaseId,invoiceId)=>JSON.stringify([purchaseId,invoiceId])
export function supplierAppliedCents(source,purchaseId,invoiceId){
  const key=supplierClaimKey(purchaseId,invoiceId)
  if(source instanceof Map){const amount=source.get(key)??0;if(!Number.isSafeInteger(amount)||amount<0)throw Error('供應商抵付餘額不正確');return amount}
  const entries=Array.isArray(source)?source:source?.entries||[]
  const amount=entries.filter(event=>['allocate','unallocate'].includes(event.action)).reduce((total,event)=>total+(event.action==='allocate'?1:-1)*(event.items||[]).filter(row=>row.purchaseId===purchaseId&&row.invoiceId===invoiceId).reduce((sum,row)=>sum+Math.round(moneyValue(row.amount,'供應商抵付金額',.01)*100),0),0)
  if(!Number.isSafeInteger(amount)||amount<0)throw Error('供應商抵付餘額不正確')
  return amount
}
