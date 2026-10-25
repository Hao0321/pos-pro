import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
import {expenseScope} from './expenseEntry.mjs'
import {operationHeader,canonicalSignature} from './operationRules.mjs'
import {supplierInventoryReceipt} from './supplierInventory.mjs'
import {planProcurement,procurementEvent,validateProcurement} from './procurementRules.mjs'
import {decimalUnits} from './decimalUnits.mjs'
export const PURCHASE_INVOICE_FAMILY='purchase-invoice'
const uncertain=()=>Object.assign(Error('請款原紀錄需要核對，請保留輸入，勿重複建單。'),{historyUncertain:true})
export function invoiceQuantity(raw){
 if(typeof raw!=='string'||raw.length>32)throw Error('數量請用一般小數，最多三位。')
 return decimalUnits(raw.normalize('NFKC'),3,1000000000000,'數量請用一般小數，最多三位。')/1000
}
export function invoiceQuote(po,raw){
 const quantities=raw.map(invoiceQuantity),reference='preview-'+po.procurement.bills.length
 const request={id:'invoice-preview',time:new Date().toISOString(),kind:'purchase-bill',purchaseId:po.id,expectedPurchase:canonicalSignature(po),quantities,reference,dueDate:po.date}
 // Use the transaction's valuation and cumulative rounding, including returns.
 while(po.procurement.bills.some(row=>row.reference.normalize('NFKC').toUpperCase()===request.reference.toUpperCase()))request.reference+='x'
 const planned=planProcurement(request,{purchases:[po]},{}),bill=planned.purchase.procurement.bills.at(-1)
 return {quantities,amount:bill.amount}
}
export function assertInvoiceLookup(input,current){
 draftObject(input,['family','context','id','digest','document']);expenseScope(input.context,current);const d=input.document
 draftObject(d,['purchaseId','reference','dueDate','quantities','expectedPurchaseDigest'])
 if(input.family!==PURCHASE_INVOICE_FAMILY||!/^purchase-bill-[-a-f0-9]{36}$/.test(input.id)||!/^[a-f0-9]{64}$/.test(input.digest)||!/^[a-f0-9]{64}$/.test(d.expectedPurchaseDigest)||typeof d.purchaseId!=='string'||!d.purchaseId||d.purchaseId.length>128||typeof d.reference!=='string'||!d.reference.trim()||d.reference.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(d.dueDate)||!Array.isArray(d.quantities)||!d.quantities.length||d.quantities.length>1000)throw uncertain()
 for(const q of d.quantities)if(typeof q!=='number'||invoiceQuantity(String(q))!==q)throw uncertain();return input
}
function admittedMaterial(input,request,result,actor){
 operationHeader(request);const d=input.document,c=request.supplierContext
 if(request.kind!=='purchase-bill'||request.id!==input.id||privateDraftDigest(request)!==input.digest||!c||c.storeId!==input.context.storeId||c.epoch!==input.context.epoch||!Number.isSafeInteger(c.revision)||c.revision<0||['purchaseId','reference','dueDate'].some(k=>request[k]!==d[k])||privateDraftDigest(request.quantities)!==privateDraftDigest(d.quantities))throw uncertain()
 let before;try{before=JSON.parse(request.expectedPurchase)}catch{throw uncertain()}
 if(canonicalSignature(before)!==request.expectedPurchase||before.id!==d.purchaseId||privateDraftDigest(before)!==d.expectedPurchaseDigest)throw uncertain()
 const row=result?.receipt,po=result?.purchase
 if(actor?.userId!==input.context.userId||actor.role!=='owner'||typeof actor.username!=='string'||result?.success!==true||row?.id!==input.id||row.kind!=='purchase-bill'||row.signature!==canonicalSignature(request)||row.purchaseId!==request.purchaseId||!Array.isArray(row.productIds)||row.productIds.length||!Array.isArray(result.products)||result.products.length||row.cashLogId||result.cashLog)throw uncertain()
 validateProcurement(po);const bill=po.procurement.bills.find(value=>value.id===input.id),expected=planProcurement(request,{purchases:[before]},actor).purchase.procurement.bills.find(value=>value.id===input.id)
 if(!bill||privateDraftDigest(bill)!==privateDraftDigest(expected)||privateDraftDigest(procurementEvent(po,request))!==privateDraftDigest(row.document)||!Number.isSafeInteger(row.purchaseVersion)||po.procurement.revision<row.purchaseVersion)throw uncertain()
 return result
}
export function purchaseInvoiceOriginal(input,current,data){
 assertInvoiceLookup(input,current);const rows=data.inventoryAudits.filter(row=>row.action==='INVENTORY_OPERATION'&&row.id==='stock-operation:'+input.id)
 if(rows.length>1)throw uncertain()
 if(!rows.length){if(data.purchases.some(po=>po.procurement?.bills?.some(row=>row.id===input.id)))throw uncertain();return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}}
 const source=rows[0];let receipt,request;try{receipt=typeof source.detail==='string'?JSON.parse(source.detail):source.detail;request=JSON.parse(receipt.signature)}catch{throw uncertain()}
 const actor={userId:source.userId,username:source.username,role:source.role},result=supplierInventoryReceipt(request,receipt,data);admittedMaterial(input,request,result,actor)
 return {protocol:'pos-private-draft-original/v1',status:'matched',action:'create',id:input.id,digest:input.digest,request,actor,result}
}
export function verifyPurchaseInvoiceProof(input,proof){
 assertPrivateDraftContext(input.context);assertInvoiceLookup(input,input.context)
 if(proof?.protocol!=='pos-private-draft-original/v1'||proof.status!=='matched'||proof.action!=='create'||proof.id!==input.id||proof.digest!==input.digest)throw uncertain()
 return admittedMaterial(input,proof.request,proof.result,proof.actor)
}
