import {salesSummary,salesCents,salesAmount} from '../../electron/salesRules.mjs'
import {businessId,businessInstant,only,text} from '../../electron/businessExchange.mjs'
import {moneyValue,operationHeader} from '../../electron/operationRules.mjs'
export const CUSTOMER_RECEIPT_DRAFT='pos-customer-receipt-draft/v1'
export function customerOpenClaims(documents,customerId,entries,today){
  return documents.filter(d=>d.customer.id===customerId).flatMap(doc=>salesSummary(doc,today,entries).claims.filter(c=>c.owed>0).map(c=>({documentId:doc.id,deliveryId:c.delivery.id,expectedRevision:doc.revision,dueDate:c.delivery.dueDate,date:c.delivery.date,owed:c.owed,name:doc.items.map(i=>i.name).join('、')}))).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.date.localeCompare(b.date)||a.deliveryId.localeCompare(b.deliveryId))
}
export function suggestCustomerAllocation(receipt,claims){
  let remaining=salesCents(receipt?.available||0)
  return claims.slice(0,100).map(claim=>{const amount=Math.min(remaining,salesCents(claim.owed));remaining-=amount;return {documentId:claim.documentId,deliveryId:claim.deliveryId,expectedRevision:claim.expectedRevision,amount:salesAmount(amount)}}).filter(row=>row.amount>0)
}
export function remainingCustomerAllocation(allocation,entries){
  return allocation.items.map(row=>{const released=entries.filter(e=>e.action==='unallocate'&&e.allocationId===allocation.id).flatMap(e=>e.items).filter(i=>i.documentId===row.documentId&&i.deliveryId===row.deliveryId).reduce((n,i)=>n+salesCents(i.amount),0);return {...row,amount:salesAmount(salesCents(row.amount)-released)}}).filter(row=>row.amount>0)
}
export function readCustomerReceiptDraft(raw,{storeId,customers=[],entries=[],now=Date.now()}={}){
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>16384)throw Error('Agent 收款草稿過大或格式不正確')
  let draft;try{draft=JSON.parse(raw)}catch{throw Error('請貼上完整的 Agent 收款草稿 JSON')}
  only(draft,['protocol','id','issuedAt','storeId','customerId','amount','method','reference','note'],'Agent 收款草稿')
  if(draft.protocol!==CUSTOMER_RECEIPT_DRAFT)throw Error('不支援這個 Agent 收款草稿版本')
  businessId(draft.id);businessId(draft.storeId);businessId(draft.customerId)
  operationHeader({id:draft.id,time:draft.issuedAt})
  if(draft.storeId!==storeId)throw Error('這份 Agent 收款草稿屬於另一間店')
  let issued;try{issued=businessInstant(draft.issuedAt)}catch{throw Error('Agent 收款草稿日期格式不正確')}
  if(typeof draft.issuedAt!=='string'||!Number.isFinite(issued)||issued>now+300000||now-issued>86400000)throw Error('Agent 收款草稿已過期，請重新準備並核對')
  if(!customers.some(c=>c.id===draft.customerId))throw Error('請先選擇或新增往來客戶')
  if(entries.some(e=>e.id===draft.id))throw Error('這個草稿編號已有紀錄，請查原單')
  moneyValue(draft.amount,'收款金額',.01)
  if(!['cash','bank'].includes(draft.method))throw Error('請選現金或銀行收款')
  return {...draft,reference:text(draft.reference??'',100,'參考編號',false),note:text(draft.note??'',1000,'備註',false)}
}
