import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react'
import { Plus, Check, X, Truck, Package, ChevronRight, ChevronLeft, ChevronDown, Clock, CheckCircle, Zap, AlertTriangle, Pencil, Trash2, Camera } from 'lucide-react'
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
  paid:     { label:'已付款', color:'var(--green)',          bg:'var(--green-dim)' },
}

// v2.6: 進貨單品項的穩定 key — 貨源目錄品項尚未建檔（productId 為 null），改用列索引
const poItemKey = (item, idx) => item.productId || `_cat${idx}`

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
  const { products, updateProduct, addProduct, orders = [] } = store
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
    // v2.6: 已建檔品項直接加庫存；貨源目錄品項（productId 為 null）到貨時自動建檔
    const createdLinks = []   // 自動建檔的商品要回寫到廠商貨源目錄，避免下次叫貨重複建檔
    const updatedItems = po.items.map((item, idx) => {
      // 夾限：不能是負數、累計收貨不得超過叫貨量的 2 倍（容忍多送，但擋掉誤填天文數字/負數倒扣）
      const raw = receivedQtys[poItemKey(item, idx)] || 0
      const cap = Math.max(0, item.qty * 2 - (item.received || 0))
      const qty = Math.max(0, Math.min(raw, cap))
      let productId = item.productId
      if (qty > 0) {
        if (productId) {
          updateProduct(productId, {
            stock: (products.find(p=>p.id===productId)?.stock || 0) + qty
          })
        } else if (addProduct) {
          const created = addProduct({
            name: item.name,
            cost: item.unitCost,
            price: Math.round(item.unitCost * 1.3), // 起始加價 30%，可到庫存管理再調
            stock: qty,
            unit: item.unit || '個',
            supplierId: po.supplierId,
            noBarcode: true,
          })
          productId = created?.id || null
          if (item.catalogId && created?.id) createdLinks.push({ catalogId: item.catalogId, productId: created.id })
        }
      }
      // 累加而非覆寫：部分到貨後補收，qty 是「本次新到的差額」
      return { ...item, productId, received: (item.received || 0) + qty }
    })

    // 回寫貨源目錄：把新建檔商品的 id 綁回 catalog 項，之後叫貨會直接對到庫存商品（不再重複建檔）
    if (createdLinks.length > 0 && po.supplierId) {
      const supNext = suppliers.map(s => s.id !== po.supplierId ? s : {
        ...s,
        catalog: (s.catalog || []).map(ci => {
          const link = createdLinks.find(l => l.catalogId === ci.id)
          return link ? { ...ci, productId: link.productId } : ci
        }),
      })
      saveSuppliers(supNext)
      if (isElectron) {
        const sup = supNext.find(s => s.id === po.supplierId)
        if (sup) dbUpdateSupplier(sup.id, sup).catch(e => console.error('[POS] catalog link-back fail:', e))
      }
    }
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

  // v2.6: 已付款 (paid) / 部分到 (partial) 也算已到貨，不再從已到貨清單消失
  const DONE_STATUS = ['received', 'partial', 'paid']
  const pending  = purchases.filter(p => !DONE_STATUS.includes(p.status))
  const done     = purchases.filter(p => DONE_STATUS.includes(p.status))
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
      {tab === 'suppliers' && <SupplierList suppliers={suppliers} products={products} purchases={purchases} onSave={saveSuppliers} onGoInventory={()=>store.setView?.('inventory')}/>}
      {tab === 'payable'   && <PayableTab   purchases={purchases} suppliers={suppliers} onMarkPaid={(id)=>{
        const target = purchases.find(p => p.id === id)
        if (!target) return
        // 保底：部分到貨不改 status（否則「補收到貨」按鈕會消失、貨永遠收不齊）
        const updatedPo = { ...target, paidDate: new Date().toISOString().slice(0,10), status: target.status === 'partial' ? 'partial' : 'paid' }
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
            {(selected.status === 'ordered' || selected.status === 'partial') && (
              <button className="btn btn-primary btn-sm" onClick={()=>onReceive(selected)}>
                <Truck size={14}/>{selected.status === 'partial' ? '補收到貨' : '確認到貨'}
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
    const safe = key === 'qty' ? Math.max(1, num) : num
    setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[key]:safe}:it))
  }

  const total = items.reduce((s,i)=>s+i.qty*i.unitCost,0)
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
    if (validItems.length === 0) { toast('✗ 商品數量或單價不對，請檢查後再送出'); return }
    setConfirming(true) // v2.6: 先確認再送出，避免誤觸
  }

  function doSubmit() {
    if (submitOnce.current) return
    submitOnce.current = true
    const validItems = items.filter(i => i.qty > 0 && i.unitCost >= 0)
    const po = {
      id: 'PO' + Date.now(), supplierId, supplierName: supplier.name || '',
      status:'ordered', date, receivedDate:null,
      items: validItems.map(({_fromHistory, _autoFilled, _aiSuggested, _dailyAvg, ...rest}) => rest),
      note, total: validItems.reduce((s,i)=>s+i.qty*i.unitCost,0),
    }
    setConfirming(false)
    onSave(po)
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

const np = {
  topGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12 },
  itemsHead: { display:'grid', gridTemplateColumns:'minmax(140px,1fr) 80px 90px 80px 36px', gap:8, padding:'9px 14px', background:'var(--bg-overlay)', fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.05em', minWidth:480 },
  itemRow: { display:'grid', gridTemplateColumns:'minmax(140px,1fr) 80px 90px 80px 36px', gap:8, padding:'9px 14px', borderTop:'1px solid var(--border-dim)', alignItems:'center', minWidth:480 },
}

// ── 確認到貨 Modal ──────────────────────────────────────────
function ReceiveModal({ po, products, onConfirm, onClose }) {
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
      <div style={ps.modal} className="animate-scale">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18}}>
          <div>
            <div style={{fontWeight:700, fontSize:15, fontFamily:'var(--font-serif)'}}>確認到貨</div>
            <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>{po.supplierName} · {po.id}</div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        <p style={{fontSize:13, color:'var(--text-secondary)', marginBottom:12}}>請核對實際到貨數量，系統將自動更新庫存：</p>
        {/* v2.6: 全部照單全收 — 一鍵把到貨量填成叫貨量 */}
        <button className="btn btn-ghost" style={{width:'100%', minHeight:44, marginBottom:12}} onClick={fillAll}>
          <CheckCircle size={15}/>全部照單全收（填入尚未到貨的數量）
        </button>
        {po.items.map((item, idx) => {
          const key = poItemKey(item, idx)
          const current = products.find(p=>p.id===item.productId)?.stock || 0
          return (
            <div key={key} style={{display:'grid', gridTemplateColumns:'1fr 70px 80px', gap:12, padding:'10px 0', borderBottom:'1px solid var(--border-dim)', alignItems:'center'}}>
              <div>
                <div style={{fontSize:13, fontWeight:500}}>
                  {item.name}
                  {!item.productId && <span style={{fontSize:10, color:'var(--accent)', background:'var(--accent-dim)', padding:'1px 6px', borderRadius:4, marginLeft:6}}>📋 未建檔</span>}
                </div>
                <div style={{fontSize:11, color:'var(--text-tertiary)'}}>
                  {item.productId ? `現有庫存：${current}` : '未建檔品項到貨後會自動建檔'}
                </div>
              </div>
              <div style={{textAlign:'right', fontSize:12, color:'var(--text-secondary)'}}>
                叫貨 {item.qty}{(item.received||0) > 0 && <div style={{fontSize:10, color:'var(--amber)'}}>已收 {item.received}</div>}
              </div>
              <input
                type="number" min={0} max={item.qty * 2}
                className="field"
                value={qtys[key] ?? item.qty}
                onChange={e=>setQtys(q=>({...q,[key]:parseInt(e.target.value)||0}))}
                style={{textAlign:'right', fontFamily:'var(--font-mono)', padding:'8px 10px'}}
              />
            </div>
          )
        })}
        <div style={{marginTop:16, padding:'10px 12px', background:'var(--green-dim)', borderRadius:8, fontSize:12, color:'var(--green)'}}>
          ✓ 確認後庫存將自動增加，並記錄稽核日誌{hasUnfiled ? '；未建檔品項會自動建立商品資料' : ''}
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
function SupplierList({ suppliers, products = [], purchases = [], onSave, onGoInventory }) {
  const [editing, setEditing] = useState(null)
  const [form,    setForm]    = useState({ name:'', contact:'', phone:'', payTerms:'', note:'' })
  const [expanded, setExpanded] = useState(null) // 展開哪一家看商品
  const [deleting, setDeleting] = useState(null) // v2.6: { s, blocked, boundCount, openPoCount }
  const [catForm,  setCatForm]  = useState(null) // v2.6: { supplierId, name, unit, cost } 貨源新增表單

  // v2.6: Electron 同步單筆供應商到 SQLite（修正：之前只寫 localStorage，重開 app 就消失）
  function persistSupplier(sup, isNew = false) {
    if (!isElectron) return
    const payload = {
      id: sup.id,
      name: sup.name || '', contact: sup.contact || '', phone: sup.phone || '',
      payTerms: sup.payTerms || '', note: sup.note || '',
      catalog: Array.isArray(sup.catalog) ? sup.catalog : [],
    }
    const op = isNew ? dbAddSupplier(payload) : dbUpdateSupplier(sup.id, payload)
    op.catch(e => console.error(`[POS] supplier ${isNew ? 'add' : 'update'} fail:`, e))
  }

  function save() {
    if (!form.name) return
    // v2.6: catalog 是陣列（sanitizeObject 會把陣列變成物件），modal 不碰 catalog，
    // 一律沿用該供應商目前的 catalog
    const clean = sanitizeObject(form)
    if (editing === 'new') {
      const sup = { ...clean, catalog: [], id: 's' + Date.now() }
      onSave([...suppliers, sup])
      persistSupplier(sup, true)
    } else {
      const prev = suppliers.find(s => s.id === editing) || {}
      const sup = { ...prev, ...clean, catalog: Array.isArray(prev.catalog) ? prev.catalog : [] }
      onSave(suppliers.map(s => s.id === editing ? sup : s))
      persistSupplier(sup)
    }
    setEditing(null)
  }

  // v2.6: 貨源目錄異動 → 立即走同一條儲存路徑（state + localStorage / SQLite）
  function updateCatalog(s, newCatalog) {
    const updated = { ...s, catalog: newCatalog }
    onSave(suppliers.map(x => x.id === s.id ? updated : x))
    persistSupplier(updated)
  }
  function addCatalogItem(s) {
    const name = (catForm?.name || '').trim()
    if (!name) return
    const list = Array.isArray(s.catalog) ? s.catalog : []
    updateCatalog(s, [...list, {
      id: 'ci' + Date.now() + list.length,
      name,
      unit: (catForm.unit || '').trim() || '個',
      cost: Number(catForm.cost) || 0,
      barcode: '',
      productId: '',
    }])
    setCatForm({ supplierId: s.id, name: '', unit: '個', cost: '' }) // 清空續填，方便連續新增
  }
  function updateCatalogItem(s, ciId, key, val) {
    updateCatalog(s, (s.catalog || []).map(ci =>
      ci.id === ciId ? { ...ci, [key]: key === 'cost' ? (parseFloat(val) || 0) : val } : ci))
  }
  function removeCatalogItem(s, ciId) {
    updateCatalog(s, (s.catalog || []).filter(ci => ci.id !== ciId))
  }

  // v2.6: 刪除廠商 — 有綁定商品或未完成叫貨單時擋下，否則先確認再刪
  function askDelete(s) {
    const boundCount  = products.filter(p => p.supplierId === s.id).length
    const openPoCount = purchases.filter(p => p.supplierId === s.id && ['ordered','partial','draft'].includes(p.status)).length
    setDeleting({ s, blocked: boundCount > 0 || openPoCount > 0, boundCount, openPoCount })
  }
  function confirmDelete() {
    const { s } = deleting
    onSave(suppliers.filter(x => x.id !== s.id))
    if (isElectron) dbDeleteSupplier(s.id).catch(e => console.error('[POS] supplier delete fail:', e))
    if (expanded === s.id) setExpanded(null)
    setDeleting(null)
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
        <button className="btn btn-primary btn-sm" onClick={()=>{setEditing('new');setForm({name:'',contact:'',phone:'',payTerms:'',note:''})}}>
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
                    📞 {s.contact || '—'}{s.phone ? ` · ☎ ${s.phone}` : ''} · {s.payTerms || '—'}
                    {s.note && <span style={{color:'var(--text-tertiary)'}}> · {s.note}</span>}
                  </div>
                </div>
                <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                    style={{
                      display:'flex', alignItems:'center', gap:5,
                      padding:'10px 12px', minHeight:40, borderRadius:6, fontSize:12,
                      background: isOpen ? 'var(--bg-active)' : 'var(--bg-overlay)',
                      color: 'var(--text-secondary)',
                      border:'1px solid var(--border-dim)',
                    }}
                  >
                    <Package size={12}/>
                    {(s.catalog || []).length} 項貨源 · {supplierProducts.length} 項商品
                    <ChevronDown size={12} style={{transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms'}}/>
                  </button>
                  {/* v2.6: 明確的文字按鈕（≥40px），不再只有小圖示 */}
                  <button className="btn btn-ghost btn-sm" style={{minHeight:40}} onClick={()=>{setEditing(s.id);setForm({ name:s.name||'', contact:s.contact||'', phone:s.phone||'', payTerms:s.payTerms||'', note:s.note||'' })}}>
                    <Pencil size={13}/>編輯
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{minHeight:40, color:'var(--red)'}} onClick={()=>askDelete(s)}>
                    <Trash2 size={13}/>刪除
                  </button>
                </div>
              </div>

              {/* 展開：v2.6 貨源目錄 + 已建檔商品（按分類分組）*/}
              {isOpen && (
                <div style={{borderTop:'1px solid var(--border-dim)', padding:'12px 16px', background:'var(--bg-overlay)'}}>
                  {/* ── 貨源目錄：這家能叫的貨（不一定已建檔成庫存商品）── */}
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8, flexWrap:'wrap'}}>
                    <div style={{fontSize:12, fontWeight:600, color:'var(--text-secondary)', letterSpacing:'.05em'}}>
                      📋 貨源目錄 <span style={{fontFamily:'var(--font-mono)', fontWeight:400, color:'var(--text-tertiary)'}}>· {(s.catalog||[]).length}</span>
                    </div>
                    {catForm?.supplierId !== s.id && (
                      <button className="btn btn-primary btn-sm" style={{minHeight:40}} onClick={()=>setCatForm({ supplierId:s.id, name:'', unit:'個', cost:'' })}>
                        <Plus size={14}/>新增貨源
                      </button>
                    )}
                  </div>

                  {(s.catalog||[]).length === 0 && catForm?.supplierId !== s.id && (
                    <div style={{textAlign:'center', padding:'14px 0', color:'var(--text-tertiary)', fontSize:12}}>
                      還沒有貨源，按「＋ 新增貨源」把這家能叫的貨記下來，叫貨時就能直接選
                    </div>
                  )}

                  {(s.catalog||[]).length > 0 && (
                    <div style={{display:'flex', flexDirection:'column', gap:6, marginBottom:10}}>
                      <div style={{display:'grid', gridTemplateColumns:'1fr 64px 84px 56px 40px', gap:8, fontSize:11, color:'var(--text-tertiary)', padding:'0 2px'}}>
                        <span>品名</span><span>單位</span><span style={{textAlign:'right'}}>進價</span><span/><span/>
                      </div>
                      {(s.catalog||[]).map(ci => (
                        <div key={ci.id} style={{display:'grid', gridTemplateColumns:'1fr 64px 84px 56px 40px', gap:8, alignItems:'center'}}>
                          <input className="field" value={ci.name} onChange={e=>updateCatalogItem(s, ci.id, 'name', e.target.value)} style={{padding:'9px 10px', fontSize:13}}/>
                          <input className="field" value={ci.unit || ''} onChange={e=>updateCatalogItem(s, ci.id, 'unit', e.target.value)} style={{padding:'9px 8px', fontSize:13}}/>
                          <input type="number" className="field" min={0} value={ci.cost} onChange={e=>updateCatalogItem(s, ci.id, 'cost', e.target.value)} style={{padding:'9px 8px', fontSize:13, textAlign:'right', fontFamily:'var(--font-mono)'}}/>
                          {ci.productId && products.find(p=>p.id===ci.productId)
                            ? <span style={{fontSize:10, color:'var(--green)', background:'var(--green-dim)', padding:'3px 5px', borderRadius:4, textAlign:'center'}}>已建檔</span>
                            : <span style={{fontSize:10, color:'var(--amber)', background:'var(--amber-dim)', padding:'3px 5px', borderRadius:4, textAlign:'center'}}>未建檔</span>}
                          <button className="btn-icon" style={{color:'var(--red)', minHeight:40, minWidth:40}} onClick={()=>removeCatalogItem(s, ci.id)} aria-label="刪除貨源"><Trash2 size={14}/></button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 貨源新增表單（inline，取代跨頁繞路）*/}
                  {catForm?.supplierId === s.id && (
                    <div style={{background:'var(--bg-raised)', border:'1px solid var(--border-dim)', borderRadius:8, padding:'10px 12px', marginBottom:12}}>
                      <div style={{display:'grid', gridTemplateColumns:'1fr 64px 84px', gap:8, marginBottom:8}}>
                        <div>
                          <FL>品名 *</FL>
                          <input className="field" autoFocus value={catForm.name} onChange={e=>setCatForm(f=>({...f, name:e.target.value}))} placeholder="例：花生 3斤裝" style={{padding:'9px 10px'}}/>
                        </div>
                        <div>
                          <FL>單位</FL>
                          <input className="field" value={catForm.unit} onChange={e=>setCatForm(f=>({...f, unit:e.target.value}))} style={{padding:'9px 8px'}}/>
                        </div>
                        <div>
                          <FL>進價</FL>
                          <input type="number" className="field" min={0} value={catForm.cost} onChange={e=>setCatForm(f=>({...f, cost:e.target.value}))} style={{padding:'9px 8px', textAlign:'right'}}/>
                        </div>
                      </div>
                      <div style={{display:'flex', gap:8}}>
                        <button className="btn btn-primary btn-sm" style={{minHeight:40, flex:1}} disabled={!(catForm.name||'').trim()} onClick={()=>addCatalogItem(s)}><Plus size={14}/>加入貨源</button>
                        <button className="btn btn-ghost btn-sm" style={{minHeight:40}} onClick={()=>setCatForm(null)}>完成</button>
                      </div>
                    </div>
                  )}

                  {/* ── 已建檔商品：庫存中綁定這家廠商的商品 ── */}
                  <div style={{fontSize:12, fontWeight:600, color:'var(--text-secondary)', letterSpacing:'.05em', margin:'12px 0 8px', paddingTop:10, borderTop:'1px dashed var(--border-dim)'}}>
                    已建檔商品 <span style={{fontFamily:'var(--font-mono)', fontWeight:400, color:'var(--text-tertiary)'}}>· {supplierProducts.length}</span>
                  </div>
                  {supplierProducts.length === 0 ? (
                    <div style={{textAlign:'center', padding:'10px 0', color:'var(--text-tertiary)', fontSize:12}}>
                      還沒有庫存商品綁定這家廠商
                      {onGoInventory && (
                        <button className="btn btn-ghost btn-sm" style={{marginLeft:8, minHeight:40}} onClick={onGoInventory}>去庫存管理設定</button>
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
            {[['name','名稱 *'],['contact','聯絡方式'],['phone','電話'],['payTerms','付款條件'],['note','備註']].map(([k,l])=>(
              <div key={k} style={{marginBottom:12}}>
                <FL>{l}</FL>
                <input className="field" type={k==='phone'?'tel':'text'} value={form[k]||''} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} placeholder={k==='phone'?'例：0912-345-678':l}/>
                {/* v2.6: 付款條件快選 chips，填進輸入框後仍可自行修改 */}
                {k === 'payTerms' && (
                  <div style={{display:'flex', gap:6, marginTop:6, flexWrap:'wrap'}}>
                    {['現金','月結30天','月結60天'].map(t => (
                      <button key={t} onClick={()=>setForm(f=>({...f, payTerms:t}))} style={{
                        fontSize:12, padding:'10px 14px', minHeight:40, borderRadius:14,
                        background: form.payTerms===t ? 'var(--accent-dim)' : 'var(--bg-overlay)',
                        color: form.payTerms===t ? 'var(--accent)' : 'var(--text-secondary)',
                        border:`1px solid ${form.payTerms===t ? 'var(--accent)' : 'var(--border-dim)'}`,
                        fontWeight: form.payTerms===t ? 600 : 400,
                      }}>{t}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div style={{display:'flex', gap:10, marginTop:4}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={save}><Check size={15}/>儲存</button>
              <button className="btn btn-ghost"   style={{flex:1}} onClick={()=>setEditing(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* v2.6: 刪除確認／擋下說明 */}
      {deleting && (
        <div style={ps.overlay}>
          <div style={{...ps.modal, maxWidth:400}} className="animate-scale">
            {deleting.blocked ? (
              <>
                <div style={{fontWeight:700, fontSize:15, fontFamily:'var(--font-serif)', marginBottom:10}}>還不能刪除「{deleting.s.name}」</div>
                <p style={{fontSize:13, color:'var(--text-secondary)', lineHeight:1.8, marginBottom:18}}>
                  這家廠商還有
                  {deleting.boundCount > 0 && ` ${deleting.boundCount} 項商品綁定`}
                  {deleting.boundCount > 0 && deleting.openPoCount > 0 && '／'}
                  {deleting.openPoCount > 0 && ` ${deleting.openPoCount} 張未完成叫貨單`}
                  ，請先處理才能刪除。
                </p>
                <button className="btn btn-primary" style={{width:'100%', minHeight:44}} onClick={()=>setDeleting(null)}>知道了</button>
              </>
            ) : (
              <>
                <div style={{fontWeight:700, fontSize:15, fontFamily:'var(--font-serif)', marginBottom:10}}>確定刪除廠商「{deleting.s.name}」？</div>
                <p style={{fontSize:13, color:'var(--text-secondary)', lineHeight:1.8, marginBottom:18}}>
                  貨源目錄會一併刪除，已完成的進貨紀錄會保留。
                </p>
                <div style={{display:'flex', gap:10}}>
                  <button className="btn" style={{flex:1, minHeight:44, background:'var(--red)', color:'#fff'}} onClick={confirmDelete}><Trash2 size={15}/>確定刪除</button>
                  <button className="btn btn-ghost" style={{flex:1, minHeight:44}} onClick={()=>setDeleting(null)}>取消</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FL({children}){return <div style={{fontSize:11,color:'var(--text-tertiary)',marginBottom:5,letterSpacing:'.03em'}}>{children}</div>}

function PayableTab({ purchases, suppliers, onMarkPaid }) {
  // 已到貨（含部分到貨）且未付款 = 應付帳款
  const unpaid = purchases.filter(p => (p.status === 'received' || p.status === 'partial') && !p.paidDate)
  const paid = purchases.filter(p => p.paidDate)
  // 部分到貨只欠「已到貨部分」的錢；全到貨欠全額
  const owedOf = (p) => p.status === 'partial'
    ? (p.items || []).reduce((s,i) => s + (i.received || 0) * (i.unitCost || 0), 0)
    : p.total

  // 依供應商彙總
  const bySupplier = {}
  unpaid.forEach(p => {
    const sid = p.supplierId || p.supplierName || '未指定'
    if (!bySupplier[sid]) bySupplier[sid] = { name: p.supplierName || '未指定', total: 0, count: 0, items: [] }
    bySupplier[sid].total += owedOf(p)
    bySupplier[sid].count += 1
    bySupplier[sid].items.push(p)
  })
  const supplierList = Object.values(bySupplier).sort((a,b) => b.total - a.total)
  const totalUnpaid = unpaid.reduce((s,p) => s + owedOf(p), 0)

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
                  <td style={{padding:'8px 4px'}}>
                    {p.id}
                    {p.status === 'partial' && <span className="badge badge-amber" style={{marginLeft:6}}>部分到貨</span>}
                  </td>
                  <td style={{padding:'8px 4px', color:'var(--text-tertiary)'}}>{p.receivedDate || p.date}</td>
                  <td style={{padding:'8px 4px', textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:500}}>
                    NT$ {owedOf(p).toLocaleString()}
                    {p.status === 'partial' && <div style={{fontSize:10, color:'var(--text-tertiary)'}}>全單 NT$ {p.total.toLocaleString()}</div>}
                  </td>
                  <td style={{padding:'8px 4px', textAlign:'right'}}>
                    {p.status === 'partial' ? (
                      // 先不開放付款：付了會把狀態鎖死、也容易多付 — 貨到齊再結一次
                      <span style={{fontSize:11, color:'var(--text-tertiary)'}}>貨到齊再付</span>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={()=>{ if(confirm(`確認 ${p.id} 已付款？`)) onMarkPaid(p.id) }}>標記已付</button>
                    )}
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
  overlay:{position:'fixed',inset:0,background:'rgba(23,37,60,0.30)',backdropFilter:'blur(2px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200},
  modal:{background:'var(--bg-raised)',border:'1px solid var(--border-dim)',borderRadius:'var(--r4)',padding:24,width:'90%',maxWidth:560},
}
