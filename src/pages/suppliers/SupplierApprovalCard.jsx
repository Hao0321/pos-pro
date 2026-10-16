import {tr} from '../../i18n'
import {salesMoney} from '../sales/SalesOrderForm'
export const supplierApprovalStatus=status=>tr({pending:'等待另一帳號核准',approved:'已核准',rejected:'已退回',withdrawn:'已撤回',paid:'已記錄付款'}[status]||'待核對')
export function SupplierProposalDetails({purchase,approval,proposal}){
 const original=approval?.material||purchase
 return <div className="supplier-proposal-details">
  {proposal?<><strong>{salesMoney(proposal.amount)} · {tr(proposal.method==='cash'?'現金':'銀行付款')}</strong>{proposal.note&&<p>{proposal.note}</p>}{proposal.reference&&<p>{tr('參考編號')}：{proposal.reference}</p>}</>:original&&<><strong>{salesMoney(original.total)}</strong><p className="customer-id">{original.id}</p><ul>{original.items.map((row,index)=><li key={index}>{row.name} · {row.qty} {row.unit} · {salesMoney(row.unitCost)}</li>)}</ul>{original.note&&<p>{original.note}</p>}</>}
  {(approval||proposal)&&<p>{tr('送審帳號：{0}',{0:(approval||proposal).submittedBy.username})}</p>}
 </div>
}
export default function SupplierApprovalCard({approval,proposal,purchase,session,busy,onStart}){
 const row=proposal||approval,isPayment=!!proposal,self=row.submittedBy.userId===session.userId,prefix=isPayment?'payment':'purchase'
 return <article className="card supplier-approval" data-supplier-approval={row.id}>
  <div className="customer-heading"><h3>{isPayment?tr('預付款提案'):tr('採購待核准')}</h3><span>{supplierApprovalStatus(row.status)}</span></div>
  <p><strong>{isPayment?proposal.supplierName:approval.material.supplierName}</strong></p><SupplierProposalDetails approval={approval} proposal={proposal} purchase={purchase}/>
  {row.status==='pending'&&<div className="customer-actions">
   {self?<><p>{tr('請由另一管理員帳號核准，自己的提案不能自己核准。')}</p><button className="btn btn-ghost" disabled={busy} onClick={()=>onStart(prefix+'-withdraw',row)}>{tr('撤回提案')}</button></>:<><button className="btn btn-primary" data-supplier-review={row.id} disabled={busy} onClick={()=>onStart(prefix+'-approve',row)}>{tr('核對並核准')}</button><button className="btn btn-ghost" disabled={busy} onClick={()=>onStart(prefix+'-reject',row)}>{tr('退回提案')}</button></>}
  </div>}
  {isPayment&&row.status==='approved'&&<><p>{tr('已核准尚未付款。實際付出後，再保存付款紀錄。')}</p><div className="customer-actions"><button className="btn btn-primary" data-supplier-approved-pay={row.id} disabled={busy} onClick={()=>onStart('pay',row)}>{tr('記錄這筆已付訂金')}</button>{self&&<button className="btn btn-ghost" disabled={busy} onClick={()=>onStart('payment-withdraw',row)}>{tr('撤回提案')}</button>}</div></>}
 </article>
}
