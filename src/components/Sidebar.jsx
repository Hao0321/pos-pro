import {tr,getLocale} from "../i18n"
import { useState, useEffect } from 'react'
import { ShoppingCart, Package, BarChart2, Users, BookOpen, Truck, ClipboardList, Tag, Settings, AlertTriangle, LogOut, Bell, LayoutDashboard, Clock, Trash2, Sparkles, CheckCircle as CheckCircleIcon } from 'lucide-react'
import { ROLES, hasPermission } from '../utils/security'
import SyncStatusBadge from './SyncStatusBadge'
import Brand from './Brand'
import DisplayPreferences from './DisplayPreferences'

const NAV = [
  { key:'dashboard',  label:'首頁',     Icon:LayoutDashboard, perm:'pos.use', accent:'gold' },
  { key:'overview',label:'營運總覽',Icon:BarChart2,perm:'reports.view',accent:'gold' },
  { key:'quick',label:'快速建單',Icon:Sparkles,perm:'pos.use',accent:'green' },
  { key:'pos',        label:'收銀台',   Icon:ShoppingCart,    perm:'pos.use', accent:'green' },
  { key:'restaurant',label:'預訂出餐',Icon:ClipboardList,perm:'pos.use',accent:'green' },
  { key:'shifts',     label:'班別交班', Icon:Clock,           perm:'pos.use', accent:'teal' },
  { key:'readiness',  label:'營業前檢查', Icon:CheckCircleIcon, perm:'pos.use', accent:'green' },
  { key:'devices',label:'共用店面',Icon:Users,perm:'settings.edit',accent:'teal' },
  { key:'inventory',  label:'庫存管理', Icon:Package,         perm:'inventory.view', accent:'blue' },
  { key:'purchase',   label:'進貨管理', Icon:Truck,           perm:'purchase.view', accent:'purple' },
  { key:'exchange',label:'報價與價目表',Icon:ClipboardList,perm:'purchase.edit',accent:'blue' },
  { key:'waste',      label:'損耗管理', Icon:Trash2,          perm:'inventory.view', accent:'red' },
  { key:'stocktake',  label:'每日盤點', Icon:ClipboardList,   perm:'stocktake.view', accent:'amber' },
  { key:'promotions', label:'促銷活動', Icon:Tag,             perm:'promotions.view', accent:'pink' },
  { key:'members',    label:'會員',     Icon:Users,           perm:'members.view', accent:'gold' },
  { key:'reports',    label:'報表分析', Icon:BarChart2,       perm:'reports.view', accent:'blue' },
  { key:'accounting', label:'會計帳務', Icon:BookOpen,        perm:'accounting.view', accent:'teal' },
  { key:'orders',     label:'顧客點餐', Icon:Bell,            perm:'pos.use', accent:'amber' },
  { key:'settings',   label:'設定',     Icon:Settings,        perm:'settings.view', accent:'gold' },
  { key:'scenarios',  label:'情境模板', Icon:Sparkles,        perm:'settings.edit', accent:'green' },
]

