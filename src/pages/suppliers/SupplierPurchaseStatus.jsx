import {tr} from '../../i18n'
import {isProcurement} from '../../../electron/procurementRules.mjs'
import {supplierApprovalStatus} from './SupplierApprovalCard'
export function purchaseApprovalBlocked(po,state){
 const ledger=state?.supplierLedger,approval=ledger?.purchaseApprovals.find(row=>row.purchaseId===po.id)
 return isProcurement(po)?approval?approval.status!=='approved':ledger?.policy.mode==='dual-owner':!!state?.legacyReadOnly
}
export default function SupplierPurchaseStatus({po,state,onOpen}){
 if(!state)return null
 const ledger=state.supplierLedger,approval=ledger.purchaseApprovals.find(row=>row.purchaseId===po.id),blocked=purchaseApprovalBlocked(po,state)
 if(!isProcurement(po))return state.legacyReadOnly?<p className="customer-note">{tr('歷史進貨單保留原帳，請使用新採購的正式收貨與付款流程')}</p>:null
 if(!blocked&&!approval?.requiredApproval)return null
 return <section className="card" style={{padding:14,marginBottom:12}} data-purchase-approval>
  <strong>{approval?supplierApprovalStatus(approval.status):tr('這張舊採購請先納入核准')}</strong>
  <p>{blocked?tr('先完成採購核准，再收貨、請款或付款。'):tr('這張採購已由另一管理員帳號核准。')}</p>
  {approval&&<p>{tr('送審帳號：{0}',{0:approval.submittedBy.username})}{approval.approvedBy?' · '+tr('核准帳號：{0}',{0:approval.approvedBy.username}):''}</p>}
  <button className="btn btn-ghost" data-purchase-review onClick={()=>onOpen(po.supplierId,po.id)}>{tr(approval?'查看核准紀錄':'將這張採購納入核准')}</button>
 </section>
}
