import { useState, useEffect } from 'react'
import { Clock, Plus, Minus, LogIn, LogOut, FileText, AlertCircle } from 'lucide-react'
import { loadShifts, loadCashLog } from '../utils/dataAccess'

export default function ShiftPage({ store, session }) {
  const { openShift, startShift, endShift, logCash, orders } = store
  const [shifts, setShifts] = useState([])
  const [cashLog, setCashLog] = useState([])
  const [showOpen, setShowOpen] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [showCash, setShowCash] = useState(false)
  const [openCash, setOpenCash] = useState('')
  const [closeCash, setCloseCash] = useState('')
  const [closeNote, setCloseNote] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const [cashType, setCashType] = useState('in')
  const [cashReason, setCashReason] = useState('')

  useEffect(() => { reload() }, [openShift?.id])

  async function reload() {
    const [s, c] = await Promise.all([
      loadShifts().catch(()=>[]),
      loadCashLog(openShift?.id).catch(()=>[]),
    ])
    setShifts(s || [])
    setCashLog((c || []).filter(x => !openShift || x.shiftId === openShift.id))
  }

  // 即時統計這班
  const shiftStats = (() => {
    if (!openShift) return null
    const shiftOrders = orders.filter(o => o.shiftId === openShift.id)
    // 排除完整退貨配對（兩邊都不算進現金流）
    const valid = shiftOrders.filter(o => o.status !== 'refunded' && !(o.refundOf && o.fullRefund))
    const refunds = shiftOrders.filter(o => o.refundOf)
    let cash = 0, card = 0
    for (const o of valid) {
      if (o.payMethod === 'mixed' && Array.isArray(o.payments)) {
        for (const p of o.payments) {
          if (p.method === 'cash') cash += p.amount
          else card += p.amount
        }
      } else if (o.payMethod === 'cash') cash += o.total
      else card += o.total
    }
    const cashIn = cashLog.filter(c => c.type==='in').reduce((s,c)=>s+c.amount, 0)
    const cashOut = cashLog.filter(c => c.type==='out').reduce((s,c)=>s+c.amount, 0)
    const expected = (openShift.openCash || 0) + cash + cashIn - cashOut
    return {
      orderCount: valid.filter(o => !o.refundOf).length,
      cash, card,
      refundCount: refunds.length,
      refundAmt: refunds.reduce((s,o)=>s+Math.abs(o.total),0),
      cashIn, cashOut, expected,
    }
  })()

  async function handleOpen() {
    const cash = parseFloat(openCash) || 0
    await startShift(session?.username || '', cash, session?.id || '')
    setShowOpen(false)
    setOpenCash('')
  }

  async function handleClose() {
    const cash = parseFloat(closeCash) || 0
    const r = await endShift(cash, closeNote)
    setShowClose(false); setCloseCash(''); setCloseNote('')
    if (r) {
      const diff = (r.diff != null ? r.diff : (cash - shiftStats.expected))
      alert(`交班完成\n預期現金：NT$ ${shiftStats.expected.toLocaleString()}\n實際現金：NT$ ${cash.toLocaleString()}\n差額：${diff >= 0 ? '+' : ''}${diff.toLocaleString()}`)
    }
    reload()
  }

  async function handleCash() {
    const amt = parseFloat(cashAmount) || 0
    if (!amt || !cashReason) return
    await logCash(cashType, amt, cashReason, session?.username || '')
    setShowCash(false); setCashAmount(''); setCashReason(''); setCashType('in')
    reload()
  }

  return (
    <div style={sh.root}>
      <div style={sh.header}>
        <div>
          <h2 style={{fontSize:20, fontWeight:600}}>班別管理</h2>
          <div style={{fontSize:13, color:'var(--text-tertiary)', marginTop:4}}>
            開班 / 交班 / 現金流水
          </div>
        </div>
        {!openShift ? (
          <button className="btn btn-primary" onClick={()=>setShowOpen(true)} style={{display:'flex',alignItems:'center',gap:6}}>
            <LogIn size={16}/> 開班
          </button>
        ) : (
          <div style={{display:'flex', gap:8}}>
            <button className="btn btn-ghost" onClick={()=>setShowCash(true)} style={{display:'flex',alignItems:'center',gap:6}}>
              <Plus size={16}/> 現金流水
            </button>
            <button className="btn btn-primary" onClick={()=>{setShowClose(true);setCloseCash(String(shiftStats?.expected||0))}} style={{display:'flex',alignItems:'center',gap:6}}>
              <LogOut size={16}/> 交班
            </button>
          </div>
        )}
      </div>

      {openShift ? (
        <div style={sh.card}>
          <div style={{display:'flex',justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
            <div>
              <div style={{fontSize:11, color:'var(--text-tertiary)'}}>當班</div>
              <div style={{fontSize:18, fontWeight:600}}>{openShift.cashier}</div>
              <div style={{fontSize:12, color:'var(--text-secondary)', marginTop:2}}>
                <Clock size={11} style={{verticalAlign:'middle', marginRight:4}}/>
                開班 {new Date(openShift.openTime).toLocaleString('zh-TW')}
              </div>
            </div>
            <span className="badge badge-green">營業中</span>
          </div>

          <div style={sh.kpiGrid}>
            <KPI label="開班現金" value={`NT$ ${(openShift.openCash||0).toLocaleString()}`}/>
            <KPI label="現金銷售" value={`NT$ ${(shiftStats?.cash||0).toLocaleString()}`} accent="green"/>
            <KPI label="電子支付" value={`NT$ ${(shiftStats?.card||0).toLocaleString()}`} accent="blue"/>
            <KPI label="現金進" value={`+NT$ ${(shiftStats?.cashIn||0).toLocaleString()}`}/>
            <KPI label="現金出" value={`-NT$ ${(shiftStats?.cashOut||0).toLocaleString()}`}/>
            <KPI label="退貨" value={`${shiftStats?.refundCount||0} 筆 / NT$ ${(shiftStats?.refundAmt||0).toLocaleString()}`} accent="red"/>
            <KPI label="訂單" value={`${shiftStats?.orderCount||0} 筆`}/>
            <KPI label="預期現金" value={`NT$ ${(shiftStats?.expected||0).toLocaleString()}`} accent="gold"/>
          </div>

          {cashLog.length > 0 && (
            <>
              <div style={{fontWeight:600, fontSize:14, margin:'20px 0 10px'}}>現金流水</div>
              <table style={sh.table}>
                <thead>
                  <tr>
                    <th>時間</th><th>類型</th><th style={{textAlign:'right'}}>金額</th><th>說明</th>
                  </tr>
                </thead>
                <tbody>
                  {cashLog.map(c => (
                    <tr key={c.id}>
                      <td>{new Date(c.time).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}</td>
                      <td>
                        <span className={`badge badge-${c.type==='in'?'green':'red'}`}>{c.type==='in'?'進':'出'}</span>
                      </td>
                      <td style={{textAlign:'right', fontFamily:'var(--font-mono)', color: c.type==='in'?'var(--green)':'var(--red)', fontWeight:500}}>
                        {c.type==='in'?'+':'-'} NT$ {c.amount.toLocaleString()}
                      </td>
                      <td style={{color:'var(--text-secondary)'}}>{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : (
        <div style={{...sh.card, textAlign:'center', padding:'40px 20px'}}>
          <AlertCircle size={32} color="var(--text-tertiary)" style={{margin:'0 auto 12px'}}/>
          <div style={{fontSize:15, fontWeight:500, marginBottom:6}}>目前未開班</div>
          <div style={{fontSize:13, color:'var(--text-tertiary)'}}>開班後才能使用收銀台功能</div>
        </div>
      )}

      <div style={{...sh.card, marginTop:12}}>
        <div style={{fontWeight:600, fontSize:14, marginBottom:12}}>歷史班別</div>
        {shifts.length === 0 ? (
          <div style={{textAlign:'center', color:'var(--text-tertiary)', padding:'20px 0', fontSize:13}}>無紀錄</div>
        ) : (
          <table style={sh.table}>
            <thead>
              <tr>
                <th>收銀員</th><th>開班</th><th>交班</th>
                <th style={{textAlign:'right'}}>現金</th><th style={{textAlign:'right'}}>電子</th>
                <th style={{textAlign:'right'}}>差額</th><th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map(s => (
                <tr key={s.id}>
                  <td>{s.cashier}</td>
                  <td>{new Date(s.openTime).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                  <td>{s.closeTime ? new Date(s.closeTime).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-'}</td>
                  <td style={{textAlign:'right', fontFamily:'var(--font-mono)'}}>{s.cashSales?.toLocaleString() || 0}</td>
                  <td style={{textAlign:'right', fontFamily:'var(--font-mono)'}}>{s.cardSales?.toLocaleString() || 0}</td>
                  <td style={{textAlign:'right', fontFamily:'var(--font-mono)', color: s.diff > 0 ? 'var(--green)' : s.diff < 0 ? 'var(--red)' : 'inherit'}}>
                    {s.status === 'closed' ? (s.diff > 0 ? '+' : '') + (s.diff||0).toLocaleString() : '-'}
                  </td>
                  <td>
                    <span className={`badge badge-${s.status==='open' ? 'green' : 'blue'}`}>
                      {s.status === 'open' ? '營業中' : '已交班'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showOpen && (
        <Modal title="開班" onClose={()=>setShowOpen(false)}>
          <Field label="收銀員"><div style={{padding:'10px 14px', fontSize:14}}>{session?.username}</div></Field>
          <Field label="開班零用金">
            <input className="field" type="number" value={openCash} onChange={e=>setOpenCash(e.target.value)} placeholder="0" autoFocus/>
          </Field>
          <button className="btn btn-primary" style={{width:'100%', padding:12, marginTop:12}} onClick={handleOpen}>確認開班</button>
        </Modal>
      )}

      {showClose && (
        <Modal title="交班" onClose={()=>setShowClose(false)}>
          <div style={{background:'var(--bg-overlay)', padding:'12px 14px', borderRadius:8, marginBottom:12}}>
            <div style={{display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:4}}>
              <span style={{color:'var(--text-secondary)'}}>預期現金</span>
              <span style={{fontFamily:'var(--font-mono)', fontWeight:600}}>NT$ {(shiftStats?.expected||0).toLocaleString()}</span>
            </div>
          </div>
          <Field label="實際現金">
            <input className="field" type="number" value={closeCash} onChange={e=>setCloseCash(e.target.value)} autoFocus/>
          </Field>
          {closeCash !== '' && (
            <div style={{padding:'8px 14px', borderRadius:8,
              background: parseFloat(closeCash) - (shiftStats?.expected||0) >= 0 ? 'var(--green-dim)' : 'var(--red-dim)',
              color: parseFloat(closeCash) - (shiftStats?.expected||0) >= 0 ? 'var(--green)' : 'var(--red)',
              fontSize:13, marginBottom:12}}>
              差額：{parseFloat(closeCash) - (shiftStats?.expected||0) >= 0 ? '+' : ''}
              NT$ {(parseFloat(closeCash) - (shiftStats?.expected||0)).toLocaleString()}
            </div>
          )}
          <Field label="備註">
            <input className="field" value={closeNote} onChange={e=>setCloseNote(e.target.value)} placeholder="差額原因..."/>
          </Field>
          <button className="btn btn-primary" style={{width:'100%', padding:12, marginTop:12}} onClick={handleClose}>確認交班</button>
        </Modal>
      )}

      {showCash && (
        <Modal title="現金進出" onClose={()=>setShowCash(false)}>
          <Field label="類型">
            <div style={{display:'flex', gap:8}}>
              {[['in','現金進'],['out','現金出']].map(([k,l]) => (
                <button key={k} onClick={()=>setCashType(k)} style={{
                  flex:1, padding:10, borderRadius:8, fontSize:13,
                  background: cashType===k?'var(--gold)':'var(--bg-overlay)',
                  color: cashType===k?'#fff':'var(--text-secondary)',
                  border:`1px solid ${cashType===k?'var(--gold)':'var(--border-subtle)'}`,
                }}>{l}</button>
              ))}
            </div>
          </Field>
          <Field label="金額">
            <input className="field" type="number" value={cashAmount} onChange={e=>setCashAmount(e.target.value)} autoFocus/>
          </Field>
          <Field label="說明">
            <input className="field" value={cashReason} onChange={e=>setCashReason(e.target.value)} placeholder="補零、付水電、貨款..."/>
          </Field>
          <button className="btn btn-primary" style={{width:'100%', padding:12, marginTop:12}} onClick={handleCash}>記錄</button>
        </Modal>
      )}
    </div>
  )
}

function KPI({ label, value, accent }) {
  return (
    <div style={{padding:'12px 14px', background:'var(--bg-overlay)', borderRadius:8}}>
      <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:4}}>{label}</div>
      <div style={{fontFamily:'var(--font-mono)', fontWeight:600, fontSize:15, color: accent ? `var(--${accent})` : 'var(--text-primary)'}}>{value}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{marginBottom:10}}>
      <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:4}}>{label}</div>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <>
      <div style={mod.overlay} onClick={onClose}/>
      <div style={mod.box}>
        <div style={mod.head}>
          <span style={{fontSize:15, fontWeight:600}}>{title}</span>
          <button onClick={onClose} style={{padding:4}}>✕</button>
        </div>
        <div style={{padding:'16px 18px'}}>{children}</div>
      </div>
    </>
  )
}

const sh = {
  root: { flex:1, overflowY:'auto', padding:'20px 24px', background:'var(--bg-base)' },
  header: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 },
  card: {
    background:'var(--bg-raised)', border:'1px solid var(--border-dim)',
    borderRadius:12, padding:'18px 20px', boxShadow:'var(--shadow-sm)',
  },
  kpiGrid: {
    display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:8,
  },
  table: {
    width:'100%', fontSize:13, borderCollapse:'collapse',
  },
}
const mod = {
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:998},
  box:{
    position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
    background:'var(--bg-raised)', borderRadius:12, width:380, maxWidth:'90vw',
    boxShadow:'var(--shadow-lg)', zIndex:999, overflow:'hidden',
  },
  head:{
    display:'flex', justifyContent:'space-between', alignItems:'center',
    padding:'14px 18px', borderBottom:'1px solid var(--border-dim)',
  },
}

const css = `
table th, table td { padding: 8px 10px; text-align: left; }
table th { font-size: 11px; color: var(--text-tertiary); font-weight: 500; border-bottom: 1px solid var(--border-dim); }
table tbody tr { border-bottom: 1px solid var(--border-dim); }
`
if (typeof document !== 'undefined' && !document.getElementById('shift-page-css')) {
  const s = document.createElement('style'); s.id = 'shift-page-css'; s.textContent = css; document.head.appendChild(s)
}
