import {useEffect,useState} from 'react'
import {tr} from '../../i18n'
export default function ReservationWebsite({state,owner,disabled,onToggle,onURL}){
 const [server,setServer]=useState(null),[copied,setCopied]=useState(false)
 useEffect(()=>{
  let alive=true,pending=false
  const load=async()=>{if(pending)return;pending=true;try{const value=await window.electronAPI?.server?.getStatus?.();if(alive)setServer(value||null)}catch{if(alive)setServer(null)}finally{pending=false}}
  const visible=()=>{if(document.visibilityState==='visible')load()};load()
  const timer=state.publicEnabled?setInterval(visible,5000):null;window.addEventListener('focus',load);document.addEventListener('visibilitychange',visible)
  return()=>{alive=false;if(timer)clearInterval(timer);window.removeEventListener('focus',load);document.removeEventListener('visibilitychange',visible)}
 },[state.publicEnabled])
 const url=server?.running?(server.tunnelUrl||`http://${server.ip}:${server.port}`)+'/reserve/':null
 useEffect(()=>setCopied(false),[url])
 useEffect(()=>{onURL?.(url)},[url,onURL])
 const intakeOpen=state.publicEnabled&&state.config.enabled&&!state.needsRecovery
 return <section className="card reservation-website" data-reservation-website>
  <div className="reservation-title"><div><h2>{tr('客人自己訂位')}</h2><p>{tr(intakeOpen?'網站訂位已開放':'網站訂位尚未開放')}</p></div>{owner&&<button className="btn btn-ghost" data-reservation-public-toggle disabled={disabled} onClick={()=>onToggle()}>{tr(state.publicEnabled?'暫停網站訂位':'開放網站訂位')}</button>}</div>
  {owner&&state.publicEnabled&&!state.guestLinkPolicy&&<button className="btn btn-ghost" data-reservation-protect-links disabled={disabled||!state.config.enabled} onClick={()=>onToggle(true)}>{tr('啟用私人連結保護')}</button>}
  {state.guestLinkPolicy&&<p>{tr('每個私人連結都顯示到期日，老闆可隨時停用或重發。')}</p>}
  {state.publicEnabled&&(url?<><label>{tr('把這個網址給客人')}<input className="field" data-reservation-public-url readOnly value={url} onFocus={event=>event.target.select()}/></label><button className="btn btn-primary" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true)}catch{setCopied(false)}}}>{tr(copied?'已複製':'複製訂位網址')}</button><p>{tr(server.tunnelUrl?'此網址目前可從網際網路開啟。':'目前網址限店內網路；對外網址需要啟用對外連線。')}</p></>:<p>{tr('請在店面電腦啟動網站服務，再分享訂位網址。')}</p>)}
 </section>
}
