import {tr,trMessage} from "../../i18n"
import {useEffect,useRef,useState} from 'react'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import {isProcurement,procurementSummary,procurementQuantities,procurementLineCents} from '../../../electron/procurementRules.mjs'
import {localDate} from '../../utils/checkoutSafety.mjs'
import {ps} from './controls.jsx'
import ProcurementReturns from './ProcurementReturns.jsx'
import {availableForReturn,quoteProcurementAllocation} from '../../../electron/procurementValuation.mjs'

const money=value=>'NT$ '+value.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
const fieldStyle={minHeight:44,fontSize:16,width:'100%'}
const actionStyle={minHeight:44}
export function ProcurementPanel({po,onCommand,openShift,readOnly=false,approvalBlocked=false,supplierCredits=[],onSupplierLedger}){
  const [dialog,setDialog]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const saving=useRef(false)
  useEffect(()=>{
    function committed(event){const r=event.detail;if(dialog&&r?.purchase?.id===po.id&&r.receipt?.kind===dialog.kind){saving.current=false;setBusy(false);setDialog(null);setError('')}}
    window.addEventListener('pos-inventory-operation',committed)
    return()=>window.removeEventListener('pos-inventory-operation',committed)
  },[dialog,po.id])
  if(!isProcurement(po))return <p style={{fontSize:12,color:'var(--text-secondary)'}}>{tr("歷史進貨單保留原帳。新增採購使用收貨、請款、分次付款與自動分錄流程。")}</p>
  const summary=procurementSummary(po,undefined,supplierCredits),p=po.procurement,billed=procurementQuantities(po,'bills')
  const billable=availableForReturn(po).quantities
  const open=(kind,extra={})=>{setError('');setDialog({kind,expectedPurchase:canonicalSignature(po),quantities:billable.map(String),reference:'',dueDate:localDate(),method:'bank',amount:'',note:'',reason:'',...extra})}
  const update=(key,value)=>setDialog(d=>({...d,[key]:value}))
  async function submit(event){
    event.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('')
    try{
      const {kind,expectedPurchase}=dialog
      const input={purchaseId:po.id,expectedPurchase}
      if(kind==='purchase-bill')Object.assign(input,{quantities:dialog.quantities.map(Number),reference:dialog.reference,dueDate:dialog.dueDate})
      if(kind==='purchase-pay')Object.assign(input,{invoiceId:dialog.invoiceId,amount:Number(dialog.amount),method:dialog.method,note:dialog.note,...(dialog.method==='cash'?{shiftId:openShift?.id||''}:{})})
      if(kind==='purchase-reverse')Object.assign(input,{paymentId:dialog.paymentId,reason:dialog.reason,...(dialog.method==='cash'?{shiftId:openShift?.id||''}:{})})
      if(kind==='purchase-cancel')input.reason=dialog.reason
      await onCommand(kind,input);setDialog(null)
    }catch(e){setError(e.message)}finally{saving.current=false;setBusy(false)}
  }
  const title=dialog&&({'purchase-bill':'登錄供應商請款','purchase-pay':'記錄供應商付款','purchase-reverse':'沖銷付款','purchase-cancel':'取消採購'}[dialog.kind])
  let billPreview=0
  if(dialog?.kind==='purchase-bill')try{billPreview=p.valuation?quoteProcurementAllocation(po,dialog.quantities.map(Number)):po.items.reduce((n,item,i)=>n+procurementLineCents(Math.round((billed[i]+Number(dialog.quantities[i]))*1000)/1000,item.unitCost)-procurementLineCents(billed[i],item.unitCost),0)/100}catch{billPreview=0}
  return <section className="procurement-flow" aria-label={tr("採購帳務流程")} style={{marginTop:16,paddingBottom:24}}>
    <h3 style={{fontSize:16}}>{tr("採購帳務流程")}</h3>
    {approvalBlocked&&<p role="status">{tr('先完成採購核准，再收貨、請款或付款。')}</p>}
    {summary.prepaid>0&&<div className="card" style={{padding:14}}><p>{tr('已有供應商預付款抵付 {0}，應付餘額已扣除。退貨後的預付部分，先解除原抵付再記錄退回。',{0:money(summary.prepaid)})}</p>{onSupplierLedger&&<button className="btn btn-ghost" onClick={onSupplierLedger}>{tr('查看供應商預付款')}</button>}</div>}
    <p style={{fontSize:16,lineHeight:1.6}}>{readOnly?tr("目前為查看模式，請由老闆確認收貨與帳款。"):p.cancel?tr("這張採購已取消。"):billable.some(q=>q>0)?tr("接著：核對供應商單據，登錄已收到的貨款。"):summary.owed>0?tr("接著：實際付款後，在請款單下方記錄付款。"):summary.credit>0?tr("接著：核對供應商是否已退回款項。"):po.status==='received'?tr("這張採購的收貨與帳款已核對。"):tr("接著：貨到了，再按「確認到貨」。")}</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8,margin:'12px 0'}}>
      {[['已收貨',summary.received],['待請款',summary.unbilled],['已付淨額',summary.paid],['應付餘額',summary.owed],['逾期未付',summary.overdue]].map(([label,value])=><div key={label} className="card" style={{padding:12}}><div style={{fontSize:12}}>{tr(label)}</div><strong>{money(value)}</strong></div>)}
    </div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
      {!readOnly&&!p.cancel&&billable.some(q=>q>0)&&<button className="btn btn-primary" disabled={approvalBlocked} style={actionStyle} onClick={()=>open('purchase-bill')}>{tr("登錄請款")}</button>}
      {!readOnly&&!p.cancel&&!p.receipts.length&&<button className="btn btn-ghost" style={actionStyle} onClick={()=>open('purchase-cancel')}>{tr("取消採購")}</button>}
    </div>
    {p.cancel&&<p role="status">{tr("已取消：")}{p.cancel.reason}</p>}
    {summary.bills.map(b=><div key={b.id} className="card" style={{padding:14,marginBottom:8}}>
      <strong>{tr("請款單 ")}{b.reference}</strong><div style={{fontSize:12,margin:'6px 0'}}>{tr("到期 ")}{b.dueDate}{tr(" · 請款 ")}{money(b.amount)}{tr(" · 未付 ")}{money(Math.max(0,b.balance))}{b.credit>0?tr(" · 供應商待退 {0}", {0: money(b.credit)}):''}{b.overdue?tr(" · 已逾期"):''}</div>
      {!readOnly&&b.balance>0&&<button className="btn btn-primary" disabled={approvalBlocked} style={actionStyle} onClick={()=>open('purchase-pay',{invoiceId:b.id,reference:b.reference,amount:String(b.balance)})}>{tr("記錄付款")}</button>}
    </div>)}
    {p.payments.length>0&&<div style={{margin:'16px 0'}}><h4>{tr("付款與沖銷紀錄")}</h4>{p.payments.map(pay=>{
      const reverse=p.reversals.find(r=>r.paymentId===pay.id),bill=p.bills.find(b=>b.id===pay.invoiceId)
      return <div key={pay.id} className="card" style={{padding:12,marginTop:8}}><div>{pay.date} · {pay.method==='cash'?tr("現金"):tr("銀行")} · {money(pay.amount)}</div><div style={{fontSize:12,overflowWrap:'anywhere'}}>{tr("請款 ")}{bill.reference} · {pay.id}{pay.note?' · '+pay.note:''}</div>
        {reverse?<p style={{fontSize:12}}>{tr("已沖銷 ")}{reverse.date}：{reverse.reason}</p>:!readOnly&&<button className="btn btn-ghost" style={actionStyle} onClick={()=>open('purchase-reverse',{paymentId:pay.id,method:pay.method})}>{tr("沖銷此付款")}</button>}</div>
    })}</div>}
    <details><summary style={{cursor:'pointer',padding:'12px 0'}}>{tr("收貨憑證（")}{p.receipts.length}{tr(" 筆）")}</summary>{p.receipts.map(r=><div key={r.id} style={{fontSize:12,padding:8,overflowWrap:'anywhere'}}>{r.date} · {money(r.amount)} · {r.id}<div>{r.quantities.map((q,i)=>q>0?`${po.items[i].name} ${q} ${po.items[i].unit||'個'}`:'').filter(Boolean).join('、')}</div></div>)}</details>
    <ProcurementReturns po={po} onCommand={onCommand} openShift={openShift} readOnly={readOnly}/>
    <p style={{fontSize:12,color:'var(--text-secondary)'}}>{tr("請款僅可登錄已收貨部分；付款與收貨各自追蹤。付款記錄須與實際付款核對。")}</p>
    {dialog&&<div style={ps.overlay}><form role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} style={ps.modal}>
      <h3 style={{marginBottom:12}}>{tr(title)}</h3>
      {dialog.kind==='purchase-bill'&&<>
        <label>{tr("供應商請款單號")}<input autoFocus aria-label={tr("供應商請款單號")} className="field" style={fieldStyle} required maxLength={100} value={dialog.reference} onChange={e=>update('reference',e.target.value)}/></label>
        <label>{tr("付款到期日")}<input aria-label={tr("付款到期日")} className="field" style={fieldStyle} type="date" required value={dialog.dueDate} onChange={e=>update('dueDate',e.target.value)}/></label>
        {po.items.map((item,i)=><label key={i} style={{display:'block',marginTop:10}}>{item.name}{tr("（已收未請 ")}{billable[i]}）<input aria-label={tr("請款數量 {0} {1}", {0: item.name, 1: i+1})} className="field" style={fieldStyle} type="number" step="0.001" min="0" max={billable[i]} required value={dialog.quantities[i]} onChange={e=>update('quantities',dialog.quantities.map((q,index)=>index===i?e.target.value:q))}/></label>)}
        <p>{tr("本次請款 ")}{money(billPreview)}</p><p style={{fontSize:12}}>{tr("依採購單價核對，不包含額外稅額或價差調整。")}</p>
      </>}
      {dialog.kind==='purchase-pay'&&<>
        <p>{tr("請款單 ")}{dialog.reference}</p>
        <label>{tr("本次付款金額")}<input autoFocus aria-label={tr("本次付款金額")} className="field" style={fieldStyle} type="number" min="0.01" step="0.01" required value={dialog.amount} onChange={e=>update('amount',e.target.value)}/></label>
        <label>{tr("付款方式")}<select aria-label={tr("付款方式")} className="field" style={fieldStyle} value={dialog.method} onChange={e=>update('method',e.target.value)}><option value="bank">{tr("銀行存款")}</option><option value="cash">{tr("本班次現金")}</option></select></label>
        <label>{tr("付款備註")}<input aria-label={tr("付款備註")} className="field" style={fieldStyle} maxLength={500} value={dialog.note} onChange={e=>update('note',e.target.value)}/></label>
        <p style={{fontSize:12}}>{tr("確認實際已付款後保存；此操作只記帳，不會執行銀行轉帳。")}</p>
      </>}
      {['purchase-reverse','purchase-cancel'].includes(dialog.kind)&&<label>{dialog.kind==='purchase-reverse'?tr("沖銷理由"):tr("取消理由")}<textarea autoFocus aria-label={tr("操作理由")} className="field" style={fieldStyle} maxLength={500} required value={dialog.reason} onChange={e=>update('reason',e.target.value)}/></label>}
      {dialog.method==='cash'&&<p style={{fontSize:12}}>{openShift?tr("現金流水會計入目前班次。"):tr("請先開班，才能記錄現金支出或沖銷收入。")}</p>}
      {error&&<p role="alert" style={{color:'var(--red)'}}>{trMessage(error)}</p>}
      <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:16}}><button type="button" className="btn btn-ghost" style={actionStyle} disabled={busy} onClick={()=>{setDialog(null);setError('')}}>{tr("返回")}</button><button className="btn btn-primary" style={actionStyle} disabled={busy||dialog.method==='cash'&&!openShift}>{busy?tr("保存中…"):tr("確認保存")}</button></div>
    </form></div>}
  </section>
}
