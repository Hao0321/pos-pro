import {tr} from '../../i18n'
import {salesSummary,activeSalesPayments,activeSalesRefunds} from '../../../electron/salesRules.mjs'
import {salesMoney} from './SalesOrderForm'
import {salesActionTitle} from './SalesOperationForm'

export const salesStatus=status=>tr({ordered:'已接單、尚未備貨',partial:'部分交付',delivered:'已全部交付',closed:'剩餘訂購已結束'}[status])
export default function SalesDocumentDetail({document:doc,today,pending,onAction,onBack,customerCredits=[],onCustomerLedger}){
  const summary=salesSummary(doc,today,customerCredits),payments=activeSalesPayments(doc),refunds=activeSalesRefunds(doc)
  const events=[...doc.deliveries,...doc.payments,...doc.paymentReversals,...doc.returns,...doc.allowances,...doc.refunds,...doc.refundReversals,...doc.closures].sort((a,b)=>b.revision-a.revision)
  function download(){
    const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json;charset=utf-8'})),link=document.createElement('a')
    link.href=url;link.download='sales-'+doc.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <section className="card sales-detail" aria-label={tr('銷售單明細')}>
    {summary.prepaid>0&&<div className="sales-note"><p>{tr('已有預收款抵付 {0}。退貨後需要退回這部分款項，請先到客戶款項解除抵付。',{0:salesMoney(summary.prepaid)})}</p><button className="btn btn-ghost" onClick={onCustomerLedger}>{tr('查看客戶款項')}</button></div>}
    <div className="sales-heading"><div><p className="sales-status">{salesStatus(summary.status)}</p><h2>{doc.customer.name}</h2><p>{doc.date} · <span className="sales-id">{doc.id}</span></p></div><button className="btn btn-ghost" data-sales-back onClick={onBack}>{tr('回銷售單列表')}</button></div>
    <div className="sales-metrics"><div><span>{tr('原接單金額')}</span><strong>{salesMoney(doc.total)}</strong></div><div><span>{tr('客戶還沒付')}</span><strong data-sales-owed>{salesMoney(summary.owed)}</strong></div><div><span>{tr('還要退給客戶')}</span><strong data-sales-credit>{salesMoney(summary.credit)}</strong></div></div>
    {summary.status==='ordered'&&<p className="sales-note">{tr('尚未扣庫存或保留商品。交給客戶時，系統會再次確認可用量。')}</p>}
    {summary.overdue>0&&<p role="status">{tr('已有 {0} 逾期未收，請與客戶核對。',{0:salesMoney(summary.overdue)})}</p>}
    <div className="sales-lines">{doc.items.map((item,index)=><div key={item.productId} className="sales-line"><div><strong>{item.name}</strong><p>{item.qty} {item.unit} × {salesMoney(item.unitPrice)}</p></div><span>{tr('尚待交付 {0} {1}',{0:summary.pending[index],1:item.unit})}</span></div>)}</div>
    {doc.note&&<p className="sales-merchant-note">{doc.note}</p>}
    {doc.sourceQuote&&<p className="sales-note">{tr('沿用報價第 {0} 版',{0:doc.sourceQuote.revision})} · <span className="sales-id">{doc.sourceQuote.id}</span></p>}
    {!doc.closures.length&&summary.pending.some(qty=>qty>0)&&<div className="sales-actions"><button className="btn btn-primary" data-sales-deliver disabled={pending} onClick={()=>onAction({action:'deliver'})}>{tr('下一步：交給客戶')}</button><span>{tr('可以分批交付，不必一次全交。')}</span></div>}
    {summary.claims.length>0&&<section className="sales-claims"><h3>{tr('每批交付與收款')}</h3><p>{tr('收款只減少客戶欠款，不會再算一次營收。')}</p>{summary.claims.map((claim,index)=><article className="sales-claim" key={claim.delivery.id}>
      <div><h4>{tr('第 {0} 批交付',{0:index+1})}</h4><p>{claim.delivery.date} · {tr('到期日 {0}',{0:claim.delivery.dueDate})}</p><p>{tr('請款 {0}・已收淨額 {1}',{0:salesMoney(claim.net),1:salesMoney(claim.paid)})}</p><strong>{tr('尚未收 {0}',{0:salesMoney(claim.owed)})}</strong>{claim.credit>0&&<p>{tr('尚應退款 {0}',{0:salesMoney(claim.credit)})}</p>}</div>
      {claim.owed>0&&<button className="btn btn-primary" data-sales-pay={claim.delivery.id} disabled={pending} onClick={()=>onAction({action:'pay',deliveryId:claim.delivery.id})}>{tr('收這筆款')}</button>}
      <details className="sales-more"><summary>{tr('退貨、折讓與款項更正')}</summary><div className="sales-actions"><button className="btn btn-ghost" disabled={pending} data-sales-return={claim.delivery.id} onClick={()=>onAction({action:'return',deliveryId:claim.delivery.id})}>{tr('客戶要退貨')}</button><button className="btn btn-ghost" disabled={pending} data-sales-discount={claim.delivery.id} onClick={()=>onAction({action:'allowance',deliveryId:claim.delivery.id})}>{tr('給客戶折讓')}</button></div>
        {payments.filter(payment=>payment.deliveryId===claim.delivery.id).map(payment=><div className="sales-payment" key={payment.id}><p>{payment.date} · {payment.method==='cash'?tr('現金'):tr('銀行收款')} {salesMoney(payment.amount)}{payment.reference&&<> · {payment.reference}</>}</p><div className="sales-actions">{claim.credit>0&&Math.round((payment.amount-refunds.filter(r=>r.paymentId===payment.id).reduce((n,r)=>n+r.amount,0))*100)>0&&<button className="btn btn-ghost" data-sales-refund={payment.id} disabled={pending} onClick={()=>onAction({action:'refund',paymentId:payment.id})}>{tr('退回這筆多收款')}</button>}{!refunds.some(r=>r.paymentId===payment.id)&&<button className="btn btn-ghost" data-sales-reverse={payment.id} disabled={pending} onClick={()=>onAction({action:'pay-reverse',paymentId:payment.id})}>{tr('這筆收款記錯了')}</button>}</div></div>)}
        {refunds.filter(refund=>refund.deliveryId===claim.delivery.id).map(refund=><div className="sales-payment" key={refund.id}><p>{tr('已退款 {0}',{0:salesMoney(refund.amount)})} · {refund.date}</p><button className="btn btn-ghost" data-sales-refund-reverse={refund.id} disabled={pending} onClick={()=>onAction({action:'refund-reverse',refundId:refund.id})}>{tr('這筆退款記錯了')}</button></div>)}
      </details>
    </article>)}</section>}
    <details className="sales-more"><summary>{tr('完整紀錄與其他操作')}</summary><button className="btn btn-ghost" onClick={download}>{tr('下載這張銷售單')}</button>{!doc.closures.length&&summary.pending.some(qty=>qty>0)&&<button className="btn btn-ghost" disabled={pending} onClick={()=>onAction({action:'close'})}>{tr('結束剩餘訂購')}</button>}<p>{tr('這是內部銷售與請款紀錄，不是稅務發票。')}</p><ol className="sales-history">{events.map(event=><li key={event.id}><strong>{salesActionTitle(event.action)}</strong><span>{event.date} · {event.actor.username}{event.amount!==undefined&&<> · {salesMoney(event.amount)}</>}</span><span className="sales-id">{event.id}</span>{event.reason&&<p>{event.reason}</p>}</li>)}</ol></details>
  </section>
}
