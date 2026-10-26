import {draftObject,privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {PURCHASE_CORRECTION_FAMILY,correctionKind} from '../../electron/purchaseCorrection.mjs'
export const newPurchaseCorrection=()=>({target:null,form:{reason:''},submission:null})
export function validPurchaseCorrection(value){try{
 draftObject(value,['target','form','submission']);draftObject(value.form,['reason'])
 if(typeof value.form.reason!=='string'||value.form.reason.length>500)return false
 if(value.target){
  const t=value.target;draftObject(t,['mode','purchaseId','paymentId','supplierId','supplierName','reference','date','itemCount','originalAmount','originalMethod','purchaseDigest','shift','done','eligible'])
  if(!correctionKind(t.mode)||['purchaseId','supplierId'].some(k=>typeof t[k]!=='string'||!t[k]||t[k].length>128)||typeof t.paymentId!=='string'||t.paymentId.length>128||typeof t.supplierName!=='string'||t.supplierName.length>2000||typeof t.reference!=='string'||t.reference.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||!Number.isInteger(t.itemCount)||t.itemCount<1||t.itemCount>1000||typeof t.originalAmount!=='number'||!Number.isFinite(t.originalAmount)||t.originalAmount<0||!/^[a-f0-9]{64}$/.test(t.purchaseDigest)||typeof t.done!=='boolean'||typeof t.eligible!=='boolean'||t.done&&t.eligible)return false
  if(t.mode==='cancel'?(t.paymentId||t.originalMethod!==''||t.shift!==null):(!t.paymentId||!['bank','cash'].includes(t.originalMethod)||t.originalAmount<=0||t.originalMethod==='bank'&&t.shift!==null))return false
  if(t.shift){draftObject(t.shift,['id','openTime','cashier']);if(typeof t.shift.id!=='string'||!t.shift.id||t.shift.id.length>128||!Number.isFinite(Date.parse(t.shift.openTime))||typeof t.shift.cashier!=='string'||t.shift.cashier.length>2000)return false}
 }
 if(value.submission){draftObject(value.submission,['id','time','digest']);if(!value.target||!new RegExp('^'+correctionKind(value.target.mode)+'-[-a-f0-9]{36}$').test(value.submission.id)||!Number.isFinite(Date.parse(value.submission.time))||!/^[a-f0-9]{64}$/.test(value.submission.digest))return false}return true
}catch{return false}}
export function correctionTarget(s){const {mode,po,payment,bill,supplier}=s,shift=mode==='reverse'&&payment.method==='cash'?s.shift:null;return {mode,purchaseId:po.id,paymentId:payment?.id||'',supplierId:po.supplierId,supplierName:supplier.name,reference:bill?.reference||'',date:payment?.date||po.date,itemCount:po.items.length,originalAmount:payment?.amount??po.total,originalMethod:payment?.method||'',purchaseDigest:privateDraftDigest(po),shift:shift?{id:shift.id,openTime:shift.openTime,cashier:shift.cashier||''}:null,done:s.done,eligible:s.eligible}}
export function correctionLookup(saved,context){if(!validPurchaseCorrection(saved)||!saved.submission)throw Error('更正原紀錄需要核對，請保留原因，勿重複操作。');const {target:t,form:f,submission:s}=saved;return {family:PURCHASE_CORRECTION_FAMILY,context,id:s.id,digest:s.digest,document:{mode:t.mode,purchaseId:t.purchaseId,paymentId:t.paymentId,reason:f.reason,shiftId:t.shift?.id||'',expectedPurchaseDigest:t.purchaseDigest,originalAmount:t.originalAmount,originalMethod:t.originalMethod}}}
