import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
import {expenseScope} from './expenseEntry.mjs'
import {operationHeader,moneyValue,canonicalSignature} from './operationRules.mjs'
import {supplierInventoryReceipt} from './supplierInventory.mjs'
import {procurementEvent,validateProcurement} from './procurementRules.mjs'
export const PURCHASE_PAYMENT_FAMILY='purchase-payment'
const uncertain=()=>Object.assign(Error('付款原紀錄需要核對，請保留輸入，勿重複付款。'),{historyUncertain:true})
const same=(a,b)=>privateDraftDigest(a)===privateDraftDigest(b)
export function assertPaymentLookup(input,current){
 draftObject(input,['family','context','id','digest','document']);expenseScope(input.context,current);const d=input.document
 draftObject(d,['purchaseId','invoiceId','amount','method','note','shiftId','expectedPurchaseDigest'])
 if(input.family!==PURCHASE_PAYMENT_FAMILY||!/^purchase-pay-[-a-f0-9]{36}$/.test(input.id)||!/^[a-f0-9]{64}$/.test(input.digest)||!/^[a-f0-9]{64}$/.test(d.expectedPurchaseDigest)||!['cash','bank'].includes(d.method)||['purchaseId','invoiceId'].some(k=>typeof d[k]!=='string'||!d[k]||d[k].length>128)||typeof d.note!=='string'||d.note.length>500||typeof d.shiftId!=='string'||d.shiftId.length>128||d.method==='bank'&&d.shiftId)throw uncertain()
 moneyValue(d.amount,'付款金額',.01);return input
}
function admittedRequest(input,request){
 operationHeader(request);const d=input.document,c=request.supplierContext
 if(request.kind!=='purchase-pay'||request.id!==input.id||privateDraftDigest(request)!==input.digest||!c||c.storeId!==input.context.storeId||c.epoch!==input.context.epoch||!Number.isSafeInteger(c.revision)||c.revision<0||['purchaseId','invoiceId','amount','method','note'].some(key=>request[key]!==d[key])||(request.shiftId||'')!==d.shiftId)throw uncertain()
 let before;try{before=JSON.parse(request.expectedPurchase)}catch{throw uncertain()}
 if(canonicalSignature(before)!==request.expectedPurchase||before.id!==d.purchaseId||privateDraftDigest(before)!==d.expectedPurchaseDigest)throw uncertain()
}
function admittedMaterial(input,request,result,actor){
 admittedRequest(input,request);const row=result?.receipt,po=result?.purchase
 if(actor?.userId!==input.context.userId||actor.role!=='owner'||typeof actor.username!=='string'||result?.success!==true||row?.id!==input.id||row.kind!=='purchase-pay'||row.signature!==canonicalSignature(request)||row.purchaseId!==request.purchaseId||po?.id!==request.purchaseId||!Array.isArray(row.productIds)||row.productIds.length||!Array.isArray(result.products)||result.products.length)throw uncertain()
 validateProcurement(po);const payment=po.procurement.payments.find(value=>value.id===request.id)
 if(!payment||['invoiceId','amount','method','note'].some(key=>payment[key]!==request[key])||privateDraftDigest(procurementEvent(po,request))!==privateDraftDigest(row.document)||!Number.isSafeInteger(row.purchaseVersion)||po.procurement.revision<row.purchaseVersion)throw uncertain()
 if(request.method==='cash'){
  const cash={id:'procurement-'+request.id,shiftId:request.shiftId,time:request.time,type:'out',amount:request.amount,reason:'供應商付款 '+request.purchaseId,cashier:actor.username||actor.userId}
  if(payment.shiftId!==cash.shiftId||payment.cashLogId!==cash.id||row.cashLogId!==cash.id||!same(result.cashLog,cash))throw uncertain()
 }else if(payment.shiftId||payment.cashLogId||row.cashLogId||result.cashLog)throw uncertain()
 return result
}
export function purchasePaymentOriginal(input,current,data){
 assertPaymentLookup(input,current)
 const rows=data.inventoryAudits.filter(row=>row.action==='INVENTORY_OPERATION'&&row.id==='stock-operation:'+input.id)
 if(rows.length>1)throw uncertain()
 if(!rows.length){if(data.purchases.some(po=>po.procurement?.payments?.some(row=>row.id===input.id)))throw uncertain();return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}}
 const source=rows[0];let receipt,request;try{receipt=typeof source.detail==='string'?JSON.parse(source.detail):source.detail;request=JSON.parse(receipt.signature)}catch{throw uncertain()}
 const actor={userId:source.userId,username:source.username,role:source.role},result=supplierInventoryReceipt(request,receipt,data)
 admittedMaterial(input,request,result,actor)
 return {protocol:'pos-private-draft-original/v1',status:'matched',action:'create',id:input.id,digest:input.digest,request,actor,result:{...result,paymentReversed:result.purchase.procurement.reversals.some(row=>row.paymentId===input.id)}}
}
export function verifyPurchasePaymentProof(input,proof){
 assertPrivateDraftContext(input.context);assertPaymentLookup(input,input.context)
 if(proof?.protocol!=='pos-private-draft-original/v1'||proof.status!=='matched'||proof.action!=='create'||proof.id!==input.id||proof.digest!==input.digest)throw uncertain()
 const result=admittedMaterial(input,proof.request,proof.result,proof.actor),reversed=result.purchase.procurement.reversals.some(row=>row.paymentId===input.id)
 if(result.paymentReversed!==reversed)throw uncertain();return result
}
