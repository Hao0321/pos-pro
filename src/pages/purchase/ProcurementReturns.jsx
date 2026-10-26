import {tr,trMessage} from "../../i18n"
import {useRef,useState,lazy,Suspense} from 'react'
import {procurementSummary} from '../../../electron/procurementRules.mjs'
import {availableForReturn} from '../../../electron/procurementValuation.mjs'
import {loadLotState} from '../../utils/dataAccess'
const SupplierLotReturnModal=lazy(()=>import('./SupplierLotReturnModal.jsx'))

const money=n=>'NT$ '+n.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
export default function ProcurementReturns({po,readOnly=false,store,session,onOpenRefund,refundReady=true,onOpenReturn,returnReady=true}){
  const [error,setError]=useState(''),[done,setDone]=useState(''),[busy,setBusy]=useState(false),running=useRef(false),[lotState,setLotState]=useState(null)
  const p=po.procurement,summary=procurementSummary(po)
  const sources=[{id:''},...p.bills.map(b=>({id:b.id}))].map(s=>availableForReturn(po,s.id)).filter(s=>s.quantities.some(q=>q>0))
  async function openReturn(){if(running.current)return;running.current=true;setBusy(true);setError('');setDone('');try{const state=await loadLotState(session);if(state.active)setLotState(state);else await onOpenReturn(po.id)}catch(cause){setError(cause.message)}finally{running.current=false;setBusy(false)}}
  return <section aria-label={tr("採購退貨與退款")} style={{margin:'16px 0'}}>
    <h4>{tr("退貨與供應商退款")}</h4>
    {!readOnly&&!p.cancel&&sources.length>0&&!lotState&&<button className="btn btn-ghost" data-purchase-return style={{minHeight:56,marginTop:8}} disabled={busy||!returnReady} onClick={openReturn}>{tr("辦理退貨")}</button>}
    {error&&!lotState&&<p role="alert">{trMessage(error)}</p>}
    {lotState&&<Suspense fallback={<p role="status">{tr('正在核對庫存…')}</p>}><SupplierLotReturnModal po={po} state={lotState} store={store} session={session} onClose={()=>setLotState(null)} onSaved={()=>{setLotState(null);setDone('已保存，可核對下方紀錄。')}}/></Suspense>}
    {summary.credit>0&&<div className="card" style={{padding:14,marginTop:10}}><strong>{tr("供應商尚待退回 ")}{money(summary.credit)}</strong><p>{tr("請核對實際收到的款項，再記錄退款。")}</p>{!readOnly&&summary.bills.filter(b=>b.credit>0).map(b=><button key={b.id} className="btn btn-primary" style={{minHeight:48,marginTop:8,width:'100%',whiteSpace:'normal'}} data-supplier-refund={b.id} disabled={busy||!refundReady} onClick={()=>onOpenRefund?.(po.id,'receive',b.id)}>{tr("記錄收到退款 · ")}{b.reference} · {money(b.credit)}</button>)}</div>}
    {done&&<p role="status">{trMessage(done)}</p>}
    {(p.returns?.length>0||p.refunds?.length>0)&&<details open><summary style={{padding:'12px 0',cursor:'pointer'}}>{tr("退貨與退款紀錄")}</summary>
      {p.returns?.map(r=><div key={r.id} className="card" style={{padding:12,marginBottom:8}}><strong>{r.date}{tr(" · 退貨 ")}{money(r.amount)}</strong><p>{r.quantities.map((q,i)=>q>0?`${po.items[i].name} ${q} ${po.items[i].unit||'個'}`:'').filter(Boolean).join('、')}</p><p>{r.reason} · {r.invoiceId?tr("折抵請款 {0}", {0: p.bills.find(b=>b.id===r.invoiceId)?.reference}):tr("沖回未請款收貨")}</p></div>)}
      {p.refunds?.map(r=>{const reversal=p.refundReversals?.find(v=>v.refundId===r.id);return <div key={r.id} className="card" style={{padding:12,marginBottom:8}}><strong>{r.date}{tr(" · 收到退款 ")}{money(r.amount)}</strong><p>{r.method==='cash'?tr("本班現金"):tr("銀行存款")}{r.note?' · '+r.note:''}</p>{reversal?<p>{tr("已更正：")}{reversal.reason}</p>:!readOnly&&<button className="btn btn-ghost" style={{minHeight:48}} data-supplier-refund-correct={r.id} disabled={busy||!refundReady} onClick={()=>onOpenRefund?.(po.id,'correct',r.id)}>{tr("更正這筆退款")}</button>}</div>})}
    </details>}
  </section>
}
