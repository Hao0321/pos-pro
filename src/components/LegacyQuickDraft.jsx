import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../i18n'
import {quickDraftScope,readQuickDraft} from '../utils/quickDraftCache'

export default function LegacyQuickDraft({context,session,onResume,blocked}){
 const scope=quickDraftScope(context,session),key=scope?.key||'',[raw,setRaw]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const latest=useRef(null),alive=useRef(false);latest.current={key,raw}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 useEffect(()=>{setError('');setBusy(false);try{setRaw(key?localStorage.getItem(key):null)}catch{setRaw(null)}},[key])
 if(!raw)return null
 async function resume(){if(busy||blocked)return;setBusy(true);setError('');const current=()=>alive.current&&latest.current.key===key;try{if(localStorage.getItem(key)!==raw)throw Error('這張草稿已在另一個視窗變更，原輸入仍保留。');const saved=readQuickDraft(localStorage,scope);if(!saved)throw Error('草稿資料需要核對，原內容仍保留。');await onResume(saved);if(latest.current.key!==key)return;if(localStorage.getItem(key)===raw)localStorage.removeItem(key);if(current())setRaw(localStorage.getItem(key))}catch(error){if(current())setError(error.message)}finally{if(current())setBusy(false)}}
 function download(){const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='POS-舊版草稿.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const style={minHeight:48,fontSize:18,whiteSpace:'normal'}
 return <div data-quick-legacy className="card" style={{padding:12,margin:'12px 0'}}><p>{tr('找到舊版草稿，接回後會重新核對店內資料。')}</p><button type="button" className="btn btn-ghost" data-quick-legacy-resume style={style} disabled={busy||blocked} onClick={resume}>{tr('接回舊版草稿')}</button><button type="button" className="btn btn-ghost" style={style} onClick={download}>{tr('下載原草稿')}</button>{error&&<p role="alert">{trMessage(error)}</p>}</div>
}
