import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
import {expenseScope} from './expenseEntry.mjs'
import {operationHeader,canonicalSignature} from './operationRules.mjs'
import {supplierInventoryReceipt} from './supplierInventory.mjs'
import {planProcurement,procurementEvent,validateProcurement} from './procurementRules.mjs'

export const PURCHASE_CORRECTION_FAMILY='purchase-correction'
export const correctionKind=mode=>mode==='reverse'?'purchase-reverse':mode==='cancel'?'purchase-cancel':null
const same=(a,b)=>privateDraftDigest(a)===privateDraftDigest(b)
const uncertain=()=>Object.assign(Error('更正原紀錄需要核對，請保留原因，勿重複操作。'),{historyUncertain:true})
const event=(po,mode,id)=>mode==='cancel'?(po.procurement.cancel?.id===id?po.procurement.cancel:null):po.procurement.reversals.find(row=>row.id===id)

export function assertCorrectionLookup(input,current){
 draftObject(input,['family','context','id','digest','document']);expenseScope(input.context,current)
 const d=input.document;draftObject(d,['mode','purchaseId','paymentId','reason','shiftId','expectedPurchaseDigest','originalAmount','originalMethod'])
 const kind=correctionKind(d.mode)
 if(!kind||input.family!==PURCHASE_CORRECTION_FAMILY||!new RegExp('^'+kind+'-[-a-f0-9]{36}$').test(input.id)||!/^[a-f0-9]{64}$/.test(input.digest)||!/^[a-f0-9]{64}$/.test(d.expectedPurchaseDigest)||typeof d.purchaseId!=='string'||!d.purchaseId||d.purchaseId.length>128||typeof d.paymentId!=='string'||d.paymentId.length>128||typeof d.shiftId!=='string'||d.shiftId.length>128||typeof d.reason!=='string'||!d.reason.trim()||d.reason.length>500||typeof d.originalAmount!=='number'||!Number.isFinite(d.originalAmount)||d.originalAmount<0)throw uncertain()
 if(d.mode==='cancel'?(d.paymentId||d.shiftId||d.originalMethod!==''):(!d.paymentId||d.originalAmount<=0||!['cash','bank'].includes(d.originalMethod)||(d.originalMethod==='cash')!==!!d.shiftId))throw uncertain()
 return input
}
function admittedMaterial(input,request,result,actor){
 operationHeader(request);const d=input.document,c=request.supplierContext
 if(request.kind!==correctionKind(d.mode)||request.id!==input.id||privateDraftDigest(request)!==input.digest||!c||c.storeId!==input.context.storeId||c.epoch!==input.context.epoch||!Number.isSafeInteger(c.revision)||c.revision<0||request.purchaseId!==d.purchaseId||request.reason!==d.reason||(request.paymentId||'')!==d.paymentId||(request.shiftId||'')!==d.shiftId)throw uncertain()
 let before;try{before=JSON.parse(request.expectedPurchase)}catch{throw uncertain()}
 if(canonicalSignature(before)!==request.expectedPurchase||before.id!==d.purchaseId||privateDraftDigest(before)!==d.expectedPurchaseDigest)throw uncertain()
 const original=d.mode==='reverse'?before.procurement.payments.find(row=>row.id===d.paymentId):null
 if(d.originalAmount!==(original?.amount??before.total)||d.originalMethod!==(original?.method||'')||d.mode==='reverse'&&!original)throw uncertain()
 const row=result?.receipt,po=result?.purchase
 if(actor?.userId!==input.context.userId||actor.role!=='owner'||typeof actor.username!=='string'||result?.success!==true||row?.id!==input.id||row.kind!==request.kind||row.signature!==canonicalSignature(request)||row.purchaseId!==request.purchaseId||!Array.isArray(row.productIds)||row.productIds.length||!Array.isArray(result.products)||result.products.length)throw uncertain()
 validateProcurement(po)
 const planned=planProcurement(request,{purchases:[before],openShift:request.shiftId?{id:request.shiftId,status:'open'}:null},actor),actual=event(po,d.mode,input.id),expected=event(planned.purchase,d.mode,input.id)
 if(!actual||!same(actual,expected)||!same(procurementEvent(po,request),row.document)||!Number.isSafeInteger(row.purchaseVersion)||po.procurement.revision<row.purchaseVersion)throw uncertain()
 if(planned.cashLog){if(actual.shiftId!==planned.cashLog.shiftId||actual.cashLogId!==planned.cashLog.id||row.cashLogId!==planned.cashLog.id||!same(result.cashLog,planned.cashLog))throw uncertain()}else if(actual.shiftId||actual.cashLogId||row.cashLogId||result.cashLog)throw uncertain()
 return result
}
export function purchaseCorrectionOriginal(input,current,data){
 assertCorrectionLookup(input,current);const rows=data.inventoryAudits.filter(row=>row.action==='INVENTORY_OPERATION'&&row.id==='stock-operation:'+input.id)
 if(rows.length>1)throw uncertain()
 if(!rows.length){if(data.purchases.some(po=>po.procurement?.cancel?.id===input.id||po.procurement?.reversals?.some(row=>row.id===input.id)))throw uncertain();return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}}
 const source=rows[0];let receipt,request;try{receipt=typeof source.detail==='string'?JSON.parse(source.detail):source.detail;request=JSON.parse(receipt.signature)}catch{throw uncertain()}
 const actor={userId:source.userId,username:source.username,role:source.role},result=supplierInventoryReceipt(request,receipt,data);admittedMaterial(input,request,result,actor)
 return {protocol:'pos-private-draft-original/v1',status:'matched',action:'create',id:input.id,digest:input.digest,request,actor,result}
}
export function verifyPurchaseCorrectionProof(input,proof){
 assertPrivateDraftContext(input.context);assertCorrectionLookup(input,input.context)
 if(proof?.protocol!=='pos-private-draft-original/v1'||proof.status!=='matched'||proof.action!=='create'||proof.id!==input.id||proof.digest!==input.digest)throw uncertain()
 return admittedMaterial(input,proof.request,proof.result,proof.actor)
}
