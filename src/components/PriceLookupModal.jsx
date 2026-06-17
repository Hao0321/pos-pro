import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, X, Tag } from 'lucide-react'

export default function PriceLookupModal({ products, onClose }) {
  const [q, setQ] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo(() => {
    if (!q) return products.slice(0, 30)
    return products.filter(p =>
      p.name.includes(q) || p.barcode?.includes(q) || p.category?.includes(q)
    ).slice(0, 50)
  }, [q, products])

  return (
    <>
      <div style={pl.overlay} onClick={onClose}/>
      <div style={pl.box}>
        <div style={pl.head}>
          <Search size={16} color="var(--text-tertiary)"/>
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)}
            placeholder="搜尋商品名稱、條碼或分類..."
            style={{flex:1, fontSize:16, color:'var(--text-primary)'}}
            onKeyDown={e => { if (e.key === 'Escape') onClose() }}/>
          <button onClick={onClose} style={{padding:6}}><X size={18}/></button>
        </div>
        <div style={pl.list}>
          {results.length === 0 ? (
            <div style={{textAlign:'center', padding:40, color:'var(--text-tertiary)', fontSize:13}}>
              查無商品
            </div>
          ) : results.map(p => (
            <div key={p.id} style={pl.row}>
              <div style={{flex:1, minWidth:0}}>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  {p.imageUrl && (
                    <img src={p.imageUrl} alt="" style={{width:32, height:32, borderRadius:6, objectFit:'cover', flexShrink:0}}/>
                  )}
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:14, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                      {p.noBarcode && <Tag size={10} style={{verticalAlign:'middle', marginRight:4, opacity:0.5}}/>}
                      {p.name}
                    </div>
                    <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:2}}>
                      {p.category} · 庫存 {p.stock} {p.unit}
                      {p.barcode && ` · ${p.barcode}`}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{textAlign:'right', flexShrink:0, marginLeft:12}}>
                <div style={{fontFamily:'var(--font-mono)', fontSize:18, fontWeight:600, color:'var(--gold)'}}>
                  ${p.price}
                </div>
                <div style={{fontSize:10, color:'var(--text-tertiary)'}}>/ {p.unit}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={pl.foot}>
          <span style={{fontSize:11, color:'var(--text-tertiary)'}}>共 {results.length} 項 · 按 Esc 關閉</span>
        </div>
      </div>
    </>
  )
}

const pl = {
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:998},
  box:{
    position:'fixed', top:'10%', left:'50%', transform:'translateX(-50%)',
    background:'var(--bg-raised)', borderRadius:12, width:600, maxWidth:'92vw',
    maxHeight:'80vh', overflow:'hidden', display:'flex', flexDirection:'column',
    boxShadow:'var(--shadow-lg)', zIndex:999,
  },
  head:{
    display:'flex', alignItems:'center', gap:10,
    padding:'14px 18px', borderBottom:'1px solid var(--border-dim)',
  },
  list:{
    flex:1, overflowY:'auto', padding:'8px 0',
  },
  row:{
    display:'flex', alignItems:'center', padding:'10px 18px',
    borderBottom:'1px solid var(--border-dim)',
  },
  foot:{
    padding:'8px 18px', borderTop:'1px solid var(--border-dim)',
    background:'var(--bg-overlay)',
  },
}
