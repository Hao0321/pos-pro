import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage,getLocale} from '../i18n'
import {ordinaryReturnQuote,ordinaryReturnSources} from '../../electron/ordinarySupplierReturn.mjs'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/expense-entry.css'
import '../styles/purchase-payment.css'
import '../styles/ordinary-supplier-return.css'
export default function OrdinarySupplierReturnComposer({draft}){
 const [error,setError]=useState(''),[handoff,setHandoff]=useState(''),card=useRef(null),latest=useRef(draft);latest.current=draft
 const {target,form,agent}=draft.value,off=draft.busy||draft.workspace.blocked,pending=draft.pending,po=draft.source?.po
 const sources=po?ordinaryReturnSources(po):[],selected=sources.find(s=>s.id===form.invoiceId),money=n=>new Intl.NumberFormat(getLocale(),{style:'currency',currency:'TWD',minimumFractionDigits:2}).format(n)
 let quote=null,quoteError='';if(po)try{quote=ordinaryReturnQuote(draft.source,form.quantities,form.invoiceId)}catch(e){if(form.quantities.some(q=>q!==''))quoteError=e.message}
 const mismatch=quote&&agent.applied&&Math.round(agent.applied.total*100)!==Math.round(quote.amount*100),valid=quote&&!mismatch&&form.reason.trim()
 async function perform(work){setError('');try{return await work()}catch(e){setError(e.message)}}
 useEffect(()=>{setError('');setHandoff('')},[target?.purchaseId,target?.basisDigest])
 useEffect(()=>{
  if(!draft.visible||!target)return;const old=document.activeElement;card.current?.querySelector('h2')?.focus()
  const key=e=>{if(e.key==='Escape'&&!latest.current.busy){e.preventDefault();perform(()=>latest.current.hide())}if(e.key==='Tab'){const controls=[...card.current.querySelectorAll('input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled),summary')].filter(el=>el.getClientRects().length&&!el.closest('fieldset:disabled')),first=controls[0],last=controls.at(-1);if(!first){e.preventDefault();return}if(e.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){e.preventDefault();first.focus()}}};document.addEventListener('keydown',key)
  return()=>{document.removeEventListener('keydown',key);if(old?.isConnected)old.focus()}
 },[draft.visible,!!target])
 async function copy(){await perform(async()=>{const text=await draft.handoff();if(!text)return;setHandoff(text);try{await navigator.clipboard.writeText(text)}catch{setError('請複製下方說明，再交給你使用的 Agent。')}})}
 return <div className="ordinary-supplier-return">
  {draft.message&&<p role="status" className="expense-entry-message" data-ordinary-return-message>{trMessage(draft.message)}</p>}
  {!draft.visible&&<WorkspaceDraftNotice draft={{...draft.workspace,notice:''}}/>}
  {target&&!draft.visible&&createPortal(<div className="purchase-payment-resume purchase-payment-pending"><span>{target.supplierName}</span><button className="btn btn-primary" data-ordinary-return-resume onClick={draft.resume}>{tr(pending?'核對原退貨':'接著填退貨')}</button></div>,document.body)}
  {draft.visible&&target&&createPortal(<div className="purchase-payment-overlay"><section className="expense-entry purchase-payment-card ordinary-return-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="ordinary-return-heading" data-ordinary-return-form data-return-ready={draft.workspace.ready}>
   <header><span>{target.supplierName}</span><h2 id="ordinary-return-heading" tabIndex={-1}>{tr(pending?'核對原退貨':'把這批貨退回')}</h2><p>{tr('填實際退回數量，金額自動算。')}</p></header>
   <WorkspaceDraftNotice draft={{...draft.workspace,notice:draft.workspace.notice?'已接回上次輸入。':''}}/>
   {(error||draft.needsReview)&&<p role="alert" className="expense-entry-error" data-ordinary-return-error>{trMessage(error||'採購或相關庫存已變更，請先核對最新資料。')}</p>}
   {quoteError&&<p role="alert" data-ordinary-return-quote-error>{trMessage(quoteError)}</p>}
   <form onSubmit={e=>{e.preventDefault();perform(draft.save)}}>
    <fieldset disabled={off||pending}>
     <label htmlFor="ordinary-return-source">{tr('退貨來源')}</label><select id="ordinary-return-source" data-ordinary-return-source value={form.invoiceId} onChange={e=>{draft.field('invoiceId',e.target.value);setError('')}}>{sources.filter(s=>s.id===form.invoiceId||s.quantities.some(q=>q>0)).map(s=><option key={s.id} value={s.id} disabled={!s.quantities.some(q=>q>0)}>{s.id?tr('請款單 {0}',{0:s.reference}):tr('還沒請款的貨')}</option>)}</select>
     <button type="button" className="btn btn-ghost expense-entry-save" data-ordinary-return-fill onClick={()=>perform(draft.fillAll)}>{tr('全部可退數量')}</button>
     <div className="ordinary-return-items">{form.quantities.map((qty,i)=><label className="ordinary-return-item" key={i} htmlFor={'ordinary-return-qty-'+i}><strong>{po?.items[i]?.name||tr('品項 {0}',{0:i+1})}</strong><span>{tr('可退 {0} · 現有 {1} {2}',{0:selected?.quantities[i]??'—',1:draft.source?.products.find(p=>p.id===po?.items[i]?.productId)?.stock??'—',2:po?.items[i]?.unit||''})}</span><input id={'ordinary-return-qty-'+i} data-ordinary-return-quantity={i} aria-label={tr('退貨數量 {0} {1}',{0:po?.items[i]?.name||'',1:i+1})} inputMode="decimal" maxLength={32} autoComplete="off" placeholder={tr('不退填 0')} value={qty} onChange={e=>{draft.field('quantities',form.quantities.map((q,n)=>n===i?e.target.value:q));setError('')}}/></label>)}</div>
     <label htmlFor="ordinary-return-reason">{tr('為什麼退貨？')}</label><textarea id="ordinary-return-reason" data-ordinary-return-reason rows={2} maxLength={500} required value={form.reason} onChange={e=>{draft.field('reason',e.target.value);setError('')}}/>
     <details className="expense-entry-details" data-ordinary-return-reasons><summary>{tr('常用退貨原因')}</summary><div className="ordinary-return-reasons">{[['品質不符','商品品質不符'],['數量錯誤','收到數量有誤'],['協議退貨','已和供應商談好']].map(([key,label])=><button type="button" className="btn btn-ghost" data-ordinary-return-quick-reason={key} key={key} onClick={()=>{draft.field('reason',tr(label));setError('')}}>{tr(label)}</button>)}</div></details>
     <p className="ordinary-return-total" data-ordinary-return-total>{tr('本次退貨')} <strong>{quote?money(quote.amount):'—'}</strong></p>
     {agent.applied&&<p data-ordinary-return-source-total>{tr('來源合計：{0}',{0:money(agent.applied.total)})}</p>}
     {mismatch&&<p role="alert">{tr('來源合計與採購計算不同，請核對原單價、數量或稅額。')}</p>}
    </fieldset>
    {pending?<div className="expense-entry-recovery"><p>{tr('先核對原單，請勿再建一張。')}</p><button type="button" className="btn btn-primary" data-ordinary-return-check disabled={off} onClick={()=>perform(draft.check)}>{tr(draft.busy?'正在核對…':'核對原退貨')}</button>{draft.retryAllowed&&<button type="button" className="btn btn-ghost" data-ordinary-return-retry disabled={off} onClick={()=>perform(draft.save)}>{tr('沿用原編號保存退貨')}</button>}<details><summary>{tr('查看原單資訊')}</summary><code>{draft.value.submission.id}</code></details></div>:<div className="purchase-payment-actions"><button className="btn btn-primary expense-entry-save" data-ordinary-return-save disabled={off||!valid||draft.needsReview}>{tr(draft.busy?'正在記帳…':'貨已退回，記好退貨')}</button>{draft.needsReview&&<button type="button" className="btn btn-ghost" data-ordinary-return-refresh disabled={off} onClick={()=>perform(draft.refresh)}>{tr('更新採購與庫存，保留輸入')}</button>}</div>}
   </form>
   <p className="expense-entry-footnote">{tr('庫存與帳款一起更新。收到退款時，再記錄款項。')}</p>
   <fieldset disabled={off||pending}><details className="expense-entry-details" data-ordinary-return-agent><summary>{tr('讓 Agent 幫我填')}</summary><button type="button" className="btn btn-ghost expense-entry-save" data-ordinary-return-handoff onClick={copy}>{tr('複製說明給 Agent')}</button>
    {handoff&&<label>{tr('給 Agent 的說明')}<textarea data-ordinary-return-instructions readOnly rows={3} value={handoff} onFocus={e=>e.target.select()}/></label>}
    <label htmlFor="ordinary-return-agent-text">{tr('貼上 Agent 整理結果')}</label><textarea id="ordinary-return-agent-text" data-ordinary-return-agent-text rows={3} value={agent.raw} onChange={e=>perform(()=>draft.agentRaw(e.target.value))}/><button type="button" className="btn btn-ghost expense-entry-save" data-ordinary-return-apply-agent disabled={!agent.raw} onClick={()=>perform(draft.applyAgent)}>{tr('帶入後核對')}</button>
    {(agent.raw||agent.applied)&&<button type="button" className="btn btn-ghost expense-entry-save" data-ordinary-return-manual onClick={draft.manual}>{tr('改用手動核對')}</button>}
   </details></fieldset>
   <button type="button" className="btn btn-ghost expense-entry-save" data-ordinary-return-hide disabled={draft.busy} onClick={()=>perform(draft.hide)}>{tr('先保留輸入')}</button>
   {!pending&&<details className="expense-entry-details"><summary>{tr('其他操作')}</summary><button className="btn btn-ghost" data-ordinary-return-discard disabled={off} onClick={draft.discard}>{tr('放棄這份未保存輸入')}</button></details>}
  </section></div>,document.body)}
 </div>
}
