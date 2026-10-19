import {useEffect,useState} from 'react'
import {tr} from '../../i18n'
export default function ReservationWebsite({state,owner,disabled,onToggle}){
 const [server,setServer]=useState(null),[copied,setCopied]=useState(false)
 useEffect(()=>{let alive=true;window.electronAPI?.server?.getStatus?.().then(value=>{if(alive)setServer(value)}).catch(()=>{});return()=>{alive=false}},[state.publicEnabled])
 const url=server?.running?(server.tunnelUrl||`http://${server.ip}:${server.port}`)+'/reserve/':null
 return <section className="card reservation-website" data-reservation-website><div className="reservation-title"><div><h2>{tr('客人自己訂位')}</h2><p>{tr(state.publicEnabled?'網站訂位已開放':'網站訂位尚未開放')}</p></div>{owner&&<button className="btn btn-ghost" data-reservation-public-toggle disabled={disabled} onClick={onToggle}>{tr(state.publicEnabled?'暫停網站訂位':'開放網站訂位')}</button>}</div>{state.publicEnabled&&(url?<><label>{tr('把這個網址給客人')}<input className="field" readOnly value={url} onFocus={event=>event.target.select()}/></label><button className="btn btn-primary" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true)}catch{setCopied(false)}}}>{tr(copied?'已複製':'複製訂位網址')}</button><p>{tr(server.tunnelUrl?'此網址目前可從網際網路開啟。':'目前網址限店內網路；對外網址需要啟用對外連線。')}</p></>:<p>{tr('請在店面電腦啟動網站服務，再分享訂位網址。')}</p>)}</section>
}
