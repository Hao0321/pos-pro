import {tr} from "../../i18n"
import {isProcurement,procurementSummary} from '../../../electron/procurementRules.mjs'
import ProcurementReturns from './ProcurementReturns.jsx'
import {availableForReturn} from '../../../electron/procurementValuation.mjs'

const money=value=>'NT$ '+value.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
const actionStyle={minHeight:48}
export function ProcurementPanel({po,readOnly=false,approvalBlocked=false,supplierCredits=[],onSupplierLedger,store,session,onOpenPayment,paymentReady=true,onOpenInvoice,invoiceReady=true,onOpenRefund,refundReady=true,onOpenReturn,returnReady=true,onOpenCorrection,correctionReady=true}){
  if(!isProcurement(po))return <p style={{fontSize:12,color:'var(--text-secondary)'}}>{tr("歷史進貨單保留原帳。新增採購使用收貨、請款、分次付款與自動分錄流程。")}</p>
  const summary=procurementSummary(po,undefined,supplierCredits),p=po.procurement
  const billable=availableForReturn(po).quantities
  return <section className="procurement-flow" aria-label={tr("採購帳務流程")} style={{marginTop:16,paddingBottom:24}}>
    <h3 style={{fontSize:16}}>{tr("採購帳務流程")}</h3>
    {approvalBlocked&&<p role="status">{tr('先完成採購核准，再收貨、請款或付款。')}</p>}
    {summary.prepaid>0&&<div className="card" style={{padding:14}}><p>{tr('已有供應商預付款抵付 {0}，應付餘額已扣除。退貨後的預付部分，先解除原抵付再記錄退回。',{0:money(summary.prepaid)})}</p>{onSupplierLedger&&<button className="btn btn-ghost" onClick={onSupplierLedger}>{tr('查看供應商預付款')}</button>}</div>}
    <p style={{fontSize:16,lineHeight:1.6}}>{readOnly?tr("目前為查看模式，請由老闆確認收貨與帳款。"):p.cancel?tr("這張採購已取消。"):billable.some(q=>q>0)?tr("接著：核對供應商單據，登錄已收到的貨款。"):summary.owed>0?tr("接著：實際付款後，在請款單下方記錄付款。"):summary.credit>0?tr("接著：核對供應商是否已退回款項。"):po.status==='received'?tr("這張採購的收貨與帳款已核對。"):tr("接著：貨到了，再按「確認到貨」。")}</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8,margin:'12px 0'}}>
      {[['已收貨',summary.received],['待請款',summary.unbilled],['已付淨額',summary.paid],['應付餘額',summary.owed],['逾期未付',summary.overdue]].map(([label,value])=><div key={label} className="card" style={{padding:12}}><div style={{fontSize:12}}>{tr(label)}</div><strong>{money(value)}</strong></div>)}
    </div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
      {!readOnly&&!p.cancel&&billable.some(q=>q>0)&&<button className="btn btn-primary" data-procurement-invoice={po.id} disabled={approvalBlocked||!invoiceReady} style={{...actionStyle,minHeight:48}} onClick={()=>onOpenInvoice?.(po.id)}>{tr("登錄請款")}</button>}
      {!readOnly&&!p.cancel&&!p.receipts.length&&<button className="btn btn-ghost" style={actionStyle} data-purchase-cancel={po.id} disabled={!correctionReady||!onOpenCorrection} onClick={()=>onOpenCorrection?.(po.id,'cancel','')}>{tr("取消這張採購")}</button>}
    </div>
    {p.cancel&&<p role="status">{tr("已取消：")}{p.cancel.reason}</p>}
    {summary.bills.map(b=><div key={b.id} className="card" style={{padding:14,marginBottom:8}}>
      <strong>{tr("請款單 ")}{b.reference}</strong><div style={{fontSize:12,margin:'6px 0'}}>{tr("到期 ")}{b.dueDate}{tr(" · 請款 ")}{money(b.amount)}{tr(" · 未付 ")}{money(Math.max(0,b.balance))}{b.credit>0?tr(" · 供應商待退 {0}", {0: money(b.credit)}):''}{b.overdue?tr(" · 已逾期"):''}</div>
      {!readOnly&&b.balance>0&&<button className="btn btn-primary" disabled={approvalBlocked||!paymentReady||!onOpenPayment} data-procurement-payment={b.id} style={{...actionStyle,minHeight:48}} onClick={()=>onOpenPayment(po.id,b.id)}>{tr("記錄付款")}</button>}
    </div>)}
    {p.payments.length>0&&<div style={{margin:'16px 0'}}><h4>{tr("付款與沖銷紀錄")}</h4>{p.payments.map(pay=>{
      const reverse=p.reversals.find(r=>r.paymentId===pay.id),bill=p.bills.find(b=>b.id===pay.invoiceId)
      return <div key={pay.id} className="card" style={{padding:12,marginTop:8}}><div>{pay.date} · {pay.method==='cash'?tr("現金"):tr("銀行")} · {money(pay.amount)}</div><div style={{fontSize:12,overflowWrap:'anywhere'}}>{tr("請款 ")}{bill.reference} · {pay.id}{pay.note?' · '+pay.note:''}</div>
        {reverse?<p style={{fontSize:12}}>{tr("已沖銷 ")}{reverse.date}：{reverse.reason}</p>:!readOnly&&<button className="btn btn-ghost" style={actionStyle} data-purchase-reverse={pay.id} disabled={!correctionReady||!onOpenCorrection} onClick={()=>onOpenCorrection?.(po.id,'reverse',pay.id)}>{tr("更正這筆付款")}</button>}</div>
    })}</div>}
    <details><summary style={{cursor:'pointer',padding:'12px 0'}}>{tr("收貨憑證（")}{p.receipts.length}{tr(" 筆）")}</summary>{p.receipts.map(r=><div key={r.id} style={{fontSize:12,padding:8,overflowWrap:'anywhere'}}>{r.date} · {money(r.amount)} · {r.id}<div>{r.quantities.map((q,i)=>q>0?`${po.items[i].name} ${q} ${po.items[i].unit||'個'}`:'').filter(Boolean).join('、')}</div></div>)}</details>
    <ProcurementReturns po={po} readOnly={readOnly} store={store} session={session} onOpenRefund={onOpenRefund} refundReady={refundReady} onOpenReturn={onOpenReturn} returnReady={returnReady}/>
    <p style={{fontSize:12,color:'var(--text-secondary)'}}>{tr("請款僅可登錄已收貨部分；付款與收貨各自追蹤。付款記錄須與實際付款核對。")}</p>
  </section>
}
