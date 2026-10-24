import {tr,trMessage} from "../../i18n"
import {useEffect,useRef,useState,lazy,Suspense} from 'react'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import {procurementSummary} from '../../../electron/procurementRules.mjs'
import {availableForReturn,quoteProcurementAllocation} from '../../../electron/procurementValuation.mjs'
import {ps} from './controls.jsx'
import {loadLotState} from '../../utils/dataAccess'
const SupplierLotReturnModal=lazy(()=>import('./SupplierLotReturnModal.jsx'))

const money=n=>'NT$ '+n.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
const control={minHeight:48,fontSize:16,width:'100%'}
export default function ProcurementReturns({po,onCommand,openShift,readOnly=false,store,session}){
  const [dialog,setDialog]=useState(null),[error,setError]=useState(''),[done,setDone]=useState(''),[busy,setBusy]=useState(false),running=useRef(false)
  const [lotState,setLotState]=useState(null)
  const p=po.procurement,summary=procurementSummary(po)
  useEffect(()=>{
    const committed=e=>{if(dialog&&e.detail?.purchase?.id===po.id&&e.detail.receipt?.kind===dialog.kind){setDialog(null);setBusy(false);running.current=false;setError('');setDone('已保存，可核對下方紀錄。')}}
    window.addEventListener('pos-inventory-operation',committed);return()=>window.removeEventListener('pos-inventory-operation',committed)
  },[dialog,po.id])
  const sources=[{id:'',label:'尚未請款的貨'},...p.bills.map(b=>({id:b.id,label:'請款單 '+b.reference}))].map(source=>({...source,...availableForReturn(po,source.id)})).filter(s=>s.quantities.some(q=>q>0))
  function open(kind,extra={}){setError('');setDone('');setDialog({kind,expectedPurchase:canonicalSignature(po),invoiceId:sources[0]?.id||'',quantities:po.items.map(()=>''),reason:'',method:'bank',amount:'',note:'',...extra})}
  async function openReturn(){if(running.current)return;if(!store||!session)return open('purchase-return');running.current=true;setBusy(true);setError('');setDone('');try{const state=await loadLotState(session);if(state.active)setLotState(state);else open('purchase-return')}catch(cause){setError(cause.message)}finally{running.current=false;setBusy(false)}}
  const update=(key,value)=>setDialog(d=>({...d,[key]:value}))
  const available=dialog?.kind==='purchase-return'?availableForReturn(po,dialog.invoiceId):null
  let preview=null
  if(available)try{preview=quoteProcurementAllocation(po,dialog.quantities.map(q=>q===''?0:Number(q)),dialog.invoiceId)}catch{}
  async function submit(e){
    e.preventDefault();if(running.current)return;running.current=true;setBusy(true);setError('')
    try{
      const input={purchaseId:po.id,expectedPurchase:dialog.expectedPurchase}
      if(dialog.kind==='purchase-return')Object.assign(input,{invoiceId:dialog.invoiceId,quantities:dialog.quantities.map(q=>q===''?0:Number(q)),reason:dialog.reason})
      else if(dialog.kind==='purchase-refund')Object.assign(input,{invoiceId:dialog.invoiceId,amount:Number(dialog.amount),method:dialog.method,note:dialog.note})
      else Object.assign(input,{refundId:dialog.refundId,reason:dialog.reason})
      if(dialog.method==='cash'&&dialog.kind!=='purchase-return')input.shiftId=openShift?.id||''
      await onCommand(dialog.kind,input);setDialog(null);setDone('已保存，可核對下方紀錄。')
    }catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  const title=dialog&&({'purchase-return':'把貨退給供應商','purchase-refund':'記錄收到供應商退款','purchase-refund-reverse':'更正供應商退款'}[dialog.kind])
  return <section aria-label={tr("採購退貨與退款")} style={{margin:'16px 0'}}>
    <h4>{tr("退貨與供應商退款")}</h4>
    {!readOnly&&!p.cancel&&sources.length>0&&!lotState&&<button className="btn btn-ghost" data-purchase-return style={{minHeight:56,marginTop:8}} disabled={busy} onClick={openReturn}>{tr("辦理退貨")}</button>}
    {error&&!dialog&&!lotState&&<p role="alert">{trMessage(error)}</p>}
    {lotState&&<Suspense fallback={<p role="status">{tr('正在核對庫存…')}</p>}><SupplierLotReturnModal po={po} state={lotState} store={store} session={session} onClose={()=>setLotState(null)} onSaved={()=>{setLotState(null);setDone('已保存，可核對下方紀錄。')}}/></Suspense>}
    {summary.credit>0&&<div className="card" style={{padding:14,marginTop:10}}><strong>{tr("供應商尚待退回 ")}{money(summary.credit)}</strong><p>{tr("請核對實際收到的款項，再記錄退款。")}</p>{!readOnly&&summary.bills.filter(b=>b.credit>0).map(b=><button key={b.id} className="btn btn-primary" style={{minHeight:48,marginTop:8,width:'100%',whiteSpace:'normal'}} onClick={()=>open('purchase-refund',{invoiceId:b.id,reference:b.reference,amount:String(b.credit)})}>{tr("記錄收到退款 · ")}{b.reference} · {money(b.credit)}</button>)}</div>}
    {done&&<p role="status">{trMessage(done)}</p>}
    {(p.returns?.length>0||p.refunds?.length>0)&&<details open><summary style={{padding:'12px 0',cursor:'pointer'}}>{tr("退貨與退款紀錄")}</summary>
      {p.returns?.map(r=><div key={r.id} className="card" style={{padding:12,marginBottom:8}}><strong>{r.date}{tr(" · 退貨 ")}{money(r.amount)}</strong><p>{r.quantities.map((q,i)=>q>0?`${po.items[i].name} ${q} ${po.items[i].unit||'個'}`:'').filter(Boolean).join('、')}</p><p>{r.reason} · {r.invoiceId?tr("折抵請款 {0}", {0: p.bills.find(b=>b.id===r.invoiceId)?.reference}):tr("沖回未請款收貨")}</p></div>)}
      {p.refunds?.map(r=>{const reversal=p.refundReversals?.find(v=>v.refundId===r.id);return <div key={r.id} className="card" style={{padding:12,marginBottom:8}}><strong>{r.date}{tr(" · 收到退款 ")}{money(r.amount)}</strong><p>{r.method==='cash'?tr("本班現金"):tr("銀行存款")}{r.note?' · '+r.note:''}</p>{reversal?<p>{tr("已更正：")}{reversal.reason}</p>:!readOnly&&<button className="btn btn-ghost" style={{minHeight:48}} onClick={()=>open('purchase-refund-reverse',{refundId:r.id,method:r.method})}>{tr("更正這筆退款")}</button>}</div>})}
    </details>}
    {dialog&&<div style={ps.overlay}><form role="dialog" aria-modal="true" aria-label={title} style={ps.modal} onSubmit={submit}>
      <h3>{tr(title)}</h3>
      {available&&<>
        <p>{tr("填入這次實際退回的數量，系統會一起更正庫存與帳款。")}</p>
        <label>{tr("退哪一批貨？")}<select autoFocus className="field" style={control} aria-label={tr("退貨來源")} value={dialog.invoiceId} onChange={e=>setDialog(d=>({...d,invoiceId:e.target.value,quantities:po.items.map(()=>''),reason:d.reason}))}>{sources.map(s=><option key={s.id} value={s.id}>{tr(s.label)}</option>)}</select></label>
        <button type="button" className="btn btn-ghost" style={{minHeight:48,margin:'10px 0'}} onClick={()=>update('quantities',available.quantities.map(String))}>{tr("填入這批全部可退數量")}</button>
        {po.items.map((item,i)=><label key={i} style={{display:'block',marginBottom:10}}>{item.name}{tr(" · 最多 ")}{available.quantities[i]} {item.unit||tr("個")}<input aria-label={tr("退貨數量 {0} {1}", {0: item.name, 1: i+1})} className="field" style={control} type="number" step="0.001" min="0" max={available.quantities[i]} disabled={!available.quantities[i]} value={dialog.quantities[i]} placeholder={tr("不退填 0")} onChange={e=>update('quantities',dialog.quantities.map((q,index)=>i===index?e.target.value:q))}/></label>)}
        <label>{tr("為什麼退貨？")}<select aria-label={tr("退貨原因")} className="field" style={control} required value={['品質不符','數量錯誤','協議退貨'].includes(dialog.reason)?dialog.reason:dialog.reason?'其他':''} onChange={e=>update('reason',e.target.value==='其他'?'其他：':e.target.value)}><option value="">{tr("請選原因")}</option>{['品質不符','數量錯誤','協議退貨','其他'].map(reason=><option key={reason} value={reason}>{tr(reason)}</option>)}</select></label>
        {dialog.reason.startsWith('其他')&&<input aria-label={tr("其他退貨原因")} className="field" style={control} value={dialog.reason} maxLength={500} required onChange={e=>update('reason',e.target.value)}/>}
        <p style={{fontSize:22,fontWeight:700}}>{tr("本次退貨 ")}{preview===null?tr("請核對數量"):money(preview)}</p><p>{tr("未付款會減少應付；已付款會列為供應商待退，收到款項後再核銷。")}</p>
      </>}
      {dialog.kind==='purchase-refund'&&<>
        <p>{tr("請款單 ")}{dialog.reference}</p><label>{tr("這次收到多少錢？")}<input autoFocus aria-label={tr("供應商退款金額")} className="field" style={control} required type="number" min="0.01" step="0.01" value={dialog.amount} onChange={e=>update('amount',e.target.value)}/></label>
        <label>{tr("收到哪裡？")}<select aria-label={tr("供應商退款方式")} className="field" style={control} value={dialog.method} onChange={e=>update('method',e.target.value)}><option value="bank">{tr("銀行存款")}</option><option value="cash">{tr("本班次現金")}</option></select></label>
        <label>{tr("備註")}<input aria-label={tr("供應商退款備註")} className="field" style={control} value={dialog.note} maxLength={500} onChange={e=>update('note',e.target.value)}/></label>
      </>}
      {dialog.kind==='purchase-refund-reverse'&&<label>{tr("更正原因")}<textarea autoFocus aria-label={tr("退款更正原因")} className="field" style={control} required maxLength={500} value={dialog.reason} onChange={e=>update('reason',e.target.value)}/></label>}
      {dialog.method==='cash'&&dialog.kind!=='purchase-return'&&<p>{openShift?tr("現金異動會列入目前班次。"):tr("請先開班，再記錄現金退款或更正。")}</p>}
      {error&&<p role="alert" style={{color:'var(--red)'}}>{trMessage(error)}</p>}
      <div style={{display:'flex',gap:10,marginTop:16}}><button className="btn btn-ghost" type="button" style={{minHeight:48}} disabled={busy} onClick={()=>{setDialog(null);setError('')}}>{tr("先不要")}</button><button className="btn btn-primary" style={{minHeight:48,flex:1}} disabled={busy||available&&preview===null||dialog.kind!=='purchase-return'&&dialog.method==='cash'&&!openShift}>{busy?tr("保存中…"):tr("確認保存")}</button></div>
    </form></div>}
  </section>
}
