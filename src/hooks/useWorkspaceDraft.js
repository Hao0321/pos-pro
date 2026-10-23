import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {loadPrivateDraftContext,lookupPrivateDraftOriginal} from '../utils/dataAccess'
import {workspaceScope,readWorkspaceDraft,writeWorkspaceDraft,clearWorkspaceDraft,workspaceOriginal} from '../utils/workspaceDraft'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {readPendingFinancial} from '../utils/financialCommand'

function originalLookup(kind,current,state){return {context:current.scope.context,id:current.original.id,digest:current.original.digest,...(kind==='quick'||kind==='ordinary-order'||kind.startsWith('reservation-ordinary-order:')?{family:kind==='quick'&&state?.draft?.kind==='purchase'?'quick-purchase':'quick-restaurant'}:{})}}
const originalAction=(kind,input)=>input.family==='quick-purchase'?'purchase-create':['menu-setup','restaurant-settings'].includes(kind)?'configure':'create'

export default function useWorkspaceDraft({kind,session,state,hasContent,validate,onRestore,onOriginal,findOriginal,enabled=true}){
 const [status,setStatus]=useState({ready:false,waiting:false,warning:'',error:'',notice:''}),latest=useRef(null),lease=useRef(null),sequence=useRef(0),mounted=useRef(false),closed=useRef(false),documentId=useRef('draft-'+crypto.randomUUID()),startRef=useRef(null)
 const previousScope=useRef(''),previousActor=useRef(session.userId+':'+session.role)
 latest.current={session,state,hasContent,validate,onRestore,onOriginal,findOriginal}
 function persist(strict=false){
  const current=lease.current;if(!current?.ready||closed.current)return
  try{
   if(!latest.current.hasContent&&!current.original){clearWorkspaceDraft(localStorage,current.scope,current.raw);current.raw=null;return}
   const saved=writeWorkspaceDraft(localStorage,current.scope,{documentId:documentId.current,state:latest.current.state,original:current.original},current.raw,latest.current.validate);current.raw=saved.raw;current.sourceState=latest.current.state
   if(mounted.current)setStatus(old=>old.warning?{...old,warning:''}:old)
  }catch(error){const warning='這個裝置暫時無法保留草稿，內容仍在畫面上，請先不要離開。';if(mounted.current)setStatus(old=>old.warning===warning?old:{...old,warning});if(strict)throw error}
 }
 function stop(){const current=lease.current;if(!current)return;persist();current.ready=false;current.controller.abort();current.release?.();lease.current=null}
 useLayoutEffect(()=>{const actor=session.userId+':'+session.role;if(previousActor.current!==actor){previousActor.current=actor;sequence.current++;stop();closed.current=false;latest.current.onRestore(null,{context:null,changed:true});setStatus({ready:false,waiting:false,warning:'',error:'',notice:''})}},[session.userId,session.role])
 useEffect(()=>{
  mounted.current=true;let alive=true
  async function start(force=false){
   const ticket=++sequence.current,actor={...latest.current.session};if(!lease.current?.ready)setStatus(old=>({...old,ready:false,error:''}))
   try{
    const context=await loadPrivateDraftContext(actor);if(!alive||ticket!==sequence.current)return
    const scope=workspaceScope(context,kind)
    if(context.userId!==actor.userId||context.role!==actor.role){stop();await latest.current.onRestore(null,{context:null,changed:true});throw Error('店面或帳號已變更，請保留原輸入核對。')}
    if(!force&&lease.current?.scope.key===scope.key&&lease.current.phase!=='fault'){setStatus(old=>old.ready===lease.current.ready?old:{...old,ready:lease.current.ready});return}
    const changed=!!previousScope.current&&previousScope.current!==scope.key;previousScope.current=scope.key;stop();closed.current=false;setStatus(old=>({...old,ready:false,waiting:false,error:''}))
    const controller=new AbortController(),current={scope,raw:null,original:null,ready:false,phase:'waiting',controller,release:null};lease.current=current
    if(!navigator.locks?.request)throw Error('這個瀏覽器無法安全保留共用草稿，請改用店面程式或 HTTPS 共用店面。')
    const waitingTimer=setTimeout(()=>{if(alive&&lease.current===current&&current.phase==='waiting')setStatus(old=>({...old,waiting:true,notice:''}))},200)
    navigator.locks.request('pos-workspace:'+scope.key,{mode:'exclusive',signal:controller.signal},async()=>{
     clearTimeout(waitingTimer);current.phase='loading'
     if(!alive||lease.current!==current)return
     try{
      current.raw=localStorage.getItem(scope.key);const saved=readWorkspaceDraft(localStorage,scope,latest.current.validate);current.raw=saved.raw;current.original=saved.value?.original??null;current.sourceState=saved.value?.state;documentId.current=saved.value?.documentId||'draft-'+crypto.randomUUID()
      async function finishOriginal(result){
       current.completing=true
       await latest.current.onOriginal?.(result,current.sourceState,{context:scope.context,isCurrent:()=>alive&&lease.current===current})
       if(!alive||lease.current!==current)return
       clearWorkspaceDraft(localStorage,scope,current.raw);current.raw=null;current.original=null;closed.current=true;current.completing=false
      }
      if(current.original){
       const input=originalLookup(kind,current,current.sourceState),result=await lookupPrivateDraftOriginal(input,actor)
       if(!alive||lease.current!==current)return
       if(result?.protocol!=='pos-private-draft-original/v1'||result.id!==current.original.id||!['matched','missing'].includes(result.status)||result.status==='matched'&&(result.action!==originalAction(kind,input)||result.digest!==current.original.digest))throw Error('保存結果尚未確認，請保留原編號核對。')
       if(result.status==='matched'){
        await finishOriginal(result)
       }else if(!readPendingFinancial())current.original=null
      }
      if(!alive||lease.current!==current)return
      if(!closed.current&&!current.original&&saved.value&&latest.current.findOriginal){
       const result=await latest.current.findOriginal(current.sourceState,{context:scope.context})
       if(!alive||lease.current!==current)return
       if(result)await finishOriginal(result)
      }
      if(!alive||lease.current!==current)return
      if(!closed.current&&(saved.value||changed))await latest.current.onRestore(saved.value?.state??null,{context:scope.context,changed,isCurrent:()=>alive&&lease.current===current})
      if(!alive||lease.current!==current)return
      current.ready=true;current.phase='active';setStatus({ready:true,waiting:false,warning:'',error:'',notice:saved.value&&!closed.current?'已接回未完成的草稿，確認前會重新核對。':''})
      await new Promise(resolve=>{current.release=resolve;if(controller.signal.aborted)resolve()})
     }catch(error){if(alive&&lease.current===current){current.ready=false;current.phase='fault';setStatus(old=>({...old,ready:false,waiting:false,error:error.message}))}}
    }).catch(error=>{if(error.name!=='AbortError'&&alive&&lease.current===current){current.phase='fault';setStatus(old=>({...old,ready:false,waiting:false,error:error.message}))}}).finally(()=>clearTimeout(waitingTimer))
   }catch(error){if(alive&&ticket===sequence.current)setStatus(old=>({...old,ready:false,waiting:false,error:error.message}))}
  }
  startRef.current=start;if(enabled)start();else setStatus(old=>({...old,ready:false}))
  async function recovered(event){const current=lease.current,proof=current?.original;if(!proof||current.completing||event.detail?.receipt?.id!==proof.id)return;try{const input=originalLookup(kind,current,current.sourceState),result=await lookupPrivateDraftOriginal(input,latest.current.session);if(alive&&lease.current===current&&current.original===proof&&result?.protocol==='pos-private-draft-original/v1'&&result.status==='matched'&&result.id===proof.id&&result.digest===proof.digest&&result.action===originalAction(kind,input)){current.completing=true;await latest.current.onOriginal?.(result,current.sourceState,{context:current.scope.context,isCurrent:()=>alive&&lease.current===current});if(!alive||lease.current!==current)return;complete();current.completing=false}}catch(error){if(alive&&lease.current===current){current.completing=false;setStatus(old=>({...old,error:error.message}))}}}
  const hide=()=>{sequence.current++;stop()},show=()=>{if(enabled)start()},refresh=()=>{if(enabled)start()}
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);window.addEventListener('focus',refresh);window.addEventListener('pos-data-refreshed',refresh)
  window.addEventListener('pos-restaurant-operation',recovered)
  window.addEventListener('pos-inventory-operation',recovered)
  return()=>{alive=false;mounted.current=false;sequence.current++;stop();window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);window.removeEventListener('focus',refresh);window.removeEventListener('pos-data-refreshed',refresh);window.removeEventListener('pos-restaurant-operation',recovered);window.removeEventListener('pos-inventory-operation',recovered)}
 },[kind,session.userId,session.role,enabled])
 useEffect(()=>{persist()},[state,hasContent,status.ready])
 function begin(){if(closed.current){closed.current=false;documentId.current='draft-'+crypto.randomUUID();if(lease.current)lease.current.original=null}return documentId.current}
 function complete(){closed.current=true;if(mounted.current)setStatus(old=>old.notice?{...old,notice:''}:old);const current=lease.current;if(current){try{clearWorkspaceDraft(localStorage,current.scope,current.raw);current.raw=null;current.original=null}catch{if(mounted.current)setStatus(old=>({...old,warning:'單據已保存，但這個裝置的舊草稿還沒清掉。'}))}}}
 function remember(request){const current=lease.current;if(!current?.ready)throw Error('請先等草稿核對完成');const proof=workspaceOriginal(request,latest.current.state);current.original=proof;persist(true);return proof}
 function uncommitted(){if(lease.current){lease.current.original=null;persist()}}
 function assertScope(scope){const current=lease.current;if(!current?.ready||scope.storeId!==current.scope.context.storeId||scope.epoch!==current.scope.context.epoch||current.scope.context.userId!==latest.current.session.userId||current.scope.context.role!==latest.current.session.role)throw Error('店面或帳號已變更，請保留原輸入核對。');return current.scope.context}
 async function adopt(state){
  const current=lease.current;if(!current?.ready||current.original||readPendingFinancial())throw Error('請先核對上一筆異動')
  begin();const saved=writeWorkspaceDraft(localStorage,current.scope,{documentId:documentId.current,state,original:null},current.raw,latest.current.validate);current.raw=saved.raw;current.sourceState=state;latest.current={...latest.current,state,hasContent:true};current.ready=false;current.phase='adopting';setStatus(old=>({...old,ready:false}))
  const isCurrent=()=>lease.current===current&&!current.controller.signal.aborted&&latest.current.session.userId===current.scope.context.userId&&latest.current.session.role===current.scope.context.role
  const guard=()=>{if(!isCurrent())throw Error('店面或帳號已變更，請保留原輸入核對。')}
  try{
   const context=await loadPrivateDraftContext(latest.current.session);guard();if(privateDraftDigest(context)!==privateDraftDigest(current.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')
   const metadata={context,changed:false,isCurrent},original=await latest.current.findOriginal?.(state,metadata);guard()
   if(original){current.completing=true;await latest.current.onOriginal?.(original,state,metadata);guard();clearWorkspaceDraft(localStorage,current.scope,current.raw);current.raw=null;current.original=null;closed.current=true;current.completing=false}
   else{await latest.current.onRestore(state,metadata);guard()}
   current.ready=true;current.phase='active';setStatus(old=>({...old,ready:true,error:'',notice:closed.current?'':old.notice}));return true
  }catch(error){if(isCurrent()){current.completing=false;current.phase='fault';setStatus(old=>({...old,ready:false,error:error.message}))}throw error}
 }
 async function reset(){const current=lease.current;if(!current||current.phase!=='fault')return;try{if(readPendingFinancial())throw Error('請先核對上一筆異動');const context=await loadPrivateDraftContext(latest.current.session);if(privateDraftDigest(context)!==privateDraftDigest(current.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。');await navigator.locks.request('pos-workspace:'+current.scope.key,async()=>{clearWorkspaceDraft(localStorage,current.scope,current.raw);current.raw=null;current.original=null});await latest.current.onRestore(null,{context,changed:false});stop();closed.current=false;documentId.current='draft-'+crypto.randomUUID();startRef.current?.()}catch(error){setStatus(old=>({...old,error:error.message}))}}
 function download(){const current=lease.current;if(!current?.raw)return;const url=URL.createObjectURL(new Blob([current.raw],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='POS-未完成草稿.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return {...status,blocked:enabled&&(!status.ready||!!lease.current?.original),originalId:lease.current?.original?.id||null,documentId:()=>begin(),begin,persist:()=>persist(true),remember,assertScope,adopt,uncommitted,complete,reset,download,rawAvailable:!!lease.current?.raw,canReset:lease.current?.phase==='fault',recheck:()=>{persist();startRef.current?.(true)},scope:lease.current?.scope||null,identity:()=>({id:begin(),time:new Date().toISOString()}),stateDigest:()=>privateDraftDigest(latest.current.state)}
}
