import {useEffect,useRef,useState} from 'react'
const fields=['productId','unit','quantity','fromLocationId','toLocationId','locationLabel','packageUnit','baseQuantity']
const empty=()=>Object.fromEntries(fields.map(key=>[key,key==='fromLocationId'?'main':'']))
const valid=value=>value&&Object.keys(value).length===fields.length&&fields.every(key=>typeof value[key]==='string'&&value[key].length<=128)
export default function useWarehouseDraft(key){
 const [form,setValue]=useState(empty),[status,setStatus]=useState({ready:false,waiting:false,error:''}),lease=useRef(null),latest=useRef(form),mounted=useRef(false)
 latest.current=form
 const report=error=>{if(mounted.current)setStatus(old=>({...old,error:error.message||String(error)}))}
 function persist(strict=false){const current=lease.current;if(!current?.ready||current.closed)return;try{if(localStorage.getItem(current.key)!==current.raw)throw Error('草稿已在其他頁面變更，請保留輸入重新讀取');const raw=JSON.stringify({version:1,form:latest.current});if(!valid(latest.current))throw Error('搬貨草稿讀不到，請保留原資料');localStorage.setItem(current.key,raw);current.raw=raw}catch(error){report(error);if(strict)throw error}}
 useEffect(()=>{
  if(!key)return;mounted.current=true;let alive=true;const controller=new AbortController(),current={key,ready:false,raw:null,closed:false,release:null};lease.current=current;setStatus({ready:false,waiting:false,error:''})
  const timer=setTimeout(()=>{if(alive&&!current.ready)setStatus(old=>({...old,waiting:true}))},200)
  if(!navigator.locks?.request){clearTimeout(timer);report(Error('這個瀏覽器無法安全保留共用草稿，請改用店面程式或 HTTPS 共用店面。'))}
  else navigator.locks.request('pos-warehouse-draft:'+key,{mode:'exclusive',signal:controller.signal},async()=>{
   clearTimeout(timer);if(!alive)return
   try{current.raw=localStorage.getItem(key);if(current.raw!==null){if(current.raw.length>4096)throw Error();const saved=JSON.parse(current.raw);if(saved.version!==1||Object.keys(saved).length!==2||!valid(saved.form))throw Error();latest.current=saved.form;setValue(saved.form)}else{latest.current=empty();setValue(latest.current)}current.ready=true;setStatus({ready:true,waiting:false,error:''})}
   catch{report(Error('搬貨草稿讀不到，請保留原資料'))}
   await new Promise(resolve=>{current.release=resolve;if(!alive)resolve()})
  }).catch(error=>{if(alive&&error.name!=='AbortError')report(error)})
  return()=>{alive=false;clearTimeout(timer);persist();current.ready=false;current.release?.();controller.abort();if(lease.current===current)lease.current=null;mounted.current=false}
 },[key])
 useEffect(()=>persist(),[form])
 useEffect(()=>{const flush=()=>persist();window.addEventListener('pagehide',flush);return()=>window.removeEventListener('pagehide',flush)},[])
 function setForm(update){const next=typeof update==='function'?update(latest.current):update;latest.current=next;if(lease.current)lease.current.closed=false;setValue(next)}
 function finish(request){
  const current=lease.current;if(!current?.ready)return
  const value=latest.current,match=request.action==='transfer'?['productId','unit','quantity','fromLocationId','toLocationId'].every(key=>value[key]===request[key]):request.action==='location'?value.locationLabel.trim().normalize('NFC')===request.label:value.productId===request.productId&&value.packageUnit.trim().normalize('NFC')===request.unit&&value.baseQuantity===request.baseQuantity
  if(!match)return
  try{if(localStorage.getItem(key)!==current.raw)throw Error('草稿已在其他頁面變更，請保留輸入重新讀取');localStorage.removeItem(key);current.raw=null;current.closed=true;const next={...value,...(request.action==='transfer'?{quantity:''}:request.action==='location'?{locationLabel:''}:{packageUnit:'',baseQuantity:''})};latest.current=next;setValue(next)}catch(error){report(error)}
 }
 function download(){const value={form:latest.current,originalRaw:lease.current?.raw??null},url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='warehouse-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return {form,setForm,status,save:()=>persist(true),finish,download}
}
