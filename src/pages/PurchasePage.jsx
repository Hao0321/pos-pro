import { useState, useMemo, useEffect, lazy, Suspense } from 'react'
import { Plus, Check, X, Truck, Package, ChevronRight, ChevronLeft, ChevronDown, Clock, CheckCircle, Zap, AlertTriangle, Pencil, Camera } from 'lucide-react'
import { writeAuditLog, sanitizeObject } from '../utils/security'
import { isElectron, loadSuppliers, saveSuppliers as dbSaveSuppliers, dbAddSupplier, dbUpdateSupplier, dbDeleteSupplier, loadPurchases, savePurchases as dbSavePurchases, dbAddPurchase, dbUpdatePurchase } from '../utils/dataAccess'
import { DEFAULT_CATEGORIES, CATEGORY_META, groupByCategory } from '../utils/categories'
import { computeSalesVelocity, suggestReorderQty } from '../utils/analytics'
import useIsMobile from '../hooks/useIsMobile'
const BarcodeScannerModal = lazy(() => import('../components/BarcodeScannerModal'))

const STATUS = {
  draft:    { label:'草稿',   color:'var(--text-tertiary)', bg:'var(--bg-active)' },
  ordered:  { label:'已叫貨', color:'var(--blue)',           bg:'var(--blue-dim)' },
  received: { label:'已到貨', color:'var(--green)',          bg:'var(--green-dim)' },
  partial:  { label:'部分到', color:'var(--amber)',          bg:'var(--amber-dim)' },
}

const SEED_SUPPLIERS = [
  { id:'s001', name:'台北乾貨行', contact:'02-2345-6789', payTerms:'月結30天', note:'每週二、五到貨' },
  { id:'s002', name:'統一糖果批發', contact:'0912-111-222', payTerms:'現金', note:'最低叫貨 2000元' },
  { id:'s003', name:'全台醬料行', contact:'04-2345-0001', payTerms:'月結60天', note:'' },
]

const SEED_PURCHASES = [
  {
    id:'PO001', supplierId:'s001', supplierName:'台北乾貨行',
    status:'received', date:'2025-03-10', receivedDate:'2025-03-12',
    items:[
      { productId:'p004', name:'紫菜',  qty:50, unitCost:18, received:50 },
      { productId:'p005', name:'冬粉',  qty:100,unitCost:9,  received:100 },
    ],
    note:'正常補貨', total:2700,
  },
  {
    id:'PO002', supplierId:'s002', supplierName:'統一糖果批發',
    status:'ordered', date:'2025-03-15', receivedDate:null,
    items:[
      { productId:'p001', name:'花生糖', qty:200, unitCost:15, received:0 },
      { productId:'p003', name:'牛軋糖', qty:100, unitCost:20, received:0 },
    ],
    note:'', total:5000,
  },
]

