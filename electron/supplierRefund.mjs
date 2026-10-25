import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
import {expenseScope} from './expenseEntry.mjs'
import {operationHeader,canonicalSignature,moneyValue} from './operationRules.mjs'
import {supplierInventoryReceipt} from './supplierInventory.mjs'
import {planProcurement,procurementEvent,validateProcurement} from './procurementRules.mjs'
export const SUPPLIER_REFUND_FAMILY='supplier-refund'
export const refundKind=mode=>mode==='receive'?'purchase-refund':mode==='correct'?'purchase-refund-reverse':null
const uncertain=()=>Object.assign(Error('退款原紀錄需要核對，請保留輸入，勿重複記帳。'),{historyUncertain:true}),same=(a,b)=>privateDraftDigest(a)===privateDraftDigest(b)
export function assertSupplierRefundLookup(input,current){
 draftObject(input,['family','context','id','digest','document']);expenseScope(input.context,current);const d=input.document,kind=refundKind(d?.mode)
 draftObject(d,d?.mode==='receive'?['mode','purchaseId','invoiceId','amount','method','note','shiftId','expectedPurchaseDigest']:['mode','purchaseId','refundId','reason','shiftId','expectedPurchaseDigest'])
 if(!kind||input.family!==SUPPLIER_REFUND_FAMILY||!new RegExp('^'+kind+'-[-a-f0-9]{36}$').test(input.id)||!/^[a-f0-9]{64}$/.test(input.digest)||!/^[a-f0-9]{64}$/.test(d.expectedPurchaseDigest)||['purchaseId',d.mode==='receive'?'invoiceId':'refundId'].some(k=>typeof d[k]!=='string'||!d[k]||d[k].length>128)||typeof d.shiftId!=='string'||d.shiftId.length>128)throw uncertain()
 if(d.mode==='receive'){moneyValue(d.amount,'供應商退款金額',.01);if(!['cash','bank'].includes(d.method)||typeof d.note!=='string'||d.note.length>500||d.method==='bank'&&d.shiftId)throw uncertain()}else if(typeof d.reason!=='string'||!d.reason.trim()||d.reason.length>500)throw uncertain();return input
}
function admittedMaterial(input,request,result,actor){
 operationHeader(request);const d=input.document,c=request.supplierContext,keys=d.mode==='receive'?['purchaseId','invoiceId','amount','method','note']:['purchaseId','refundId','reason']
 if(request.kind!==refundKind(d.mode)||request.id!==input.id||privateDraftDigest(request)!==input.digest||!c||c.storeId!==input.context.storeId||c.epoch!==input.context.epoch||!Number.isSafeInteger(c.revision)||c.revision<0||keys.some(k=>request[k]!==d[k])||(request.shiftId||'')!==d.shiftId)throw uncertain()
 let before;try{before=JSON.parse(request.expectedPurchase)}catch{throw uncertain()}
 if(canonicalSignature(before)!==request.expectedPurchase||before.id!==d.purchaseId||privateDraftDigest(before)!==d.expectedPurchaseDigest)throw uncertain()
 const row=result?.receipt,po=result?.purchase
 if(actor?.userId!==input.context.userId||actor.role!=='owner'||typeof actor.username!=='string'||result?.success!==true||row?.id!==input.id||row.kind!==request.kind||row.signature!==canonicalSignature(request)||row.purchaseId!==request.purchaseId||!Array.isArray(row.productIds)||row.productIds.length||!Array.isArray(result.products)||result.products.length)throw uncertain()
 validateProcurement(po);const planned=planProcurement(request,{purchases:[before],openShift:request.shiftId?{id:request.shiftId,status:'open'}:null},actor),collection=d.mode==='receive'?'refunds':'refundReversals',actual=po.procurement[collection]?.find(value=>value.id===input.id),expected=planned.purchase.procurement[collection]?.find(value=>value.id===input.id)
 if(!actual||!same(actual,expected)||!same(procurementEvent(po,request),row.document)||!Number.isSafeInteger(row.purchaseVersion)||po.procurement.revision<row.purchaseVersion)throw uncertain()
 if(planned.cashLog){if(actual.shiftId!==planned.cashLog.shiftId||actual.cashLogId!==planned.cashLog.id||row.cashLogId!==planned.cashLog.id||!same(result.cashLog,planned.cashLog))throw uncertain()}else if(actual.shiftId||actual.cashLogId||row.cashLogId||result.cashLog)throw uncertain()
 return result
}
const corrected=(input,result)=>input.document.mode==='receive'&&result.purchase.procurement.refundReversals?.some(row=>row.refundId===input.id)||false
export function supplierRefundOriginal(input,current,data){
 assertSupplierRefundLookup(input,current);const rows=data.inventoryAudits.filter(row=>row.action==='INVENTORY_OPERATION'&&row.id==='stock-operation:'+input.id)
 if(rows.length>1)throw uncertain()
 if(!rows.length){if(data.purchases.some(po=>[...(po.procurement?.refunds||[]),...(po.procurement?.refundReversals||[])].some(row=>row.id===input.id)))throw uncertain();return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}}
 const source=rows[0];let receipt,request;try{receipt=typeof source.detail==='string'?JSON.parse(source.detail):source.detail;request=JSON.parse(receipt.signature)}catch{throw uncertain()}
 const actor={userId:source.userId,username:source.username,role:source.role},result=supplierInventoryReceipt(request,receipt,data);admittedMaterial(input,request,result,actor)
 return {protocol:'pos-private-draft-original/v1',status:'matched',action:'create',id:input.id,digest:input.digest,request,actor,result:{...result,refundCorrected:corrected(input,result)}}
}
export function verifySupplierRefundProof(input,proof){
 assertPrivateDraftContext(input.context);assertSupplierRefundLookup(input,input.context)
 if(proof?.protocol!=='pos-private-draft-original/v1'||proof.status!=='matched'||proof.action!=='create'||proof.id!==input.id||proof.digest!==input.digest)throw uncertain()
 const result=admittedMaterial(input,proof.request,proof.result,proof.actor);if(result.refundCorrected!==corrected(input,result))throw uncertain();return result
}
