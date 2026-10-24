import {useEffect,useRef,useState} from 'react'
import useWorkspaceDraft from './useWorkspaceDraft'
import {getLoyaltyProgramPreview,applyLoyaltyProgram,lookupPrivateDraftOriginal,loadPrivateDraftContext} from '../utils/dataAccess'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {isLoyaltyProgramRejection} from '../../electron/loyaltyProgram.mjs'
import {loyaltyForm,loyaltyFormProgram,validLoyaltyProgramDraft} from '../utils/loyaltyProgramDraft'
export default function useLoyaltyProgramSetup({session,initial,onSaved}){
 const [state,setState]=useState({form:loyaltyForm(initial.current),submission:null}),[preview,setPreview]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[retryAllowed,setRetryAllowed]=useState(false),[running,setRunning]=useState(false),latest=useRef(null),submitted=useRef(null),completed=useRef(null),action=useRef(false)
 const hasContent=!!state.submission||privateDraftDigest(state.form)!==privateDraftDigest(loyaltyForm(preview.current));latest.current={session,state,onSaved}
 const workspace=useWorkspaceDraft({kind:'loyalty-settings',session,state,hasContent,validate:validLoyaltyProgramDraft,
  onRestore:(value,metadata)=>{submitted.current=value?.submission||null;setRetryAllowed(false);if(value)setState(value);else if(metadata.changed)setState({form:loyaltyForm(initial.current),submission:null})},
  findOriginal:async(value,metadata)=>{if(!value.submission)return null;const result=await lookup(value.submission,metadata.context);return result.status==='matched'?{result}:null},
  onOriginal:async(value,source,metadata)=>{await done(value.result,metadata);if(!metadata.isCurrent())return;completed.current=source.submission.id;submitted.current=null}
 })
 function scope(context){workspace.assertScope(context);if(privateDraftDigest(context)!==privateDraftDigest(workspace.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')}
 async function lookup(request,context){if(privateDraftDigest(context)!==privateDraftDigest(request.quote.context))throw Error('店面或帳號已變更，請保留原輸入核對。');const result=await lookupPrivateDraftOriginal({context,family:'loyalty-program',id:request.id,digest:privateDraftDigest(request)},latest.current.session);if(result?.protocol!=='pos-private-draft-original/v1'||result.id!==request.id||!['missing','matched'].includes(result.status)||result.status==='matched'&&(result.action!=='configure'||result.digest!==privateDraftDigest(request)||result.entryId!==request.id))throw Error('福利方案保存還沒確認，請保留原內容。');return result}
 async function done(_result,metadata){const current=await getLoyaltyProgramPreview({},latest.current.session);if(!metadata.isCurrent())return;setPreview(current);setState({form:loyaltyForm(current.current),submission:null});submitted.current=null;setRetryAllowed(false);setError('');setMessage('會員福利已啟用，現在顯示最新方案。');await latest.current.onSaved?.(current)}
 async function finish(request,result){const context=workspace.scope.context,isCurrent=()=>{try{workspace.assertScope(context);return true}catch{return false}};await done(result,{isCurrent});if(!isCurrent())return;completed.current=request.id;workspace.complete();submitted.current=null}
 useEffect(()=>{let alive=true;if(!workspace.ready||state.submission)return;setBusy(true);let program;try{program=loyaltyFormProgram(state.form)}catch(error){setError(error.message);setBusy(false);return}const timer=setTimeout(()=>{getLoyaltyProgramPreview({program},session).then(value=>{if(alive){scope(value.context);setPreview(value);setError(value.error||'')}}).catch(error=>{if(alive)setError(error.message)}).finally(()=>{if(alive)setBusy(false)})},120);return()=>{alive=false;clearTimeout(timer)}},[state.form,!!state.submission,workspace.ready,session.userId,session.role])
 function change(key,value){if(workspace.blocked||submitted.current)return;workspace.begin();setState(old=>({...old,form:{...old.form,[key]:value}}));setMessage('');setError('')}
 async function checkOriginal(){const request=submitted.current||latest.current.state.submission;if(!request)throw Error('請先核對上次的福利設定。');const context=await loadPrivateDraftContext(latest.current.session);scope(context);const result=await lookup(request,context);scope(context);if(result.status==='matched'){await finish(request,result);return true}setRetryAllowed(true);setMessage('還沒找到保存紀錄，請再確認同一個方案。');return false}
 async function save(){
  if(action.current)return;action.current=true;setRunning(true);setError('')
  try{
   let request=submitted.current||latest.current.state.submission
   if(request&&!retryAllowed){await checkOriginal();return}
   if(!request){if(workspace.blocked||busy)throw Error('請先等方案試算完成。');const program=loyaltyFormProgram(latest.current.state.form),fresh=await getLoyaltyProgramPreview({program},latest.current.session);scope(fresh.context);if(!fresh.allowed||fresh.digest!==preview.digest){setPreview(fresh);throw Error(fresh.error||'目前方案已更新，請重新核對。')}
    request={id:'loyalty-program-'+crypto.randomUUID(),time:new Date().toISOString(),quote:fresh};workspace.persist();completed.current=null;await workspace.adopt({form:latest.current.state.form,submission:request});if(completed.current===request.id)return;scope(fresh.context);submitted.current=request;setRetryAllowed(false)
   }
   const context=await loadPrivateDraftContext(latest.current.session);scope(context);if(privateDraftDigest(context)!==privateDraftDigest(request.quote.context))throw Error('店面或帳號已變更，請保留原輸入核對。')
   let result;try{result=await applyLoyaltyProgram(request,latest.current.session)}catch{throw Error('福利方案保存還沒確認，請保留原內容。')}
   if(isLoyaltyProgramRejection(result,request)){await workspace.adopt({form:latest.current.state.form,submission:null});setRetryAllowed(false);const fresh=await getLoyaltyProgramPreview({program:loyaltyFormProgram(latest.current.state.form)},latest.current.session);scope(fresh.context);setPreview(fresh);throw Error(result.error)}
   if(result?.success!==true)throw Error('福利方案保存還沒確認，請保留原內容。')
   const original=await lookup(request,context);scope(context);if(original.status!=='matched')throw Error('福利方案保存還沒確認，請保留原內容。');await finish(request,original)
  }catch(error){setError(error.message)}finally{action.current=false;setRunning(false)}
 }
 let matches=false;try{matches=privateDraftDigest(loyaltyFormProgram(state.form))===privateDraftDigest(preview.program)}catch{}
 const pending=!!state.submission,changed=privateDraftDigest(state.form)!==privateDraftDigest(loyaltyForm(preview.current))
 return {workspace:{...workspace,notice:'',canReset:false},state,preview,busy,running,error,message,pending,retryAllowed,change,save,locked:workspace.blocked||running||pending,canSave:!workspace.blocked&&!running&&(pending||!busy&&matches&&preview.allowed&&(!preview.hasProgram||changed)),useCurrentPointValue:()=>change('redeem',String(preview.current.redeem))}
}
