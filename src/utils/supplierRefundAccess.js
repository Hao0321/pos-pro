import {loadPrivateDraftContext,loadSupplierState,getOpenShift,lookupPrivateDraftOriginal} from './dataAccess'
import {procurementSummary,isProcurement,validateProcurement} from '../../electron/procurementRules.mjs'
import {refundKind,verifySupplierRefundProof} from '../../electron/supplierRefund.mjs'
export async function readSupplierRefund(purchaseId,mode,id,actor){
 const [context,state,shift]=await Promise.all([loadPrivateDraftContext(actor),loadSupplierState(actor),getOpenShift()])
 if(!refundKind(mode)||context.role!=='owner'||state.storeId!==context.storeId||state.epoch!==context.epoch)throw Error('店面或帳號已變更，請保留原輸入核對。')
 const po=state.purchases.find(row=>row.id===purchaseId),supplier=state.suppliers.find(row=>row.id===po?.supplierId)
 if(!isProcurement(po)||!supplier||po.procurement.cancel)throw Error('原採購或供應商已變更，請保留退款輸入核對。');validateProcurement(po)
 const refund=mode==='correct'?po.procurement.refunds?.find(row=>row.id===id):null,bill=procurementSummary(po).bills.find(row=>row.id===(mode==='correct'?refund?.invoiceId:id))
 if(!bill||mode==='correct'&&!refund)throw Error('原請款或退款已變更，請保留原輸入核對。')
 return {context,state,po,bill,supplier,shift,mode,refund,corrected:mode==='correct'&&!!po.procurement.refundReversals?.some(row=>row.refundId===refund.id)}
}
export async function lookupSupplierRefund(input,actor){const proof=await lookupPrivateDraftOriginal(input,actor);if(proof?.protocol!=='pos-private-draft-original/v1'||proof.id!==input.id||!['matched','missing'].includes(proof.status))throw Error('退款原紀錄需要核對，請保留輸入，勿重複記帳。');if(proof.status==='matched')verifySupplierRefundProof(input,proof);return proof}
