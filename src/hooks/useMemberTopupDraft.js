import {useRef,useState} from 'react'
import useWorkspaceDraft from './useWorkspaceDraft'
import {loadPrivateDraftContext,loadMembers,loadShifts,loadTopups} from '../utils/dataAccess'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {memberTopupBasis} from '../../electron/memberTopupDraft.mjs'
import {newMemberTopupDraft,validMemberTopupDraft,memberTopupRequest,memberTopupReview,savedMemberTopup} from '../utils/memberTopupDraft'

export default function useMemberTopupDraft({session,onSaved,onReset,saveRequest}){
 const [value,setValue]=useState(null),[review,setReview]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[retryAllowed,setRetryAllowed]=useState(false),latest=useRef(null),gate=useRef(false),completed=useRef(null)
 latest.current={value,session,onSaved,onReset,saveRequest};function put(next){latest.current.value=next;setValue(next)}
 async function inspect(){const[context,members,shifts,topups]=await Promise.all([loadPrivateDraftContext(latest.current.session),loadMembers([]),loadShifts(),loadTopups()]);if(![members,shifts,topups].every(Array.isArray))throw Error('儲值紀錄讀不到，請保留原編號。');return {context,members,shifts,topups}}
 const workspace=useWorkspaceDraft({kind:'member-topup',session,state:value,hasContent:!!value,validate:validMemberTopupDraft,
  onRestore:(saved,metadata)=>{put(saved);setReview(null);setRetryAllowed(false);if(metadata.changed)latest.current.onReset()},
  findOriginal:async(saved,metadata)=>{if(!saved.submission)return null;const facts=await inspect();if(privateDraftDigest(facts.context)!==privateDraftDigest(metadata.context))throw Error('店面或帳號已變更，請保留原輸入核對。');const row=savedMemberTopup(saved,facts.topups);return row?{row,member:facts.members.find(row=>row.id===saved.member.id)||null}:null},
  onOriginal:(found,saved,metadata)=>finish(saved,found,metadata,false)
 })
 function scope(context){workspace.assertScope(context);if(privateDraftDigest(context)!==privateDraftDigest(workspace.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')}
 async function finish(saved,found,metadata=null,clear=true){const context=metadata?.context||workspace.scope?.context,isCurrent=metadata?.isCurrent||(()=>{try{scope(context);return true}catch{return false}});if(!isCurrent())return false;await latest.current.onSaved(memberTopupRequest(saved,context),found.member,{isCurrent});if(!isCurrent())return false;completed.current=saved.submission.id;if(clear)workspace.complete();put(null);setReview(null);setRetryAllowed(false);setMessage('已確認原儲值，請勿再次收款。');return true}
 async function task(work){if(gate.current)return false;gate.current=true;setBusy(true);try{return await work()}finally{gate.current=false;setBusy(false)}}
 async function start(member){return task(async()=>{if(workspace.blocked)throw Error('請先等草稿核對完成');if(latest.current.value){if(latest.current.value.member.id!==member.id){setMessage('還有另一位會員的未完成儲值，請先接回核對。');return false}return resumeInner()}const facts=await inspect();scope(facts.context);const row=facts.members.find(row=>row.id===member.id);if(!row)throw Error('找不到原會員，請保留這筆儲值核對。');workspace.begin();const next=newMemberTopupDraft(row,facts.shifts.find(row=>row.status==='open')?.id||'');put(next);setReview(memberTopupReview(next,facts));setMessage('');return true})}
 async function resumeInner(){if(workspace.blocked||!latest.current.value)return false;const facts=await inspect();scope(facts.context);const saved=latest.current.value,row=savedMemberTopup(saved,facts.topups);if(row)return finish(saved,{row,member:facts.members.find(row=>row.id===saved.member.id)||null});setReview(memberTopupReview(saved,facts));setMessage('');return true}
 const resume=()=>task(resumeInner)
 function field(key,text){if(gate.current||workspace.blocked||latest.current.value?.submission)return;put({...latest.current.value,[key]:text});setMessage('')}
 async function save(){return task(async()=>{
  if(workspace.blocked||!latest.current.value)throw Error('請先等草稿核對完成');const saved=latest.current.value,facts=await inspect();scope(facts.context);const original=savedMemberTopup(saved,facts.topups);if(original)return finish(saved,{row:original,member:facts.members.find(row=>row.id===saved.member.id)||null})
  const checked=memberTopupReview(saved,facts);setReview(checked);if(!saved.submission&&(checked.memberChanged||checked.shiftChanged))return false;if(saved.submission&&!retryAllowed)throw Error('請先核對原儲值。')
  const candidate={...saved,submission:saved.submission||{id:'member-topup-'+crypto.randomUUID(),time:new Date().toISOString(),cashier:latest.current.session.username||''}},request=memberTopupRequest(candidate,facts.context)
  if(!saved.submission){workspace.persist();completed.current=null;await workspace.adopt(candidate);if(completed.current===candidate.submission.id)return true;scope(facts.context);put(candidate)}setRetryAllowed(false)
  try{await latest.current.saveRequest(request);scope(facts.context);const after=await inspect();scope(after.context);const row=savedMemberTopup(candidate,after.topups);if(!row)throw Error('儲值紀錄讀不到，請保留原編號。');return finish(candidate,{row,member:after.members.find(row=>row.id===candidate.member.id)||null})}
  catch(error){if(error.notCommitted){scope(facts.context);const next={...candidate,submission:null};await workspace.adopt(next);put(next);setReview(memberTopupReview(next,await inspect()))}throw error}
 })}
 async function checkOriginal(){return task(async()=>{const saved=latest.current.value;if(!saved?.submission)throw Error('請先核對原儲值。');const facts=await inspect();scope(facts.context);const row=savedMemberTopup(saved,facts.topups);if(row)return finish(saved,{row,member:facts.members.find(row=>row.id===saved.member.id)||null});setRetryAllowed(true);setMessage('尚未找到原儲值，請用原編號再核對，勿再次收款。');return false})}
 async function rebind(kind){return task(async()=>{const saved=latest.current.value;if(workspace.blocked||!saved||saved.submission)return false;const facts=await inspect();scope(facts.context);const checked=memberTopupReview(saved,facts);if(kind==='member'&&!checked.current)throw Error('找不到原會員，請保留這筆儲值核對。');if(kind==='shift'&&!checked.shift)throw Error('請先開班再收取儲值款項');const next={...saved,...(kind==='member'?{member:memberTopupBasis(checked.current)}:{shiftId:checked.shift.id})};await workspace.adopt(next);put(next);setReview(memberTopupReview(next,facts));setMessage('已接回原輸入，確認收到款項後再儲值。');return true})}
 function close(){workspace.persist()}
 function discard(){if(busy||workspace.blocked||latest.current.value?.submission)return false;workspace.complete();put(null);setReview(null);setMessage('已放棄這份未保存輸入。');return true}
 return {value,review,message,workspace,busy,retryAllowed,pending:!!value?.submission,ready:workspace.ready,blocked:workspace.blocked,start,resume,field,save,checkOriginal,rebind,close,discard}
}
