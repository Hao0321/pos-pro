import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage,getLocale} from '../i18n'
import {expenseMoney} from '../../electron/expenseEntry.mjs'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/expense-entry.css'
import '../styles/purchase-payment.css'
import '../styles/supplier-refund.css'
export default function SupplierRefundComposer({draft,onShift}){
 const [error,setError]=useState(''),card=useRef(null),latest=useRef(draft);latest.current=draft
 const {target,form}=draft.value,off=draft.busy||draft.workspace.blocked,pending=draft.pending,correct=target?.mode==='correct',cash=form.method==='cash',money=n=>new Intl.NumberFormat(getLocale(),{style:'currency',currency:'TWD',minimumFractionDigits:2}).format(n)
 let amount=null;try{amount=expenseMoney(form.amount)}catch{}const valid=!!draft.source&&(correct?form.reason.trim()&&!draft.source.corrected:amount!==null&&target&&Math.round(amount*100)<=Math.round(target.credit*100))
 async function perform(work){setError('');try{return await work()}catch(e){setError(e.message)}}
 useEffect(()=>setError(''),[target?.purchaseId,target?.mode,target?.refundId])
 useEffect(()=>{if(!draft.visible||!target)return;const old=document.activeElement;card.current?.querySelector('h2')?.focus();const key=e=>{if(e.key==='Escape'&&!latest.current.busy){e.preventDefault();perform(()=>latest.current.hide())}if(e.key==='Tab'){const controls=[...card.current.querySelectorAll('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),summary')].filter(row=>row.getClientRects().length),first=controls[0],last=controls.at(-1);if(!first){e.preventDefault();return}if(e.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){e.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(old?.isConnected)old.focus()}},[draft.visible,!!target])
 const resume=target&&!draft.visible&&<div className={'purchase-payment-resume'+(pending?' purchase-payment-pending':'')}><span>{target.supplierName} · {target.reference}</span><button className="btn btn-primary" data-supplier-refund-resume onClick={draft.resume}>{tr(pending?'核對原退款':correct?'接著填退款更正':'接著記收到退款')}</button></div>
 return <div className="supplier-refund">
  {draft.message&&<p role="status" className="expense-entry-message" data-supplier-refund-message>{trMessage(draft.message)}</p>}
  {!draft.visible&&<WorkspaceDraftNotice draft={{...draft.workspace,notice:''}}/>}{pending&&resume?createPortal(resume,document.body):resume}
  {draft.visible&&target&&createPortal(<div className="purchase-payment-overlay"><section className="expense-entry purchase-payment-card supplier-refund-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="supplier-refund-heading" data-supplier-refund-form data-refund-ready={draft.workspace.ready}>
   <header><span>{target.supplierName} · {target.reference}</span><h2 id="supplier-refund-heading" tabIndex={-1}>{tr(pending?'核對原退款':correct?'更正這筆退款':'這次收到多少？')}</h2><p data-supplier-refund-source>{tr(correct?'原退款：{0}':'這張單還待退：{0}',{0:money(correct?target.originalAmount:target.credit)})}</p></header>
   <WorkspaceDraftNotice draft={{...draft.workspace,notice:draft.workspace.notice?'已接回上次輸入。':''}}/>
   {(error||draft.needsReview)&&<p role="alert" className="expense-entry-error" data-supplier-refund-error>{trMessage(error||'帳款或班次已變更，請先核對最新資料。')}</p>}
   <form onSubmit={e=>{e.preventDefault();perform(draft.save)}}>
    <fieldset disabled={off||pending}>
     {correct?<><p>{tr('原收款方式：{0}',{0:tr(cash?'本班次現金':'銀行存款')})}</p><label htmlFor="supplier-refund-reason">{tr('更正原因')}</label><div className="supplier-refund-reasons">{['金額填錯','方式選錯','重複記錄'].map(reason=><button type="button" className="btn btn-ghost" data-supplier-refund-quick-reason={reason} key={reason} onClick={()=>{draft.field('reason',tr(reason));setError('')}}>{tr(reason)}</button>)}</div><textarea id="supplier-refund-reason" data-supplier-refund-reason rows={2} required maxLength={500} value={form.reason} onChange={e=>{draft.field('reason',e.target.value);setError('')}}/></>:<><label htmlFor="supplier-refund-amount">{tr('收到的退款金額')}</label><div className="expense-entry-amount"><span>NT$</span><input id="supplier-refund-amount" data-supplier-refund-amount inputMode="decimal" autoComplete="off" maxLength={100} value={form.amount} onChange={e=>{draft.field('amount',e.target.value);setError('')}}/></div><label htmlFor="supplier-refund-method">{tr('收到哪裡？')}</label><select id="supplier-refund-method" data-supplier-refund-method value={form.method} onChange={e=>{draft.field('method',e.target.value);setError('')}}><option value="bank">{tr('銀行存款')}</option><option value="cash">{tr('本班次現金')}</option></select><details className="expense-entry-details" data-supplier-refund-options><summary>{tr('退款備註（選填）')}</summary><label htmlFor="supplier-refund-note">{tr('供應商退款備註')}</label><textarea id="supplier-refund-note" data-supplier-refund-note rows={2} maxLength={500} value={form.note} onChange={e=>{draft.field('note',e.target.value);setError('')}}/></details></>}
    </fieldset>
    {!correct&&form.amount&&amount===null&&<p role="status">{tr('請填正確金額，最多到小數點後兩位。')}</p>}
    {!correct&&amount!==null&&amount>target.credit&&<p role="alert">{tr('退款超過供應商尚待退回的金額')}</p>}
    {cash&&<p className="purchase-payment-shift">{target.shift?<>{tr('本次班次：{0}',{0:new Intl.DateTimeFormat(getLocale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(target.shift.openTime))})}<br/>{tr(correct?'本次更正會減少目前核對班次的現金。':'收到的現金會記入目前核對班次。')}</>:tr('請先開班，才能記錄這筆退款現金異動。')}</p>}
    {pending?<div className="expense-entry-recovery"><p>{tr('先核對原筆，請勿重複記錄退款或更正。')}</p><button type="button" className="btn btn-primary" data-supplier-refund-check disabled={off} onClick={()=>perform(draft.check)}>{tr(draft.busy?'正在核對…':'核對原退款')}</button>{draft.retryAllowed&&<button type="button" className="btn btn-ghost" data-supplier-refund-retry disabled={off} onClick={()=>perform(draft.save)}>{tr('沿用原編號保存退款紀錄')}</button>}<details><summary>{tr('查看原單資訊')}</summary><code>{draft.value.submission.id}</code></details></div>:<div className="purchase-payment-actions"><button className="btn btn-primary expense-entry-save" data-supplier-refund-save disabled={off||!valid||draft.needsReview||cash&&!target.shift}>{tr(draft.busy?'正在記帳…':correct?'原因確認，記好更正':'已收到，記好退款')}</button>{(draft.needsReview||cash&&!target.shift)&&<button type="button" className="btn btn-ghost" data-supplier-refund-refresh disabled={off} onClick={()=>perform(draft.refresh)}>{tr('更新帳款與班次，保留輸入')}</button>}{cash&&!target.shift&&<button type="button" className="btn btn-ghost" disabled={off} onClick={onShift}>{tr('前往開班')}</button>}</div>}
   </form>
   <p className="expense-entry-footnote">{tr(correct?'保留原退款，另外記錄更正原因。':'核對實際收到的款項，再記錄。')}</p>
   <button type="button" className="btn btn-ghost expense-entry-save" data-supplier-refund-hide disabled={draft.busy} onClick={()=>perform(draft.hide)}>{tr('先保留輸入')}</button>
   {!pending&&<details className="expense-entry-details"><summary>{tr('其他操作')}</summary><button className="btn btn-ghost" data-supplier-refund-discard disabled={off} onClick={draft.discard}>{tr('放棄這份未保存輸入')}</button></details>}
  </section></div>,document.body)}
 </div>
}
