import { useState, useEffect } from 'react'
import { Plus, X, Check, Tag, Clock, Percent, Gift } from 'lucide-react'
import { writeAuditLog, sanitizeObject } from '../utils/security'
import { isElectron, loadPromotions, savePromotions as dbSavePromotions } from '../utils/dataAccess'

export const PROMO_TYPES = {
  threshold:  { label:'滿額折扣',    icon:'💰', desc:'消費滿 X 元折 Y 元' },
  percent:    { label:'全館折扣',    icon:'%',  desc:'所有商品打 X 折' },
  buyget:     { label:'買X送Y',     icon:'🎁', desc:'買 X 件送 Y 件' },
  fixed:      { label:'指定品折扣',  icon:'🏷', desc:'特定商品減 X 元' },
}

// Apply all active promotions to cart, return discount amount + descriptions
export function applyPromotions(cart, promotions, subtotal) {
  const now    = new Date().toISOString()
  const active = promotions.filter(p => p.enabled && p.startAt <= now && p.endAt >= now)
  let   totalDiscount = 0
  const applied = []

  for (const promo of active) {
    if (promo.type === 'threshold' && subtotal >= promo.condition.threshold) {
      const d = promo.condition.discount
      totalDiscount += d
      applied.push({ id:promo.id, label:`${promo.name}：折 NT$${d}`, discount:d })
    }
    if (promo.type === 'percent') {
      const d = Math.round(subtotal * (1 - promo.condition.rate) * 100) / 100
      totalDiscount += d
      applied.push({ id:promo.id, label:`${promo.name}：${Math.round(promo.condition.rate*10)}折 (-NT$${d})`, discount:d })
    }
    if (promo.type === 'buyget') {
      const totalQty = cart.reduce((s,i)=>s+i.qty,0)
      const sets     = Math.floor(totalQty / promo.condition.buy)
      if (sets > 0) {
        // Find cheapest items for free
        const sorted  = [...cart].flatMap(i=>Array(i.qty).fill(i.price)).sort((a,b)=>a-b)
        const freeQty = Math.min(sets * promo.condition.get, sorted.length)
        const d       = sorted.slice(0, freeQty).reduce((s,v)=>s+v, 0)
        totalDiscount += d
        applied.push({ id:promo.id, label:`${promo.name}：送 ${freeQty} 件 (-NT$${d})`, discount:d })
      }
    }
    if (promo.type === 'fixed') {
      const match = cart.filter(i => promo.condition.productIds?.includes(i.id))
      if (match.length > 0) {
        const d = match.reduce((s,i)=>s+Math.min(promo.condition.discount,i.price)*i.qty,0)
        totalDiscount += d
        applied.push({ id:promo.id, label:`${promo.name}：指定品折 NT$${promo.condition.discount}`, discount:d })
      }
    }
  }

  return { totalDiscount: Math.min(totalDiscount, subtotal), applied }
}

const SEED_PROMOTIONS = [
  {
    id:'pr001', name:'滿500折50', type:'threshold', enabled:true,
    startAt:'2025-01-01T00:00:00', endAt:'2025-12-31T23:59:59',
    condition:{ threshold:500, discount:50 },
    note:'全館適用',
  },
  {
    id:'pr002', name:'週末九折', type:'percent', enabled:false,
    startAt:'2025-03-01T00:00:00', endAt:'2025-03-31T23:59:59',
    condition:{ rate:0.9 },
    note:'',
  },
  {
    id:'pr003', name:'買三送一', type:'buyget', enabled:true,
    startAt:'2025-01-01T00:00:00', endAt:'2025-06-30T23:59:59',
    condition:{ buy:3, get:1 },
    note:'最低價商品免費',
  },
]

