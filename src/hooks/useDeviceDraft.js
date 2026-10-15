import {useEffect,useRef,useState} from 'react'

// Drafts are device/user/store scoped and never enter the business backup.
export default function useDeviceDraft(key,empty,valid,messages){
  const [form,setValue]=useState(empty),[ready,setReady]=useState(''),[warning,setWarning]=useState('')
  const loaded=useRef(''),blocked=useRef(false),finished=useRef(false),latest=useRef(null)
  const fits=value=>valid(value)&&new TextEncoder().encode(JSON.stringify({version:1,form:value})).length<=65536
  useEffect(()=>{
    if(!key||loaded.current===key)return
    loaded.current=key;blocked.current=false;finished.current=false;setWarning('')
    try{
      const raw=localStorage.getItem(key)
      if(raw!==null){if(new TextEncoder().encode(raw).length>65536)throw Error();const saved=JSON.parse(raw);if(saved.version!==1||!fits(saved.form))throw Error();setValue(saved.form)}
      else setValue(empty())
    }catch{blocked.current=true;setWarning(messages.unreadable)}
    setReady(key)
  },[key])
  latest.current={key,form,ready:ready===key&&!!key}
  function persist(){
    const value=latest.current
    if(!value?.ready||blocked.current||finished.current)return
    try{if(!fits(value.form))throw Error();localStorage.setItem(value.key,JSON.stringify({version:1,form:value.form}))}
    catch{setWarning(messages.unsaved)}
  }
  useEffect(persist,[key,ready,form])
  useEffect(()=>{const flush=()=>persist();window.addEventListener('pagehide',flush);return()=>{flush();window.removeEventListener('pagehide',flush)}},[])
  function setForm(value){finished.current=false;setValue(value)}
  function saveNow(value){
    const current=latest.current
    if(!current?.ready||!fits(value))throw Error(messages.unsaved)
    try{
      if(blocked.current){
        if(!messages.preserveUnreadable)throw Error(messages.unreadable)
        const raw=localStorage.getItem(current.key)
        if(raw!==null)localStorage.setItem(current.key+':unreadable:'+crypto.randomUUID(),raw)
      }
      localStorage.setItem(current.key,JSON.stringify({version:1,form:value}))
    }catch{setWarning(messages.unsaved);throw Error(messages.unsaved)}
    blocked.current=false;finished.current=false;latest.current={...current,form:value};setValue(value)
    return value
  }
  function clear(){
    finished.current=true
    if(blocked.current&&messages.preserveUnreadable){setValue(empty());return}
    try{if(key)localStorage.removeItem(key);blocked.current=false;setWarning('')}
    catch{setWarning(messages.uncleared)}
    setValue(empty())
  }
  return {form,setForm,saveNow,clear,warning,ready:ready===key&&!!key}
}
