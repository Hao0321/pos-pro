import {useCallback,useEffect,useRef,useState} from 'react'
import {loadKitchenPrintState} from '../utils/dataAccess'
import {readKitchenPrintPending,retryKitchenPrint,submitKitchenPrint,kitchenPrintErrorMessage} from '../utils/kitchenPrintClient'

function pendingState(){try{return {pending:readKitchenPrintPending(),pendingError:''}}catch(error){return {pending:null,pendingError:error.message}}}
export default function useKitchenPrinting(actor,refreshSource=null){
 const [state,setState]=useState(null),[journal,setJournal]=useState(pendingState),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[message,setMessage]=useState(''),[sourceReady,setSourceReady]=useState(false)
 const actionBusy=useRef(false),reloadRef=useRef(null),sourceRef=useRef(refreshSource),identity=actor.userId+'|'+actor.role
 sourceRef.current=refreshSource
 useEffect(()=>{
  let closed=false,loading=null,again=false,timer
  setState(null);setMessage('');setError('');setLoadError('');setSourceReady(false);setJournal(pendingState())
  const load=()=>{
   if(closed)return Promise.resolve(false)
   if(loading){again=true;return loading}
   loading=(async()=>{
    let ready=false
    do{
     again=false
     try{
      const next=await loadKitchenPrintState(actor)
      if(next?.protocol!=='pos-kitchen-print-state/v1'||next.actor?.userId!==actor.userId||next.actor?.role!==actor.role||!Array.isArray(next.jobs))throw Error('列印店面或帳號需要重新核對')
      if(sourceRef.current){const source=await sourceRef.current();if(!source||source.storeId&&source.storeId!==next.storeId)throw Error('工作單尚未讀取完成，請稍後再試。')}
      ready=true
      if(!closed){setState(next);setSourceReady(true);setLoadError('')}
     }catch(e){ready=false;if(!closed){setSourceReady(false);setLoadError(kitchenPrintErrorMessage(e))}}
    }while(again&&!closed)
    return ready&&!closed
   })().finally(()=>{loading=null})
   return loading
  }
  const changed=()=>{if(!closed){setJournal(pendingState());load()}}
  reloadRef.current=load;load()
  for(const event of ['pos-data-refreshed','pos-restaurant-operation','pos-kitchen-print-pending-changed'])window.addEventListener(event,changed)
  // The native sender changes progress outside the renderer. Poll only while visible.
  timer=setInterval(()=>{if(document.visibilityState!=='hidden')load()},2500)
  return()=>{closed=true;clearInterval(timer);reloadRef.current=null;for(const event of ['pos-data-refreshed','pos-restaurant-operation','pos-kitchen-print-pending-changed'])window.removeEventListener(event,changed)}
 },[identity])
 const run=useCallback(async(input,retry=false)=>{
  if(actionBusy.current)return null;actionBusy.current=true;setBusy(true);setError('');setMessage('')
  let failure=''
  try{const result=await (retry?retryKitchenPrint(actor):submitKitchenPrint(input,actor));setMessage(input?.action==='confirm'?'已保存紙張確認':input?.action==='configure'?'已保存廚房列印設定':'已保存，請看列印進度');return result}
  catch(e){failure=kitchenPrintErrorMessage(e,!!pendingState().pending);return null}
  finally{setJournal(pendingState());await reloadRef.current?.();setError(failure);actionBusy.current=false;setBusy(false)}
 },[identity])
 return {state,...journal,busy,sourceReady,error:error||loadError,message,act:run,retry:()=>run(null,true),reload:()=>reloadRef.current?.()}
}
