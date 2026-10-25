import {useRef,useState} from 'react'
import useWorkspaceDraft from './useWorkspaceDraft'
import {loadPrivateDraftContext,loadMembers,lookupPrivateDraftOriginal,saveMemberProfile} from '../utils/dataAccess'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {memberProfileRequest,memberProfileValues} from '../../electron/memberProfile.mjs'
import {newMemberProfileDraft,validMemberProfileDraft,hasMemberProfileInput,memberProfileChanges,memberProfileInput,memberProfileReview,rebaseMemberProfile} from '../utils/memberProfileDraft'

export default function useMemberProfileDraft({session,onSaved,onReset}){
 const [value,setValue]=useState(null),[review,setReview]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[retryAllowed,setRetryAllowed]=useState(false),latest=useRef(null),gate=useRef(false),completed=useRef(null)
 latest.current={value,session,onSaved,onReset}
 function put(next){latest.current.value=next;setValue(next)}
 async function inspect(){const[context,rows]=await Promise.all([loadPrivateDraftContext(latest.current.session),loadMembers([])]);if(!Array.isArray(rows))throw Error('會員保存紀錄需要核對，請保留原輸入。');return {context,rows}}
 const workspace=useWorkspaceDraft({kind:'member-profile',session,state:value,hasContent:hasMemberProfileInput(value),validate:validMemberProfileDraft,
  onRestore:(saved,metadata)=>{put(saved);setReview(null);setRetryAllowed(false);if(metadata.changed)latest.current.onReset()},
  findOriginal:async(saved,metadata)=>{if(!saved.submission)return null;const facts=await inspect();if(privateDraftDigest(facts.context)!==privateDraftDigest(metadata.context))throw Error('店面或帳號已變更，請保留原輸入核對。');const original=await lookup(saved,facts);return original.status==='matched'?{original,member:facts.rows.find(row=>row.id===saved.memberId)||null}:null},
  onOriginal:(found,saved,metadata)=>finish(saved,found,metadata,false)
 })
 function scope(context){workspace.assertScope(context);if(privateDraftDigest(context)!==privateDraftDigest(workspace.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')}
 async function lookup(saved,facts){
  const body=memberProfileInput(saved,facts.context),request=memberProfileRequest(saved.action,saved.memberId,body,facts.context),input={context:facts.context,family:'member-profile',id:request.id,digest:privateDraftDigest(request)},result=await lookupPrivateDraftOriginal(input,latest.current.session)
  if(result?.protocol!=='pos-private-draft-original/v1'||result.id!==input.id||!['missing','matched'].includes(result.status)||result.status==='matched'&&(result.action!==saved.action||result.entryId!==saved.memberId||result.digest!==input.digest))throw Error('會員保存紀錄需要核對，請保留原輸入。')
  return result
 }
 async function finish(saved,found,metadata=null,clear=true){
  const context=workspace.scope?.context,isCurrent=metadata?.isCurrent||(()=>{try{scope(context);return true}catch{return false}})
  if(!isCurrent())return false;await latest.current.onSaved(found.member,{isCurrent});if(!isCurrent())return false
  completed.current=saved.submission.id;if(clear)workspace.complete();put(null);setReview(null);setRetryAllowed(false);setMessage(found.member?'會員資料已保存。':'已確認先前保存，原會員目前已移除。');return true
 }
 async function task(work){if(gate.current)return false;gate.current=true;setBusy(true);try{return await work()}finally{gate.current=false;setBusy(false)}}
 async function start(row=null){return task(async()=>{
  if(workspace.blocked)throw Error('請先等草稿核對完成');const old=latest.current.value
  if(hasMemberProfileInput(old)){if(row?old.action!=='update'||old.memberId!==row.id:old.action!=='create'){setMessage('還有上次未完成的會員資料，請先接回核對。');return false}setMessage('');return true}
  const facts=await inspect();scope(facts.context);const member=row?facts.rows.find(value=>value.id===row.id):null;if(row&&!member)throw Error('找不到原會員，原輸入仍保留。')
  workspace.begin();completed.current=null;put(newMemberProfileDraft(member));setReview(null);setRetryAllowed(false);setMessage('');return true
 })}
 async function resume(){return task(async()=>{if(workspace.blocked)throw Error('請先等草稿核對完成');if(!hasMemberProfileInput(latest.current.value))return false;setMessage('');return true})}
 function field(key,text){if(gate.current||workspace.blocked||latest.current.value?.submission)return;put({...latest.current.value,form:{...latest.current.value.form,[key]:text},duplicates:null});setReview(null);setMessage('')}
 function more(open){if(latest.current.value)put({...latest.current.value,more:open})}
 async function confirmOriginal(saved){const facts=await inspect();scope(facts.context);const original=await lookup(saved,facts);scope(facts.context);if(original.status!=='matched')throw Error('會員保存紀錄需要核對，請保留原輸入。');return finish(saved,{original,member:facts.rows.find(row=>row.id===saved.memberId)||null})}
 async function send(saved,context){
  const input=memberProfileInput(saved,context)
  try{await saveMemberProfile(saved.action,saved.memberId,input,latest.current.session);scope(context);return await confirmOriginal(saved)}catch(error){
   if(error.memberProfileRejected){scope(context);const next={...saved,submission:null,duplicates:null};await workspace.adopt(next);put(next);setRetryAllowed(false);const facts=await inspect();scope(facts.context);setReview(memberProfileReview(next,facts.rows))}
   throw error
  }
 }
 async function save(confirmDuplicates=false){return task(async()=>{
  if(workspace.blocked||!latest.current.value)throw Error('請先等草稿核對完成');const saved=latest.current.value,facts=await inspect();scope(facts.context)
  if(saved.submission){if(!retryAllowed)throw Error('請先核對這次會員保存結果。');const original=await lookup(saved,facts);scope(facts.context);if(original.status==='matched')return finish(saved,{original,member:facts.rows.find(row=>row.id===saved.memberId)||null});return send(saved,facts.context)}
  const checked=memberProfileReview(saved,facts.rows);setReview(checked)
  if(checked.conflicts.length)return false
  if(checked.duplicates.length&&(!confirmDuplicates||privateDraftDigest(checked.duplicates)!==privateDraftDigest(review?.duplicates||[])))return false
  const candidate={...saved,duplicates:checked.duplicates,submission:{id:'member-profile-'+crypto.randomUUID(),time:new Date().toISOString()}};memberProfileChanges(candidate)
  workspace.persist();completed.current=null;await workspace.adopt(candidate);if(completed.current===candidate.submission.id)return true;scope(facts.context);put(candidate);setRetryAllowed(false);return send(candidate,facts.context)
 })}
 async function checkOriginal(){return task(async()=>{const saved=latest.current.value;if(!saved?.submission)throw Error('請先核對這次會員保存結果。');const facts=await inspect();scope(facts.context);const original=await lookup(saved,facts);scope(facts.context);if(original.status==='matched')return finish(saved,{original,member:facts.rows.find(row=>row.id===saved.memberId)||null});setRetryAllowed(true);setMessage('尚未找到這次保存，原內容仍保留。');return false})}
 async function resolve(choice){return task(async()=>{
  const saved=latest.current.value;if(workspace.blocked||!saved||saved.submission||!review?.conflicts.length)return false
  const facts=await inspect();scope(facts.context);const member=facts.rows.find(row=>row.id===saved.memberId)
  if(privateDraftDigest(memberProfileValues(member))!==privateDraftDigest(review.current)){setReview(memberProfileReview(saved,facts.rows));throw Error('會員資料又更新了，請再核對差異。')}
  const next=rebaseMemberProfile(saved,member,choice);await workspace.adopt(next);put(next);setReview(null);setMessage('已核對差異，按儲存才會更新。');return true
 })}
 async function useExisting(id){return task(async()=>{
  const saved=latest.current.value;if(workspace.blocked||saved?.action!=='create'||saved.submission)return false
  const facts=await inspect();scope(facts.context);const matched=memberProfileReview(saved,facts.rows).duplicates.find(row=>row.id===id),member=facts.rows.find(row=>row.id===id)
  if(!matched||!member)throw Error('相同手機的會員已更新，請再核對。');const context=facts.context,isCurrent=()=>{try{scope(context);return true}catch{return false}}
  await latest.current.onSaved(member,{isCurrent});if(!isCurrent())return false;workspace.complete();put(null);setReview(null);setMessage('已開啟原會員，沒有新增。');return true
 })}
 function close(){workspace.persist()}
 function discard(){if(busy||workspace.blocked||latest.current.value?.submission)return false;workspace.complete();put(null);setReview(null);setMessage('已放棄這份未保存輸入。');return true}
 return {value,review,message,workspace,busy,pending:!!value?.submission,ready:workspace.ready,blocked:workspace.blocked,resumable:hasMemberProfileInput(value),retryAllowed,start,resume,field,more,save,checkOriginal,resolve,useExisting,close,discard}
}
