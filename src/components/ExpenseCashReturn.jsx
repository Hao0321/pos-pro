import {useEffect,useRef,useState} from 'react'
import {tr,trMessage,getLocale} from '../i18n'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/expense-entry.css'
export default function ExpenseCashReturn({draft,onShift}){
 const [error,setError]=useState(''),saved=draft.value,off=draft.busy||draft.workspace.blocked,card=useRef(null),latest=useRef(draft);latest.current=draft
 useEffect(()=>{if(!saved.expense)return;const previous=document.activeElement;card.current?.querySelector('h2')?.focus();const key=e=>{if(e.key==='Escape'&&!latest.current.pending){e.preventDefault();latest.current.close()}if(e.key==='Tab'){const controls=[...card.current.querySelectorAll('button:not(:disabled),summary')].filter(node=>node.getClientRects().length);if(!controls.length){e.preventDefault();return}const first=controls[0],last=controls.at(-1);if(e.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){e.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus()}},[!!saved.expense])
 async function perform(work){setError('');try{await work()}catch(e){setError(e.message)}}
 return <div className="expense-cash-return">
  {draft.message&&<p className="expense-entry-message" role="status" data-expense-return-message>{tr(draft.message)}</p>}
  {draft.drawerError&&<p role="alert">{trMessage(draft.drawerError)}</p>}
  <WorkspaceDraftNotice draft={{...draft.workspace,notice:draft.workspace.notice&&saved.expense?'已接回上次輸入。':''}}/>
  {saved.expense&&<section className="expense-return-dialog" role="dialog" aria-modal="true" aria-label={tr('退回抽屜支出')} data-expense-return>
   <div className="expense-return-card" ref={card}><h2 tabIndex={-1}>{tr('現金真的退回了嗎？')}</h2><p className="expense-return-purpose">{saved.expense.description}</p><strong>{new Intl.NumberFormat(getLocale(),{style:'currency',currency:'TWD',minimumFractionDigits:2}).format(saved.expense.amount)}</strong>
    <p>{tr('原支出保留，退回金額會自動沖回費用。')}</p>
    {saved.drawer?<dl><dt>{tr('退回日期')}</dt><dd>{saved.submission?.date||saved.date}</dd><dt>{tr('收進目前班次')}</dt><dd data-expense-return-shift data-shift-id={saved.drawer.id}>{new Intl.DateTimeFormat(getLocale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(saved.drawer.openTime))}<br/>{saved.drawer.cashier}</dd></dl>:<p>{tr('請先開班，再記錄退回抽屜。')}</p>}
    {error&&<p className="expense-entry-error" role="alert" data-expense-return-error>{trMessage(error)}</p>}
    {draft.pending?<div className="expense-entry-recovery"><p>{tr('先核對剛才那筆退回，請勿重複退回。')}</p><button className="btn btn-primary" data-expense-return-check disabled={off} onClick={()=>perform(draft.check)}>{tr(draft.busy?'正在核對…':'核對原退回紀錄')}</button>{draft.retryAllowed&&<button className="btn btn-ghost" data-expense-return-retry disabled={off} onClick={()=>perform(draft.save)}>{tr('沿用原編號記錄退回')}</button>}<details><summary>{tr('查看原單資訊')}</summary><code>{saved.submission.id}</code></details></div>:<div className="expense-return-actions"><button className="btn btn-primary" data-expense-return-confirm disabled={off} onClick={()=>perform(draft.save)}>{tr(saved.drawer?'現金已退回，記好退回':'核對目前班次')}</button>{!saved.drawer&&<button className="btn btn-ghost" disabled={off} onClick={onShift}>{tr('前往開班')}</button>}<button className="btn btn-ghost" data-expense-return-close disabled={off} onClick={()=>{draft.close();setError('')}}>{tr('還沒退回，先保留')}</button></div>}
   </div>
  </section>}
 </div>
}