export default function Sidebar({ view, setView, session, lowStockCount, todayRevenue, todayOrders, onLogout, pendingOrders = 0, openShift = null,largeText=false,toggleLargeText,simpleMode=false,toggleSimpleMode }) {
  const [now, setNow] = useState(new Date())
  const [showMore,setShowMore]=useState(false)
  const common=new Set(['dashboard','quick','pos','restaurant','shifts','readiness','inventory','purchase'])
  useEffect(()=>{if(!common.has(view))setShowMore(true)},[view])
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const timeStr = now.toLocaleTimeString(getLocale(), { hour:'2-digit', minute:'2-digit' })
  const dateStr = now.toLocaleDateString(getLocale(), { month:'numeric', day:'numeric', weekday:'short' })
  const role    = ROLES[session?.role]

  return (
    <aside className="workspace-sidebar" style={s.sidebar}>
      {/* Logo */}
      <div style={s.logoWrap}>
        <Brand compact/>
      </div>

      {/* 今日營收卡 */}
      <DisplayPreferences compact/>
      <button className="btn btn-ghost" aria-label={tr("切換大字模式（選單）")} aria-pressed={largeText} onClick={toggleLargeText} style={{minHeight:48,fontSize:16,margin:'0 12px 8px'}}>{tr("大字好按 ")}{largeText?'✓':''}</button>
      <button className="btn btn-ghost" aria-label={tr("切換簡易操作")} aria-pressed={simpleMode} onClick={toggleSimpleMode} style={{minHeight:48,fontSize:16,margin:'0 12px 8px'}}>{simpleMode?tr("簡易操作 ✓"):tr("切換簡易操作")}</button>
      <div style={s.todayCard} className="animate-up">
        <div style={s.todayTop}>
          <div>
            <div style={s.todayLabel}>{tr("今日營業")}</div>
            <div style={s.todayAmount} className="mono tabular">${todayRevenue.toLocaleString()}</div>
          </div>
          {openShift && (
            <div style={s.liveDot} title={tr("營業中")}>
              <span style={s.liveDotPulse}/>
            </div>
          )}
        </div>
        <div style={s.todayMeta}>
          <span>{todayOrders.length}{tr(" 筆")}</span>
          <span style={{opacity:0.4}}>•</span>
          <span>{dateStr}</span>
          <span style={{opacity:0.4}}>•</span>
          <span style={{fontFamily:'var(--font-mono)'}}>{timeStr}</span>
        </div>
      </div>

      {/* 導航 */}
      <nav style={s.nav}>
        {NAV.filter(n => hasPermission(session, n.perm)).map(({ key, label, Icon, accent }, idx) => {
          const active = view === key
          const badge = key === 'inventory' && lowStockCount > 0 ? lowStockCount
                      : key === 'orders' && pendingOrders > 0 ? pendingOrders
                      : null
          return (
            <button key={key} className="workspace-nav-item" data-nav={key} aria-current={active?'page':undefined} onClick={() => setView(key)}
              style={{
                ...s.navItem,
                display:simpleMode&&!showMore&&!common.has(key)&&view!==key?'none':'flex',
                background: active ? 'var(--bg-raised)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: active ? 600 : 500,
                boxShadow: active ? 'var(--shadow-sm)' : 'none',
              }}>
              <span style={{
                ...s.navIcon,
                background: active ? `var(--${accent}-dim)` : 'transparent',
                color: active ? `var(--${accent})` : 'var(--text-tertiary)',
                transform: active ? 'scale(1.05)' : 'scale(1)',
              }}>
                <Icon size={16} strokeWidth={active ? 2.4 : 2}/>
              </span>
              <span style={s.navLabel}>{tr(label)}</span>
              {badge != null && (
                <span style={{
                  ...s.navBadge,
                  background: key === 'orders' ? 'var(--red)' : 'var(--amber)',
                  color: '#fff',
                }}>{badge}</span>
              )}
              {active && <span style={{...s.activeBar, background:`var(--${accent})`}}/>}
            </button>
          )
        })}
        {simpleMode&&<button className="btn btn-ghost" aria-label={tr("展開全部功能")} aria-expanded={showMore} style={{minHeight:48,fontSize:16,marginTop:6}} onClick={()=>setShowMore(v=>!v)}>{showMore?tr("收起更多功能"):tr("全部功能")}</button>}
      </nav>

      {/* 底部 - 警示 + 用戶 */}
      <div style={s.bottom}>
        <SyncStatusBadge onGoToSettings={() => setView('settings')}/>
        {lowStockCount > 0 && (
          <div style={s.alertBox} className="animate-up">
            <AlertTriangle size={14} style={{color:'var(--amber)', flexShrink:0}}/>
            <span style={{fontSize:12, color:'var(--amber)', fontWeight:600}}>{lowStockCount}{tr(" 項低庫存")}</span>
          </div>
        )}
        <div style={s.userRow}>
          <div style={s.avatar}>{session?.username?.[0]}</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text-primary)'}}>{session?.username}</div>
            <div style={{fontSize:10, color: role?.color || 'var(--text-tertiary)', fontWeight:600, letterSpacing:'.05em'}}>{tr(role?.label)}</div>
          </div>
          <button className="btn-icon" onClick={onLogout} title={tr("登出")}
            style={{color:'var(--text-tertiary)'}}>
            <LogOut size={14}/>
          </button>
        </div>
      </div>
    </aside>
  )
}

