import {useEffect,useRef,useState} from 'react'

// One lease/persistence implementation for device-local stock forms. Existing
// feature keys, envelopes, size limits and completion rules remain unchanged.
export default function useLockedDraft(key,{empty,valid,maxLength,message,prefix,fileName}){
 const [form,setValue]=useState(empty),[status,setStatus]=useState({ready:false,waiting:false,error:''})
 const lease=useRef(null),latest=useRef(form),mounted=useRef(false);latest.current=form
 const report=cause=>{if(mounted.current)setStatus(old=>({...old,error:cause.message||String(cause)}))}
 function persist(strict=false){
  const current=lease.current;if(!current?.ready||current.closed)return
  try{if(localStorage.getItem(current.key)!==current.raw)throw Error('草稿已在其他頁面變更，請保留輸入重新讀取');const raw=JSON.stringify({version:1,form:latest.current});if(raw.length>maxLength||!valid(latest.current))throw Error(message);localStorage.setItem(current.key,raw);current.raw=raw}catch(cause){report(cause);if(strict)throw cause}
 }
 useEffect(()=>{
  if(!key)return;mounted.current=true;let alive=true
  const controller=new AbortController(),current={key,ready:false,raw:null,closed:false,release:null};lease.current=current;setStatus({ready:false,waiting:false,error:''})
  const timer=setTimeout(()=>{if(alive&&!current.ready)setStatus(old=>({...old,waiting:true}))},200)
  if(!navigator.locks?.request){clearTimeout(timer);report(Error('這個瀏覽器無法安全保留共用草稿，請改用店面程式或 HTTPS 共用店面。'))}
  else navigator.locks.request(prefix+key,{mode:'exclusive',signal:controller.signal},async()=>{
   clearTimeout(timer);if(!alive)return
   try{current.raw=localStorage.getItem(key);if(current.raw!==null){if(current.raw.length>maxLength)throw Error();const saved=JSON.parse(current.raw);if(saved.version!==1||Object.keys(saved).length!==2||!valid(saved.form))throw Error();latest.current=saved.form;setValue(saved.form)}else{latest.current=empty();setValue(latest.current)}current.ready=true;setStatus({ready:true,waiting:false,error:''})}catch{report(Error(message))}
   await new Promise(resolve=>{current.release=resolve;if(!alive)resolve()})
  }).catch(cause=>{if(alive&&cause.name!=='AbortError')report(cause)})
  return()=>{alive=false;clearTimeout(timer);persist();current.ready=false;current.release?.();controller.abort();if(lease.current===current)lease.current=null;mounted.current=false}
 },[key])
 useEffect(()=>persist(),[form]);useEffect(()=>{const flush=()=>persist();window.addEventListener('pagehide',flush);return()=>window.removeEventListener('pagehide',flush)},[])
 function setForm(update){const next=typeof update==='function'?update(latest.current):update;latest.current=next;if(lease.current)lease.current.closed=false;setValue(next)}
 function close(next,acknowledged=false){const current=lease.current;if(!current?.ready)return;try{const raw=localStorage.getItem(current.key);if(raw!==current.raw&&!(acknowledged&&raw===null))throw Error('草稿已在其他頁面變更，請保留輸入重新讀取');localStorage.removeItem(current.key);current.raw=null;current.closed=true;latest.current=next;setValue(next)}catch(cause){report(cause)}}
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify({form:latest.current,originalRaw:lease.current?.raw??null},null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return {form,setForm,status,save:()=>persist(true),close,download,current:()=>({form:latest.current,ready:!!lease.current?.ready})}
}
