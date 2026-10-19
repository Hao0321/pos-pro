import {procurementSummary,isProcurement} from '../../electron/procurementRules.mjs'
import {businessId,businessInstant,only,text} from '../../electron/businessExchange.mjs'
import {moneyValue,operationHeader} from '../../electron/operationRules.mjs'
import {supplierClaimKey} from '../../electron/supplierCredit.mjs'
export const SUPPLIER_PAYMENT_DRAFT='pos-supplier-payment-draft/v1'
const cents=value=>Math.round(value*100)
export function supplierOpenClaims(purchases,supplierId,entries,today,openingClaims=[]){
 const carried=openingClaims.filter(row=>row.supplierId===supplierId&&row.owed>0).map(row=>({purchaseId:row.purchaseId,invoiceId:row.invoiceId,expectedRevision:row.revision,dueDate:row.dueDate,date:row.date,reference:row.number,owed:row.owed,name:row.number,opening:true}))
 return [...purchases.filter(po=>isProcurement(po)&&po.supplierId===supplierId).flatMap(po=>procurementSummary(po,today,entries).bills.filter(bill=>bill.balance>0).map(bill=>({purchaseId:po.id,invoiceId:bill.id,expectedRevision:po.procurement.revision,dueDate:bill.dueDate,date:bill.date,reference:bill.reference,owed:bill.balance,name:po.items.map(item=>item.name).join('、')}))),...carried].sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.date.localeCompare(b.date)||a.purchaseId.localeCompare(b.purchaseId)||a.invoiceId.localeCompare(b.invoiceId))
}
export function suggestSupplierAllocation(payment,claims){
 let remaining=cents(payment?.available||0)
 return claims.slice(0,100).map(claim=>{const amount=Math.min(remaining,cents(claim.owed));remaining-=amount;return {purchaseId:claim.purchaseId,invoiceId:claim.invoiceId,expectedRevision:claim.expectedRevision,amount:amount/100}}).filter(row=>row.amount>0)
}
export function remainingSupplierAllocation(allocation,entries){
 const released=new Map()
 for(const event of entries.filter(row=>row.action==='unallocate'&&row.allocationId===allocation.id))for(const row of event.items){const key=supplierClaimKey(row.purchaseId,row.invoiceId);released.set(key,(released.get(key)||0)+cents(row.amount))}
 return allocation.items.map(row=>({...row,amount:(cents(row.amount)-(released.get(supplierClaimKey(row.purchaseId,row.invoiceId))||0))/100})).filter(row=>row.amount>0)
}
export function readSupplierPaymentDraft(raw,{storeId,suppliers=[],entries=[],now=Date.now()}={}){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>16384)throw Error('Agent 付款草稿過大或格式不正確')
 let draft;try{draft=JSON.parse(raw)}catch{throw Error('請貼上完整的 Agent 付款草稿 JSON')}
 only(draft,['protocol','id','issuedAt','storeId','supplierId','amount','method','reference','note'],'Agent 付款草稿')
 if(draft.protocol!==SUPPLIER_PAYMENT_DRAFT)throw Error('不支援這個 Agent 付款草稿版本')
 businessId(draft.storeId);businessId(draft.supplierId);operationHeader({id:draft.id,time:draft.issuedAt})
 if(draft.storeId!==storeId)throw Error('這份 Agent 付款草稿屬於另一間店')
 let issued;try{issued=businessInstant(draft.issuedAt)}catch{throw Error('Agent 付款草稿日期格式不正確')}
 if(issued>now+300000||now-issued>86400000)throw Error('Agent 付款草稿已過期，請重新準備並核對')
 if(!suppliers.some(row=>row.id===draft.supplierId))throw Error('請先選擇或新增原供應商')
 if(entries.some(row=>row.id===draft.id))throw Object.assign(Error('這個草稿編號已有紀錄，請查原單'),{existingOperationId:draft.id})
 moneyValue(draft.amount,'付款金額',.01)
 if(!['cash','bank'].includes(draft.method))throw Error('請選現金或銀行付款')
 return {...draft,reference:text(draft.reference??'',100,'參考編號',false),note:text(draft.note??'',1000,'備註',false)}
}
export function supplierAgentInstructions(state,{translate=value=>value}={}){
 const tr=translate
 return tr('請準備供應商預付款草稿 JSON，讓使用者回到 POS 核對。只填已確認的供應商、金額與方式；不執行轉帳，不填已付款確認、核准人或登入資料。id 使用全新英數與連字號，issuedAt 使用現在的 ISO 日期時間。資料以 TWD 計算。')+'\n'+JSON.stringify({protocol:SUPPLIER_PAYMENT_DRAFT,storeId:state.storeId,suppliers:state.suppliers.map(row=>({id:row.id,name:row.name})),fields:{id:tr('唯一草稿編號'),issuedAt:tr('現在的 ISO 時間'),supplierId:tr('上述供應商代碼'),amount:tr('實際金額數字，大於 0、最多兩位小數'),method:'cash | bank',reference:tr('選填，最多 100 字'),note:tr('選填，最多 1000 字')}},null,2)
}