export default function PurchasePage({ store, session }) {
  const { products, updateProduct, orders = [] } = store
  const [suppliers,  setSuppliers]  = useState([])
  const [purchases,  setPurchases]  = useState([])
  const [tab,        setTab]        = useState('list')
  const [selected,   setSelected]   = useState(null)
  const [receiving,  setReceiving]  = useState(null)

  useEffect(() => {
    loadSuppliers(SEED_SUPPLIERS).then(setSuppliers)
    loadPurchases(SEED_PURCHASES).then(setPurchases)
  }, [])

  function saveSuppliers(s) {
    setSuppliers(s)
    if (!isElectron) localStorage.setItem('pos_suppliers', JSON.stringify(s))
  }
  function savePurchases(p) {
    setPurchases(p)
    if (!isElectron) localStorage.setItem('pos_purchases', JSON.stringify(p))
  }

  // 在 Electron 模式同步單筆異動到 SQLite
  async function persistPurchase(po, isNew=false) {
    if (!isElectron) return
    try {
      if (isNew) await dbAddPurchase(po)
      else await dbUpdatePurchase(po.id, po)
    } catch (e) { console.error('persistPurchase failed:', e) }
  }

  function handleReceive(po, receivedQtys) {
    // Update stock for each item
    po.items.forEach(item => {
      const qty = receivedQtys[item.productId] || 0
      if (qty > 0) {
        updateProduct(item.productId, {
          stock: (products.find(p=>p.id===item.productId)?.stock || 0) + qty
        })
      }
    })
    const updatedItems = po.items.map(item => ({
      ...item, received: (receivedQtys[item.productId] || 0),
    }))
    const allReceived = updatedItems.every(i => i.received >= i.qty)
    const anyReceived = updatedItems.some(i => i.received > 0)

    const updated = {
      ...po,
      items: updatedItems,
      status: allReceived ? 'received' : anyReceived ? 'partial' : 'ordered',
      receivedDate: new Date().toISOString().slice(0,10),
    }
    savePurchases(purchases.map(p => p.id===po.id ? updated : p))
    persistPurchase(updated)
    writeAuditLog('PURCHASE_APPROVE', session, { poId: po.id, supplier: po.supplierName })
    setReceiving(null)
    setSelected(updated)
  }

  const pending  = purchases.filter(p => p.status !== 'received')
  const done     = purchases.filter(p => p.status === 'received')
  const totalOwed = pending.filter(p=>p.status==='ordered').reduce((s,p)=>s+p.total,0)

  return (
    <div style={ps.root}>
      <div style={ps.header}>
        <div>
          <h2 style={ps.title}>進貨管理</h2>
          <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
            {pending.length} 張待處理 · 待付款 NT$ {totalOwed.toLocaleString()}
          </div>
        </div>
        <div style={{display:'flex', gap:8}}>
          {[['list','進貨單'],['new','+ 新增'],['suppliers','供應商'],['payable','應付帳款']].map(([k,l])=>(
            <button key={k} onClick={()=>{setTab(k);setSelected(null)}} className={`btn btn-sm ${tab===k?'btn-primary':'btn-ghost'}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === 'list'      && <PurchaseList purchases={purchases} selected={selected} onSelect={setSelected} onReceive={setReceiving}/>}
      {tab === 'new'       && <NewPurchase  products={products} suppliers={suppliers} purchases={purchases} orders={orders} onSave={po=>{savePurchases([po,...purchases]);persistPurchase(po,true);setTab('list');writeAuditLog('PURCHASE_CREATE',session,{id:po.id})}}/>}
      {tab === 'suppliers' && <SupplierList suppliers={suppliers} products={products} onSave={saveSuppliers} onGoInventory={()=>store.setView?.('inventory')}/>}
      {tab === 'payable'   && <PayableTab   purchases={purchases} suppliers={suppliers} onMarkPaid={(id)=>{
        const target = purchases.find(p => p.id === id)
        if (!target) return
        const updatedPo = { ...target, paidDate: new Date().toISOString().slice(0,10), status:'paid' }
        const updated = purchases.map(p => p.id === id ? updatedPo : p)
        savePurchases(updated)
        persistPurchase(updatedPo)
        writeAuditLog('PURCHASE_PAY', session, { poId:id })
      }}/>}

      {receiving && (
        <ReceiveModal po={receiving} products={products} onConfirm={q=>handleReceive(receiving,q)} onClose={()=>setReceiving(null)}/>
      )}
    </div>
  )
}

// ── 進貨單列表 ──────────────────────────────────────────────
function PurchaseList({ purchases, selected, onSelect, onReceive }) {
  const isMobile = useIsMobile()
  // mobile：選中就只看詳情，未選看列表
  const showList   = !isMobile || !selected
  const showDetail = !isMobile || !!selected

  return (
    <div style={{display:'flex', flex:1, gap:14, overflow:'hidden', flexDirection: isMobile ? 'column' : 'row'}}>
      {showList && (
      <div style={{width: isMobile ? '100%' : 300, flexShrink:0, display:'flex', flexDirection:'column', gap:8, overflowY:'auto'}}>
        {purchases.length === 0 && (
          <div style={{textAlign:'center', padding:'40px', color:'var(--text-tertiary)', fontSize:13}}>尚無進貨單</div>
        )}
        {purchases.map(po => {
          const st = STATUS[po.status]
          return (
            <button key={po.id} onClick={()=>onSelect(po)} style={{
              ...ps.poCard,
              border: `1px solid ${selected?.id===po.id?'var(--border-mid)':'var(--border-dim)'}`,
              background: selected?.id===po.id?'var(--bg-active)':'var(--bg-raised)',
            }}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:6}}>
                <span style={{fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-secondary)'}}>{po.id}</span>
                <span style={{...ps.statusBadge, background:st.bg, color:st.color}}>{st.label}</span>
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
                <button className="btn-icon btn-sm" onClick={()=>onSelect(null)} aria-label="返回">
                  <ChevronLeft size={16}/>
                </button>
              )}
              <div style={{minWidth:0}}>
                <div style={{fontWeight:700, fontSize:16, fontFamily:'var(--font-serif)'}}>{selected.supplierName}</div>
                <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
                  進貨單 {selected.id} · 叫貨日 {selected.date}
                </div>
              </div>
            </div>
            {selected.status === 'ordered' && (
              <button className="btn btn-primary btn-sm" onClick={()=>onReceive(selected)}>
                <Truck size={14}/>確認到貨
              </button>
            )}
          </div>
          <div className="card" style={{overflow:'hidden', marginBottom:14}}>
            <div style={{display:'grid', gridTemplateColumns:'1fr 70px 70px 70px 70px', gap:8, padding:'9px 14px', background:'var(--bg-overlay)', fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.05em'}}>
              <span>商品</span><span style={{textAlign:'right'}}>叫貨量</span><span style={{textAlign:'right'}}>單價</span><span style={{textAlign:'right'}}>到貨量</span><span style={{textAlign:'right'}}>小計</span>
            </div>
            {selected.items.map((item,i) => (
              <div key={i} style={{display:'grid', gridTemplateColumns:'1fr 70px 70px 70px 70px', gap:8, padding:'10px 14px', borderTop:'1px solid var(--border-dim)', fontSize:13, alignItems:'center'}}>
                <span style={{fontWeight:500}}>{item.name}</span>
                <span style={{textAlign:'right', fontFamily:'var(--font-mono)'}}>{item.qty}</span>
                <span style={{textAlign:'right', fontFamily:'var(--font-mono)', color:'var(--text-secondary)'}}>{item.unitCost}</span>
                <span style={{textAlign:'right', fontFamily:'var(--font-mono)', color: item.received===item.qty?'var(--green)':item.received>0?'var(--amber)':'var(--text-tertiary)'}}>{item.received ?? '—'}</span>
                <span style={{textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:500}}>{(item.qty*item.unitCost).toLocaleString()}</span>
              </div>
            ))}
            <div style={{display:'flex', justifyContent:'space-between', padding:'12px 14px', borderTop:'1px solid var(--border-mid)', fontWeight:600}}>
              <span>總計</span>
              <span style={{fontFamily:'var(--font-mono)', color:'var(--gold-bright)'}}>NT$ {selected.total.toLocaleString()}</span>
            </div>
          </div>
          {selected.note && <div style={{fontSize:13, color:'var(--text-secondary)', padding:'10px 14px', background:'var(--bg-overlay)', borderRadius:8}}>備註：{selected.note}</div>}
        </div>
      ) : !isMobile && (
        <div style={ps.emptyDetail}>
          <Package size={32} style={{opacity:.2, marginBottom:12}}/>
          <span style={{color:'var(--text-tertiary)', fontSize:13}}>選擇進貨單查看詳情</span>
        </div>
      ))}
    </div>
  )
}

// ── 新增進貨單 ──────────────────────────────────────────────
function NewPurchase({ products, suppliers, purchases, orders = [], onSave }) {
  // AI: 近 30 天每日銷售速度
  const salesVelocity = useMemo(() => computeSalesVelocity(orders, 30), [orders])
  const [supplierId, setSupplierId] = useState('')
  const [date,       setDate]       = useState(new Date().toISOString().slice(0,10))
  const [items,      setItems]      = useState([])
  const [note,       setNote]       = useState('')
  const [addProdId,  setAddProdId]  = useState('')
  const [catFilter,  setCatFilter]  = useState('all')
  const [showCamera, setShowCamera] = useState(false)
  const [camMsg,     setCamMsg]     = useState('')

  const supplier = suppliers.find(s=>s.id===supplierId)

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
    const safe = key === 'qty' ? Math.max(1, num) : num
    setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[key]:safe}:it))
  }

  const total = items.reduce((s,i)=>s+i.qty*i.unitCost,0)
  const unaddedLow = lowStockForSupplier.filter(p => !items.find(i => i.productId === p.id)).length

  function handleSave() {
    if (!supplierId || items.length===0) return
    // audit #11: 防 supplier 同步被改造成 undefined（race condition）
    if (!supplier) return
    // audit #12: 過濾掉 qty<=0 的品項
    const validItems = items.filter(i => i.qty > 0 && i.unitCost >= 0)
    if (validItems.length === 0) return
    const po = {
      id: 'PO' + Date.now(), supplierId, supplierName: supplier.name || '',
      status:'ordered', date, receivedDate:null,
      items: validItems.map(({_fromHistory, _autoFilled, _aiSuggested, _dailyAvg, ...rest}) => rest),
      note, total: validItems.reduce((s,i)=>s+i.qty*i.unitCost,0),
    }
    onSave(po)
  }

  return (
    <div style={{maxWidth:780, display:'flex', flexDirection:'column', gap:16, overflowY:'auto', height:'100%'}}>
      <div style={np.topGrid}>
        <div>
          <FL>供應商 *</FL>
          <select className="field" value={supplierId} onChange={e=>{setSupplierId(e.target.value);setAddProdId('')}} style={{cursor:'pointer'}}>
            <option value="">— 選擇供應商 —</option>
            {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <FL>叫貨日期</FL>
          <input type="date" className="field" value={date} onChange={e=>setDate(e.target.value)}/>
        </div>
      </div>

      {supplier && (
        <div style={{fontSize:12, color:'var(--text-secondary)', background:'var(--bg-overlay)', borderRadius:8, padding:'10px 14px'}}>
          📞 {supplier.contact} · {supplier.payTerms}{supplier.note ? ` · ${supplier.note}` : ''}
          <div style={{marginTop:4, color:'var(--text-tertiary)', fontSize:11}}>
            該供應商商品 {products.filter(p=>p.supplierId===supplierId).length} 項
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
          </select>
          <button className="btn btn-ghost btn-sm" onClick={()=>addItem()} disabled={!addProdId}>
            <Plus size={14}/>加入
          </button>
        </div>
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
                  {item._fromHistory && <span style={{fontSize:10, color:'var(--blue)', background:'var(--blue-dim)', padding:'1px 6px', borderRadius:4}}>歷史單價</span>}
                  {item._autoFilled && <span style={{fontSize:10, color:'var(--amber)', background:'var(--amber-dim)', padding:'1px 6px', borderRadius:4}}>自動補貨</span>}
                  {item._aiSuggested && <span style={{fontSize:10, color:'var(--purple)', background:'var(--purple-dim)', padding:'1px 6px', borderRadius:4}}>🤖 AI 建議</span>}
                  {daysOfStock && <span style={{fontSize:10, color:'var(--text-tertiary)'}}>可賣 ~{daysOfStock} 天</span>}
                </div>
              </div>
              <input type="number" className="field" value={item.qty} min={1} onChange={e=>updateItem(i,'qty',e.target.value)} style={{textAlign:'right', padding:'6px 8px', fontFamily:'var(--font-mono)', fontSize:13}}/>
              <input type="number" className="field" value={item.unitCost} min={0} onChange={e=>updateItem(i,'unitCost',e.target.value)} style={{textAlign:'right', padding:'6px 8px', fontFamily:'var(--font-mono)', fontSize:13}}/>
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

const np = {
  topGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12 },
  itemsHead: { display:'grid', gridTemplateColumns:'minmax(140px,1fr) 80px 90px 80px 36px', gap:8, padding:'9px 14px', background:'var(--bg-overlay)', fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.05em', minWidth:480 },
  itemRow: { display:'grid', gridTemplateColumns:'minmax(140px,1fr) 80px 90px 80px 36px', gap:8, padding:'9px 14px', borderTop:'1px solid var(--border-dim)', alignItems:'center', minWidth:480 },
}

// ── 確認到貨 Modal ──────────────────────────────────────────
function ReceiveModal({ po, products, onConfirm, onClose }) {
  const [qtys, setQtys] = useState(() => {
    const m = {}
    po.items.forEach(i => { m[i.productId] = i.qty })
    return m
  })

  return (
    <div style={ps.overlay}>
      <div style={ps.modal} className="animate-scale">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18}}>
          <div>
            <div style={{fontWeight:700, fontSize:15, fontFamily:'var(--font-serif)'}}>確認到貨</div>
            <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>{po.supplierName} · {po.id}</div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <p style={{fontSize:13, color:'var(--text-secondary)', marginBottom:16}}>請核對實際到貨數量，系統將自動更新庫存：</p>
        {po.items.map(item => {
          const current = products.find(p=>p.id===item.productId)?.stock || 0
          return (
            <div key={item.productId} style={{display:'grid', gridTemplateColumns:'1fr 70px 80px', gap:12, padding:'10px 0', borderBottom:'1px solid var(--border-dim)', alignItems:'center'}}>
              <div>
                <div style={{fontSize:13, fontWeight:500}}>{item.name}</div>
                <div style={{fontSize:11, color:'var(--text-tertiary)'}}>現有庫存：{current}</div>
              </div>
              <div style={{textAlign:'right', fontSize:12, color:'var(--text-secondary)'}}>叫貨 {item.qty}</div>
              <input
                type="number" min={0} max={item.qty * 2}
                className="field"
                value={qtys[item.productId] ?? item.qty}
                onChange={e=>setQtys(q=>({...q,[item.productId]:parseInt(e.target.value)||0}))}
                style={{textAlign:'right', fontFamily:'var(--font-mono)', padding:'8px 10px'}}
              />
            </div>
          )
        })}
        <div style={{marginTop:16, padding:'10px 12px', background:'var(--green-dim)', borderRadius:8, fontSize:12, color:'var(--green)'}}>
          ✓ 確認後庫存將自動增加，並記錄稽核日誌
        </div>
        <div style={{display:'flex', gap:10, marginTop:16}}>
          <button className="btn btn-primary" style={{flex:1, padding:12}} onClick={()=>onConfirm(qtys)}>
            <CheckCircle size={15}/>確認到貨
          </button>
          <button className="btn btn-ghost" style={{flex:1}} onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}

// ── 供應商管理（含商品清單展開）──────────────────────────────
function SupplierList({ suppliers, products = [], onSave, onGoInventory }) {
  const [editing, setEditing] = useState(null)
  const [form,    setForm]    = useState({ name:'', contact:'', payTerms:'', note:'' })
  const [expanded, setExpanded] = useState(null) // 展開哪一家看商品

  function save() {
    if (!form.name) return
    const clean = sanitizeObject(form)
    if (editing === 'new') onSave([...suppliers, { ...clean, id:'s'+Date.now() }])
    else onSave(suppliers.map(s=>s.id===editing?{...s,...clean}:s))
    setEditing(null)
  }

  function productsOf(supplierId) {
    return products.filter(p => p.supplierId === supplierId)
  }

  return (
    <div style={{maxWidth:760, width:'100%', overflowY:'auto'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
        <div style={{fontSize:12, color:'var(--text-tertiary)'}}>
          共 {suppliers.length} 家供應商 · {products.filter(p=>p.supplierId).length} 項已指定供應商
        </div>
        <button className="btn btn-primary btn-sm" onClick={()=>{setEditing('new');setForm({name:'',contact:'',payTerms:'',note:''})}}>
          <Plus size={14}/>新增供應商
        </button>
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {suppliers.length === 0 && (
          <div className="card" style={{textAlign:'center', padding:'40px', color:'var(--text-tertiary)', fontSize:13}}>
            尚無供應商，點右上「新增供應商」開始
          </div>
        )}
        {suppliers.map(s => {
          const supplierProducts = productsOf(s.id)
          const isOpen = expanded === s.id
          const groups = isOpen ? groupByCategory(supplierProducts) : []

          return (
            <div key={s.id} className="card" style={{overflow:'hidden'}}>
              {/* 卡片頭：供應商基本資料 */}
              <div style={{padding:'14px 16px', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
                <div style={{flex:1, minWidth:200}}>
                  <div style={{fontWeight:600, fontSize:14}}>{s.name}</div>
                  <div style={{fontSize:12, color:'var(--text-secondary)', marginTop:3}}>
                    📞 {s.contact || '—'} · {s.payTerms || '—'}
                    {s.note && <span style={{color:'var(--text-tertiary)'}}> · {s.note}</span>}
                  </div>
                </div>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                    style={{
                      display:'flex', alignItems:'center', gap:5,
                      padding:'5px 10px', borderRadius:6, fontSize:12,
                      background: isOpen ? 'var(--bg-active)' : 'var(--bg-overlay)',
                      color: 'var(--text-secondary)',
                      border:'1px solid var(--border-dim)',
                    }}
                  >
                    <Package size={12}/>
                    {supplierProducts.length} 項商品
                    <ChevronDown size={12} style={{transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms'}}/>
                  </button>
                  <button className="btn-icon btn-sm" onClick={()=>{setEditing(s.id);setForm(s)}} title="編輯">
                    <Pencil size={13}/>
                  </button>
                </div>
              </div>

              {/* 展開：商品按分類分組 */}
              {isOpen && (
                <div style={{borderTop:'1px solid var(--border-dim)', padding:'12px 16px', background:'var(--bg-overlay)'}}>
                  {supplierProducts.length === 0 ? (
                    <div style={{textAlign:'center', padding:'20px 0', color:'var(--text-tertiary)', fontSize:12}}>
                      此供應商還沒有指定的商品
                      {onGoInventory && (
                        <div style={{marginTop:8}}>
                          <button className="btn btn-ghost btn-sm" onClick={onGoInventory}>
                            前往庫存管理 → 編輯商品設「主要供應商」
                          </button>
                        </div>
                      )}
                    </div>
                  ) : groups.map(g => (
                    <div key={g.category} style={{marginBottom:10}}>
                      <div style={{
                        fontSize:11, fontWeight:600, color:'var(--text-tertiary)',
                        letterSpacing:'.05em', marginBottom:6,
                        display:'flex', alignItems:'center', gap:6,
                      }}>
                        <span>{CATEGORY_META[g.category]?.icon || '📦'}</span>
                        <span>{g.category}</span>
                        <span style={{fontFamily:'var(--font-mono)', fontWeight:400}}>· {g.products.length}</span>
                      </div>
                      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:6}}>
                        {g.products.map(p => {
                          const reorder = Number(p.reorderLevel) || 0
                          const stock = Number(p.stock) || 0
                          const low = reorder > 0 && stock <= reorder
                          return (
                            <div key={p.id} style={{
                              padding:'8px 10px',
                              borderRadius:6,
                              background:'var(--bg-raised)',
                              border:`1px solid ${low ? 'var(--amber)' : 'var(--border-dim)'}`,
                              fontSize:12,
                            }}>
                              <div style={{fontWeight:500, marginBottom:2}}>{p.name}</div>
                              <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-tertiary)'}}>
                                <span>庫存 {stock}{reorder ? `/安全 ${reorder}` : ''}</span>
                                <span style={{fontFamily:'var(--font-mono)'}}>${p.cost || '—'}</span>
                              </div>
                              {low && <div style={{fontSize:10, color:'var(--amber)', marginTop:2}}>⚠ 待補貨</div>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {editing && (
        <div style={ps.overlay}>
          <div style={{...ps.modal, maxWidth:400}} className="animate-scale">
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:18}}>
              <span style={{fontWeight:700}}>{editing==='new'?'新增供應商':'編輯供應商'}</span>
              <button className="btn-icon" onClick={()=>setEditing(null)}><X size={16}/></button>
            </div>
            {[['name','名稱 *'],['contact','聯絡方式'],['payTerms','付款條件'],['note','備註']].map(([k,l])=>(
              <div key={k} style={{marginBottom:12}}>
                <FL>{l}</FL>
                <input className="field" value={form[k]||''} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} placeholder={l}/>
              </div>
            ))}
            <div style={{display:'flex', gap:10, marginTop:4}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={save}><Check size={15}/>儲存</button>
              <button className="btn btn-ghost"   style={{flex:1}} onClick={()=>setEditing(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FL({children}){return <div style={{fontSize:11,color:'var(--text-tertiary)',marginBottom:5,letterSpacing:'.03em'}}>{children}</div>}

function PayableTab({ purchases, suppliers, onMarkPaid }) {
  // 已收貨但未付款 = 應付帳款
  const unpaid = purchases.filter(p => p.status === 'received' && !p.paidDate)
  const paid = purchases.filter(p => p.paidDate)

  // 依供應商彙總
  const bySupplier = {}
  unpaid.forEach(p => {
    const sid = p.supplierId || p.supplierName || '未指定'
    if (!bySupplier[sid]) bySupplier[sid] = { name: p.supplierName || '未指定', total: 0, count: 0, items: [] }
    bySupplier[sid].total += p.total
    bySupplier[sid].count += 1
    bySupplier[sid].items.push(p)
  })
  const supplierList = Object.values(bySupplier).sort((a,b) => b.total - a.total)
  const totalUnpaid = unpaid.reduce((s,p) => s + p.total, 0)

  return (
    <div style={{flex:1, overflowY:'auto', padding:'4px 0'}}>
      <div className="card" style={{padding:'18px 20px', marginBottom:14, borderTop:'2px solid var(--red)'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
          <span style={{fontSize:12, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'.05em'}}>未付款總額</span>
          <span style={{fontFamily:'var(--font-mono)', fontSize:24, fontWeight:600, color:'var(--red)'}}>NT$ {totalUnpaid.toLocaleString()}</span>
        </div>
        <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:4}}>
          {unpaid.length} 張未付款 · {supplierList.length} 家供應商
        </div>
      </div>

      {supplierList.length === 0 ? (
        <div className="card" style={{padding:'40px 20px', textAlign:'center', color:'var(--text-tertiary)'}}>
          🎉 沒有未付款進貨
        </div>
      ) : supplierList.map((s, i) => (
        <div key={i} className="card" style={{padding:'18px 20px', marginBottom:10}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <div>
              <div style={{fontSize:14, fontWeight:600}}>{s.name}</div>
              <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:2}}>{s.count} 筆未付</div>
            </div>
            <div style={{fontFamily:'var(--font-mono)', fontSize:18, fontWeight:600, color:'var(--red)'}}>
              NT$ {s.total.toLocaleString()}
            </div>
          </div>
          <table style={{width:'100%', fontSize:13}}>
            <tbody>
              {s.items.map(p => (
                <tr key={p.id} style={{borderTop:'1px solid var(--border-dim)'}}>
                  <td style={{padding:'8px 4px'}}>{p.id}</td>
                  <td style={{padding:'8px 4px', color:'var(--text-tertiary)'}}>{p.receivedDate || p.date}</td>
                  <td style={{padding:'8px 4px', textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:500}}>
                    NT$ {p.total.toLocaleString()}
                  </td>
                  <td style={{padding:'8px 4px', textAlign:'right'}}>
                    <button className="btn btn-primary btn-sm" onClick={()=>{ if(confirm(`確認 ${p.id} 已付款？`)) onMarkPaid(p.id) }}>標記已付</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {paid.length > 0 && (
        <details style={{marginTop:14}}>
          <summary style={{cursor:'pointer', padding:'10px 16px', fontSize:13, color:'var(--text-secondary)'}}>
            已付款歷史 ({paid.length})
          </summary>
          <div className="card" style={{padding:'12px 16px', marginTop:8}}>
            <table style={{width:'100%', fontSize:12}}>
              <thead>
                <tr style={{color:'var(--text-tertiary)'}}>
                  <th style={{textAlign:'left', padding:'6px 4px'}}>進貨單</th>
                  <th style={{textAlign:'left', padding:'6px 4px'}}>供應商</th>
                  <th style={{textAlign:'left', padding:'6px 4px'}}>付款日</th>
                  <th style={{textAlign:'right', padding:'6px 4px'}}>金額</th>
                </tr>
              </thead>
              <tbody>
                {paid.slice(0,30).map(p => (
                  <tr key={p.id} style={{borderTop:'1px solid var(--border-dim)'}}>
                    <td style={{padding:'6px 4px'}}>{p.id}</td>
                    <td style={{padding:'6px 4px'}}>{p.supplierName}</td>
                    <td style={{padding:'6px 4px', color:'var(--text-tertiary)'}}>{p.paidDate}</td>
                    <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'var(--font-mono)'}}>NT$ {p.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}

const ps = {
  root:{display:'flex',flexDirection:'column',height:'100%',padding:'16px',gap:14,overflow:'hidden'},
  header:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexShrink:0,flexWrap:'wrap',gap:10},
  title:{fontFamily:'var(--font-serif)',fontSize:20,fontWeight:600},
  poCard:{display:'flex',flexDirection:'column',borderRadius:'var(--r3)',padding:'13px 15px',textAlign:'left',cursor:'pointer',transition:'all 150ms',width:'100%'},
  statusBadge:{fontSize:10,padding:'2px 8px',borderRadius:20,fontWeight:500},
  detail:{flex:1,overflowY:'auto'},
  emptyDetail:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'},
  overlay:{position:'fixed',inset:0,background:'rgba(44,42,38,0.25)',backdropFilter:'blur(2px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200},
  modal:{background:'var(--bg-raised)',border:'1px solid var(--border-dim)',borderRadius:'var(--r4)',padding:24,width:'90%',maxWidth:560},
}
