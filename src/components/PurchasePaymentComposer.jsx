import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage,getLocale} from '../i18n'
import {expenseMoney} from '../../electron/expenseEntry.mjs'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/expense-entry.css'
import '../styles/purchase-payment.css'
export default function PurchasePaymentComposer({draft,onShift}){
 const [error,setError]=useState(''),card=useRef(null),latest=useRef(draft);latest.current=draft
 const {target,form}=draft.value,off=draft.busy||draft.workspace.blocked,pending=draft.pending,money=n=>new Intl.NumberFormat(getLocale(),{style:'currency',currency:'TWD',minimumFractionDigits:2}).format(n)
 let amount=null;try{amount=expenseMoney(form.amount)}catch{}const valid=amount!==null&&target&&Math.round(amount*100)<=Math.round(target.balance*100)
 useEffect(()=>{if(!draft.visible||!target)return;const old=document.activeElement;card.current?.querySelector('h2')?.focus();const key=e=>{if(e.key==='Escape'&&!latest.current.busy){e.preventDefault();perform(()=>latest.current.hide())}if(e.key==='Tab'){const controls=[...card.current.querySelectorAll('input:not(:disabled),select:not(:disabled),button:not(:disabled),summary')].filter(row=>row.getClientRects().length);if(!controls.length){e.preventDefault();return}const first=controls[0],last=controls.at(-1);if(e.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){e.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(old?.isConnected)old.focus()}},[draft.visible,!!target])
 async function perform(work){setError('');try{await work()}catch(e){setError(e.message)}}
 return <div className="purchase-payment">
  {draft.message&&<p role="status" className="expense-entry-message" data-purchase-payment-message>{tr(draft.message)}</p>}
  {!draft.visible&&<WorkspaceDraftNotice draft={{...draft.workspace,notice:''}}/>}
  {target&&!draft.visible&&(pending?createPortal(<div className="purchase-payment-resume purchase-payment-pending"><span>{target.supplierName} · {target.reference}</span><button className="btn btn-primary" data-purchase-payment-resume onClick={draft.resume}>{tr('核對原付款')}</button></div>,document.body):<div className="purchase-payment-resume"><span>{target.supplierName} · {target.reference}</span><button className="btn btn-primary" data-purchase-payment-resume onClick={draft.resume}>{tr('接著記付款')}</button></div>)}
  {draft.visible&&target&&createPortal(<div className="purchase-payment-overlay"><section className="expense-entry purchase-payment-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="purchase-payment-heading" data-purchase-payment data-payment-ready={draft.workspace.ready}>
   <header><span>{target.supplierName} · {target.reference}</span><h2 id="purchase-payment-heading" tabIndex={-1}>{tr(pending?'核對原付款':'這次付多少？')}</h2><p>{tr('這張單還沒付：{0}',{0:money(target.balance)})}</p></header>
   <WorkspaceDraftNotice draft={{...draft.workspace,notice:draft.workspace.notice?'已接回上次輸入。':''}}/>
   {(error||draft.needsReview)&&<p role="alert" className="expense-entry-error" data-purchase-payment-error>{trMessage(error||'帳款或班次已變更，請先核對最新資料。')}</p>}
   {draft.message&&<p role="status">{tr(draft.message)}</p>}
   <form onSubmit={e=>{e.preventDefault();perform(draft.save)}}>
    <fieldset disabled={off||pending}>
     <label htmlFor="purchase-payment-amount">{tr('本次付款金額')}</label><div className="expense-entry-amount"><span>NT$</span><input id="purchase-payment-amount" data-purchase-payment-amount inputMode="decimal" autoComplete="off" maxLength={100} placeholder="0.00" value={form.amount} onChange={e=>{draft.field('amount',e.target.value);setError('')}}/></div>
     <label htmlFor="purchase-payment-method">{tr('這筆錢怎麼付？')}</label><select id="purchase-payment-method" data-purchase-payment-method value={form.method} onChange={e=>{draft.field('method',e.target.value);setError('')}}><option value="bank">{tr('銀行存款')}</option><option value="cash">{tr('本班次現金')}</option></select>
     <details className="expense-entry-details" data-purchase-payment-options><summary>{tr('付款備註（選填）')}</summary><label htmlFor="purchase-payment-note">{tr('付款備註')}</label><textarea id="purchase-payment-note" data-purchase-payment-note rows={2} maxLength={500} value={form.note} onChange={e=>{draft.field('note',e.target.value);setError('')}}/></details>
    </fieldset>
    {amount!==null&&amount>target.balance&&<p role="alert">{tr('付款超過此請款單未付餘額')}</p>}
    {form.amount&&amount===null&&<p role="status">{tr('請填正確金額，最多到小數點後兩位。')}</p>}
    {form.method==='cash'&&<p className="purchase-payment-shift">{target.shift?tr('現金記入 {0} 的班次',{0:new Intl.DateTimeFormat(getLocale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(target.shift.openTime))}):tr('請先開班，才能記錄本班次現金付款。')}</p>}
    {pending?<div className="expense-entry-recovery"><p>{tr('先核對原筆，請勿再次付款。')}</p><button type="button" className="btn btn-primary" data-purchase-payment-check disabled={off} onClick={()=>perform(draft.check)}>{tr(draft.busy?'正在核對…':'核對原付款')}</button>{draft.retryAllowed&&<button type="button" className="btn btn-ghost" data-purchase-payment-retry disabled={off} onClick={()=>perform(draft.save)}>{tr('沿用原編號保存付款')}</button>}<details><summary>{tr('查看原單資訊')}</summary><code>{draft.value.submission.id}</code></details></div>:<div className="purchase-payment-actions">
     <button className="btn btn-primary expense-entry-save" data-purchase-payment-save disabled={off||!valid||draft.needsReview||form.method==='cash'&&!target.shift}>{tr(draft.busy?'正在記帳…':'已付款，記好這筆')}</button>
     {(draft.needsReview||form.method==='cash'&&!target.shift)&&<button type="button" className="btn btn-ghost" data-purchase-payment-refresh disabled={off} onClick={()=>perform(draft.refresh)}>{tr('更新餘額與班次，保留輸入')}</button>}
     {form.method==='cash'&&!target.shift&&<button type="button" className="btn btn-ghost" disabled={off} onClick={onShift}>{tr('前往開班')}</button>}
    </div>}
   </form>
   <p className="expense-entry-footnote">{tr('只記錄已付的款項，不會替你轉帳。')}</p>
   <button type="button" className="btn btn-ghost expense-entry-save" data-purchase-payment-hide disabled={draft.busy} onClick={()=>perform(draft.hide)}>{tr('先保留輸入')}</button>
   {!pending&&<details className="expense-entry-details"><summary>{tr('其他操作')}</summary><button className="btn btn-ghost" data-purchase-payment-discard disabled={off} onClick={draft.discard}>{tr('放棄這份未保存輸入')}</button></details>}
  </section></div>,document.body)}
 </div>
}
