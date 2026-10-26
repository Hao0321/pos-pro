import {loadPrivateDraftContext,loadSupplierState,getOpenShift,lookupPrivateDraftOriginal} from './dataAccess'
import {isProcurement,validateProcurement} from '../../electron/procurementRules.mjs'
import {correctionKind,verifyPurchaseCorrectionProof} from '../../electron/purchaseCorrection.mjs'
export async function readPurchaseCorrection(purchaseId,mode,paymentId,actor){
 const [context,state,shift]=await Promise.all([loadPrivateDraftContext(actor),loadSupplierState(actor),getOpenShift()])
 if(!correctionKind(mode)||context.role!=='owner'||state.storeId!==context.storeId||state.epoch!==context.epoch)throw Error('店面或帳號已變更，請保留原輸入核對。')
 const po=state.purchases.find(p=>p.id===purchaseId),supplier=state.suppliers.find(s=>s.id===po?.supplierId)
 if(!isProcurement(po)||!supplier)throw Error('原採購或付款已變更，請保留原因核對。');validateProcurement(po)
 const payment=mode==='reverse'?po.procurement.payments.find(p=>p.id===paymentId):null,bill=payment?po.procurement.bills.find(b=>b.id===payment.invoiceId):null
 if(mode==='reverse'&&(!payment||!bill))throw Error('原採購或付款已變更，請保留原因核對。')
 const done=mode==='reverse'?po.procurement.reversals.some(r=>r.paymentId===paymentId):!!po.procurement.cancel
 const eligible=!po.procurement.cancel&&!done&&(mode==='reverse'||!po.procurement.receipts.length&&!po.procurement.bills.length&&!po.procurement.payments.length)
 const issue=eligible?'':mode==='reverse'&&done?'這筆付款已更正，請核對原紀錄。':po.procurement.cancel?'這張採購已取消，請核對原紀錄。':'這張採購已有收貨或帳務，請回原單核對。'
 return {context,state,po,supplier,payment,bill,shift,mode,done,eligible,issue}
}
export async function lookupPurchaseCorrection(input,actor){const proof=await lookupPrivateDraftOriginal(input,actor);if(proof?.protocol!=='pos-private-draft-original/v1'||proof.id!==input.id||!['matched','missing'].includes(proof.status))throw Error('更正原紀錄需要核對，請保留原因，勿重複操作。');if(proof.status==='matched')verifyPurchaseCorrectionProof(input,proof);return proof}
