import { useState, useMemo } from 'react'
import { Plus, Pencil, Trash2, X, Check, Gift, TrendingUp, Phone, Wallet, RotateCcw, Cake } from 'lucide-react'
import RefundModal from '../components/RefundModal'
import { computeMemberRFM } from '../utils/analytics'

const TIER = {
  normal: { label:'一般', color:'var(--text-secondary)', bg:'var(--bg-active)', min:0,     max:10000 },
  silver: { label:'銀卡', color:'#aab8cc',               bg:'rgba(170,184,204,0.12)', min:10000, max:30000 },
  gold:   { label:'金卡', color:'var(--gold-bright)',    bg:'var(--gold-dim)',     min:30000, max:Infinity },
}
const EMPTY_FORM = { name:'', phone:'', note:'', birthday:'' }

export default function MembersPage({ store, session }) {
  const { members, addMember, updateMember, deleteMember, orders, products, topupMember, refund } = store
  const [editing,    setEditing]    = useState(null)
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [search,     setSearch]     = useState('')
  const [filterTier, setFilterTier] = useState('all')
  const [selected,   setSelected]   = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [showTopup,  setShowTopup]  = useState(false)
  const [topupAmt,   setTopupAmt]   = useState('')
  const [topupBonus, setTopupBonus] = useState('')
  const [topupMethod,setTopupMethod] = useState('cash')
  const [refundOrder,setRefundOrder] = useState(null)

  // 重新從 list 取最新資料（避免顯示過期）
  const selectedLive = selected ? members.find(m => m.id === selected.id) || selected : null

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

  function startNew()  { setEditing('new');  setForm(EMPTY_FORM) }
  function startEdit(m){ setEditing(m.id);   setForm({name:m.name, phone:m.phone, note:m.note||'', birthday:m.birthday||''}) }

  function save() {
    if (!form.name || !form.phone) return
    if (editing === 'new') addMember(form)
    else updateMember(editing, form)
    setEditing(null)
  }

  async function handleTopup() {
    if (!selectedLive) return
    const amt = parseFloat(topupAmt) || 0
    const bonus = parseFloat(topupBonus) || 0
    if (amt <= 0) return
    await topupMember(selectedLive.id, amt, bonus, topupMethod, session?.username || '')
    setShowTopup(false); setTopupAmt(''); setTopupBonus(''); setTopupMethod('cash')
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
    <div style={ms.root}>
      <div style={ms.left}>
        <div style={ms.header}>
          <div>
            <h2 style={ms.title}>會員管理</h2>
            <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
              {members.length} 位會員
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={startNew}>
            <Plus size={15}/>新增會員
          </button>
        </div>

        <div style={ms.toolbar}>
          <input className="field" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋姓名或手機..." style={{flex:1, maxWidth:240, padding:'8px 12px'}}/>
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
              }}>{l}</button>
            ))}
          </div>
        </div>

        {/* Member list */}
        <div style={ms.list}>
          {filtered.map(m => {
            const t   = TIER[m.tier]
            const pct = tierProgress(m)
            const active = selected?.id === m.id
            const rfm = rfmMap.get(m.id)
            return (
              <button key={m.id} onClick={()=>setSelected(active?null:m)} style={{
                ...ms.memberCard,
                background: active ? 'var(--bg-active)' : 'var(--bg-raised)',
                border: `1px solid ${active ? 'var(--border-mid)' : 'var(--border-dim)'}`,
              }}>
                <div style={{...ms.avatar, background:t.bg, color:t.color}}>
                  {m.name[0]}
                </div>
                <div style={{flex:1, minWidth:0, textAlign:'left'}}>
                  <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2, flexWrap:'wrap'}}>
                    <span style={{fontWeight:600, fontSize:14}}>{m.name}</span>
                    <span style={{fontSize:10, padding:'1px 7px', borderRadius:20, background:t.bg, color:t.color, fontWeight:500}}>
                      {t.label}
                    </span>
                    {rfm && (
                      <span style={{fontSize:10, padding:'1px 7px', borderRadius:20, background:'var(--bg-overlay)', color:rfm.tagColor, fontWeight:600, border:`1px solid ${rfm.tagColor}`}}>
                        {rfm.tag}
                      </span>
                    )}
                  </div>
                  <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:6, fontFamily:'var(--font-mono)'}}>
                    {m.phone}
                  </div>
                  <div style={{display:'flex', gap:14, flexWrap:'wrap'}}>
                    <span style={{fontSize:11, color:'var(--text-secondary)'}}>
                      <Gift size={10} style={{marginRight:3, verticalAlign:'middle'}}/>
                      {m.points.toLocaleString()} 點
                    </span>
                    <span style={{fontSize:11, color:'var(--text-secondary)'}}>
                      累消 NT$ {m.totalSpent.toLocaleString()}
                    </span>
                    {rfm && rfm.frequency > 0 && (
                      <span style={{fontSize:11, color:'var(--text-tertiary)'}}>
                        · {rfm.recencyDays === 0 ? '今天' : `${rfm.recencyDays} 天前`} · {rfm.frequency} 次
                      </span>
                    )}
                  </div>
                  {m.tier !== 'gold' && (
                    <div style={{marginTop:8}}>
                      <div style={{display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-tertiary)', marginBottom:3}}>
                        <span>升級{m.tier==='normal'?'銀卡':'金卡'}進度</span>
                        <span className="mono">{Math.round(pct)}%</span>
                      </div>
                      <div style={{height:3, background:'var(--border-dim)', borderRadius:2}}>
                        <div style={{height:'100%', width:`${pct}%`, background:t.color, borderRadius:2, transition:'width .5s'}}/>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{display:'flex', flexDirection:'column', gap:4}}>
                  <button className="btn-icon btn-sm" onClick={e=>{e.stopPropagation();startEdit(m)}}><Pencil size={13}/></button>
                  <button className="btn-icon btn-sm" style={{color:'var(--red)'}} onClick={e=>{e.stopPropagation();setConfirmDel(m.id)}}><Trash2 size={13}/></button>
                </div>
              </button>
            )
          })}
          {filtered.length===0 && (
            <div style={{textAlign:'center', padding:'48px', color:'var(--text-tertiary)', fontSize:13}}>沒有符合的會員</div>
          )}
        </div>
      </div>

      {/* Member detail panel */}
      {selectedLive && (
        <div style={ms.detail} className="animate-in">
          <div style={ms.detailHeader}>
            <div style={{...ms.avatarLg, background:TIER[selectedLive.tier].bg, color:TIER[selectedLive.tier].color}}>
              {selectedLive.name[0]}
            </div>
            <div>
              <div style={{fontWeight:700, fontSize:18, fontFamily:'var(--font-serif)', display:'flex', alignItems:'center', gap:8}}>
                {selectedLive.name}
                {isBirthdayMonth(selectedLive) && <Cake size={14} color="var(--red)" title="本月生日"/>}
              </div>
              <div style={{fontSize:12, color:'var(--text-tertiary)', display:'flex', alignItems:'center', gap:4, marginTop:3}}>
                <Phone size={11}/>{selectedLive.phone}
              </div>
              <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:2}}>
                加入 {selectedLive.joinDate}
                {selectedLive.birthday && ` · 生日 ${selectedLive.birthday}`}
              </div>
            </div>
            <button className="btn-icon" style={{marginLeft:'auto'}} onClick={()=>setSelected(null)}><X size={16}/></button>
          </div>

          <div style={ms.statsGrid}>
            <StatCard label="累積點數" value={`${selectedLive.points.toLocaleString()} 點`} color="var(--gold-bright)" />
            <StatCard label="累計消費" value={`NT$ ${selectedLive.totalSpent.toLocaleString()}`} color="var(--blue)" />
            <StatCard label="儲值餘額" value={`NT$ ${(selectedLive.balance||0).toLocaleString()}`} color="var(--teal)" />
            <StatCard label="歷史訂單" value={`${memberOrders.length} 筆`} color="var(--text-secondary)" />
          </div>

          <div style={{display:'flex', gap:8, marginBottom:16}}>
            <button className="btn btn-primary btn-sm" onClick={()=>setShowTopup(true)} style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6}}>
              <Wallet size={14}/> 儲值
            </button>
          </div>

          <div style={ms.sectionTitle}>消費記錄</div>
          <div style={{flex:1, overflowY:'auto'}}>
            {memberOrders.length === 0 ? (
              <div style={{color:'var(--text-tertiary)', fontSize:13, padding:'24px 0', textAlign:'center'}}>尚無消費記錄</div>
            ) : memberOrders.slice(0,20).map(o => {
              const isRefund = o.refundOf
              const isRefunded = o.status === 'refunded'
              return (
                <div key={o.id} style={{...ms.orderRow, opacity: isRefunded ? 0.5 : 1}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:6}}>
                      {isRefund && <span className="badge badge-red">退貨</span>}
                      {isRefunded && <span className="badge badge-amber">已退</span>}
                      <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1}}>
                        {(o.items||[]).map(i=>i.name).join('、').slice(0,28)}
                      </span>
                    </div>
                    <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:2}}>
                      {new Date(o.time).toLocaleString('zh-TW', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                      {o.pointsEarned>0 && <span style={{color:'var(--gold)', marginLeft:8}}>+{o.pointsEarned}點</span>}
                    </div>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:6}}>
                    <span style={{fontFamily:'var(--font-mono)', fontSize:13, fontWeight:500, color: o.total < 0 ? 'var(--red)' : 'inherit'}}>
                      NT$ {o.total.toLocaleString()}
                    </span>
                    {!isRefund && !isRefunded && (
                      <button onClick={()=>setRefundOrder(o)} style={{padding:4, color:'var(--text-tertiary)'}} title="退貨">
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
        <RefundModal order={refundOrder} session={session}
          priorRefunds={orders.filter(o => o.refundOf === refundOrder.id)}
          onClose={()=>setRefundOrder(null)}
          onRefund={handleRefund}/>
      )}

      {showTopup && selectedLive && (
        <div style={ms.overlay} onClick={()=>setShowTopup(false)}>
          <div style={ms.drawer} className="animate-scale" onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <span style={{fontWeight:600, fontSize:15, display:'flex', alignItems:'center', gap:8}}>
                <Wallet size={16}/> 會員儲值
              </span>
              <button className="btn-icon" onClick={()=>setShowTopup(false)}><X size={16}/></button>
            </div>
            <div style={{padding:'10px 12px', background:'var(--bg-overlay)', borderRadius:8, marginBottom:14, fontSize:13}}>
              {selectedLive.name} · 目前餘額 <strong style={{fontFamily:'var(--font-mono)'}}>NT$ {(selectedLive.balance||0).toLocaleString()}</strong>
            </div>
            <FieldLabel>儲值金額 *</FieldLabel>
            <input className="field" type="number" value={topupAmt} onChange={e=>setTopupAmt(e.target.value)} placeholder="1000" autoFocus style={{marginBottom:12}}/>
            <FieldLabel>贈送金額（選填）</FieldLabel>
            <input className="field" type="number" value={topupBonus} onChange={e=>setTopupBonus(e.target.value)} placeholder="例：儲千送百" style={{marginBottom:12}}/>
            <FieldLabel>付款方式</FieldLabel>
            <div style={{display:'flex', gap:8, marginBottom:18}}>
              {[['cash','現金'],['card','電子']].map(([k,l]) => (
                <button key={k} onClick={()=>setTopupMethod(k)} style={{
                  flex:1, padding:10, borderRadius:8, fontSize:13,
                  background: topupMethod===k?'var(--gold)':'var(--bg-overlay)',
                  color: topupMethod===k?'#fff':'var(--text-secondary)',
                  border:`1px solid ${topupMethod===k?'var(--gold)':'var(--border-subtle)'}`,
                }}>{l}</button>
              ))}
            </div>
            {(parseFloat(topupAmt)+parseFloat(topupBonus||0)) > 0 && (
              <div style={{textAlign:'center', padding:12, background:'var(--gold-dim)', borderRadius:8, color:'var(--gold-bright)', marginBottom:14, fontSize:13}}>
                會員可使用 NT$ {(parseFloat(topupAmt)+parseFloat(topupBonus||0)).toLocaleString()}
              </div>
            )}
            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-primary" style={{flex:1}} disabled={!topupAmt} onClick={handleTopup}>確認儲值</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setShowTopup(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit drawer */}
      {editing && (
        <div style={ms.overlay}>
          <div style={ms.drawer} className="animate-scale">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
              <span style={{fontWeight:600, fontSize:15}}>{editing==='new'?'新增會員':'編輯會員'}</span>
              <button className="btn-icon" onClick={()=>setEditing(null)}><X size={16}/></button>
            </div>
            <FieldLabel>姓名 *</FieldLabel>
            <input className="field" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="陳小明" style={{marginBottom:12}}/>
            <FieldLabel>手機號碼 *</FieldLabel>
            <input className="field" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="0912-345-678" style={{marginBottom:12, fontFamily:'var(--font-mono)'}}/>
            <FieldLabel>生日（選填）</FieldLabel>
            <input className="field" type="date" value={form.birthday || ''} onChange={e=>setForm(f=>({...f,birthday:e.target.value}))} style={{marginBottom:12}}/>
            <FieldLabel>備註</FieldLabel>
            <input className="field" value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))} placeholder="（選填）" style={{marginBottom:20}}/>
            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={save}><Check size={15}/>儲存</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setEditing(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div style={ms.overlay}>
          <div style={{...ms.drawer, maxWidth:340}} className="animate-scale">
            <div style={{textAlign:'center', padding:'8px 0 20px'}}>
              <div style={{fontSize:32, marginBottom:12}}>⚠️</div>
              <div style={{fontWeight:600, marginBottom:6}}>確認刪除此會員？</div>
              <div style={{fontSize:13, color:'var(--text-secondary)'}}>點數與歷史訂單關聯將一併移除</div>
            </div>
            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-danger" style={{flex:1}} onClick={()=>{deleteMember(confirmDel);setConfirmDel(null);setSelected(null)}}>確認刪除</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setConfirmDel(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div style={{background:'var(--bg-overlay)', border:'1px solid var(--border-dim)', borderRadius:10, padding:'12px 14px'}}>
      <div style={{fontSize:10, color:'var(--text-tertiary)', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:4}}>{label}</div>
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
  statsGrid:{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, flexShrink:0 },
  sectionTitle:{ fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.08em', textTransform:'uppercase', flexShrink:0 },
  orderRow:{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--border-dim)' },
  overlay:{ position:'fixed', inset:0, background:'rgba(44,42,38,0.25)',backdropFilter:'blur(2px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 },
  drawer:{ background:'var(--bg-raised)', border:'1px solid var(--border-mid)', borderRadius:'var(--r4)', padding:24, width:'90%', maxWidth:420 },
}