export default function PromotionsPage({ store, session }) {
  const [promotions, setPromotions] = useState([])
  const [editing,  setEditing]  = useState(null)
  const [form,     setForm]     = useState(null)

  useEffect(() => { loadPromotions(SEED_PROMOTIONS).then(setPromotions) }, [])

  function save(ps) {
    setPromotions(ps)
    if (!isElectron) localStorage.setItem('pos_promotions', JSON.stringify(ps))
  }

  function toggle(id) {
    save(promotions.map(p => p.id===id ? {...p, enabled:!p.enabled} : p))
  }

  function startNew(type) {
    const defaults = {
      threshold: { threshold:500, discount:50 },
      percent:   { rate:0.9 },
      buyget:    { buy:3, get:1 },
      fixed:     { productIds:[], discount:30 },
    }
    setEditing('new')
    setForm({
      name:'', type, enabled:true, note:'',
      startAt: new Date().toISOString().slice(0,16),
      endAt:   new Date(Date.now()+30*864e5).toISOString().slice(0,16),
      condition: defaults[type],
    })
  }

  function startEdit(p) {
    setEditing(p.id)
    setForm({...p, startAt:p.startAt.slice(0,16), endAt:p.endAt.slice(0,16)})
  }

  function saveForm() {
    if (!form.name) return
    const clean = { ...sanitizeObject(form), startAt:form.startAt+':00', endAt:form.endAt+':00' }
    if (editing==='new') {
      const n = { ...clean, id:'pr'+Date.now() }
      save([...promotions, n])
      writeAuditLog('PROMO_CREATE', session, { promoName:n.name, type:n.type })
    } else {
      save(promotions.map(p=>p.id===editing?clean:p))
    }
    setEditing(null); setForm(null)
  }

  const now    = new Date().toISOString()
  const active = promotions.filter(p=>p.enabled && p.startAt<=now && p.endAt>=now)

  return (
    <div style={pm.root}>
      <div style={pm.header}>
        <div>
          <h2 style={pm.title}>促銷活動</h2>
          <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
            {active.length} 個活動進行中 · 共 {promotions.length} 個
          </div>
        </div>
      </div>

      {/* Quick add */}
      <div style={{display:'flex', gap:8, flexWrap:'wrap', flexShrink:0}}>
        {Object.entries(PROMO_TYPES).map(([type,info])=>(
          <button key={type} className="btn btn-ghost btn-sm" onClick={()=>startNew(type)} style={{gap:6}}>
            <span>{info.icon}</span>{info.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:10}}>
        {promotions.length===0 && (
          <div style={{textAlign:'center', padding:'48px', color:'var(--text-tertiary)', fontSize:13}}>尚未建立任何促銷活動</div>
        )}
        {promotions.map(p => {
          const isActive = p.enabled && p.startAt<=now && p.endAt>=now
          const isExpired = p.endAt < now
          const info = PROMO_TYPES[p.type]
          return (
            <div key={p.id} className="card" style={{padding:'14px 16px', borderLeft:`3px solid ${isActive?'var(--gold)':isExpired?'var(--border-dim)':'var(--border-subtle)'}`, opacity:isExpired?0.5:1}}>
              <div style={{display:'flex', alignItems:'center', gap:12}}>
                <div style={{fontSize:22, flexShrink:0}}>{info.icon}</div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
                    <span style={{fontWeight:600, fontSize:14}}>{p.name}</span>
                    <span style={{fontSize:10, padding:'1px 8px', borderRadius:20, background:isActive?'var(--gold-dim)':isExpired?'var(--bg-active)':'var(--border-dim)', color:isActive?'var(--gold-bright)':'var(--text-tertiary)'}}>
                      {isActive?'進行中':isExpired?'已結束':'未啟用'}
                    </span>
                    <span style={{fontSize:10, color:'var(--text-tertiary)'}}>{info.label}</span>
                  </div>
                  <div style={{fontSize:12, color:'var(--text-secondary)'}}>
                    {describeCondition(p)}
                  </div>
                  <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:3, fontFamily:'var(--font-mono)'}}>
                    {p.startAt.slice(0,10)} ~ {p.endAt.slice(0,10)}
                  </div>
                </div>
                <div style={{display:'flex', gap:6, alignItems:'center', flexShrink:0}}>
                  {/* Toggle */}
                  <button
                    onClick={()=>toggle(p.id)}
                    style={{
                      width:44, height:24, borderRadius:12, position:'relative', cursor:'pointer',
                      background:p.enabled?'var(--gold)':'var(--border-mid)', transition:'background 200ms',
                      border:'none',
                    }}
                  >
                    <span style={{
                      position:'absolute', top:3, left:p.enabled?22:3,
                      width:18, height:18, borderRadius:'50%', background:'#fff',
                      transition:'left 200ms', display:'block',
                    }}/>
                  </button>
                  <button className="btn-icon btn-sm" onClick={()=>startEdit(p)}>✏️</button>
                  <button className="btn-icon btn-sm" style={{color:'var(--red)'}} onClick={()=>save(promotions.filter(x=>x.id!==p.id))}>
                    <X size={14}/>
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Edit modal */}
      {editing && form && (
        <div style={pm.overlay}>
          <div style={pm.modal} className="animate-scale">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18}}>
              <span style={{fontWeight:700, fontSize:15}}>{editing==='new'?`新增${PROMO_TYPES[form.type].label}`:'編輯促銷'}</span>
              <button className="btn-icon" onClick={()=>{setEditing(null);setForm(null)}}><X size={16}/></button>
            </div>

            <FL>活動名稱 *</FL>
            <input className="field" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="例：週末特賣" style={{marginBottom:14}}/>

            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14}}>
              <div><FL>開始時間</FL><input type="datetime-local" className="field" value={form.startAt} onChange={e=>setForm(f=>({...f,startAt:e.target.value}))}/></div>
              <div><FL>結束時間</FL><input type="datetime-local" className="field" value={form.endAt}   onChange={e=>setForm(f=>({...f,endAt:e.target.value}))}/></div>
            </div>

            {/* Condition fields by type */}
            <div style={{background:'var(--bg-overlay)', borderRadius:10, padding:'14px', marginBottom:14}}>
              <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:10}}>折扣條件</div>
              {form.type === 'threshold' && (
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
                  <div><FL>滿額（NT$）</FL><input type="number" className="field" value={form.condition.threshold} onChange={e=>setForm(f=>({...f,condition:{...f.condition,threshold:parseFloat(e.target.value)||0}}))} style={{fontFamily:'var(--font-mono)'}}/></div>
                  <div><FL>折抵（NT$）</FL><input type="number" className="field" value={form.condition.discount} onChange={e=>setForm(f=>({...f,condition:{...f.condition,discount:parseFloat(e.target.value)||0}}))} style={{fontFamily:'var(--font-mono)'}}/></div>
                </div>
              )}
              {form.type === 'percent' && (
                <div><FL>折扣率（0.9 = 九折）</FL><input type="number" min={0.1} max={1} step={0.05} className="field" value={form.condition.rate} onChange={e=>setForm(f=>({...f,condition:{...f.condition,rate:parseFloat(e.target.value)||0.9}}))} style={{fontFamily:'var(--font-mono)'}}/></div>
              )}
              {form.type === 'buyget' && (
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
                  <div><FL>買幾件</FL><input type="number" className="field" value={form.condition.buy} onChange={e=>setForm(f=>({...f,condition:{...f.condition,buy:parseInt(e.target.value)||2}}))} style={{fontFamily:'var(--font-mono)'}}/></div>
                  <div><FL>送幾件</FL><input type="number" className="field" value={form.condition.get} onChange={e=>setForm(f=>({...f,condition:{...f.condition,get:parseInt(e.target.value)||1}}))} style={{fontFamily:'var(--font-mono)'}}/></div>
                </div>
              )}
              {form.type === 'fixed' && (
                <div><FL>折抵金額（NT$）</FL><input type="number" className="field" value={form.condition.discount} onChange={e=>setForm(f=>({...f,condition:{...f.condition,discount:parseFloat(e.target.value)||0}}))} style={{fontFamily:'var(--font-mono)'}}/></div>
              )}
            </div>

            <FL>備註</FL>
            <input className="field" value={form.note||''} onChange={e=>setForm(f=>({...f,note:e.target.value}))} placeholder="（選填）" style={{marginBottom:16}}/>

            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={saveForm}><Check size={15}/>儲存</button>
              <button className="btn btn-ghost"   style={{flex:1}} onClick={()=>{setEditing(null);setForm(null)}}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function describeCondition(p) {
  if (p.type==='threshold') return `消費滿 NT$${p.condition.threshold} 折抵 NT$${p.condition.discount}`
  if (p.type==='percent')   return `全館 ${Math.round(p.condition.rate*10)} 折（${Math.round((1-p.condition.rate)*100)}% off）`
  if (p.type==='buyget')    return `買 ${p.condition.buy} 件送 ${p.condition.get} 件（最低價商品免費）`
  if (p.type==='fixed')     return `指定商品每件折 NT$${p.condition.discount}`
  return ''
}

function FL({children}){return <div style={{fontSize:11,color:'var(--text-tertiary)',marginBottom:5,letterSpacing:'.03em'}}>{children}</div>}

const pm = {
  root:{display:'flex',flexDirection:'column',height:'100%',padding:'16px',gap:14,overflow:'hidden'},
  header:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexShrink:0,flexWrap:'wrap',gap:10},
  title:{fontFamily:'var(--font-serif)',fontSize:20,fontWeight:600},
  overlay:{position:'fixed',inset:0,background:'rgba(44,42,38,0.25)',backdropFilter:'blur(2px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200},
  modal:{background:'var(--bg-raised)',border:'1px solid var(--border-dim)',borderRadius:'var(--r4)',padding:24,width:'90%',maxWidth:480},
}
