import { useState, useMemo, useRef, useEffect } from 'react'
import { Plus, AlertTriangle, Package } from 'lucide-react'
import { exportXLS } from '../utils/exportXLS'
import { localDate } from '../utils/checkoutSafety.mjs'
import { quantityValue } from '../../electron/operationRules.mjs'
import useVisibleViewport from '../hooks/useVisibleViewport'

const REASONS = ['過期', '破損', '腐壞', '自用', '試吃樣品', '盤虧', '其他']

export default function WastePage({ store, session }) {
  const { products, wasteLog, recordWaste, financialState } = store
  const viewport = useVisibleViewport()
  const busy = useRef(false), active = useRef(false), pendingId = useRef(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState(REASONS[0])
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState(() => localDate().slice(0,7))

  function confirmed(recovered=false) {
    active.current=false;pendingId.current=null
    setShowAdd(false);setProductId('');setQty('');setReason(REASONS[0]);setError('')
    setMessage(recovered?'原編號損耗已確認保存，請勿再次記錄。':'損耗已保存並扣除庫存。')
  }
  useEffect(() => {
    if(!active.current)return
    if(financialState?.kind==='waste'&&financialState.phase!=='idle')pendingId.current=financialState.id
    if(financialState?.phase==='idle'&&pendingId.current){
      if(wasteLog.some(w=>w.id===pendingId.current))confirmed(true)
      else {active.current=false;pendingId.current=null}
    }
  }, [financialState, wasteLog])

  const filtered = useMemo(() => {
    return wasteLog.filter(w => {
      const okMonth = !filterMonth || localDate(new Date(w.time)).startsWith(filterMonth)
      const okSearch = !search || w.productName?.includes(search) || w.reason?.includes(search)
      return okMonth && okSearch
    })
  }, [wasteLog, filterMonth, search])

  const loss = w => Math.round((w.cost || 0) * Math.abs(w.qty) * 100) / 100
  const totalLoss = Math.round(filtered.reduce((s,w) => s + loss(w), 0)*100)/100
  const totalQty = filtered.reduce((s,w) => s + Math.abs(w.qty), 0)

  // 即期商品
  const expiringSoon = useMemo(() => {
    const today0 = Date.parse(localDate()+'T00:00:00Z')
    return products.filter(p => {
      if (!p.expiryDate || !(p.stock > 0)) return false
      const exp = Date.parse(p.expiryDate+'T00:00:00Z')
      const days = Math.floor((exp - today0) / 86400000)
      return days <= 7
    }).map(p => ({
      ...p,
      daysLeft: Math.floor((Date.parse(p.expiryDate+'T00:00:00Z') - today0) / 86400000),
    })).sort((a,b) => a.daysLeft - b.daysLeft)
  }, [products])

  async function saveLoss(p, quantity, cause) {
    if(busy.current)return
    busy.current=true;setSaving(true);setError('');setMessage('')
    try{
      if(!p)throw Error('請選擇損耗商品')
      quantityValue(quantity,'損耗數量',.001)
      if(quantity>p.stock)throw Error('損耗數量超過目前可用庫存，請先核對')
      active.current=true
      const result=await recordWaste({productId:p.id,productName:p.name,qty:quantity,cost:p.cost||0,reason:cause,cashier:session?.username||''})
      if(typeof result?.id!=='string'||!result.id)throw Error('損耗保存回覆不完整，請核對原編號')
      confirmed()
    }catch(e){setError(e.message||'損耗保存尚未確認，請保留內容並核對原編號')}
    finally{busy.current=false;setSaving(false)}
  }
  async function handleAdd() {
    await saveLoss(products.find(x=>x.id===productId),Number(qty),reason)
  }

  async function handleQuickAdd(p) {
    if (busy.current || !confirm(`記錄「${p.name}」1 個庫存單位過期？`)) return
    await saveLoss(p,1,'過期')
  }

  function exportExcel() {
    const rows = [['日期','時間','商品','數量','成本','損失','原因','記錄者']]
    filtered.forEach(w => {
      const t = new Date(w.time)
      rows.push([
        t.toLocaleDateString('zh-TW'),
        t.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}),
        w.productName,
        Math.abs(w.qty),
        w.cost || 0,
        loss(w),
        w.reason,
        w.cashier || '',
      ])
    })
    rows.push(['','','合計', totalQty, '', totalLoss, '', ''])
    exportXLS(rows, `損耗紀錄_${filterMonth}.xls`)
  }

  return (
    <div style={ws.root}>
      {!showAdd&&error&&<p role="alert" style={{color:'var(--red)',marginBottom:12}}>{error}</p>}
      {message&&<p role="status" style={{marginBottom:12}}>{message}</p>}
      <div style={ws.header}>
        <div>
          <h2 style={{fontSize:20, fontWeight:600}}>損耗管理</h2>
          <div style={{fontSize:13, color:'var(--text-tertiary)', marginTop:4}}>
            記錄過期、破損、自用等庫存損耗
          </div>
        </div>
        <button disabled={saving} className="btn btn-primary" onClick={()=>{setError('');setMessage('');setShowAdd(true)}} style={{display:'flex',alignItems:'center',gap:6}}>
          <Plus size={16}/> 新增損耗
        </button>
      </div>

      {expiringSoon.length > 0 && (
        <div style={ws.card}>
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:12}}>
            <AlertTriangle size={16} color="var(--amber)"/>
            <span style={{fontWeight:600}}>近 7 天到期 ({expiringSoon.length})</span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:8}}>
            {expiringSoon.map(p => (
              <div key={p.id} style={{
                padding:'10px 12px', borderRadius:8,
                background: p.daysLeft <= 0 ? 'var(--red-dim)' : p.daysLeft <= 3 ? 'var(--amber-dim)' : 'var(--bg-overlay)',
                border:`1px solid ${p.daysLeft <= 0 ? 'rgba(217,79,68,0.22)' : 'transparent'}`,
              }}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4}}>
                  <div style={{fontSize:13, fontWeight:500, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</div>
                  <button disabled={saving} onClick={()=>handleQuickAdd(p)} style={{padding:8,minWidth:44,minHeight:44,fontSize:12,color:'var(--red)',background:'none',border:'1px solid var(--red)',borderRadius:4}}>報廢</button>
                </div>
                <div style={{fontSize:11, color:'var(--text-secondary)'}}>
                  庫存 {p.stock} · 到期 {p.expiryDate}
                </div>
                <div style={{fontSize:11, color: p.daysLeft <= 0 ? 'var(--red)' : 'var(--amber)', fontWeight:600, marginTop:2}}>
                  {p.daysLeft <= 0 ? `已過期 ${-p.daysLeft} 天` : `剩 ${p.daysLeft} 天`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={ws.card}>
        <div style={{display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
          <input className="field" type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{width:160}}/>
          <input className="field" placeholder="搜尋商品/原因" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1, minWidth:200}}/>
          <button className="btn btn-ghost btn-sm" onClick={exportExcel}>匯出 Excel</button>
        </div>

        <div style={{display:'flex', gap:12, marginBottom:14}}>
          <div style={ws.statBox}>
            <div style={{fontSize:11, color:'var(--text-tertiary)'}}>合計筆數</div>
            <div style={{fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)'}}>{filtered.length}</div>
          </div>
          <div style={ws.statBox}>
            <div style={{fontSize:11, color:'var(--text-tertiary)'}}>合計件數</div>
            <div style={{fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)'}}>{totalQty}</div>
          </div>
          <div style={ws.statBox}>
            <div style={{fontSize:11, color:'var(--text-tertiary)'}}>合計損失</div>
            <div style={{fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)', color:'var(--red)'}}>NT$ {totalLoss.toLocaleString()}</div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{textAlign:'center', color:'var(--text-tertiary)', padding:'40px 0', fontSize:13}}>
            <Package size={32} color="var(--text-tertiary)" style={{margin:'0 auto 12px', opacity:0.5}}/>
            <div>無損耗紀錄</div>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}><table style={{width:'100%',minWidth:650,fontSize:13,borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <th style={ws.th}>時間</th>
                <th style={ws.th}>商品</th>
                <th style={{...ws.th, textAlign:'right'}}>數量</th>
                <th style={{...ws.th, textAlign:'right'}}>單位成本</th>
                <th style={{...ws.th, textAlign:'right'}}>損失</th>
                <th style={ws.th}>原因</th>
                <th style={ws.th}>記錄者</th>
                <th style={ws.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(w => (
                <tr key={w.id} style={{borderBottom:'1px solid var(--border-dim)'}}>
                  <td style={ws.td}>{new Date(w.time).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                  <td style={ws.td}>{w.productName}</td>
                  <td style={{...ws.td, textAlign:'right', fontFamily:'var(--font-mono)'}}>{Math.abs(w.qty)}</td>
                  <td style={{...ws.td, textAlign:'right', fontFamily:'var(--font-mono)', color:'var(--text-secondary)'}}>{(w.cost||0).toLocaleString()}</td>
                  <td style={{...ws.td, textAlign:'right', fontFamily:'var(--font-mono)', color:'var(--red)', fontWeight:500}}>{loss(w).toLocaleString()}</td>
                  <td style={ws.td}><span className="badge badge-amber">{w.reason}</span></td>
                  <td style={ws.td}>{w.cashier}</td>
                  <td style={ws.td}>
                    <span style={{fontSize:11,color:'var(--text-tertiary)'}}>已入帳，保留紀錄</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {showAdd && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(23,37,60,0.40)',zIndex:998}} onClick={()=>!saving&&setShowAdd(false)}/>
          <div role="dialog" aria-modal="true" aria-labelledby="waste-dialog-title" style={{position:'fixed',top:viewport.top+viewport.height/2,left:'50%',transform:'translate(-50%,-50%)',background:'var(--bg-raised)',borderRadius:12,width:420,maxWidth:'90vw',maxHeight:viewport.height*.9,overflowY:'auto',boxShadow:'var(--shadow-lg)',zIndex:999}}>
            <div style={{padding:'10px 18px',borderBottom:'1px solid var(--border-dim)',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:15,fontWeight:600}}><span id="waste-dialog-title">記錄損耗</span><button aria-label="關閉損耗表單" disabled={saving} onClick={()=>setShowAdd(false)} style={{minWidth:44,minHeight:44}}>✕</button></div>
            <div style={{padding:18}}>
              {error&&<p role="alert" style={{color:'var(--red)',marginBottom:12}}>{error}</p>}
              <div style={{marginBottom:10}}>
                <label htmlFor="waste-product" style={{fontSize:12,color:'var(--text-tertiary)'}}>商品</label>
                <select id="waste-product" disabled={saving} className="field" style={{fontSize:16,minHeight:44}} value={productId} onChange={e=>setProductId(e.target.value)} autoFocus>
                  <option value="">— 請選擇 —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (庫存 {p.stock})</option>)}
                </select>
              </div>
              <div style={{marginBottom:10}}>
                <label htmlFor="waste-quantity" style={{fontSize:12,color:'var(--text-tertiary)'}}>數量（與庫存相同單位，最多三位小數）</label>
                <input id="waste-quantity" disabled={saving} className="field" style={{fontSize:16,minHeight:44}} type="number" inputMode="decimal" min="0.001" step="0.001" value={qty} onChange={e=>setQty(e.target.value)} placeholder="0"/>
              </div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:4}}>原因</div>
                <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:6}}>
                  {REASONS.map(r => (
                    <button disabled={saving} key={r} onClick={()=>setReason(r)} style={{
                      padding:'8px 4px',minHeight:44,fontSize:12,borderRadius:6,
                      background: reason===r?'var(--gold)':'var(--bg-overlay)',
                      color: reason===r?'#fff':'var(--text-secondary)',
                      border:`1px solid ${reason===r?'var(--gold)':'var(--border-subtle)'}`,
                    }}>{r}</button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" style={{width:'100%',padding:12,minHeight:44,marginTop:8}} disabled={saving||!productId||qty===''} onClick={handleAdd}>{saving?'保存中…':'記錄'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const ws = {
  root: { flex:1, overflowY:'auto', padding:'20px 24px', background:'var(--bg-base)' },
  header: { display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,flexWrap:'wrap',gap:12 },
  card: {
    background:'var(--bg-raised)', border:'1px solid var(--border-dim)',
    borderRadius:12, padding:'18px 20px', boxShadow:'var(--shadow-sm)',
    marginBottom:12,
  },
  statBox: {
    flex:1, padding:'12px 14px', background:'var(--bg-overlay)', borderRadius:8,
  },
  th: { padding:'8px 10px', textAlign:'left', fontSize:11, color:'var(--text-tertiary)', fontWeight:500, borderBottom:'1px solid var(--border-dim)' },
  td: { padding:'10px', verticalAlign:'middle' },
}
