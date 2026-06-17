import { useState, useEffect } from 'react'
import { ShoppingCart, Package, BarChart2, Users, BookOpen, Truck, ClipboardList, Tag, Settings, AlertTriangle, LogOut, Bell, LayoutDashboard, Clock, Trash2, Sparkles } from 'lucide-react'
import { ROLES, hasPermission } from '../utils/security'
import SyncStatusBadge from './SyncStatusBadge'

const NAV = [
  { key:'dashboard',  label:'首頁',     Icon:LayoutDashboard, perm:'pos.use', accent:'gold' },
  { key:'pos',        label:'收銀台',   Icon:ShoppingCart,    perm:'pos.use', accent:'green' },
  { key:'shifts',     label:'班別交班', Icon:Clock,           perm:'pos.use', accent:'teal' },
  { key:'inventory',  label:'庫存管理', Icon:Package,         perm:'inventory.view', accent:'blue' },
  { key:'purchase',   label:'進貨管理', Icon:Truck,           perm:'purchase.view', accent:'purple' },
  { key:'waste',      label:'損耗管理', Icon:Trash2,          perm:'inventory.view', accent:'red' },
  { key:'stocktake',  label:'每日盤點', Icon:ClipboardList,   perm:'stocktake.view', accent:'amber' },
  { key:'promotions', label:'促銷活動', Icon:Tag,             perm:'promotions.view', accent:'pink' },
  { key:'members',    label:'會員',     Icon:Users,           perm:'members.view', accent:'gold' },
  { key:'reports',    label:'報表分析', Icon:BarChart2,       perm:'reports.view', accent:'blue' },
  { key:'accounting', label:'會計帳務', Icon:BookOpen,        perm:'accounting.view', accent:'teal' },
  { key:'orders',     label:'顧客點餐', Icon:Bell,            perm:'pos.use', accent:'amber' },
  { key:'settings',   label:'設定',     Icon:Settings,        perm:'settings.view', accent:'gold' },
]

export default function Sidebar({ view, setView, session, lowStockCount, todayRevenue, todayOrders, onLogout, pendingOrders = 0, openShift = null }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const timeStr = now.toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit' })
  const dateStr = now.toLocaleDateString('zh-TW', { month:'numeric', day:'numeric', weekday:'short' })
  const role    = ROLES[session?.role]

  return (
    <aside style={s.sidebar}>
      {/* Logo */}
      <div style={s.logoWrap}>
        <div style={s.logoMark}>
          <Sparkles size={14} style={{position:'absolute', top:-6, right:-6, color:'var(--gold-bright)', filter:'drop-shadow(0 0 6px rgba(212,163,107,0.6))'}}/>
          P
        </div>
        <div>
          <div style={s.logoName}>POS<span style={{background:'var(--accent-grad)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text'}}>Pro</span></div>
          <div style={s.logoSub}>智慧雜貨店系統</div>
        </div>
      </div>

      {/* 今日營收卡 */}
      <div style={s.todayCard} className="animate-up">
        <div style={s.todayTop}>
          <div>
            <div style={s.todayLabel}>今日營業</div>
            <div style={s.todayAmount} className="mono tabular">${todayRevenue.toLocaleString()}</div>
          </div>
          {openShift && (
            <div style={s.liveDot} title="營業中">
              <span style={s.liveDotPulse}/>
            </div>
          )}
        </div>
        <div style={s.todayMeta}>
          <span>{todayOrders.length} 筆</span>
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
            <button key={key} onClick={() => setView(key)}
              style={{
                ...s.navItem,
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
              <span style={s.navLabel}>{label}</span>
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
      </nav>

      {/* 底部 - 警示 + 用戶 */}
      <div style={s.bottom}>
        <SyncStatusBadge onGoToSettings={() => setView('settings')}/>
        {lowStockCount > 0 && (
          <div style={s.alertBox} className="animate-up">
            <AlertTriangle size={14} style={{color:'var(--amber)', flexShrink:0}}/>
            <span style={{fontSize:12, color:'var(--amber)', fontWeight:600}}>{lowStockCount} 項低庫存</span>
          </div>
        )}
        <div style={s.userRow}>
          <div style={s.avatar}>{session?.username?.[0]}</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text-primary)'}}>{session?.username}</div>
            <div style={{fontSize:10, color: role?.color || 'var(--text-tertiary)', fontWeight:600, letterSpacing:'.05em'}}>{role?.label}</div>
          </div>
          <button className="btn-icon" onClick={onLogout} title="登出"
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
  logoMark:{
    width:38, height:38, borderRadius:12,
    background:'var(--accent-grad)',
    color:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontFamily:'var(--font-serif)', fontWeight:900, fontSize:18,
    flexShrink:0, position:'relative',
    boxShadow:'0 4px 12px rgba(184,137,90,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
  },
  logoName:{
    fontSize:16, fontWeight:800, letterSpacing:'-.01em',
    color:'var(--text-primary)',
  },
  logoSub:{
    fontSize:10, color:'var(--text-tertiary)',
    letterSpacing:'.05em', marginTop:1,
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
    border:'1px solid rgba(232,157,42,0.18)',
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
