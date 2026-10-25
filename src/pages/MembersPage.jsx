import {tr,trMessage,getLocale} from "../i18n"
import { useState, useMemo,useRef,useEffect } from 'react'
import { Plus, Pencil, Trash2, X, Check, Gift, TrendingUp, Phone, Wallet, RotateCcw, Cake } from 'lucide-react'
import RefundModal from '../components/RefundModal'
import MemberProfileEditor from '../components/MemberProfileEditor'
import { computeMemberRFM } from '../utils/analytics'

const TIER = {
  normal: { label:'一般', color:'var(--text-secondary)', bg:'var(--bg-active)', min:0,     max:10000 },
  silver: { label:'銀卡', color:'var(--silver)',         bg:'var(--silver-dim)',   min:10000, max:30000 },
  gold:   { label:'金卡', color:'var(--gold-bright)',    bg:'var(--gold-dim)',     min:30000, max:Infinity },
}

export default function MembersPage({ store, session }) {
  const { members, deleteMember, orders, products, topupMember, refund } = store
  const profileEditor=useRef(null)
  const [search,     setSearch]     = useState('')
  const [filterTier, setFilterTier] = useState('all')
  const [selected,   setSelected]   = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [showTopup,  setShowTopup]  = useState(false)
  const [topupAmt,   setTopupAmt]   = useState('')
  const [topupBonus, setTopupBonus] = useState('')
  const [topupMethod,setTopupMethod] = useState('cash')
  const [refundOrder,setRefundOrder] = useState(null)
  const saving=useRef(false)
  const memberTrigger=useRef(null),detailClose=useRef(null)

  // 重新從 list 取最新資料（避免顯示過期）
  const selectedLive = selected ? members.find(m => m.id === selected.id) || selected : null
  useEffect(()=>{
    if(selectedLive)detailClose.current?.focus({preventScroll:true})
    else memberTrigger.current?.focus({preventScroll:true})
  },[selectedLive?.id])

  // 預先計算每位會員的 RFM 標籤
  const rfmMap = useMemo(() => {
    const m = new Map()
    for (const mem of members) m.set(mem.id, computeMemberRFM(mem, orders))
    return m
  }, [members, orders])

  const filtered = members.filter(m => {
    const okSearch = !search || (m.name||'').includes(search) || (m.phone||'').includes(search)
    const okTier   = filterTier === 'all'
                  || m.tier === filterTier
                  || (filterTier.startsWith('rfm:') && rfmMap.get(m.id)?.tag === filterTier.slice(4))
    return okSearch && okTier
  })

  function startNew()  { profileEditor.current?.start() }
  function startEdit(m){ profileEditor.current?.start(m) }

  async function handleTopup() {
    if (!selectedLive||saving.current) return
    const amt = parseFloat(topupAmt) || 0
    const bonus = session?.role==='owner'?(parseFloat(topupBonus) || 0):0
    if (amt <= 0) return
    saving.current=true
    try{await topupMember(selectedLive.id, amt, bonus, topupMethod, session?.username || '')
    setShowTopup(false); setTopupAmt(''); setTopupBonus(''); setTopupMethod('cash')}catch(e){alert(trMessage(e.message))}finally{saving.current=false}
  }

  async function handleRefund(origOrder, refundItems, opts) {
    return await refund(origOrder, refundItems, opts)
  }

  // 生日提醒
  function isBirthdayMonth(m) {
    if (!m.birthday) return false
    return m.birthday.slice(5,7) === String(new Date().getMonth()+1).padStart(2,'0')
  }

  // Get member's order history
  const memberOrders = selected ? orders.filter(o => o.memberId === selected.id) : []
  const memberRevenue = memberOrders.reduce((s,o) => s+o.total, 0)

  // Tier progress
  function tierProgress(m) {
    const t = TIER[m.tier]
    if (m.tier === 'gold') return 100
    const pct = ((m.totalSpent - t.min) / (t.max - t.min)) * 100
    return Math.min(100, Math.max(0, pct))
  }

  return (
    <div style={ms.root} className={'members-page'+(selectedLive?' has-member-detail':'')}>
      <div style={ms.left} className="member-list-panel">
        <div style={{...ms.header,flexWrap:'wrap',gap:8}}>
          <div>
            <h2 className="page-title" style={ms.title}>{tr("會員管理")}</h2>
            <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
              {members.length}{tr(" 位會員")}</div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {session?.role==='owner'&&<button className="btn btn-ghost" style={{minHeight:48,fontSize:16}} data-loyalty-settings-entry onClick={store.openLoyaltySettings}>{tr('設定會員福利')}</button>}
            <button className="btn btn-primary" style={{minHeight:48,fontSize:18}} data-member-new onClick={startNew}>
              <Plus size={15}/>{tr("新增會員")}</button>
          </div>
        </div>

        <div style={ms.toolbar}>
          <input className="field" value={search} onChange={e=>setSearch(e.target.value)} placeholder={tr("搜尋姓名或手機...")} style={{flex:1, maxWidth:240, padding:'8px 12px'}}/>
          <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
            {[
              ['all','全部'],['normal','一般'],['silver','銀卡'],['gold','金卡'],
              ['rfm:VIP','★VIP'],['rfm:核心會員','核心'],['rfm:流失預警','流失預警'],['rfm:沉睡會員','沉睡'],
            ].map(([k,l])=>(
              <button key={k} onClick={()=>setFilterTier(k)} style={{
                ...ms.filterBtn,
                background: filterTier===k?'var(--bg-active)':'transparent',
                color: filterTier===k?'var(--text-primary)':'var(--text-tertiary)',
                border: `1px solid ${filterTier===k?'var(--border-mid)':'transparent'}`,
              }}>{tr(l)}</button>
            ))}
          </div>
        </div>

        <MemberProfileEditor ref={profileEditor} store={store} session={session} onSaved={setSelected}/>

        {/* Member list */}
        <div style={ms.list}>
          {filtered.map(m => {
            const t   = TIER[m.tier]
            const pct = tierProgress(m)
            const active = selected?.id === m.id
            const rfm = rfmMap.get(m.id)
            return (
              <div key={m.id} role="group" data-member-card={m.id} onClick={event=>{memberTrigger.current=event.currentTarget.querySelector('[data-member-open]');setSelected(active?null:m)}} style={{
                ...ms.memberCard,
                background: active ? 'var(--bg-active)' : 'var(--bg-raised)',
                border: `1px solid ${active ? 'var(--border-mid)' : 'var(--border-dim)'}`,
              }}>
                <button type="button" data-member-open={m.id} aria-label={tr('查看會員 {0}',{0:m.name})} style={{display:'flex',alignItems:'center',gap:14,flex:1,minWidth:0,minHeight:48,padding:0,textAlign:'left',background:'transparent',border:0,color:'inherit',cursor:'pointer'}}>
                <div style={{...ms.avatar, background:t.bg, color:t.color}}>
                  {m.name[0]}
                </div>
                <div style={{flex:1, minWidth:0, textAlign:'left'}}>
                  <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2, flexWrap:'wrap'}}>
                    <span style={{fontWeight:600, fontSize:14}}>{m.name}</span>
                    <span style={{fontSize:10, padding:'1px 7px', borderRadius:20, background:t.bg, color:t.color, fontWeight:500}}>
                      {tr(t.label)}
                    </span>
                    {rfm && (
                      <span style={{fontSize:10, padding:'1px 7px', borderRadius:20, background:'var(--bg-overlay)', color:rfm.tagColor, fontWeight:600, border:`1px solid ${rfm.tagColor}`}}>
                        {tr(rfm.tag)}
                      </span>
                    )}
                  </div>
                  <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:6, fontFamily:'var(--font-mono)'}}>
                    {m.phone}
                  </div>
                  <div style={{display:'flex', gap:14, flexWrap:'wrap'}}>
                    <span style={{fontSize:11, color:'var(--text-secondary)'}}>
                      <Gift size={10} style={{marginRight:3, verticalAlign:'middle'}}/>
                      {m.points.toLocaleString()}{tr(" 點")}</span>
                    <span style={{fontSize:11, color:'var(--text-secondary)'}}>{tr("累消 NT$ ")}{m.totalSpent.toLocaleString()}
                    </span>
                    {rfm && rfm.frequency > 0 && (
                      <span style={{fontSize:11, color:'var(--text-tertiary)'}}>
                        · {rfm.recencyDays === 0 ? tr("今天") : tr("{0} 天前", {0: rfm.recencyDays})} · {rfm.frequency}{tr(" 次")}</span>
                    )}
                  </div>
                  {m.tier !== 'gold' && (
                    <div style={{marginTop:8}}>
                      <div style={{display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-tertiary)', marginBottom:3}}>
                        <span>{tr('升級{0}進度',{0:m.tier==='normal'?tr('銀卡'):tr('金卡')})}</span>
                        <span className="mono">{Math.round(pct)}%</span>
                      </div>
                      <div style={{height:3, background:'var(--border-dim)', borderRadius:2}}>
                        <div style={{height:'100%', width:`${pct}%`, background:t.color, borderRadius:2, transition:'width .5s'}}/>
                      </div>
                    </div>
                  )}
                </div>
                </button>
                <div style={{display:'flex', flexDirection:'column', gap:4}}>
                  <button type="button" className="btn-icon" data-member-edit={m.id} aria-label={tr('編輯會員')} style={{minWidth:48,minHeight:48}} onClick={e=>{e.stopPropagation();startEdit(m)}}><Pencil size={18}/></button>
                  <button type="button" className="btn-icon" aria-label={tr('確認刪除此會員？')} style={{color:'var(--red)',minWidth:48,minHeight:48}} onClick={e=>{e.stopPropagation();setConfirmDel(m.id)}}><Trash2 size={18}/></button>
                </div>
              </div>
            )
          })}
          {filtered.length===0 && (
            <div style={{textAlign:'center', padding:'48px', color:'var(--text-tertiary)', fontSize:13}}>{tr("沒有符合的會員")}</div>
          )}
        </div>
      </div>

      {/* Member detail panel */}
      {selectedLive && (
        <div style={ms.detail} className="member-detail animate-in" role="region" aria-label={tr('會員詳情')}>
          <div style={ms.detailHeader}>
            <div style={{...ms.avatarLg, background:TIER[selectedLive.tier].bg, color:TIER[selectedLive.tier].color}}>
              {selectedLive.name[0]}
            </div>
            <div>
              <div style={{fontWeight:700, fontSize:18, fontFamily:'var(--font-serif)', display:'flex', alignItems:'center', gap:8}}>
                {selectedLive.name}
                {isBirthdayMonth(selectedLive) && <Cake size={14} color="var(--red)" title={tr("本月生日")}/>}
              </div>
              <div style={{fontSize:12, color:'var(--text-tertiary)', display:'flex', alignItems:'center', gap:4, marginTop:3}}>
                <Phone size={11}/>{selectedLive.phone}
              </div>
              <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:2}}>{tr("加入 ")}{selectedLive.joinDate}
                {selectedLive.birthday && tr(" · 生日 {0}", {0: selectedLive.birthday})}
              </div>
            </div>
            <button ref={detailClose} className="btn-icon" data-member-close aria-label={tr('關閉會員詳情')} style={{marginLeft:'auto',minWidth:48,minHeight:48}} onClick={()=>setSelected(null)}><X size={18}/></button>
          </div>

          <div style={ms.statsGrid} className="member-stats">
            <StatCard label={tr("累積點數")} value={tr('{0} 點',{0:selectedLive.points.toLocaleString(getLocale())})} color="var(--gold-bright)" />
            <StatCard label={tr("累計消費")} value={`NT$ ${selectedLive.totalSpent.toLocaleString()}`} color="var(--blue)" />
            <StatCard label={tr("儲值餘額")} value={`NT$ ${(selectedLive.balance||0).toLocaleString()}`} color="var(--teal)" />
            <StatCard label={tr("歷史訂單")} value={tr('{0} 筆',{0:memberOrders.length.toLocaleString(getLocale())})} color="var(--text-secondary)" />
          </div>

          <div style={{display:'flex', gap:8, marginBottom:16}}>
            <button className="btn btn-primary btn-sm" onClick={()=>setShowTopup(true)} style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6}}>
              <Wallet size={14}/>{tr(" 儲值")}</button>
          </div>

          <div style={ms.sectionTitle}>{tr("消費記錄")}</div>
          <div style={{flex:1, overflowY:'auto'}}>
            {memberOrders.length === 0 ? (
              <div style={{color:'var(--text-tertiary)', fontSize:13, padding:'24px 0', textAlign:'center'}}>{tr("尚無消費記錄")}</div>
            ) : memberOrders.slice(0,20).map(o => {
              const isRefund = o.refundOf
              const isRefunded = o.status === 'refunded'
              return (
                <div key={o.id} style={{...ms.orderRow, opacity: isRefunded ? 0.5 : 1}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:6}}>
                      {isRefund && <span className="badge badge-red">{tr("退貨")}</span>}
                      {isRefunded && <span className="badge badge-amber">{tr("已退")}</span>}
                      <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1}}>
                        {(o.items||[]).map(i=>i.name).join('、').slice(0,28)}
                      </span>
                    </div>
                    <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:2}}>
                      {new Date(o.time).toLocaleString(getLocale(), {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                      {o.pointsEarned>0 && <span style={{color:'var(--gold)', marginLeft:8}}>+{o.pointsEarned}{tr("點")}</span>}
                    </div>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:6}}>
                    <span style={{fontFamily:'var(--font-mono)', fontSize:13, fontWeight:500, color: o.total < 0 ? 'var(--red)' : 'inherit'}}>
                      NT$ {o.total.toLocaleString()}
                    </span>
                    {!isRefund && !isRefunded && session?.role==='owner' && (
                      <button onClick={()=>setRefundOrder(o)} style={{padding:4, color:'var(--text-tertiary)'}} title={tr("退貨")}>
                        <RotateCcw size={13}/>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {refundOrder && (
        <RefundModal order={orders.find(row=>row.id===refundOrder.id)||refundOrder} session={session} products={store.products} retryFinancial={store.retryFinancial} onRecovery={()=>store.setView('recovery')}
          priorRefunds={orders.filter(o => o.refundOf === refundOrder.id)}
          onClose={()=>setRefundOrder(null)}
          onRefund={handleRefund}/>
      )}

      {showTopup && selectedLive && (
        <div style={ms.overlay} onClick={()=>setShowTopup(false)}>
          <div style={ms.drawer} className="animate-scale" onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <span style={{fontWeight:600, fontSize:15, display:'flex', alignItems:'center', gap:8}}>
                <Wallet size={16}/>{tr(" 會員儲值")}</span>
              <button className="btn-icon" onClick={()=>setShowTopup(false)}><X size={16}/></button>
            </div>
            <div style={{padding:'10px 12px', background:'var(--bg-overlay)', borderRadius:8, marginBottom:14, fontSize:13}}>
              {selectedLive.name}{tr(" · 目前餘額 ")}<strong style={{fontFamily:'var(--font-mono)'}}>NT$ {(selectedLive.balance||0).toLocaleString()}</strong>
            </div>
            <FieldLabel>{tr("儲值金額 *")}</FieldLabel>
            <input className="field" type="number" value={topupAmt} onChange={e=>setTopupAmt(e.target.value)} placeholder="1000" autoFocus style={{marginBottom:12}}/>
            <FieldLabel>{tr("贈送金額（選填）")}</FieldLabel>
            <input className="field" type="number" disabled={session?.role!=='owner'} value={topupBonus} onChange={e=>setTopupBonus(e.target.value)} placeholder={session?.role==='owner'?tr("例：儲千送百"):tr("贈額需由老闆設定")} style={{marginBottom:12}}/>
            <FieldLabel>{tr("付款方式")}</FieldLabel>
            <div style={{display:'flex', gap:8, marginBottom:18}}>
              {[['cash','現金'],['card','電子']].map(([k,l]) => (
                <button key={k} onClick={()=>setTopupMethod(k)} style={{
                  flex:1, padding:10, borderRadius:8, fontSize:13,
                  background: topupMethod===k?'var(--gold)':'var(--bg-overlay)',
                  color: topupMethod===k?'#fff':'var(--text-secondary)',
                  border:`1px solid ${topupMethod===k?'var(--gold)':'var(--border-subtle)'}`,
                }}>{tr(l)}</button>
              ))}
            </div>
            {(parseFloat(topupAmt)+parseFloat(topupBonus||0)) > 0 && (
              <div style={{textAlign:'center', padding:12, background:'var(--gold-dim)', borderRadius:8, color:'var(--gold-bright)', marginBottom:14, fontSize:13}}>{tr("會員可使用 NT$ ")}{(parseFloat(topupAmt)+parseFloat(topupBonus||0)).toLocaleString()}
              </div>
            )}
            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-primary" style={{flex:1}} disabled={!topupAmt} onClick={handleTopup}>{tr("確認儲值")}</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setShowTopup(false)}>{tr("取消")}</button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div style={ms.overlay}>
          <div style={{...ms.drawer, maxWidth:340}} className="animate-scale">
            <div style={{textAlign:'center', padding:'8px 0 20px'}}>
              <div style={{fontSize:32, marginBottom:12}}>⚠️</div>
              <div style={{fontWeight:600, marginBottom:6}}>{tr("確認刪除此會員？")}</div>
              <div style={{fontSize:13, color:'var(--text-secondary)'}}>{tr("點數與歷史訂單關聯將一併移除")}</div>
            </div>
            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-danger" style={{flex:1}} onClick={async()=>{if(saving.current)return;saving.current=true;try{await deleteMember(confirmDel);setConfirmDel(null);setSelected(null)}catch(e){alert(trMessage(e.message))}finally{saving.current=false}}}>{tr("確認刪除")}</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setConfirmDel(null)}>{tr("取消")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className="member-stat" style={{background:'var(--bg-overlay)', border:'1px solid var(--border-dim)', borderRadius:10, padding:'12px 14px',minWidth:0,overflowWrap:'anywhere'}}>
      <div style={{fontSize:10, color:'var(--text-tertiary)', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:4}}>{tr(label)}</div>
      <div style={{fontFamily:'var(--font-mono)', fontSize:16, fontWeight:500, color}}>{value}</div>
    </div>
  )
}

function FieldLabel({ children }) {
  return <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:5, letterSpacing:'.03em'}}>{children}</div>
}

const ms = {
  root:{ display:'flex', height:'100%', background:'var(--bg-base)', overflow:'hidden' },
  left:{ flex:1, display:'flex', flexDirection:'column', padding:'16px', gap:14, overflow:'hidden', minWidth:0 },
  header:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexShrink:0 },
  title:{ fontFamily:'var(--font-serif)', fontSize:20, fontWeight:600 },
  toolbar:{ display:'flex', gap:10, flexShrink:0, flexWrap:'wrap' },
  filterBtn:{ padding:'5px 10px', borderRadius:6, fontSize:12, cursor:'pointer', transition:'all 120ms' },
  list:{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:8 },
  memberCard:{
    display:'flex', alignItems:'center', gap:14, padding:'14px 16px',
    borderRadius:'var(--r3)', transition:'all 150ms var(--ease)', textAlign:'left', cursor:'pointer', width:'100%',
  },
  avatar:{ width:40, height:40, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:16, flexShrink:0 },
  avatarLg:{ width:52, height:52, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:22, flexShrink:0 },
  detail:{
    width:320, flexShrink:0, borderLeft:'1px solid var(--border-dim)',
    background:'var(--bg-raised)', display:'flex', flexDirection:'column',
    padding:'20px', gap:14, overflow:'hidden',
  },
  detailHeader:{ display:'flex', gap:14, alignItems:'flex-start', flexShrink:0 },
  statsGrid:{ display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:8, flexShrink:0 },
  sectionTitle:{ fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.08em', textTransform:'uppercase', flexShrink:0 },
  orderRow:{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--border-dim)' },
  overlay:{ position:'fixed', inset:0, background:'rgba(23,37,60,0.30)',backdropFilter:'blur(2px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 },
  drawer:{ background:'var(--bg-raised)', border:'1px solid var(--border-mid)', borderRadius:'var(--r4)', padding:24, width:'90%', maxWidth:420 },
}
