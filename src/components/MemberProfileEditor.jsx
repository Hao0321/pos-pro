import {forwardRef,useEffect,useId,useImperativeHandle,useRef,useState} from 'react'
import {tr,trMessage} from '../i18n'
import useMemberProfileDraft from '../hooks/useMemberProfileDraft'
import {memberProfileChanges} from '../utils/memberProfileDraft'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/member-profile.css'

const labels={name:'姓名',phone:'手機號碼',birthday:'生日（選填）',note:'備註'}
export default forwardRef(function MemberProfileEditor({session,store,onSaved},ref){
 const [open,setOpen]=useState(false),[error,setError]=useState(''),panel=useRef(null),trigger=useRef(null),prefix=useId()
 const draft=useMemberProfileDraft({session,onReset:()=>setOpen(false),onSaved:async(member,metadata)=>{await store.reloadFromDB();if(!metadata.isCurrent())return;onSaved(member);setOpen(false);setError('')}})
 const value=draft.value,locked=draft.busy||draft.blocked||draft.pending
 const notice={...draft.workspace,notice:''}
 async function run(work){setError('');try{return await work()}catch(cause){setError(cause.message);return false}}
 useImperativeHandle(ref,()=>({start:row=>run(async()=>{trigger.current=document.activeElement;if(await draft.start(row))setOpen(true)})}))
 useEffect(()=>{if(open)panel.current?.querySelector('input')?.focus({preventScroll:true});else if(trigger.current&&document.contains(trigger.current))trigger.current.focus({preventScroll:true})},[open])
 function close(){run(()=>{draft.close();setOpen(false)})}
 function keyboard(event){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!draft.busy)close()}
  if(event.key!=='Tab')return
  const nodes=[...panel.current.querySelectorAll('button,input,summary')].filter(node=>node.getClientRects().length&&(node.tagName==='SUMMARY'||node.matches(':enabled'))),first=nodes[0],last=nodes.at(-1)
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
 }
 let changed=true
 try{changed=!value||value.action==='create'||Object.keys(memberProfileChanges(value)).length>0}catch{}
 const conflicts=draft.review?.conflicts||[],duplicates=draft.review?.duplicates||[]
 return <section className="member-profile-workspace" data-member-profile-workspace data-member-profile-ready={draft.ready}>
  {!open&&<WorkspaceDraftNotice draft={notice}/>}
  {!open&&draft.resumable&&<button type="button" className="btn btn-primary" data-member-profile-resume disabled={!draft.ready||draft.busy} onClick={()=>run(async()=>{trigger.current=document.activeElement;if(await draft.resume())setOpen(true)})}>{tr(draft.pending?'核對上次會員保存':value?.action==='update'?'接著修改會員':'接著新增會員')}</button>}
  {!open&&error&&<p role="alert">{trMessage(error)}</p>}
  {!open&&draft.message&&<p role="status" data-member-profile-message>{trMessage(draft.message)}</p>}
  {open&&value&&<div className="member-profile-overlay">
   <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={prefix+'-title'} className="member-profile-dialog" data-member-profile-dialog onKeyDown={keyboard}>
    <header><h2 id={prefix+'-title'}>{tr(value.action==='create'?'新增會員':'編輯會員')}</h2><button type="button" className="btn btn-ghost" aria-label={tr('稍後再填')} data-member-profile-close disabled={draft.busy} onClick={close}>×</button></header>
    <p className="member-profile-hint">{tr('先填這兩項就好。')}</p>
    {value.action==='update'&&<p data-member-profile-target>{value.base.name} · {value.base.phone}</p>}
    <WorkspaceDraftNotice draft={notice}/>
    <form onSubmit={event=>{event.preventDefault();run(()=>draft.save())}}>
     <fieldset disabled={locked}>
      {['name','phone'].map(key=><label key={key} htmlFor={prefix+'-'+key}>{tr(labels[key])}<input id={prefix+'-'+key} className="field" data-member-profile-field={key} type={key==='phone'?'tel':'text'} autoComplete="off" maxLength={2000} value={value.form[key]} onChange={event=>draft.field(key,event.target.value)}/></label>)}
      <details open={value.more} data-member-profile-more onToggle={event=>{if(event.currentTarget.open!==value.more)draft.more(event.currentTarget.open)}}><summary>{tr('生日、備註（選填）')}</summary>
       {['birthday','note'].map(key=><label key={key} htmlFor={prefix+'-'+key}>{tr(labels[key])}<input id={prefix+'-'+key} className="field" data-member-profile-field={key} placeholder={key==='birthday'?'YYYY-MM-DD':undefined} inputMode={key==='birthday'?'numeric':undefined} maxLength={2000} value={value.form[key]} onChange={event=>draft.field(key,event.target.value)}/></label>)}
      </details>
     </fieldset>
     {!!conflicts.length&&!draft.pending&&<section data-member-profile-conflicts className="member-profile-review"><h3>{tr('這些資料已被更新')}</h3>{conflicts.map(key=><div key={key} className="member-profile-difference"><strong>{tr(labels[key])}</strong><span>{tr('我的輸入')}：{value.form[key]||'—'}</span><span>{tr('目前資料')}：{draft.review.current[key]||'—'}</span></div>)}<div className="member-profile-actions"><button type="button" className="btn btn-ghost" data-member-profile-use-current disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.resolve('current'))}>{tr('採用最新資料')}</button><button type="button" className="btn btn-primary" data-member-profile-use-mine disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.resolve('mine'))}>{tr('保留我的修改')}</button></div></section>}
     {!!duplicates.length&&!conflicts.length&&!draft.pending&&<section data-member-profile-duplicates className="member-profile-review"><h3>{tr('這支手機已有會員')}</h3>{duplicates.map(row=><div key={row.id} className="member-profile-match"><div><strong>{row.name}</strong><span>{row.phone}</span></div>{value.action==='create'&&<button type="button" className="btn btn-ghost" data-member-profile-existing={row.id} disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.useExisting(row.id))}>{tr('開啟這位會員')}</button>}</div>)}<button type="button" className="btn btn-primary" data-member-profile-shared-phone disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.save(true))}>{tr(value.action==='create'?'仍新增另一位會員':'確認共用手機並保存')}</button></section>}
     {error&&<p role="alert" data-member-profile-error>{trMessage(error)}</p>}
     {draft.message&&<p role="status">{trMessage(draft.message)}</p>}
     {draft.pending?<div className="member-profile-actions" data-member-profile-pending><button type="button" className="btn btn-primary" data-member-profile-check disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.checkOriginal())}>{tr('核對上次會員保存')}</button>{draft.retryAllowed&&<button type="button" className="btn btn-ghost" data-member-profile-retry disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.save())}>{tr('用原編號再保存')}</button>}</div>:<div className="member-profile-actions"><button type="submit" className="btn btn-primary" data-member-profile-save disabled={locked||!value.form.name.trim()||!value.form.phone.trim()||!changed||!!conflicts.length||!!duplicates.length}>{tr(value.action==='create'?'新增會員':'儲存修改')}</button><button type="button" className="btn btn-ghost" data-member-profile-later disabled={draft.busy} onClick={close}>{tr('稍後再填')}</button></div>}
    </form>
    {!draft.pending&&<button type="button" className="btn btn-ghost member-profile-discard" data-member-profile-discard disabled={draft.busy||draft.blocked} onClick={()=>run(()=>{if(draft.discard())setOpen(false)})}>{tr('放棄這份輸入')}</button>}
   </section>
  </div>}
 </section>
})
