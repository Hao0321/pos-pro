import {tr,getLocale} from "../../i18n"
import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { readAuditLogs } from "../../utils/security"

export const LEVEL_STYLE = {
  info:     { color:'var(--text-tertiary)',  bg:'var(--bg-active)' },
  warning:  { color:'var(--amber)',          bg:'var(--amber-dim)' },
  critical: { color:'var(--red)',            bg:'var(--red-dim)'   },
}

export function AuditTab({ session }) {
  const [logs,    setLogs]    = useState(readAuditLogs)
  const [filter,  setFilter]  = useState('all')
  const [search,  setSearch]  = useState('')

  const filtered = logs.filter(l=>{
    const okFilter = filter==='all' || l.level===filter
    const okSearch = !search || l.username.includes(search) || l.label.includes(search)
    return okFilter && okSearch
  })

  const counts = { warning: logs.filter(l=>l.level==='warning').length, critical:logs.filter(l=>l.level==='critical').length }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12,height:'100%'}}>
      <div style={{display:'flex',gap:10,flexShrink:0,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={tr("搜尋人員或操作...")} style={{flex:1,maxWidth:220,background:'var(--bg-overlay)',border:'1px solid var(--border-subtle)',borderRadius:8,padding:'7px 12px',fontSize:13,color:'var(--text-primary)'}}/>
        <div style={{display:'flex',gap:4}}>
          {[['all','全部',logs.length],['info','一般',null],['warning','警告',counts.warning],['critical','重大',counts.critical]].map(([k,l,n])=>(
            <button key={k} onClick={()=>setFilter(k)} style={{padding:'5px 10px',borderRadius:6,fontSize:12,cursor:'pointer',background:filter===k?'var(--bg-active)':'transparent',color:filter===k?'var(--text-primary)':'var(--text-tertiary)',border:`1px solid ${filter===k?'var(--border-mid)':'transparent'}`}}>
              {tr(l)}{n!==null&&<span style={{marginLeft:4,fontFamily:'var(--font-mono)',fontSize:10}}>{n}</span>}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={()=>setLogs(readAuditLogs())}><RefreshCw size={13}/></button>
      </div>

      <div style={{flex:1,overflowY:'auto',background:'var(--bg-raised)',border:'1px solid var(--border-dim)',borderRadius:'var(--r3)',overflow:'hidden',display:'flex',flexDirection:'column'}}>
        <div style={{display:'grid',gridTemplateColumns:'140px 70px 70px 1fr 1fr',gap:8,padding:'8px 14px',background:'var(--bg-overlay)',fontSize:11,color:'var(--text-tertiary)',letterSpacing:'.05em',flexShrink:0}}>
          <span>{tr("時間")}</span><span>{tr("人員")}</span><span>{tr("等級")}</span><span>{tr("操作")}</span><span>{tr("詳情")}</span>
        </div>
        <div style={{flex:1,overflowY:'auto'}}>
          {filtered.length===0 ? (
            <div style={{textAlign:'center',padding:'40px',color:'var(--text-tertiary)',fontSize:13}}>{tr("無符合記錄")}</div>
          ) : filtered.slice(0,500).map(l=>{
            const lvl = LEVEL_STYLE[l.level] || LEVEL_STYLE.info
            return (
              <div key={l.id} style={{display:'grid',gridTemplateColumns:'140px 70px 70px 1fr 1fr',gap:8,padding:'9px 14px',borderBottom:'1px solid var(--border-dim)',fontSize:12,alignItems:'center'}}>
                <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-tertiary)',whiteSpace:'nowrap'}}>
                  {new Date(l.timestamp).toLocaleString(getLocale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                </span>
                <span style={{fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.username}</span>
                <span>
                  <span style={{padding:'1px 7px',borderRadius:20,fontSize:10,background:lvl.bg,color:lvl.color}}>{l.level}</span>
                </span>
                <span style={{color:lvl.color,fontWeight:l.level!=='info'?600:400}}>{tr(l.label)}</span>
                <span style={{color:'var(--text-tertiary)',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {Object.entries(l.detail||{}).map(([k,v])=>`${k}:${v}`).join(' · ')}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
