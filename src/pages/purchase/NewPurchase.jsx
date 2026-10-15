import { useState, useMemo, useRef, lazy, Suspense } from "react"
import { Plus, Check, X, ChevronRight, Zap, Camera } from "lucide-react"
import { DEFAULT_CATEGORIES, CATEGORY_META, groupByCategory } from "../../utils/categories"
import { computeSalesVelocity, suggestReorderQty } from "../../utils/analytics"
import { localDate } from "../../utils/checkoutSafety.mjs"
import {procurementLineCents} from '../../../electron/procurementRules.mjs'
import { FL, ps } from "./controls.jsx"

export const BarcodeScannerModal = lazy(() => import('../../components/BarcodeScannerModal'))

export function NewPurchase({ products, suppliers, purchases, orders = [], onSave }) {
  const pendingId=useRef('PO'+crypto.randomUUID())
  // AI: 近 30 天每日銷售速度
  const salesVelocity = useMemo(() => computeSalesVelocity(orders, 30), [orders])
  const [supplierId, setSupplierId] = useState('')
  const [date,       setDate]       = useState(() => localDate())
  const [items,      setItems]      = useState([])
  const [note,       setNote]       = useState('')
  const [addProdId,  setAddProdId]  = useState('')
  const [catFilter,  setCatFilter]  = useState('all')
  const [showCamera, setShowCamera] = useState(false)
  const [camMsg,     setCamMsg]     = useState('')
  const [confirming, setConfirming] = useState(false) // v2.6: 送出前確認
  const submitOnce = useRef(false) // 防連點兩下重複送單（setState 是非同步的，state 擋不住同一渲染內的第二下）

  const supplier = suppliers.find(s=>s.id===supplierId)

  // v2.6: 用既有 camMsg toast 告訴使用者為什麼沒反應
  function toast(msg, ms = 2500) {
    setCamMsg(msg)
    setTimeout(() => setCamMsg(''), ms)
  }

  // 從歷史進貨單找該廠商該商品的最近單價
  function historicalPrice(productId, sid) {
    if (!sid) return null
    const sorted = (purchases || [])
      .filter(po => po.supplierId === sid)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    for (const po of sorted) {
      const found = (po.items || []).find(i => i.productId === productId)
      if (found && found.unitCost > 0) return found.unitCost
    }
    return null
  }

  // v2.6: 貨源目錄品項的歷史單價（用 catalogId 對過往進貨單）
  function historicalCatalogPrice(catalogId, sid) {
    if (!sid || !catalogId) return null
    const sorted = (purchases || [])
      .filter(po => po.supplierId === sid)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    for (const po of sorted) {
      const found = (po.items || []).find(i => i.catalogId === catalogId)
      if (found && found.unitCost > 0) return found.unitCost
    }
    return null
  }

  // v2.6: 貨源目錄 → 可叫貨清單。已連到庫存商品的目錄項併回庫存商品（不重複列）；
  // 未建檔的目錄項變成 pseudo-product，叫貨到貨後才自動建檔
  const catalogOnly = useMemo(() => {
    if (!supplier) return []
    return (supplier.catalog || [])
      .filter(ci => !ci.productId || !products.find(p => p.id === ci.productId))
      .map(ci => ({
        id: 'cat_' + ci.id, isCatalog: true, catalogId: ci.id,
        name: ci.name, unit: ci.unit || '個', cost: Number(ci.cost) || 0,
      }))
  }, [supplier, products])

  // 依供應商過濾商品：選了 → 該供應商的 + 未指定供應商的；沒選 → 全部
  const filteredProducts = useMemo(() => {
    let arr = !supplierId ? products : products.filter(p => !p.supplierId || p.supplierId === supplierId)
    if (catFilter !== 'all') arr = arr.filter(p => (p.category || '未分類') === catFilter)
    return arr
  }, [products, supplierId, catFilter])

  // 該供應商有的分類清單（給 chips）
  const availableCategories = useMemo(() => {
    if (!supplierId) return []
    const supplierProds = products.filter(p => p.supplierId === supplierId)
    const set = new Set(supplierProds.map(p => p.category || '未分類'))
    // 依 DEFAULT_CATEGORIES 順序排序
    const ordered = DEFAULT_CATEGORIES.filter(c => set.has(c))
    const extra = [...set].filter(c => !DEFAULT_CATEGORIES.includes(c))
    return [...ordered, ...extra]
  }, [products, supplierId])

  // 該供應商的低庫存商品（stock <= reorderLevel，預設 reorderLevel=0 不算）
  // audit #13: 強制 Number 轉型，避免字串 reorderLevel 造成 NaN
  const lowStockForSupplier = useMemo(() => {
    if (!supplierId) return []
    return products.filter(p => p.supplierId === supplierId
      && (Number(p.reorderLevel) || 0) > 0
      && (Number(p.stock) || 0) <= (Number(p.reorderLevel) || 0)
      && (catFilter === 'all' || (p.category || '未分類') === catFilter))
  }, [products, supplierId, catFilter])

  function addItem(prodId) {
    const id = prodId || addProdId
    // v2.6: 貨源目錄品項（尚未建檔）→ 用目錄資訊直接開叫貨列
    if (typeof id === 'string' && id.startsWith('cat_')) {
      const c = catalogOnly.find(x => x.id === id)
      if (!c || items.find(i => i.catalogId === c.catalogId)) return
      setItems(prev => [...prev, {
        productId: null,
        isCatalog: true,
        catalogId: c.catalogId,
        name: c.name,
        unit: c.unit,
        qty: 1,
        unitCost: c.cost || historicalCatalogPrice(c.catalogId, supplierId) || 0,
        received: 0,
      }])
      setAddProdId('')
      return
    }
    const p = products.find(x => x.id === id)
    if (!p || items.find(i => i.productId === p.id)) return
    const histPrice = historicalPrice(p.id, supplierId)
    const dailyAvg = salesVelocity.get(p.id) || 0
    // AI 建議：基於近 30 天日均 + 14 天供貨週期；若無銷售資料則回退到 reorderLevel × 2
    let suggestedQty, aiUsed = false
    if (dailyAvg > 0) {
      suggestedQty = suggestReorderQty(p, dailyAvg, 14).suggested
      aiUsed = true
    } else {
      const reorder = Number(p.reorderLevel) || 0
      const stock = Number(p.stock) || 0
      suggestedQty = reorder > 0 ? Math.max(1, reorder * 2 - stock) : 1
    }
    setItems(prev => [...prev, {
      productId: p.id,
      name: p.name,
      qty: suggestedQty,
      unitCost: histPrice || Number(p.cost) || 0,
      received: 0,
      _fromHistory: !!histPrice,
      _aiSuggested: aiUsed,
      _dailyAvg: dailyAvg,
    }])
    setAddProdId('')
  }

  function fillLowStock() {
    if (!supplierId) return
    const toAdd = lowStockForSupplier.filter(p => !items.find(i => i.productId === p.id))
    if (toAdd.length === 0) return
    const newItems = toAdd.map(p => {
      const histPrice = historicalPrice(p.id, supplierId)
      const dailyAvg = salesVelocity.get(p.id) || 0
      let suggestedQty, aiUsed = false
      if (dailyAvg > 0) {
        suggestedQty = suggestReorderQty(p, dailyAvg, 14).suggested
        aiUsed = true
      } else {
        const reorder = Number(p.reorderLevel) || 0
        const stock = Number(p.stock) || 0
        suggestedQty = Math.max(1, reorder * 2 - stock)
      }
      return {
        productId: p.id,
        name: p.name,
        qty: suggestedQty,
        unitCost: histPrice || Number(p.cost) || 0,
        received: 0,
        _fromHistory: !!histPrice,
        _autoFilled: true,
        _aiSuggested: aiUsed,
        _dailyAvg: dailyAvg,
      }
    })
    setItems(prev => [...prev, ...newItems])
  }

  function updateItem(i, key, val) {
    // audit #12: qty 至少 1，避免 qty=0 通過驗證造成空進貨單
    const num = parseFloat(val) || 0
    const safe = num
    setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[key]:safe}:it))
  }

  const total = items.reduce((s,i)=>{try{return s+procurementLineCents(i.qty,i.unitCost)/100}catch{return s}},0)
  const unaddedLow = lowStockForSupplier.filter(p => !items.find(i => i.productId === p.id)).length
  // v2.6: 貨源目錄裡還沒加入清單的品項（給下拉的「📋 貨源目錄」群組）
  const pickableCatalog = catalogOnly.filter(c => !items.find(i => i.catalogId === c.catalogId))
  // v2.6: 目前進行到哪一步（給步驟指示高亮）
  const step = !supplierId ? 1 : items.length === 0 ? 2 : 3

  function handleSave() {
    // v2.6: 不再沉默 return，用 toast 講清楚缺什麼
    if (!supplierId) { toast('✗ 請先選擇廠商'); return }
    if (items.length === 0) { toast('✗ 請先加入至少一項商品'); return }
    // audit #11: 防 supplier 同步被改造成 undefined（race condition）
    if (!supplier) { toast('✗ 找不到這家廠商，請重新選擇'); return }
    // audit #12: 過濾掉 qty<=0 的品項
    const validItems = items.filter(i => i.qty > 0 && i.unitCost >= 0)
    if (validItems.length !== items.length) { toast('✗ 每項商品都需要有效數量與單價，請檢查後再送出'); return }
    try{items.forEach(i=>procurementLineCents(i.qty,i.unitCost))}catch(e){toast('✗ '+e.message);return}
    setConfirming(true) // v2.6: 先確認再送出，避免誤觸
  }

  async function doSubmit() {
    if (submitOnce.current) return
    submitOnce.current = true
    const validItems = items.filter(i => i.qty > 0 && i.unitCost >= 0)
    const po = {
      id: pendingId.current, supplierId, supplierName: supplier.name || '',
      status:'ordered', date, receivedDate:null,
      items: validItems.map(({_fromHistory, _autoFilled, _aiSuggested, _dailyAvg, ...rest}) => rest),
      note, total,
    }
    try {await onSave(po);setConfirming(false)}
    catch(e) {submitOnce.current=false;toast('✗ '+e.message)}
  }

  return (
    <div style={{maxWidth:780, display:'flex', flexDirection:'column', gap:16, overflowY:'auto', height:'100%'}}>
      {/* v2.6: 三步驟指示，目前這一步高亮 */}
      <div style={{display:'flex', gap:8, flexShrink:0}}>
        {[[1,'① 選廠商'],[2,'② 加商品'],[3,'③ 送出叫貨單']].map(([n,l])=>(
          <div key={n} style={{
            flex:1, textAlign:'center', padding:'11px 6px', borderRadius:8, fontSize:13,
            fontWeight: step===n ? 700 : 400,
            background: step===n ? 'var(--accent-dim)' : 'var(--bg-overlay)',
            color: step===n ? 'var(--accent)' : 'var(--text-tertiary)',
            border: `1px solid ${step===n ? 'var(--accent)' : 'var(--border-dim)'}`,
          }}>{l}</div>
        ))}
      </div>
      <div style={np.topGrid}>
        <div>
          <FL>供應商 *</FL>
          <select aria-label="採購供應商" className="field" value={supplierId} onChange={e=>{setSupplierId(e.target.value);setAddProdId('')}} style={{cursor:'pointer',fontSize:16,minHeight:44}}>
            <option value="">— 選擇供應商 —</option>
            {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <FL>叫貨日期</FL>
          <input aria-label="採購日期" type="date" className="field" value={date} onChange={e=>setDate(e.target.value)}/>
        </div>
      </div>

      {supplier && (
        <div style={{fontSize:12, color:'var(--text-secondary)', background:'var(--bg-overlay)', borderRadius:8, padding:'10px 14px'}}>
          📞 {supplier.contact} · {supplier.payTerms}{supplier.note ? ` · ${supplier.note}` : ''}
          <div style={{marginTop:4, color:'var(--text-tertiary)', fontSize:11}}>
            該供應商商品 {products.filter(p=>p.supplierId===supplierId).length} 項
            {' · 📋 貨源目錄 '}{(supplier.catalog||[]).length}{' 項'}
            {lowStockForSupplier.length > 0 && (
              <span style={{color:'var(--amber)', marginLeft:8}}>
                · {lowStockForSupplier.length} 項低於安全庫存
              </span>
            )}
          </div>
        </div>
      )}

      {/* 分類篩選 chips（只在選了供應商且有多個分類時顯示）*/}
      {supplierId && availableCategories.length > 0 && (
        <div>
          <FL>分類篩選</FL>
          <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
            <button
              onClick={()=>setCatFilter('all')}
              style={{
                fontSize:12, padding:'5px 11px', borderRadius:14,
                background: catFilter==='all' ? 'var(--gold-dim)' : 'var(--bg-overlay)',
                color: catFilter==='all' ? 'var(--gold)' : 'var(--text-secondary)',
                border:`1px solid ${catFilter==='all' ? 'var(--gold)' : 'var(--border-dim)'}`,
                fontWeight: catFilter==='all' ? 600 : 400,
              }}
            >
              全部
            </button>
            {availableCategories.map(c => (
              <button
                key={c}
                onClick={()=>setCatFilter(c)}
                style={{
                  fontSize:12, padding:'5px 11px', borderRadius:14,
                  background: catFilter===c ? 'var(--gold-dim)' : 'var(--bg-overlay)',
                  color: catFilter===c ? 'var(--gold)' : 'var(--text-secondary)',
                  border:`1px solid ${catFilter===c ? 'var(--gold)' : 'var(--border-dim)'}`,
                  fontWeight: catFilter===c ? 600 : 400,
                }}
              >
                {CATEGORY_META[c]?.icon || '📦'} {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 一鍵補貨 */}
      {supplierId && unaddedLow > 0 && (
        <button
          onClick={fillLowStock}
          style={{
            display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
            padding:'14px 16px', borderRadius:'var(--r3)',
            background:'linear-gradient(135deg, var(--amber-dim), var(--gold-dim))',
            border:'1px solid var(--amber)', cursor:'pointer', textAlign:'left',
            width:'100%',
          }}
        >
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <Zap size={18} style={{color:'var(--amber)'}}/>
            <div>
              <div style={{fontWeight:600, fontSize:14, color:'var(--text-primary)'}}>
                一鍵帶入低庫存補貨清單{catFilter !== 'all' && `（${catFilter}）`}
              </div>
              <div style={{fontSize:12, color:'var(--text-secondary)', marginTop:2}}>{unaddedLow} 項商品低於安全庫存，自動計算建議叫貨量</div>
            </div>
          </div>
          <ChevronRight size={18} style={{color:'var(--amber)'}}/>
        </button>
      )}

      <div>
        <FL>加入商品 {supplierId && `（限 ${supplier?.name} 供應）`}</FL>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={()=>setShowCamera(true)}
            disabled={!supplierId}
            title="用相機掃條碼加入"
          >
            <Camera size={14}/>掃條碼
          </button>
          <select
            aria-label="採購商品"
            className="field"
            value={addProdId}
            onChange={e=>setAddProdId(e.target.value)}
            disabled={!supplierId}
            style={{cursor:'pointer', flex:1, minWidth:200}}
          >
            <option value="">— {supplierId ? '選擇商品' : '請先選供應商'} —</option>
            {/* 依分類分組，用 optgroup */}
            {groupByCategory(filteredProducts.filter(p=>!items.find(i=>i.productId===p.id))).map(g => (
              <optgroup key={g.category} label={`${CATEGORY_META[g.category]?.icon || '📦'} ${g.category}（${g.products.length}）`}>
                {g.products.map(p => {
                  const low = (Number(p.reorderLevel) || 0) > 0 && (Number(p.stock) || 0) <= (Number(p.reorderLevel) || 0)
                  return (
                    <option key={p.id} value={p.id}>
                      {low ? '⚠ ' : ''}{p.name}（庫存：{p.stock}{p.reorderLevel ? ` / 安全 ${p.reorderLevel}` : ''}）
                    </option>
                  )
                })}
              </optgroup>
            ))}
            {/* v2.6: 貨源目錄（尚未建檔）群組 */}
            {pickableCatalog.length > 0 && (
              <optgroup label={`📋 貨源目錄（${pickableCatalog.length}）`}>
                {pickableCatalog.map(c => (
                  <option key={c.id} value={c.id}>{c.name}（{c.unit}｜進價 ${c.cost}）</option>
                ))}
              </optgroup>
            )}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={()=>addItem()} disabled={!addProdId}>
            <Plus size={14}/>加入
          </button>
        </div>
        {/* v2.6: 不讓使用者對著灰色按鈕發呆 */}
        {!supplierId && (
          <div style={{fontSize:12, color:'var(--amber)', marginTop:6}}>請先在上面選擇廠商，就能加商品</div>
        )}
      </div>

      {items.length > 0 && (
        <div className="card" style={{overflow:'auto'}}>
          <div style={np.itemsHead}>
            <span>商品</span><span style={{textAlign:'right'}}>數量</span><span style={{textAlign:'right'}}>單價</span><span style={{textAlign:'right'}}>小計</span><span/>
          </div>
          {items.map((item,i)=>{
            const daysOfStock = item._dailyAvg > 0 ? (item.qty / item._dailyAvg).toFixed(0) : null
            return (
            <div key={i} style={np.itemRow}>
              <div>
                <div style={{fontSize:13, fontWeight:500}}>{item.name}</div>
                <div style={{display:'flex', gap:6, marginTop:2, flexWrap:'wrap'}}>
                  {item.isCatalog && <span style={{fontSize:10, color:'var(--accent)', background:'var(--accent-dim)', padding:'1px 6px', borderRadius:4}}>📋 未建檔</span>}
                  {item._fromHistory && <span style={{fontSize:10, color:'var(--blue)', background:'var(--blue-dim)', padding:'1px 6px', borderRadius:4}}>歷史單價</span>}
                  {item._autoFilled && <span style={{fontSize:10, color:'var(--amber)', background:'var(--amber-dim)', padding:'1px 6px', borderRadius:4}}>自動補貨</span>}
                  {item._aiSuggested && <span style={{fontSize:10, color:'var(--purple)', background:'var(--purple-dim)', padding:'1px 6px', borderRadius:4}}>🤖 AI 建議</span>}
                  {daysOfStock && <span style={{fontSize:10, color:'var(--text-tertiary)'}}>可賣 ~{daysOfStock} 天</span>}
                </div>
              </div>
              <input aria-label={'訂購數量 '+item.name} type="number" className="field" value={item.qty} min={0.001} step="0.001" onChange={e=>updateItem(i,'qty',e.target.value)} style={{textAlign:'right', padding:'6px 8px', fontFamily:'var(--font-mono)', fontSize:16,minHeight:44}}/>
              <input aria-label={'採購單價 '+item.name} type="number" className="field" value={item.unitCost} min={0} step="0.01" onChange={e=>updateItem(i,'unitCost',e.target.value)} style={{textAlign:'right', padding:'6px 8px', fontFamily:'var(--font-mono)', fontSize:16,minHeight:44}}/>
              <span style={{textAlign:'right', fontFamily:'var(--font-mono)', fontSize:13}}>{(item.qty*item.unitCost).toLocaleString()}</span>
              <button className="btn-icon btn-sm" style={{color:'var(--red)'}} onClick={()=>setItems(prev=>prev.filter((_,idx)=>idx!==i))}><X size={13}/></button>
            </div>
          )})}
          <div style={{display:'flex', justifyContent:'space-between', padding:'12px 14px', borderTop:'1px solid var(--border-mid)', fontWeight:600}}>
            <span>總計</span>
            <span style={{fontFamily:'var(--font-mono)', color:'var(--gold-bright)'}}>NT$ {total.toLocaleString()}</span>
          </div>
        </div>
      )}

      <div>
        <FL>備註</FL>
        <input className="field" value={note} onChange={e=>setNote(e.target.value)} placeholder="（選填）"/>
      </div>

      <button className="btn btn-primary" style={{width:'100%', padding:13}} disabled={!supplierId||items.length===0} onClick={handleSave}>
        <Check size={16}/>建立進貨單
      </button>
      {/* v2.6: 按鈕還不能按時，說清楚缺哪一步 */}
      {(!supplierId || items.length===0) && (
        <div style={{fontSize:12, color:'var(--text-tertiary)', textAlign:'center', marginTop:-8}}>
          {!supplierId ? '① 請先選擇廠商' : '② 請先加入至少一項商品，才能送出'}
        </div>
      )}

      {/* v2.6: 送出前確認 */}
      {confirming && (
        <div style={ps.overlay}>
          <div style={{...ps.modal, maxWidth:400}} className="animate-scale">
            <div style={{fontWeight:700, fontSize:16, fontFamily:'var(--font-serif)', marginBottom:10}}>確認送出叫貨單</div>
            <p style={{fontSize:14, color:'var(--text-secondary)', lineHeight:1.7, marginBottom:18}}>
              向「{supplier?.name}」叫貨 {items.filter(i=>i.qty>0&&i.unitCost>=0).length} 項，共 NT$ {total.toLocaleString()}。確定送出？
            </p>
            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-primary" style={{flex:1, minHeight:44}} onClick={doSubmit}><Check size={15}/>確定送出</button>
              <button className="btn btn-ghost" style={{flex:1, minHeight:44}} onClick={()=>setConfirming(false)}>再檢查</button>
            </div>
          </div>
        </div>
      )}

      {camMsg && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          background: camMsg.startsWith('✗') ? 'var(--red-dim)' : 'var(--green-dim)',
          color: camMsg.startsWith('✗') ? 'var(--red)' : 'var(--green)',
          border:`1px solid ${camMsg.startsWith('✗') ? 'var(--red)' : 'var(--green)'}`,
          padding:'8px 14px', borderRadius:8, fontSize:13, zIndex:600,
        }}>{camMsg}</div>
      )}

      {showCamera && (
        <Suspense fallback={null}>
        <BarcodeScannerModal
          title="掃條碼加入進貨單"
          mode="continuous"
          onScan={(code) => {
            const p = products.find(x => x.barcode === code)
            if (!p) {
              setCamMsg(`✗ 條碼 ${code} 查無商品`)
              setTimeout(()=>setCamMsg(''), 2500)
              return 'keep'
            }
            if (p.supplierId && p.supplierId !== supplierId) {
              setCamMsg(`✗ ${p.name} 屬於其他供應商`)
              setTimeout(()=>setCamMsg(''), 2500)
              return 'keep'
            }
            if (items.find(i => i.productId === p.id)) {
              setCamMsg(`已在清單：${p.name}`)
              setTimeout(()=>setCamMsg(''), 1500)
              return 'keep'
            }
            addItem(p.id)
            setCamMsg(`✓ 已加入 ${p.name}`)
            setTimeout(()=>setCamMsg(''), 1500)
            return 'keep'
          }}
          onClose={()=>setShowCamera(false)}
        />
        </Suspense>
      )}
    </div>
  )
}

export const np = {
  topGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12 },
  itemsHead: { display:'grid', gridTemplateColumns:'minmax(140px,1fr) 80px 90px 80px 36px', gap:8, padding:'9px 14px', background:'var(--bg-overlay)', fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.05em', minWidth:480 },
  itemRow: { display:'grid', gridTemplateColumns:'minmax(140px,1fr) 80px 90px 80px 36px', gap:8, padding:'9px 14px', borderTop:'1px solid var(--border-dim)', alignItems:'center', minWidth:480 },
}
