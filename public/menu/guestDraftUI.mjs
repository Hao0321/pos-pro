import {tr} from '../i18n/core.mjs'
import {createGuestWorkspace} from './guestDraftStore.mjs'
import {CUSTOMER_JOURNAL} from './orderJournal.mjs'
import {safeGuestSource} from './guestDraftShape.mjs'
export function createGuestDraftUI({getContext,hasOriginal,snapshot,restore,refresh,adoptOriginal,onLock,onSuspend,onWarning,afterAcquire=()=>{}}){
 let workspace=null,hydrated=false,restored=false,clearConfirm=false,localError='',lastLocked=true
 const locked=()=>!hydrated||!workspace?.owned||workspace.state.corrupt||!!localError
 const originalReady=()=>hydrated&&workspace?.owned
 function render(){
  const state=workspace?.state||{status:'loading'},blocked=locked(),original=hasOriginal(),problem=!!localError||state.corrupt||['error','retained'].includes(state.status),waiting=!workspace?.owned
  document.body.dataset.guestDraftState=problem?'retained':waiting?'waiting':!hydrated?'loading':state.status==='saving'?'saving':'ready'
  for(const node of document.querySelectorAll('[data-guest-draft-status]')){
   node.hidden=!!original&&!waiting&&!problem;node.setAttribute('aria-live',problem||waiting?'polite':'off')
   const message=problem?state.corrupt?'這份點餐草稿需要核對，原資料已保留。':localError||'還沒保存好，請先別關閉頁面。':waiting&&state.status!=='loading'?'另一個分頁正在點餐，離開該頁後會自動接回。':!hydrated?'正在接回點餐…':state.status==='saving'?'儲存中…':restored?'已接回上次點餐':'已自動保存'
   const signature=JSON.stringify([tr(message),problem,waiting,!!state.retained,clearConfirm,!!original,!!workspace?.owned]);if(node.dataset.draftView===signature)continue;node.dataset.draftView=signature;node.replaceChildren()
   const text=document.createElement('p');text.textContent=tr(message);node.append(text);node.dataset.problem=String(problem||waiting)
   if((problem||state.retained)&&!original){
    const actions=document.createElement('div');actions.className='guest-draft-actions'
    for(const [label,action,disabled]of [['重新保存',retry,!workspace?.owned&&state.status!=='error'],['下載保留資料',download,false],[clearConfirm?'確定清除':'清除未送出的點餐',clear,!workspace?.owned]]){const button=document.createElement('button');button.type='button';button.textContent=tr(label);button.disabled=disabled;button.dataset.guestDraftAction=label==='下載保留資料'?'download':label==='重新保存'?'retry':'clear';button.onclick=()=>Promise.resolve(action()).catch(error=>{localError=error.message;render()});actions.append(button)}
    node.append(actions)
   }
  }
  if(blocked!==lastLocked){lastLocked=blocked;onLock(blocked)}
 }
 function save(){if(!workspace||!hydrated||hasOriginal())return;try{workspace.save(snapshot()).catch(()=>{});clearConfirm=false}catch(error){localError=error.message;render()}}
 async function acquire({record,corrupt,token}){
  hydrated=false;localError='';onLock(true);lastLocked=true;onSuspend()
  try{
   const original=adoptOriginal()
   if(!original){await refresh(()=>workspace.isCurrent(token));if(!workspace.isCurrent(token))return;if(!corrupt){restore(record?.state||null);restored=!!record}}
   if(!workspace.isCurrent(token))return
   hydrated=true;render();Promise.resolve(afterAcquire()).catch(()=>{})
  }catch(error){if(workspace.isCurrent(token)){localError=error instanceof TypeError?'無法核對餐點，請確認網路後重試。':error.message;render();onWarning(localError)}}
 }
 async function start(){const context=getContext();workspace=createGuestWorkspace({scopeId:context.scopeId,mode:context.mode,onAcquire:acquire,onState:()=>{if(!workspace?.owned&&hydrated){hydrated=false;onSuspend()}render()}});await workspace.start();render()}
 async function prepare(){if(locked())throw Error('請先等點餐保存完成');save();await workspace.flush();return workspace.proof()}
 async function retry(){localError='';if(!workspace?.owned){await workspace?.resume();render();return}if(workspace.state.corrupt){render();return}if(!hydrated){await workspace.pause();await workspace.resume();render();return}save();try{await workspace.flush()}catch(error){localError=error.message}render()}
 function download(){const content=workspace?.exportSource()||{},blob=new Blob([safeGuestSource(content)],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='pos-unfinished-order.json';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 async function clear(){if(hasOriginal())return;if(!clearConfirm){clearConfirm=true;render();return}await workspace.reset();clearConfirm=false;localError='';restored=false;restore(null);hydrated=true;render()}
 async function resumeVisible(){if(!workspace||workspace.owned)return;hydrated=false;render();await workspace.resume()}
 function pause(){save();hydrated=false;onSuspend();workspace?.pause();render()}
 window.addEventListener('pagehide',pause);window.addEventListener('pageshow',resumeVisible)
 window.addEventListener('focus',resumeVisible)
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else resumeVisible()})
 document.addEventListener('freeze',pause);document.addEventListener('resume',resumeVisible)
 window.addEventListener('storage',event=>{if(event.key===CUSTOMER_JOURNAL){pause();workspace?.resume()}})
 return {start,save,prepare,render,get locked(){return locked()},get originalReady(){return originalReady()},get token(){return workspace?.currentToken},isCurrent:token=>workspace?.isCurrent(token)===true,runWriter:(consume,options)=>workspace.runWriter(consume,options),restoreCurrent:()=>{localError='';restore(workspace.record?.state||null);restored=!!workspace.record;render()},get documentId(){return workspace?.documentId}}
}
