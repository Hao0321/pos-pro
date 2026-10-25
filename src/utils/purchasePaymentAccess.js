import {loadPrivateDraftContext,loadSupplierState,getOpenShift,lookupPrivateDraftOriginal} from './dataAccess'
import {procurementSummary,isProcurement} from '../../electron/procurementRules.mjs'
import {verifyPurchasePaymentProof} from '../../electron/purchasePayment.mjs'
export async function readPurchasePayment(purchaseId,invoiceId,actor){
 const [context,state,shift]=await Promise.all([loadPrivateDraftContext(actor),loadSupplierState(actor),getOpenShift()])
 if(context.role!=='owner'||state.storeId!==context.storeId||state.epoch!==context.epoch)throw Error('店面或帳號已變更，請保留原輸入核對。')
 const po=state.purchases.find(row=>row.id===purchaseId),supplier=state.suppliers.find(row=>row.id===po?.supplierId)
 if(!isProcurement(po)||!supplier||po.procurement.cancel)throw Error('原採購或供應商已變更，請保留付款輸入核對。')
 const bill=procurementSummary(po,undefined,state.supplierLedger.entries).bills.find(row=>row.id===invoiceId)
 if(!bill)throw Error('原請款單已變更，請保留付款輸入核對。')
 return {context,state,po,bill,supplier,shift}
}
export async function lookupPurchasePayment(input,actor){const proof=await lookupPrivateDraftOriginal(input,actor);if(proof?.protocol!=='pos-private-draft-original/v1'||proof.id!==input.id||!['matched','missing'].includes(proof.status))throw Error('付款原紀錄需要核對，請保留輸入，勿重複付款。');if(proof.status==='matched')verifyPurchasePaymentProof(input,proof);return proof}
