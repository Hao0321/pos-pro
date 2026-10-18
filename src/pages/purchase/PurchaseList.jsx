import {tr,trMessage} from "../../i18n"
import { useState } from "react"
import { X, Truck, Package, ChevronLeft, CheckCircle } from "lucide-react"
import useIsMobile from "../../hooks/useIsMobile"
import { STATUS, poItemKey, ps } from "./controls.jsx"

export function PurchaseList({ purchases, selected, onSelect, onReceive,renderProcurement,canReceive=()=>true }) {
  const isMobile = useIsMobile()
  // mobile：選中就只看詳情，未選看列表
  const showList   = !isMobile || !selected
  const showDetail = !isMobile || !!selected

  return (
    <div style={{display:'flex', flex:1, gap:14, overflow:'hidden', flexDirection: isMobile ? 'column' : 'row'}}>
      {showList && (
      <div style={{width: isMobile ? '100%' : 300, flexShrink:0, display:'flex', flexDirection:'column', gap:8, overflowY:'auto'}}>
        {purchases.length === 0 && (
          <div style={{textAlign:'center', padding:'40px', color:'var(--text-tertiary)', fontSize:13}}>{tr("尚無進貨單")}</div>
        )}
        {purchases.map(po => {
          const st = STATUS[po.status]||STATUS.draft
          return (
            <button key={po.id} data-purchase-id={po.id} onClick={()=>onSelect(po)} style={{
              ...ps.poCard,
              border: `1px solid ${selected?.id===po.id?'var(--border-mid)':'var(--border-dim)'}`,
              background: selected?.id===po.id?'var(--bg-active)':'var(--bg-raised)',
            }}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:6,gap:6,flexWrap:'wrap'}}>
                <span style={{fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-secondary)',overflowWrap:'anywhere'}}>{po.id}</span>
                <span style={{...ps.statusBadge, background:st.bg, color:st.color}}>{tr(st.label)}</span>
              </div>
              <div style={{fontWeight:600, fontSize:14, marginBottom:4}}>{po.supplierName}</div>
              <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text-tertiary)'}}>
                <span>{po.date}</span>
                <span style={{fontFamily:'var(--font-mono)', color:'var(--text-primary)'}}>NT$ {po.total.toLocaleString()}</span>
              </div>
            </button>
          )
        })}
      </div>
      )}

      {showDetail && (selected ? (
        <div style={ps.detail} className="animate-in">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, gap:10, flexWrap:'wrap'}}>
            <div style={{display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0}}>
              {isMobile && (
                <button className="btn-icon btn-sm" onClick={()=>onSelect(null)} aria-label={tr("返回")}>
                  <ChevronLeft size={16}/>
                </button>
              )}
              <div style={{minWidth:0}}>
                <div style={{fontWeight:700, fontSize:16, fontFamily:'var(--font-serif)'}}>{selected.supplierName}</div>
                <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>{tr("進貨單 ")}{selected.id}{tr(" · 叫貨日 ")}{selected.date}
                </div>
              </div>
            </div>
            {onReceive&&canReceive(selected)&&(selected.status === 'ordered' || selected.status === 'partial') && (
              <button className="btn btn-primary btn-sm" data-purchase-receive onClick={()=>onReceive(selected)}>
                <Truck size={14}/>{selected.status === 'partial' ? tr("補收到貨") : tr("確認到貨")}
              </button>
            )}
          </div>
          <div className="card" style={{overflowX:'auto', marginBottom:14}}>
            <div style={{display:'grid',minWidth:420, gridTemplateColumns:'1fr 70px 70px 70px 70px', gap:8, padding:'9px 14px', background:'var(--bg-overlay)', fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.05em'}}>
              <span>{tr("商品")}</span><span style={{textAlign:'right'}}>{tr("叫貨量")}</span><span style={{textAlign:'right'}}>{tr("單價")}</span><span style={{textAlign:'right'}}>{tr("到貨量")}</span><span style={{textAlign:'right'}}>{tr("小計")}</span>
            </div>
            {selected.items.map((item,i) => (
              <div key={i} style={{display:'grid',minWidth:420, gridTemplateColumns:'1fr 70px 70px 70px 70px', gap:8, padding:'10px 14px', borderTop:'1px solid var(--border-dim)', fontSize:13, alignItems:'center'}}>
                <span style={{fontWeight:500}}>{item.name}</span>
                <span style={{textAlign:'right', fontFamily:'var(--font-mono)'}}>{item.qty}</span>
                <span style={{textAlign:'right', fontFamily:'var(--font-mono)', color:'var(--text-secondary)'}}>{item.unitCost}</span>
                <span style={{textAlign:'right', fontFamily:'var(--font-mono)', color: item.received===item.qty?'var(--green)':item.received>0?'var(--amber)':'var(--text-tertiary)'}}>{item.received ?? '—'}</span>
                <span style={{textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:500}}>{(item.qty*item.unitCost).toLocaleString()}</span>
              </div>
            ))}
            <div style={{display:'flex', justifyContent:'space-between', padding:'12px 14px', borderTop:'1px solid var(--border-mid)', fontWeight:600}}>
              <span>{tr("總計")}</span>
              <span style={{fontFamily:'var(--font-mono)', color:'var(--gold-bright)'}}>NT$ {selected.total.toLocaleString()}</span>
            </div>
          </div>
          {selected.note && <div style={{fontSize:13, color:'var(--text-secondary)', padding:'10px 14px', background:'var(--bg-overlay)', borderRadius:8}}>{tr("備註：")}{selected.note}</div>}
          {renderProcurement?.(selected)}
        </div>
      ) : !isMobile && (
        <div style={ps.emptyDetail}>
          <Package size={32} style={{opacity:.2, marginBottom:12}}/>
          <span style={{color:'var(--text-tertiary)', fontSize:13}}>{tr("選擇進貨單查看詳情")}</span>
        </div>
      ))}
    </div>
  )
}

