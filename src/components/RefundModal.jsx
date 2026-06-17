import { useState, useMemo } from 'react'
import { X, RotateCcw } from 'lucide-react'

export default function RefundModal({ order, onClose, onRefund, session, priorRefunds = [] }) {
  const [refundQty, setRefundQty] = useState({})
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 注意：hooks 一律放在任何 early return 之前，避免 hooks 數量隨 order 變動而違反 hooks 規則
  const items = useMemo(() => order?.items || [], [order])

  // 之前已退數量（同一張原單可被多次部分退貨）→ 算出每個品項剩餘可退量，避免超退
  const refundedById = useMemo(() => {
    const m = {}
    for (const ro of priorRefunds)
      for (const it of (ro.items || [])) m[it.id] = (m[it.id] || 0) + Math.abs(it.qty || 0)
    return m
  }, [priorRefunds])
  const remainingOf = (item) => Math.max(0, Math.abs(item.qty) - (refundedById[item.id] || 0))

  const refundItems = useMemo(() => items.map(item => ({
    ...item,
    qty: refundQty[item.id] || 0,
  })).filter(i => i.qty > 0), [items, refundQty])

  const refundTotal = refundItems.reduce((s, i) => s + i.price * i.qty, 0)
  const ratio = order && order.subtotal > 0 ? refundTotal / order.subtotal : 0
  const refundDiscount = Math.round((order?.discount || 0) * ratio)
  const refundManual = Math.round((order?.manualDiscount || 0) * ratio)
  const refundActual = refundTotal - refundDiscount - refundManual
  // 原單若用儲值付，按比例退回儲值，其餘才退現金/原付款 → 讓收銀員清楚該退多少現金
  const restoredBalance = Math.round((order?.balanceUsed || 0) * ratio)
  const cashBack = refundActual - restoredBalance

  if (!order) return null

  function setQty(id, val) {
    const item = items.find(i => i.id === id)
    if (!item) return
    const v = Math.max(0, Math.min(remainingOf(item), parseInt(val) || 0))
    setRefundQty(p => ({ ...p, [id]: v }))
  }

  async function handleSubmit() {
    if (!refundItems.length || submitting) return
    setSubmitting(true)
    try {
      const r = await onRefund(order, refundItems, { reason, cashier: session?.username || '' })
      if (r) onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div style={rm.overlay} onClick={onClose}/>
      <div style={rm.box}>
        <div style={rm.head}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <RotateCcw size={16}/>
            <span style={{fontWeight:600}}>退貨</span>
            <span style={{fontSize:11, color:'var(--text-tertiary)'}}>{order.id}</span>
          </div>
          <button onClick={onClose} style={{padding:4}}><X size={18}/></button>
        </div>

        <div style={{padding:'14px 18px', background:'var(--bg-overlay)', fontSize:13}}>
          <div style={{display:'flex', justifyContent:'space-between'}}>
            <span style={{color:'var(--text-secondary)'}}>原訂單金額</span>
            <span style={{fontFamily:'var(--font-mono)', fontWeight:500}}>NT$ {order.total.toLocaleString()}</span>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', marginTop:4, fontSize:12}}>
            <span style={{color:'var(--text-tertiary)'}}>{new Date(order.time).toLocaleString('zh-TW')}</span>
            <span style={{color:'var(--text-tertiary)'}}>{order.payMethod === 'cash' ? '現金' : order.payMethod === 'card' ? '電子支付' : '混合'}</span>
          </div>
        </div>

        <div style={{padding:'12px 18px', maxHeight:'40vh', overflowY:'auto'}}>
          <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.05em'}}>選擇退貨商品</div>
          {items.map(item => {
            const maxQty = remainingOf(item)
            const already = refundedById[item.id] || 0
            const done = maxQty === 0
            const cur = refundQty[item.id] || 0
            return (
              <div key={item.id} style={{...rm.itemRow, opacity: done ? 0.45 : 1}}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:500}}>{item.name}</div>
                  <div style={{fontSize:11, color:'var(--text-tertiary)'}}>
                    NT$ {item.price} × {Math.abs(item.qty)}
                    {already > 0 && <span style={{color:'var(--amber)', marginLeft:6}}>已退 {already}</span>}
                  </div>
                </div>
                <div style={{display:'flex', alignItems:'center', gap:6}}>
                  <button onClick={()=>setQty(item.id, cur - 1)} style={rm.qtyBtn} disabled={done}>−</button>
                  <input type="number" value={cur} onChange={e=>setQty(item.id, e.target.value)} disabled={done}
                    style={{width:50, textAlign:'center', fontFamily:'var(--font-mono)', fontSize:14, background:'var(--bg-overlay)', borderRadius:6, padding:'4px 0', border:'1px solid var(--border-dim)'}}/>
                  <button onClick={()=>setQty(item.id, cur + 1)} style={rm.qtyBtn} disabled={done}>+</button>
                  <button onClick={()=>setQty(item.id, maxQty)} style={{fontSize:11, color: done ? 'var(--text-tertiary)' : 'var(--gold)', marginLeft:4, padding:4}} disabled={done}>{done ? '已退完' : '全'}</button>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{padding:'14px 18px', borderTop:'1px solid var(--border-dim)'}}>
          <input className="field" placeholder="退貨原因（選填）" value={reason} onChange={e=>setReason(e.target.value)} style={{marginBottom:12}}/>

          <div style={{background:'var(--red-dim)', padding:'12px 14px', borderRadius:8, marginBottom:12}}>
            <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text-secondary)', marginBottom:2}}>
              <span>退貨小計</span><span style={{fontFamily:'var(--font-mono)'}}>NT$ {refundTotal.toLocaleString()}</span>
            </div>
            {refundDiscount > 0 && (
              <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text-secondary)', marginBottom:2}}>
                <span>沖回折抵</span><span style={{fontFamily:'var(--font-mono)'}}>−NT$ {refundDiscount.toLocaleString()}</span>
              </div>
            )}
            {refundManual > 0 && (
              <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text-secondary)', marginBottom:2}}>
                <span>沖回手動折讓</span><span style={{fontFamily:'var(--font-mono)'}}>−NT$ {refundManual.toLocaleString()}</span>
              </div>
            )}
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:6}}>
              <span style={{fontSize:13, fontWeight:600, color:'var(--red)'}}>實退金額</span>
              <span style={{fontFamily:'var(--font-mono)', fontSize:20, fontWeight:600, color:'var(--red)'}}>
                NT$ {refundActual.toLocaleString()}
              </span>
            </div>
            {restoredBalance > 0 && (
              <div style={{marginTop:8, paddingTop:8, borderTop:'1px dashed var(--border-dim)'}}>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:2}}>
                  <span style={{color:'var(--teal)'}}>↩ 退回儲值卡</span>
                  <span style={{fontFamily:'var(--font-mono)', color:'var(--teal)'}}>NT$ {restoredBalance.toLocaleString()}</span>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}>
                  <span style={{color:'var(--text-secondary)'}}>退現金 / 原付款</span>
                  <span style={{fontFamily:'var(--font-mono)'}}>NT$ {cashBack.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>

          <button className="btn btn-primary" style={{width:'100%', padding:12, background:'var(--red)', opacity: refundItems.length === 0 || submitting ? 0.4 : 1}}
            disabled={refundItems.length === 0 || submitting}
            onClick={handleSubmit}>
            {submitting ? '處理中...' : '確認退貨'}
          </button>
        </div>
      </div>
    </>
  )
}

const rm = {
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:998},
  box:{
    position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
    background:'var(--bg-raised)', borderRadius:12, width:480, maxWidth:'92vw',
    maxHeight:'88vh', overflow:'hidden', display:'flex', flexDirection:'column',
    boxShadow:'var(--shadow-lg)', zIndex:999,
  },
  head:{
    display:'flex', justifyContent:'space-between', alignItems:'center',
    padding:'14px 18px', borderBottom:'1px solid var(--border-dim)',
  },
  itemRow:{
    display:'flex', alignItems:'center', gap:10,
    padding:'10px 0', borderBottom:'1px solid var(--border-dim)',
  },
  qtyBtn:{
    width:26, height:26, borderRadius:6, fontSize:13, fontWeight:600,
    background:'var(--bg-overlay)', border:'1px solid var(--border-subtle)',
    color:'var(--text-secondary)', display:'flex', alignItems:'center', justifyContent:'center',
  },
}
