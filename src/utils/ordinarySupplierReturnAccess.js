import {loadPrivateDraftContext,loadSupplierState,loadLotState,lookupPrivateDraftOriginal} from './dataAccess'
import {isProcurement,validateProcurement} from '../../electron/procurementRules.mjs'
import {verifyOrdinaryReturnProof} from '../../electron/ordinarySupplierReturn.mjs'
export async function readOrdinaryReturn(purchaseId,actor){
 const [context,state,lot]=await Promise.all([loadPrivateDraftContext(actor),loadSupplierState(actor),loadLotState(actor)])
 if(context.role!=='owner'||[state,lot.context].some(c=>c.storeId!==context.storeId||c.epoch!==context.epoch))throw Error('店面或帳號已變更，請保留原輸入核對。')
 if(lot.active)throw Error('這間店已使用批次，請保留輸入，改由批次退貨核對。')
 const po=state.purchases.find(p=>p.id===purchaseId),supplier=state.suppliers.find(s=>s.id===po?.supplierId)
 if(!isProcurement(po)||!supplier||po.procurement.cancel)throw Error('原採購或供應商已變更，請保留退貨輸入核對。');validateProcurement(po)
 return {context,state,po,supplier,products:lot.products.map(p=>({id:p.id,name:p.name,unit:p.unit,stock:p.availableUnits/1000})),costActive:lot.costActive,lotsActive:lot.active}
}
export async function lookupOrdinaryReturn(input,actor){const proof=await lookupPrivateDraftOriginal(input,actor);if(proof?.protocol!=='pos-private-draft-original/v1'||proof.id!==input.id||!['matched','missing'].includes(proof.status))throw Error('退貨原紀錄需要核對，請保留輸入，勿重複退貨。');if(proof.status==='matched')verifyOrdinaryReturnProof(input,proof);return proof}
