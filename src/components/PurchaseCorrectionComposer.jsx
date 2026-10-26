import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage,getLocale} from '../i18n'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/expense-entry.css'
import '../styles/purchase-payment.css'
import '../styles/purchase-correction.css'

const choices={reverse:['金額記錯了','重複記了付款','這筆付款沒有發生'],cancel:['不需要這筆採購了','供應商無法供貨','採購內容要重開']}
export default function PurchaseCorrectionComposer({draft,onShift}){
 const [error,setError]=useState(''),card=useRef(null),latest=useRef(draft);latest.current=draft
 const {target,form}=draft.value,reverse=target?.mode==='reverse',cash=target?.originalMethod==='cash',pending=draft.pending,off=draft.busy||draft.workspace.blocked
 const money=n=>new Intl.NumberFormat(getLocale(),{style:'currency',currency:'TWD',minimumFractionDigits:2}).format(n),valid=!!draft.source?.eligible&&!!form.reason.trim()&&(!cash||!!target?.shift)
 async function perform(work){setError('');try{return await work()}catch(e){setError(e.message)}}
 useEffect(()=>setError(''),[target?.purchaseId,target?.mode,target?.paymentId,target?.purchaseDigest])
 useEffect(()=>{
  if(!draft.visible||!target)return;const previous=document.activeElement;card.current?.querySelector('h2')?.focus()
  const key=e=>{if(e.key==='Escape'&&!latest.current.busy){e.preventDefault();perform(()=>latest.current.hide())}if(e.key==='Tab'){const controls=[...card.current.querySelectorAll('textarea:not(:disabled),button:not(:disabled),summary')].filter(el=>el.getClientRects().length&&!el.closest('fieldset:disabled')),first=controls[0],last=controls.at(-1);if(!first){e.preventDefault();return}if(e.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){e.preventDefault();first.focus()}}};document.addEventListener('keydown',key)
  return()=>{document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus()}
 },[draft.visible,!!target])
 return <div className="purchase-correction">
  {draft.message&&<p role="status" className="expense-entry-message" data-purchase-correction-message>{trMessage(draft.message)}</p>}
  {!draft.visible&&<WorkspaceDraftNotice draft={{...draft.workspace,notice:''}}/>}
  {target&&!draft.visible&&createPortal(<div className="purchase-payment-resume purchase-payment-pending"><span>{target.supplierName}</span><button className="btn btn-primary" data-purchase-correction-resume onClick={draft.resume}>{tr(pending?'核對這次保存結果':reverse?'接著填付款更正':'接著填取消原因')}</button></div>,document.body)}
  {draft.visible&&target&&createPortal(<div className="purchase-payment-overlay"><section className="expense-entry purchase-payment-card purchase-correction-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="purchase-correction-heading" data-purchase-correction-form data-correction-ready={draft.workspace.ready} data-correction-mode={target.mode}>
   <header><span>{target.supplierName}</span><h2 id="purchase-correction-heading" tabIndex={-1}>{tr(pending?'核對這次保存結果':reverse?'更正這筆供應商付款':'取消這張採購')}</h2><p>{tr(reverse?'撤回整筆付款紀錄，原紀錄會保留。':'這張還沒收貨，選原因就能取消。')}</p></header>
   <WorkspaceDraftNotice draft={{...draft.workspace,notice:draft.workspace.notice?'已接回上次輸入。':''}}/>
   <section className="purchase-correction-source" aria-label={tr('本次核對的原單')} data-purchase-correction-source>
    <span>{tr(reverse?'原付款金額':'原採購金額')}</span><strong data-purchase-correction-amount>{money(target.originalAmount)}</strong>
    <p data-purchase-correction-method>{reverse?tr(cash?'原付款方式：現金':'原付款方式：銀行'):tr('品項數：{0}',{0:target.itemCount})}</p>
    <p>{target.date}{target.reference?' · '+target.reference:''}</p>
   </section>
   {(error||draft.needsReview)&&<p role="alert" className="expense-entry-error" data-purchase-correction-error>{trMessage(error||draft.source?.issue||'原單或班次已變更，請先核對最新資料。')}</p>}
   {cash&&<p className="purchase-correction-shift" data-purchase-correction-shift>{target.shift?tr('現金加回這班：{0}',{0:new Date(target.shift.openTime).toLocaleString(getLocale())+' · '+target.shift.cashier}):tr('請先開班，再核對這筆現金更正。')}</p>}
   {cash&&!target.shift&&!pending&&<button className="btn btn-ghost expense-entry-save" data-purchase-correction-open-shift disabled={off} onClick={()=>perform(()=>{draft.hide();onShift?.()})}>{tr('前往開班，原因會保留')}</button>}
   <form onSubmit={e=>{e.preventDefault();perform(draft.save)}}>
    <fieldset disabled={off||pending}>
     <label htmlFor="purchase-correction-reason">{tr(reverse?'為什麼更正這筆付款？':'為什麼取消這張採購？')}</label><textarea id="purchase-correction-reason" data-purchase-correction-reason rows={2} maxLength={500} required value={form.reason} onChange={e=>perform(()=>draft.reason(e.target.value))}/>
     <details className="expense-entry-details" data-purchase-correction-presets><summary>{tr('選一個常用原因')}</summary><div className="purchase-correction-presets">{choices[target.mode].map(choice=><button key={choice} type="button" className="btn btn-ghost" data-purchase-correction-preset={choice} onClick={()=>perform(()=>draft.reason(tr(choice)))}>{tr(choice)}</button>)}</div></details>
    </fieldset>
    {pending?<div className="expense-entry-recovery"><p>{tr('先核對原筆，請勿再建一筆。')}</p><button type="button" className="btn btn-primary" data-purchase-correction-check disabled={off} onClick={()=>perform(draft.check)}>{tr(draft.busy?'正在核對…':'核對這次保存結果')}</button>{draft.retryAllowed&&<button type="button" className="btn btn-ghost" data-purchase-correction-retry disabled={off} onClick={()=>perform(draft.save)}>{tr('沿用原編號繼續保存')}</button>}<details><summary>{tr('查看原單資訊')}</summary><code>{draft.value.submission.id}</code></details></div>:<div className="purchase-payment-actions"><button className="btn btn-primary expense-entry-save" data-purchase-correction-save disabled={off||!valid||draft.needsReview}>{tr(draft.busy?'正在記帳…':reverse?'撤回這筆付款紀錄':'確定取消這張採購')}</button>{draft.needsReview&&<button type="button" className="btn btn-ghost" data-purchase-correction-refresh disabled={off} onClick={()=>perform(draft.refresh)}>{tr('更新原單與班次，保留原因')}</button>}</div>}
   </form>
   <p className="expense-entry-footnote">{tr(reverse?cash?'這筆更正會將原付款現金加回目前班次。':'只更正帳本，不會轉帳。請先核對銀行款項。':'取消後仍保留原單與原因，可隨時核對。')}</p>
   <button type="button" className="btn btn-ghost expense-entry-save" data-purchase-correction-hide disabled={draft.busy} onClick={()=>perform(draft.hide)}>{tr('先保留原因')}</button>
   {!pending&&<details className="expense-entry-details"><summary>{tr('其他操作')}</summary><button className="btn btn-ghost" data-purchase-correction-discard disabled={off} onClick={draft.discard}>{tr('放棄這份未保存原因')}</button></details>}
  </section></div>,document.body)}
 </div>
}
