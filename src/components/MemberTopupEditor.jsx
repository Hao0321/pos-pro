import {forwardRef,useEffect,useId,useImperativeHandle,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage,getLocale} from '../i18n'
import useMemberTopupDraft from '../hooks/useMemberTopupDraft'
import {memberTopupMoney,memberTopupTotals} from '../../electron/memberTopupDraft.mjs'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/member-topup.css'
export default forwardRef(function MemberTopupEditor({session,store,onSaved},ref){
 const [open,setOpen]=useState(false),[guard,setGuard]=useState(false),[error,setError]=useState(''),panel=useRef(null),trigger=useRef(null),prefix=useId()
 const draft=useMemberTopupDraft({session,onReset:()=>setOpen(false),saveRequest:request=>store.saveMemberTopupDraft(request),onSaved:async(request,member,metadata)=>{await store.confirmMemberTopupDraft(request);if(!metadata.isCurrent())return;await store.reloadFromDB();if(!metadata.isCurrent())return;onSaved(member);setOpen(false);setGuard(false);setError('')}})
 const value=draft.value,locked=draft.busy||draft.blocked||draft.pending,notice={...draft.workspace,notice:''},money=value=>new Intl.NumberFormat(getLocale(),{style:'currency',currency:'TWD',maximumFractionDigits:2}).format(value)
 async function run(work){setError('');try{return await work()}catch(cause){setError(cause.message);return false}}
 useImperativeHandle(ref,()=>({start:row=>run(async()=>{trigger.current=document.activeElement;const ready=await draft.start(row);setGuard(!ready);setOpen(true)})}))
 useEffect(()=>{if(open)panel.current?.querySelector('input:enabled,button:enabled')?.focus({preventScroll:true});else if(trigger.current&&document.contains(trigger.current))trigger.current.focus({preventScroll:true})},[open,guard])
 function close(){run(()=>{draft.close();setOpen(false);setGuard(false)})}
 function keyboard(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!draft.busy)close()}if(event.key==='Tab'){const nodes=[...panel.current.querySelectorAll('button,input,summary')].filter(node=>node.getClientRects().length&&(node.tagName==='SUMMARY'||node.matches(':enabled'))),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}}
 const member=draft.review?.current||store.members.find(row=>row.id===value?.member.id);let totals=null
 try{if(value)totals=memberTopupTotals(member?.balance||0,memberTopupMoney(value.amount),memberTopupMoney(value.bonus,{optional:true}))}catch{}
 const review=draft.review,needsReview=!!review&&(review.memberChanged||review.shiftChanged)
 return <section className="member-topup-workspace" data-member-topup-ready={draft.ready}>
  {!open&&<WorkspaceDraftNotice draft={notice}/>}
  {!open&&value&&<button type="button" className="btn btn-primary" data-member-topup-resume disabled={!draft.ready||draft.busy} onClick={()=>run(async()=>{trigger.current=document.activeElement;if(await draft.resume()){setGuard(false);setOpen(true)}})}>{tr(draft.pending?'核對原儲值':'接著完成儲值')}</button>}
  {!open&&error&&<p role="alert">{trMessage(error)}</p>}
  {!open&&draft.message&&<p role="status">{trMessage(draft.message)}</p>}
  {open&&value&&createPortal(<div className="member-topup-overlay"><section ref={panel} className="member-topup-dialog" role="dialog" aria-modal="true" aria-labelledby={prefix+'-title'} data-member-topup-dialog onKeyDown={keyboard}>
   <header><h2 id={prefix+'-title'}>{tr('會員儲值')}</h2><button type="button" className="btn btn-ghost" data-member-topup-close aria-label={tr('稍後再填')} disabled={draft.busy} onClick={close}>×</button></header>
   <div className="member-topup-target" data-member-topup-target><strong>{value.member.name}</strong><span>{value.member.phone}</span></div>
   <WorkspaceDraftNotice draft={notice}/>
   {guard?<section data-member-topup-guard><p>{tr('還有另一位會員的未完成儲值，請先接回核對。')}</p><button type="button" className="btn btn-primary" data-member-topup-guard-resume disabled={draft.busy||draft.blocked} onClick={()=>run(async()=>{if(await draft.resume())setGuard(false)})}>{tr('接回這位會員的儲值')}</button></section>:<>
    <p className="member-topup-hint">{tr('填入這次實際收到的金額。')}</p>
    <form onSubmit={event=>{event.preventDefault();run(()=>draft.save())}}>
     <fieldset disabled={locked}><label htmlFor={prefix+'-amount'}>{tr('實收金額')}<input className="field" id={prefix+'-amount'} data-member-topup-amount inputMode="decimal" autoComplete="off" maxLength={2000} value={value.amount} onChange={event=>draft.field('amount',event.target.value)}/></label>
      <div className="member-topup-methods" role="group" aria-label={tr('付款方式')}>{[['cash','現金'],['card','電子']].map(([key,label])=><button type="button" key={key} className={'btn '+(value.payMethod===key?'btn-primary':'btn-ghost')} aria-pressed={value.payMethod===key} data-member-topup-method={key} onClick={()=>draft.field('payMethod',key)}>{tr(label)}</button>)}</div>
      {session.role==='owner'&&<details open={value.more} onToggle={event=>{if(event.currentTarget.open!==value.more)draft.field('more',event.currentTarget.open)}} data-member-topup-more><summary>{tr('加贈金額（選填）')}</summary><label htmlFor={prefix+'-bonus'}>{tr('贈送金額（選填）')}<input className="field" id={prefix+'-bonus'} data-member-topup-bonus inputMode="decimal" autoComplete="off" maxLength={2000} value={value.bonus} onChange={event=>draft.field('bonus',event.target.value)}/></label></details>}
     </fieldset>
     {totals&&<dl className="member-topup-totals" data-member-topup-totals><div><dt>{tr('實收金額')}</dt><dd>{money(totals.received)}</dd></div>{totals.gift>0&&<div><dt>{tr('贈送金額')}</dt><dd>{money(totals.gift)}</dd></div>}<div><dt>{tr('儲值後可用')}</dt><dd>{money(totals.balance)}</dd></div></dl>}
     {!draft.pending&&review?.memberChanged&&<section className="member-topup-review" data-member-topup-member-changed><p>{tr('會員資料已更新，請先核對這筆儲值的會員。')}</p>{review.current&&<><p>{review.current.name} · {review.current.phone}</p><button type="button" className="btn btn-ghost" data-member-topup-rebind-member disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.rebind('member'))}>{tr('確認是這位會員')}</button></>}</section>}
     {!draft.pending&&review?.shiftChanged&&<section className="member-topup-review" data-member-topup-shift-changed><p>{tr('原班次已結束，請先核對這筆儲值的班次。')}</p><button type="button" className="btn btn-ghost" data-member-topup-rebind-shift disabled={draft.busy||draft.blocked} onClick={()=>run(async()=>{if(review.shift)await draft.rebind('shift');else{draft.close();setOpen(false);store.setView('shifts')}})}>{tr(review.shift?'改用目前班次':'前往開班')}</button></section>}
     {error&&<p role="alert" data-member-topup-error>{trMessage(error)}</p>}{draft.message&&<p role="status">{trMessage(draft.message)}</p>}
     <div className="member-topup-actions">{draft.pending?<><button type="button" className="btn btn-primary" data-member-topup-check disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.checkOriginal())}>{tr('核對原儲值')}</button>{draft.retryAllowed&&<button type="button" className="btn btn-ghost" data-member-topup-retry disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.save())}>{tr('用原編號再核對')}</button>}</>:<><button type="submit" className="btn btn-primary" data-member-topup-save disabled={locked||!totals||needsReview}>{tr('確認儲值')}</button><button type="button" className="btn btn-ghost" data-member-topup-later disabled={draft.busy} onClick={close}>{tr('稍後再填')}</button></>}</div>
    </form>
    {!draft.pending&&<button type="button" className="btn btn-ghost member-topup-discard" data-member-topup-discard disabled={draft.busy||draft.blocked} onClick={()=>run(()=>{if(draft.discard())setOpen(false)})}>{tr('放棄這份輸入')}</button>}
   </>}
  </section></div>,document.body)}
 </section>
})