export function ReceiveModal({ po, products, onConfirm, onClose, saving, error }) {
  // v2.6: key 改用 poItemKey — 貨源目錄品項沒有 productId，避免全部撞在 null 上
  // 預填「尚未到貨的差額」：部分到貨補收時不會把已收的量再收一次
  const remaining = (i) => Math.max(0, i.qty - (i.received || 0))
  const [qtys, setQtys] = useState(() => {
    const m = {}
    po.items.forEach((i, idx) => { m[poItemKey(i, idx)] = remaining(i) })
    return m
  })
  const hasUnfiled = po.items.some(i => !i.productId)

  // v2.6: 一鍵把每項到貨量填成「未到數量」
  function fillAll() {
    const m = {}
    po.items.forEach((i, idx) => { m[poItemKey(i, idx)] = remaining(i) })
    setQtys(m)
  }

  return (
    <div style={ps.overlay}>
      <div style={ps.modal} className="animate-scale" role="dialog" aria-modal="true" aria-label={tr("確認到貨")}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18}}>
          <div>
            <div style={{fontWeight:700, fontSize:15, fontFamily:'var(--font-serif)'}}>{tr("確認到貨")}</div>
            <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>{po.supplierName} · {po.id}</div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <p style={{fontSize:13, color:'var(--text-secondary)', marginBottom:12}}>{tr("請核對實際到貨數量，系統將自動更新庫存：")}</p>
        {/* v2.6: 全部照單全收 — 一鍵把到貨量填成叫貨量 */}
        <button className="btn btn-ghost" style={{width:'100%', minHeight:44, marginBottom:12}} onClick={fillAll}>
          <CheckCircle size={15}/>{tr("全部照單全收（填入尚未到貨的數量）")}</button>
        {po.items.map((item, idx) => {
          const key = poItemKey(item, idx)
          const current = products.find(p=>p.id===item.productId)?.stock || 0
          return (
            <div key={key} style={{display:'grid', gridTemplateColumns:'1fr 70px 80px', gap:12, padding:'10px 0', borderBottom:'1px solid var(--border-dim)', alignItems:'center'}}>
              <div>
                <div style={{fontSize:13, fontWeight:500}}>
                  {item.name}
                  {!item.productId && <span style={{fontSize:10, color:'var(--accent)', background:'var(--accent-dim)', padding:'1px 6px', borderRadius:4, marginLeft:6}}>{tr("📋 未建檔")}</span>}
                </div>
                <div style={{fontSize:11, color:'var(--text-tertiary)'}}>
                  {item.productId ? tr("現有庫存：{0}", {0: current}) : tr("未建檔品項到貨後會自動建檔")}
                </div>
              </div>
              <div style={{textAlign:'right', fontSize:12, color:'var(--text-secondary)'}}>{tr("叫貨 ")}{item.qty}{(item.received||0) > 0 && <div style={{fontSize:10, color:'var(--amber)'}}>{tr("已收 ")}{item.received}</div>}
              </div>
              <input
                aria-label={tr("本次到貨量 {0} {1}", {0: item.name, 1: idx+1})} type="number" min={0} max={remaining(item)} step="0.001" disabled={saving}
                className="field"
                value={qtys[key] ?? item.qty}
                onChange={e=>setQtys(q=>({...q,[key]:Number(e.target.value)||0}))}
                style={{textAlign:'right', fontFamily:'var(--font-mono)', padding:'8px 10px',fontSize:16,minHeight:44}}
              />
            </div>
          )
        })}
        <div style={{marginTop:16, padding:'10px 12px', background:'var(--green-dim)', borderRadius:8, fontSize:12, color:'var(--green)'}}>{tr("✓ 確認後庫存將自動增加，並記錄稽核日誌")}{hasUnfiled ? tr("；未建檔品項會自動建立商品資料") : ''}
        </div>
        {error&&<p role="alert" style={{color:'var(--red)'}}>{trMessage(error)}</p>}
        <div style={{display:'flex', gap:10, marginTop:16}}>
          <button disabled={saving} className="btn btn-primary" style={{flex:1, padding:12}} onClick={()=>onConfirm(qtys)}>
            <CheckCircle size={15}/>{saving?tr("保存中…"):tr("確認到貨")}
          </button>
          <button className="btn btn-ghost" style={{flex:1}} onClick={onClose}>{tr("取消")}</button>
        </div>
      </div>
    </div>
  )
}
