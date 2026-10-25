import {loadPrivateDraftContext,loadSupplierState,lookupPrivateDraftOriginal} from './dataAccess'
import {isProcurement,validateProcurement} from '../../electron/procurementRules.mjs'
import {verifyPurchaseInvoiceProof} from '../../electron/purchaseInvoice.mjs'
export async function readPurchaseInvoice(purchaseId,actor){
 const [context,state]=await Promise.all([loadPrivateDraftContext(actor),loadSupplierState(actor)])
 if(context.role!=='owner'||state.storeId!==context.storeId||state.epoch!==context.epoch)throw Error('店面或帳號已變更，請保留原輸入核對。')
 const po=state.purchases.find(row=>row.id===purchaseId),supplier=state.suppliers.find(row=>row.id===po?.supplierId)
 if(!isProcurement(po)||!supplier||po.procurement.cancel)throw Error('原採購或供應商已變更，請保留請款輸入核對。');validateProcurement(po)
 return {context,state,po,supplier}
}
export async function lookupPurchaseInvoice(input,actor){const proof=await lookupPrivateDraftOriginal(input,actor);if(proof?.protocol!=='pos-private-draft-original/v1'||proof.id!==input.id||!['matched','missing'].includes(proof.status))throw Error('請款原紀錄需要核對，請保留輸入，勿重複建單。');if(proof.status==='matched')verifyPurchaseInvoiceProof(input,proof);return proof}
