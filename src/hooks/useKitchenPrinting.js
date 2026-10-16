import {useCallback,useEffect,useRef,useState} from 'react'
import {loadKitchenPrintState} from '../utils/dataAccess'
import {readKitchenPrintPending,retryKitchenPrint,submitKitchenPrint,kitchenPrintErrorMessage} from '../utils/kitchenPrintClient'

function pendingState(){try{return {pending:readKitchenPrintPending(),pendingError:''}}catch(error){return {pending:null,pendingError:error.message}}}
export default function useKitchenPrinting(actor){
 const [state,setState]=useState(null),[journal,setJournal]=useState(pendingState),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[message,setMessage]=useState('')
 const actionBusy=useRef(false),reloadRef=useRef(null),identity=actor.userId+'|'+actor.role
 useEffect(()=>{
  let closed=false,loading=false,again=false,timer
  setState(null);setMessage('');setError('');setLoadError('');setJournal(pendingState())
  const load=async()=>{
   if(closed)return;if(loading){again=true;return}loading=true
   do{again=false;try{const next=await loadKitchenPrintState(actor);if(next?.protocol!=='pos-kitchen-print-state/v1'||next.actor?.userId!==actor.userId||next.actor?.role!==actor.role||!Array.isArray(next.jobs))throw Error('列印店面或帳號需要重新核對');if(!closed){setState(next);setLoadError('')}}catch(e){if(!closed)setLoadError(kitchenPrintErrorMessage(e))}}while(again&&!closed)
   loading=false
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
  try{const result=await (retry?retryKitchenPrint(actor):submitKitchenPrint(input,actor));setMessage(input?.action==='confirm'?'已保存紙張確認':input?.action==='configure'?'已保存廚房列印設定':'已保存，請看列印進度');return result}
  catch(e){setError(kitchenPrintErrorMessage(e,!!pendingState().pending));return null}
  finally{setJournal(pendingState());await reloadRef.current?.();actionBusy.current=false;setBusy(false)}
 },[identity])
 return {state,...journal,busy,error:error||loadError,message,act:run,retry:()=>run(null,true),reload:()=>reloadRef.current?.()}
}
