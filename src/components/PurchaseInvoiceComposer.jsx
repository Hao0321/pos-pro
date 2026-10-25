import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage,getLocale} from '../i18n'
import {invoiceQuote} from '../../electron/purchaseInvoice.mjs'
import {availableForReturn} from '../../electron/procurementValuation.mjs'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/expense-entry.css'
import '../styles/purchase-payment.css'
import '../styles/purchase-invoice.css'
export default function PurchaseInvoiceComposer({draft}){
 const [error,setError]=useState(''),[handoff,setHandoff]=useState(''),card=useRef(null),latest=useRef(draft);latest.current=draft
 const {target,form,agent}=draft.value,off=draft.busy||draft.workspace.blocked,pending=draft.pending,po=draft.source?.po,money=n=>new Intl.NumberFormat(getLocale(),{style:'currency',currency:'TWD',minimumFractionDigits:2}).format(n)
 let quote=null,quoteError='';if(po)try{quote=invoiceQuote(po,form.quantities)}catch(e){quoteError=e.message}
 const mismatch=quote&&agent.applied&&Math.round(agent.applied.total*100)!==Math.round(quote.amount*100),available=po?availableForReturn(po).quantities:[],valid=quote&&!mismatch&&form.reference.trim()&&form.dueDate
 async function perform(work){setError('');try{return await work()}catch(e){setError(e.message)}}
 useEffect(()=>{setError('');setHandoff('')},[target?.purchaseId,target?.purchaseDigest])
 useEffect(()=>{if(!draft.visible||!target)return;const old=document.activeElement;card.current?.querySelector('h2')?.focus();const key=e=>{if(e.key==='Escape'&&!latest.current.busy){e.preventDefault();perform(()=>latest.current.hide())}if(e.key==='Tab'){const controls=[...card.current.querySelectorAll('input:not(:disabled),textarea:not(:disabled),button:not(:disabled),summary')].filter(row=>row.getClientRects().length);const first=controls[0],last=controls.at(-1);if(!first){e.preventDefault();return}if(e.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){e.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(old?.isConnected)old.focus()}},[draft.visible,!!target])
 async function copy(){await perform(async()=>{const text=await draft.handoff();if(!text)return;setHandoff(text);try{await navigator.clipboard.writeText(text)}catch{setError('請複製下方說明，再交給你使用的 Agent。')}})}
 return <div className="purchase-invoice">
  {draft.message&&<p role="status" className="expense-entry-message" data-purchase-invoice-message>{trMessage(draft.message)}</p>}
  {!draft.visible&&<WorkspaceDraftNotice draft={{...draft.workspace,notice:''}}/>}
  {target&&!draft.visible&&createPortal(<div className="purchase-payment-resume purchase-payment-pending"><span>{target.supplierName}</span><button className="btn btn-primary" data-purchase-invoice-resume onClick={draft.resume}>{tr(pending?'核對原請款':'接著填請款')}</button></div>,document.body)}
  {draft.visible&&target&&createPortal(<div className="purchase-payment-overlay"><section className="expense-entry purchase-payment-card purchase-invoice-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="purchase-invoice-heading" data-purchase-invoice data-invoice-ready={draft.workspace.ready}>
   <header><span>{target.supplierName}</span><h2 id="purchase-invoice-heading" tabIndex={-1}>{tr(pending?'核對原請款':'把這張請款記好')}</h2><p>{tr('已帶入收到的貨，先核對原單。')}</p></header>
   <WorkspaceDraftNotice draft={{...draft.workspace,notice:draft.workspace.notice?'已接回上次輸入。':''}}/>
   {(error||draft.needsReview)&&<p role="alert" className="expense-entry-error" data-purchase-invoice-error>{trMessage(error||'採購或已收未請數量已變更，請先核對最新資料。')}</p>}
   {quoteError&&<p role="alert">{trMessage(quoteError)}</p>}
   <form onSubmit={e=>{e.preventDefault();perform(draft.save)}}>
    <fieldset disabled={off||pending}>
     <label htmlFor="purchase-invoice-reference">{tr('供應商請款單號')}</label><input id="purchase-invoice-reference" data-purchase-invoice-reference required autoComplete="off" maxLength={100} value={form.reference} onChange={e=>{draft.field('reference',e.target.value);setError('')}}/>
     <label htmlFor="purchase-invoice-dueDate">{tr('付款到期日')}</label><input id="purchase-invoice-dueDate" data-purchase-invoice-date type="date" required min={target.date} value={form.dueDate} onChange={e=>{draft.field('dueDate',e.target.value);setError('')}}/>
     <p className="purchase-invoice-total" data-purchase-invoice-total>{tr('本次請款')} <strong>{quote?money(quote.amount):'—'}</strong></p>
     {agent.applied&&<p data-purchase-invoice-source-total>{tr('來源合計：{0}',{0:money(agent.applied.total)})}</p>}
     {mismatch&&<p role="alert">{tr('來源合計與採購計算不同，請核對原單價、數量或稅額。')}</p>}
     <details className="expense-entry-details" data-purchase-invoice-items><summary>{tr('核對品項與數量（{0} 項）',{0:target.itemCount})}</summary>
      {form.quantities.map((qty,i)=><label className="purchase-invoice-item" key={i} htmlFor={'purchase-invoice-qty-'+i}><span>{po?.items[i]?.name||tr('品項 {0}',{0:i+1})} · {po?.items[i]?.unit||''}</span><small>{tr('已收未請：{0}',{0:available[i]??'—'})}</small><input id={'purchase-invoice-qty-'+i} data-purchase-invoice-quantity={i} inputMode="decimal" maxLength={32} autoComplete="off" value={qty} onChange={e=>{draft.field('quantities',form.quantities.map((q,n)=>n===i?e.target.value:q));setError('')}}/></label>)}
     </details>
     <details className="expense-entry-details" data-purchase-invoice-agent><summary>{tr('讓 Agent 幫我填')}</summary><button type="button" className="btn btn-ghost expense-entry-save" data-purchase-invoice-handoff onClick={copy}>{tr('複製說明給 Agent')}</button>
      {handoff&&<label>{tr('給 Agent 的說明')}<textarea data-purchase-invoice-instructions readOnly rows={3} value={handoff} onFocus={e=>e.target.select()}/></label>}
      <label htmlFor="purchase-invoice-agent-text">{tr('貼上 Agent 整理結果')}</label><textarea id="purchase-invoice-agent-text" data-purchase-invoice-agent-text rows={3} value={agent.raw} onChange={e=>perform(()=>draft.agentRaw(e.target.value))}/><button type="button" className="btn btn-ghost expense-entry-save" data-purchase-invoice-apply-agent disabled={!agent.raw} onClick={()=>perform(draft.applyAgent)}>{tr('帶入後核對')}</button>
      {(agent.raw||agent.applied)&&<button type="button" className="btn btn-ghost expense-entry-save" data-purchase-invoice-manual onClick={draft.manual}>{tr('改用手動核對')}</button>}
     </details>
    </fieldset>
    {pending?<div className="expense-entry-recovery"><p>{tr('先核對原單，請勿再建一張。')}</p><button type="button" className="btn btn-primary" data-purchase-invoice-check disabled={off} onClick={()=>perform(draft.check)}>{tr(draft.busy?'正在核對…':'核對原請款')}</button>{draft.retryAllowed&&<button type="button" className="btn btn-ghost" data-purchase-invoice-retry disabled={off} onClick={()=>perform(draft.save)}>{tr('沿用原編號保存請款')}</button>}<details><summary>{tr('查看原單資訊')}</summary><code>{draft.value.submission.id}</code></details></div>:<div className="purchase-payment-actions"><button className="btn btn-primary expense-entry-save" data-purchase-invoice-save disabled={off||!valid||draft.needsReview}>{tr(draft.busy?'正在記帳…':'核對好了，記好請款')}</button>{draft.needsReview&&<button type="button" className="btn btn-ghost" data-purchase-invoice-refresh disabled={off} onClick={()=>perform(draft.refresh)}>{tr('更新採購，保留輸入')}</button>}</div>}
   </form>
   <p className="expense-entry-footnote">{tr('依採購單價核對，不包含額外稅額或價差調整。')}</p>
   <button type="button" className="btn btn-ghost expense-entry-save" data-purchase-invoice-hide disabled={draft.busy} onClick={()=>perform(draft.hide)}>{tr('先保留輸入')}</button>
   {!pending&&<details className="expense-entry-details"><summary>{tr('其他操作')}</summary><button className="btn btn-ghost" data-purchase-invoice-discard disabled={off} onClick={draft.discard}>{tr('放棄這份未保存輸入')}</button></details>}
  </section></div>,document.body)}
 </div>
}
