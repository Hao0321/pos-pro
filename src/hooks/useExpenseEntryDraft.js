import {useRef,useState} from 'react'
import useWorkspaceDraft from './useWorkspaceDraft'
import {loadPrivateDraftContext,lookupExpenseEntry} from '../utils/dataAccess'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {newExpenseDraft,validExpenseDraft,expenseDraftInput,expenseHasContent} from '../utils/expenseEntryDraft'
export default function useExpenseEntryDraft({session,saveRequest,onSaved}){
 const [value,setValue]=useState(newExpenseDraft),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[retryAllowed,setRetryAllowed]=useState(false),latest=useRef(null),gate=useRef(false),completed=useRef(null)
 latest.current={value,session,saveRequest,onSaved};function put(next){latest.current.value=next;setValue(next)}
 const workspace=useWorkspaceDraft({kind:'expense-entry',session,state:value,hasContent:expenseHasContent(value),validate:validExpenseDraft,enabled:session.role==='owner',
  onRestore:saved=>{put(saved||newExpenseDraft());setRetryAllowed(false)},
  findOriginal:async(saved,metadata)=>{if(!saved?.submission)return null;const proof=await lookupExpenseEntry(expenseDraftInput(saved,metadata.context),latest.current.session);return proof.status==='matched'?proof:null},
  onOriginal:(proof,saved,metadata)=>finish(saved,proof,metadata,false)
 })
 function scope(context){workspace.assertScope(context);if(privateDraftDigest(context)!==privateDraftDigest(workspace.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')}
 async function task(work){if(gate.current)return false;gate.current=true;setBusy(true);try{return await work()}finally{gate.current=false;setBusy(false)}}
 async function finish(saved,proof,metadata=null,clear=true){const context=metadata?.context||workspace.scope?.context,isCurrent=metadata?.isCurrent||(()=>{try{scope(context);return true}catch{return false}});if(!isCurrent())return false;await latest.current.onSaved(expenseDraftInput(saved,context),proof,{isCurrent});if(!isCurrent())return false;completed.current=saved.submission.id;if(clear)workspace.complete();put(newExpenseDraft());setRetryAllowed(false);setMessage(proof.result.removed?'這筆支出已取消，沒有再次記帳。':'支出已記好，報表會自動更新。');return true}
 function field(key,text){if(gate.current||workspace.blocked||latest.current.value.submission)return;workspace.begin();put({...latest.current.value,form:{...latest.current.value.form,[key]:text}});setMessage('')}
 function preset(account,label){if(gate.current||workspace.blocked||latest.current.value.submission)return;workspace.begin();const current=latest.current.value;put({...current,form:{...current.form,expenseAccount:account,description:current.form.description.trim()?current.form.description:label}});setMessage('')}
 async function save(){return task(async()=>{
  if(workspace.blocked)throw Error('請先等草稿核對完成');const saved=latest.current.value,context=await loadPrivateDraftContext(latest.current.session);scope(context)
  if(saved.submission){const proof=await lookupExpenseEntry(expenseDraftInput(saved,context),latest.current.session);scope(context);if(proof.status==='matched')return finish(saved,proof);if(!retryAllowed)throw Error('請先核對原支出。')}
  const candidate={...saved,submission:saved.submission||{id:'expense-entry-'+crypto.randomUUID(),time:new Date().toISOString()}},request=expenseDraftInput(candidate,context)
  if(!saved.submission){workspace.persist();completed.current=null;await workspace.adopt(candidate);if(completed.current===candidate.submission.id)return true;scope(context);put(candidate)}setRetryAllowed(false)
  try{await latest.current.saveRequest(request);scope(context);const proof=await lookupExpenseEntry(request,latest.current.session);scope(context);if(proof.status!=='matched')throw Error('支出結果尚未確認，請先核對原編號。');return finish(candidate,proof)}catch(error){if(error.notCommitted){scope(context);const next={...candidate,submission:null};await workspace.adopt(next);put(next)}throw error}
 })}
 async function check(){return task(async()=>{const saved=latest.current.value;if(!saved.submission)throw Error('請先核對原支出。');const context=await loadPrivateDraftContext(latest.current.session);scope(context);const proof=await lookupExpenseEntry(expenseDraftInput(saved,context),latest.current.session);scope(context);if(proof.status==='matched')return finish(saved,proof);setRetryAllowed(true);setMessage('還沒找到這筆支出，可沿用原編號繼續。');return false})}
 function discard(){if(busy||workspace.blocked||latest.current.value.submission)return;workspace.complete();put(newExpenseDraft());setMessage('已放棄這份未保存輸入。')}
 return {value,workspace,busy,message,retryAllowed,pending:!!value.submission,field,preset,save,check,discard}
}