const s = {
  sidebar:{
    width:'var(--sidebar-w)', minWidth:232, flexShrink:0,
    background:'var(--bg-overlay)',
    borderRight:'1px solid var(--border-dim)',
    display:'flex', flexDirection:'column', height:'100%',
  },
  logoWrap:{
    display:'flex', alignItems:'center', gap:12,
    padding:'18px 18px 14px',
  },
  todayCard:{
    margin:'4px 14px 14px',
    padding:'14px 16px',
    background:'var(--bg-raised)',
    borderRadius:'var(--r3)',
    border:'1px solid var(--border-dim)',
    boxShadow:'var(--shadow-sm)',
  },
  todayTop:{
    display:'flex', justifyContent:'space-between', alignItems:'flex-start',
  },
  todayLabel:{
    fontSize:10, color:'var(--text-tertiary)',
    letterSpacing:'.08em', fontWeight:700, textTransform:'uppercase',
    marginBottom:4,
  },
  todayAmount:{
    fontSize:22, fontWeight:700, letterSpacing:'-.02em',
    color:'var(--text-primary)',
  },
  todayMeta:{
    fontSize:10.5, color:'var(--text-tertiary)',
    marginTop:8, display:'flex', gap:6, alignItems:'center', fontWeight:500,
  },
  liveDot:{
    width:10, height:10, borderRadius:'50%',
    background:'var(--green)', position:'relative',
    flexShrink:0, marginTop:4,
  },
  liveDotPulse:{
    position:'absolute', inset:-3,
    borderRadius:'50%', background:'var(--green)', opacity:0.4,
    animation:'pulseGlow 1.6s var(--ease) infinite',
  },
  nav:{
    flex:1, display:'flex', flexDirection:'column', gap:2,
    padding:'4px 10px', overflowY:'auto',
  },
  navItem:{
    display:'flex', alignItems:'center', gap:11,
    padding:'9px 10px', borderRadius:'var(--r2)',
    fontSize:13.5, textAlign:'left', width:'100%',
    transition:'all 200ms var(--ease-snap)',
    position:'relative',
  },
  navIcon:{
    width:30, height:30, borderRadius:8,
    display:'flex', alignItems:'center', justifyContent:'center',
    flexShrink:0,
    transition:'all 240ms var(--ease-spring)',
  },
  navLabel:{
    flex:1, letterSpacing:'.01em',
  },
  navBadge:{
    fontSize:10, fontWeight:700,
    padding:'1px 7px', borderRadius:'var(--r-pill)',
    minWidth:18, textAlign:'center',
  },
  activeBar:{
    position:'absolute', left:-10, top:'25%', bottom:'25%',
    width:3, borderRadius:'0 3px 3px 0',
  },
  bottom:{
    padding:'12px 0 16px',
    display:'flex', flexDirection:'column', gap:10,
  },
  alertBox:{
    display:'flex', alignItems:'center', gap:8,
    background:'var(--amber-dim)',
    borderRadius:'var(--r2)',
    padding:'8px 12px', margin:'0 14px',
    border:'1px solid var(--amber-dim)',
  },
  userRow:{
    display:'flex', alignItems:'center', gap:10,
    padding:'10px 12px', margin:'0 10px',
    borderRadius:'var(--r3)', background:'var(--bg-raised)',
    border:'1px solid var(--border-dim)',
    boxShadow:'var(--shadow-xs)',
  },
  avatar:{
    width:32, height:32, borderRadius:'50%',
    background:'var(--accent-grad)',
    color:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontWeight:700, fontSize:13, flexShrink:0,
    boxShadow:'inset 0 1px 0 rgba(255,255,255,0.2)',
  },
}
