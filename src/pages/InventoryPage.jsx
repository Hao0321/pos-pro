import { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react'
import { Plus, Pencil, Trash2, X, Check, AlertTriangle, ChevronUp, ChevronDown, Barcode, Printer, Tag, Truck, Camera, Upload, Download, FileText } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import { loadSuppliers, loadPurchases } from '../utils/dataAccess'
import { DEFAULT_CATEGORIES, CATEGORY_META, mergeCategories } from '../utils/categories'
import { getExpiringProducts, getProductHistory } from '../utils/analytics'
import { parseCSV, stringifyCSV, downloadCSV, readFileAsText, PRODUCT_CSV_HEADERS, productToCSVRow, csvRowToProduct } from '../utils/csv'
const BarcodeScannerModal = lazy(() => import('../components/BarcodeScannerModal'))

function BarcodeDisplay({ value }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && value) {
      try {
        JsBarcode(ref.current, value, {
          format: 'CODE128',
          width: 2,
          height: 70,
          displayValue: true,
          fontSize: 14,
          margin: 10,
          background: '#ffffff',
          lineColor: '#000000',
        })
      } catch {}
    }
  }, [value])
  return <svg ref={ref} style={{ width: '100%', maxWidth: 320 }} />
}

const EMPTY = { name:'', category:'', price:'', cost:'', stock:'', barcode:'', unit:'個', noBarcode:false, imageUrl:'', expiryDate:'', supplierId:'', reorderLevel:'' }

export default function InventoryPage({ store }) {
  const { products, addProduct, updateProduct, deleteProduct, categories, orders = [], wasteLog = [] } = store
  const [editing,   setEditing]   = useState(null)
  const [form,      setForm]      = useState(EMPTY)
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [sortKey,   setSortKey]   = useState('name')
  const [sortAsc,   setSortAsc]   = useState(true)
  const [confirmDel, setConfirmDel] = useState(null)
  const [barcodePreview, setBarcodePreview] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [suppliers, setSuppliers] = useState([])
  const [showCamera, setShowCamera] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [batchForm, setBatchForm] = useState({ action: 'price', value: '', supplierId: '', category: '' })
  const [csvImport, setCsvImport] = useState(null) // { records, toAdd, toUpdate, errors }
  const [purchases, setPurchases] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const csvFileRef = useRef(null)

  useEffect(() => { loadSuppliers([]).then(s => setSuppliers(Array.isArray(s) ? s : [])) }, [])
  useEffect(() => { loadPurchases([]).then(p => setPurchases(Array.isArray(p) ? p : [])) }, [])

  function handleExportCSV() {
    const supplierMap = new Map(suppliers.map(s => [s.id, s]))
    const rows = products.map(p => productToCSVRow(p, supplierMap))
    const csv = stringifyCSV(rows, PRODUCT_CSV_HEADERS)
    downloadCSV(`商品_${new Date().toISOString().slice(0,10)}.csv`, csv)
  }

  function handleDownloadTemplate() {
    const sample = [{
      '商品名稱':'範例商品（請刪除此列）', '分類':'雜貨', '售價':50, '成本':25, '庫存':100,
      '安全庫存':10, '條碼':'4710000000001', '單位':'個',
      '主要供應商': suppliers[0]?.name || '台北乾貨行', '保存期限':'', '圖片網址':'', 'ID':'',
    }]
    const csv = stringifyCSV(sample, PRODUCT_CSV_HEADERS)
    downloadCSV('商品匯入範本.csv', csv)
  }

  async function handleCSVFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await readFileAsText(file)
      const { records } = parseCSV(text)
      const supplierByName = new Map(suppliers.map(s => [s.name, s]))
      const productByBarcode = new Map(products.filter(p => p.barcode).map(p => [p.barcode, p]))
      const productById = new Map(products.map(p => [p.id, p]))

      const toAdd = []
      const toUpdate = []
      const errors = []

      records.forEach((row, idx) => {
        const data = csvRowToProduct(row, supplierByName)
        if (!data.name) {
          errors.push(`第 ${idx+2} 列：缺商品名稱（略過）`)
          return
        }
        // 供應商名稱找不到 → 警告但仍匯入（留空供應商）
        if (data.supplierName && !data.supplierId) {
          errors.push(`第 ${idx+2} 列：找不到供應商「${data.supplierName}」，此商品供應商將留空`)
        }
        // 匹配規則：先用 ID、再用條碼
        let existing = data.id ? productById.get(data.id) : null
        if (!existing && data.barcode) existing = productByBarcode.get(data.barcode)
        if (existing) toUpdate.push({ id: existing.id, data, existing })
        else toAdd.push({ data })
      })

      setCsvImport({ records, toAdd, toUpdate, errors })
    } catch (err) {
      alert('讀取 CSV 失敗：' + (err.message || err))
    }
    if (csvFileRef.current) csvFileRef.current.value = ''
  }

  function confirmCSVImport() {
    if (!csvImport) return
    csvImport.toAdd.forEach(({ data }) => {
      const { id, supplierName, ...rest } = data
      addProduct(rest)
    })
    csvImport.toUpdate.forEach(({ id, data }) => {
      // 更新既有商品時不覆蓋 stock —— 庫存應由結帳/進貨/盤點管理，避免 CSV 把期間異動倒回
      const { id: _, supplierName, stock, ...rest } = data
      updateProduct(id, rest)
    })
    const total = csvImport.toAdd.length + csvImport.toUpdate.length
    setCsvImport(null)
    alert(`✓ 匯入完成：新增 ${csvImport.toAdd.length}、更新 ${csvImport.toUpdate.length}（共 ${total}）\n※ 更新既有商品不會改動庫存`)
  }

  function toggleAll(visibleIds, checked) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) visibleIds.forEach(id => next.add(id))
      else visibleIds.forEach(id => next.delete(id))
      return next
    })
  }

  function applyBatch() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) { setShowBatch(false); return }
    const { action, value, supplierId, category } = batchForm
    for (const id of ids) {
      const p = products.find(x => x.id === id)
      if (!p) continue
      let update = {}
      if (action === 'price' && value) {
        const v = parseFloat(value)
        if (v > 0) update.price = v
      } else if (action === 'priceAdjust' && value) {
        // +10% / -5% 這種百分比調整
        const pct = parseFloat(value) || 0
        update.price = Math.max(0, Math.round((p.price || 0) * (1 + pct/100)))
      } else if (action === 'cost' && value) {
        const v = parseFloat(value)
        if (v >= 0) update.cost = v
      } else if (action === 'supplier') {
        update.supplierId = supplierId
      } else if (action === 'reorderLevel' && value) {
        const v = parseInt(value)
        if (v >= 0) update.reorderLevel = v
      } else if (action === 'category' && category) {
        update.category = category
      }
      if (Object.keys(update).length) updateProduct(id, update)
    }
    setShowBatch(false)
    setBatchForm({ action: 'price', value: '', supplierId: '', category: '' })
    setSelectedIds(new Set())
  }

  function handleCameraScan(code) {
    setShowCamera(false)
    const matched = products.find(p => p.barcode === code)
    if (matched) {
      startEdit(matched)
    } else {
      // 找不到 → 預填條碼進新增表單
      setEditing('new')
      setForm({ ...EMPTY, barcode: code, noBarcode: false })
    }
  }

  async function handleGenerateBarcode(product) {
    if (!window.electronAPI) return
    const result = await window.electronAPI.barcode.generateLabel(product)
    if (result.success) {
      setBarcodePreview({ product, barcodeText: result.barcodeText })
      // 如果商品沒有條碼，自動儲存產生的條碼
      if (!product.barcode && result.barcodeText) {
        updateProduct(product.id, { barcode: result.barcodeText })
      }
    }
  }

  async function handlePrintLabel(product) {
    if (!window.electronAPI) return
    await window.electronAPI.barcode.printLabels([product], 1)
  }

  async function handleBatchPrint() {
    if (!window.electronAPI || selectedIds.size === 0) return
    const selected = products.filter(p => selectedIds.has(p.id))
    await window.electronAPI.barcode.printLabels(selected, 1)
    setSelectedIds(new Set())
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSort(key) {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  // 即將過期 / 已過期商品 id 集合（給 filter 用）— useMemo 避免每次 render 重掃全商品
  const { expiredIds, expiringIds, expired, soon } = useMemo(() => {
    const { expired, soon } = getExpiringProducts(products, 7)
    return {
      expired, soon,
      expiredIds: new Set(expired.map(p => p.id)),
      expiringIds: new Set([...expired.map(p => p.id), ...soon.map(p => p.id)]),
    }
  }, [products])

  const filtered = useMemo(() => products
    .filter(p => {
      const okSearch = !search || (p.name||'').includes(search) || (p.category||'').includes(search)
      if (filter === 'low')      return okSearch && p.stock <= 5 && p.stock > 0
      if (filter === 'zero')     return okSearch && p.stock === 0
      if (filter === 'nobc')     return okSearch && p.noBarcode
      if (filter === 'expiring') return okSearch && expiringIds.has(p.id)
      if (filter === 'expired')  return okSearch && expiredIds.has(p.id)
      return okSearch
    })
    .sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey]
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    }), [products, search, filter, sortKey, sortAsc, expiringIds, expiredIds])

  function startNew()  { setEditing('new'); setForm(EMPTY) }
  function startEdit(p){ setEditing(p.id);  setForm({...p}) }

  function save() {
    if (!form.name || !form.price) return
    const data = {
      ...form,
      price: parseFloat(form.price) || 0,
      cost:  parseFloat(form.cost)  || 0,
      stock: parseInt(form.stock)   || 0,
      reorderLevel: parseInt(form.reorderLevel) || 0,
      noBarcode: !form.barcode || form.noBarcode,
    }
    if (editing === 'new') addProduct(data)
    else updateProduct(editing, data)
    setEditing(null)
  }

  function handleDelete(id) {
    deleteProduct(id); setConfirmDel(null)
  }

  const lowCount  = products.filter(p => p.stock <= 5 && p.stock > 0).length
  const zeroCount = products.filter(p => p.stock === 0).length

  const FILTERS = [
    ['all',      '全部',         products.length],
    ['low',      '低庫存',       lowCount],
    ['zero',     '缺貨',         zeroCount],
    ['expiring', '即將過期',     soon.length],
    ['expired',  '已過期',       expired.length],
    ['nobc',     '無條碼',       products.filter(p=>p.noBarcode).length],
  ]

  const COLS = [
    { key:'name',  label:'商品名稱',  flex:'2fr' },
    { key:'category', label:'分類',   flex:'1fr' },
    { key:'price', label:'售價',      flex:'80px', mono:true, align:'right' },
    { key:'cost',  label:'成本',      flex:'80px', mono:true, align:'right' },
    { key:'stock', label:'庫存',      flex:'70px', mono:true, align:'right' },
    { key:'barcode', label:'條碼',    flex:'1.4fr', mono:true },
  ]

  const gridTpl = '32px ' + COLS.map(c=>c.flex).join(' ') + ' 80px'

  return (
    <div style={iv.root}>
      <div style={iv.header}>
        <div>
          <h2 style={iv.title}>庫存管理</h2>
          <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
            共 {products.length} 種商品
            {(lowCount + zeroCount) > 0 && (
              <span style={{color:'var(--amber)', marginLeft:8}}>
                · {lowCount + zeroCount} 項需補貨
              </span>
            )}
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={startNew}>
          <Plus size={15}/>新增商品
        </button>
      </div>

      <div style={iv.toolbar}>
        <input className="field" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋商品名稱或分類..." style={{flex:1, maxWidth:280, padding:'8px 12px'}}/>
        <button className="btn btn-ghost btn-sm" onClick={()=>setShowCamera(true)} title="用相機掃條碼快速找/新增商品">
          <Camera size={14}/>掃條碼
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleExportCSV} title="匯出全部商品為 CSV">
          <Download size={14}/>匯出 CSV
        </button>
        <button className="btn btn-ghost btn-sm" onClick={()=>csvFileRef.current?.click()} title="從 CSV 批量匯入（新增 + 更新）">
          <Upload size={14}/>匯入 CSV
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleDownloadTemplate} title="下載 CSV 範本">
          <FileText size={14}/>範本
        </button>
        <input ref={csvFileRef} type="file" accept=".csv" style={{display:'none'}} onChange={handleCSVFile}/>
        <div style={{display:'flex', gap:4}}>
          {FILTERS.map(([k,l,n]) => (
            <button key={k} onClick={()=>setFilter(k)} style={{
              ...iv.filterBtn,
              background: filter===k ? 'var(--bg-active)' : 'transparent',
              color: filter===k ? 'var(--text-primary)' : 'var(--text-tertiary)',
              border: `1px solid ${filter===k ? 'var(--border-mid)' : 'transparent'}`,
            }}>
              {l}
              <span style={{...iv.filterCount, background: filter===k?'var(--bg-overlay)':'var(--border-dim)', color: filter===k?'var(--text-secondary)':'var(--text-disabled)'}}>{n}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={iv.tableWrap}>
        {/* Header */}
        <div style={{...iv.row, ...iv.rowHead, gridTemplateColumns: gridTpl}}>
          <input
            type="checkbox"
            checked={filtered.length > 0 && filtered.every(p => selectedIds.has(p.id))}
            onChange={e => toggleAll(filtered.map(p=>p.id), e.target.checked)}
            title="全選"
            style={{cursor:'pointer', accentColor:'var(--gold)'}}
          />
          {COLS.map(col => (
            <button key={col.key} onClick={()=>handleSort(col.key)} style={{...iv.colHead, justifyContent: col.align==='right' ? 'flex-end' : 'flex-start'}}>
              {col.label}
              {sortKey===col.key && (sortAsc ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)}
            </button>
          ))}
          <span style={{...iv.colHead, fontSize:11}}>操作</span>
        </div>

        {/* Rows */}
        <div style={{flex:1, overflowY:'auto'}}>
          {filtered.length === 0 ? (
            <div style={iv.empty}>沒有符合條件的商品</div>
          ) : filtered.map(p => {
            const low  = p.stock <= 5 && p.stock > 0
            const zero = p.stock === 0
            return (
              <div key={p.id} className="cv-row" style={{...iv.row, gridTemplateColumns: gridTpl, background: selectedIds.has(p.id) ? 'var(--gold-dim)' : expiredIds.has(p.id) ? 'rgba(229,90,90,0.06)' : zero?'rgba(229,90,90,0.03)': low?'rgba(229,160,48,0.03)' : expiringIds.has(p.id) ? 'rgba(229,160,48,0.04)' : 'transparent'}}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(p.id)}
                  onChange={()=>toggleSelect(p.id)}
                  style={{cursor:'pointer', accentColor:'var(--gold)'}}
                />
                <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                  {p.noBarcode && <span style={{fontSize:9, border:'1px solid var(--border-mid)', color:'var(--text-tertiary)', borderRadius:4, padding:'1px 5px', flexShrink:0}}>自包</span>}
                  <span style={{fontWeight:500, fontSize:13}}>{p.name}</span>
                  {expiredIds.has(p.id) && (
                    <span style={{fontSize:9, background:'var(--red-dim)', color:'var(--red)', borderRadius:4, padding:'1px 5px', fontWeight:600}}>已過期</span>
                  )}
                  {!expiredIds.has(p.id) && expiringIds.has(p.id) && (() => {
                    const day = soon.find(s => s.id === p.id)?.daysLeft
                    return <span style={{fontSize:9, background:'var(--amber-dim)', color:'var(--amber)', borderRadius:4, padding:'1px 5px', fontWeight:600}}>{day}天到期</span>
                  })()}
                </div>
                <span style={{fontSize:12, color:'var(--text-secondary)'}}>{p.category}</span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:12, textAlign:'right'}}>
                  {p.price.toLocaleString()}
                </span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-secondary)', textAlign:'right'}}>
                  {p.cost ? p.cost.toLocaleString() : '—'}
                </span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:13, textAlign:'right', fontWeight: (low||zero)?600:400, color: zero?'var(--red)':low?'var(--amber)':'var(--text-primary)'}}>
                  {p.stock}
                  {low  && <AlertTriangle size={11} style={{marginLeft:4, verticalAlign:'middle'}}/>}
                </span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:11, color: p.noBarcode?'var(--text-tertiary)':'var(--teal)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {p.noBarcode ? '—' : p.barcode || '—'}
                </span>
                <div style={{display:'flex', gap:4, justifyContent:'flex-end'}}>
                  {window.electronAPI && (
                    <button className="btn-icon btn-sm" title="產生條碼" onClick={()=>handleGenerateBarcode(p)} style={{color:'var(--teal,#2d9c8f)'}}><Barcode size={13}/></button>
                  )}
                  <button className="btn-icon btn-sm" onClick={()=>startEdit(p)}><Pencil size={13}/></button>
                  <button className="btn-icon btn-sm" style={{color:'var(--red)'}} onClick={()=>setConfirmDel(p.id)}><Trash2 size={13}/></button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Edit drawer */}
      {editing && (
        <div style={iv.overlay}>
          <div style={iv.drawer} className="animate-scale">
            <div style={iv.drawerHeader}>
              <span style={{fontWeight:600, fontSize:15}}>{editing==='new'?'新增商品':'編輯商品'}</span>
              <button className="btn-icon" onClick={()=>setEditing(null)}><X size={16}/></button>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14}}>
              <div style={{gridColumn:'1/-1'}}>
                <FieldLabel>商品名稱 *</FieldLabel>
                <input className="field" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="例：花生糖"/>
              </div>
              <div>
                <FieldLabel>分類</FieldLabel>
                <input className="field" value={form.category} list="cat-list" onChange={e=>setForm(f=>({...f,category:e.target.value}))} placeholder="例：雜貨、生鮮、調味料..."/>
                <datalist id="cat-list">{mergeCategories(categories).map(c=><option key={c} value={c}/>)}</datalist>
                {/* 預設分類快捷鍵 */}
                <div style={{display:'flex', flexWrap:'wrap', gap:4, marginTop:6}}>
                  {DEFAULT_CATEGORIES.slice(0, 8).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={()=>setForm(f=>({...f,category:c}))}
                      style={{
                        fontSize:11, padding:'3px 8px', borderRadius:12,
                        background: form.category===c ? 'var(--gold-dim)' : 'var(--bg-overlay)',
                        color: form.category===c ? 'var(--gold)' : 'var(--text-secondary)',
                        border:'1px solid var(--border-dim)',
                      }}
                    >
                      {CATEGORY_META[c]?.icon} {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel>單位</FieldLabel>
                <input className="field" value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))} placeholder="包 / 瓶 / kg"/>
              </div>
              <div>
                <FieldLabel>售價 (NT$) *</FieldLabel>
                <input className="field" type="number" value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} placeholder="0"/>
              </div>
              <div>
                <FieldLabel>成本 (NT$)</FieldLabel>
                <input className="field" type="number" value={form.cost} onChange={e=>setForm(f=>({...f,cost:e.target.value}))} placeholder="0"/>
              </div>
              <div>
                <FieldLabel>庫存數量</FieldLabel>
                <input className="field" type="number" value={form.stock} onChange={e=>setForm(f=>({...f,stock:e.target.value}))} placeholder="0"/>
              </div>
              <div>
                <FieldLabel>安全庫存（低於此值提醒補貨）</FieldLabel>
                <input className="field" type="number" value={form.reorderLevel} onChange={e=>setForm(f=>({...f,reorderLevel:e.target.value}))} placeholder="例：10"/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <FieldLabel><Truck size={11} style={{verticalAlign:'-1px',marginRight:4}}/>主要供應商</FieldLabel>
                <select className="field" value={form.supplierId || ''} onChange={e=>setForm(f=>({...f,supplierId:e.target.value}))} style={{cursor:'pointer'}}>
                  <option value="">— 未指定 —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {suppliers.length === 0 && (
                  <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:4}}>尚未建立供應商，請至「進貨管理 → 供應商」新增</div>
                )}
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'var(--text-secondary)'}}>
                  <input type="checkbox" checked={form.noBarcode} onChange={e=>setForm(f=>({...f,noBarcode:e.target.checked,barcode:e.target.checked?'':f.barcode}))} style={{accentColor:'var(--gold)'}}/>
                  此商品為自包裝，無條碼
                </label>
              </div>
              {!form.noBarcode && (
                <div style={{gridColumn:'1/-1'}}>
                  <FieldLabel>條碼</FieldLabel>
                  <input className="field" value={form.barcode} onChange={e=>setForm(f=>({...f,barcode:e.target.value}))} placeholder="掃描或手動輸入" style={{fontFamily:'var(--font-mono)'}}/>
                </div>
              )}
              <div>
                <FieldLabel>保存期限（選填）</FieldLabel>
                <input className="field" type="date" value={form.expiryDate || ''} onChange={e=>setForm(f=>({...f,expiryDate:e.target.value}))}/>
              </div>
              <div>
                <FieldLabel>商品圖片網址（選填）</FieldLabel>
                <input className="field" value={form.imageUrl || ''} onChange={e=>setForm(f=>({...f,imageUrl:e.target.value}))} placeholder="https://..."/>
              </div>
              {form.imageUrl && (
                <div style={{gridColumn:'1/-1', textAlign:'center'}}>
                  <img src={form.imageUrl} alt="預覽" style={{maxHeight:120, maxWidth:'100%', borderRadius:8, border:'1px solid var(--border-dim)'}} onError={e=>e.target.style.display='none'}/>
                </div>
              )}
            </div>
            {editing !== 'new' && (
              <div style={{marginTop:6, marginBottom:12, border:'1px solid var(--border-dim)', borderRadius:8, overflow:'hidden'}}>
                <button
                  type="button"
                  onClick={()=>setShowHistory(v=>!v)}
                  style={{
                    width:'100%', padding:'10px 14px', display:'flex',
                    justifyContent:'space-between', alignItems:'center',
                    background:'var(--bg-overlay)', fontSize:13, fontWeight:600,
                    color:'var(--text-secondary)',
                  }}
                >
                  <span>📋 變動歷史</span>
                  {showHistory ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                </button>
                {showHistory && (() => {
                  const history = getProductHistory(editing, { orders, wasteLog, purchases })
                  if (history.length === 0) return (
                    <div style={{padding:'14px', textAlign:'center', color:'var(--text-tertiary)', fontSize:12}}>
                      此商品尚無變動紀錄
                    </div>
                  )
                  return (
                    <div style={{maxHeight:200, overflowY:'auto'}}>
                      {history.slice(0, 30).map((h, i) => {
                        const positive = h.delta > 0
                        const typeMeta = {
                          sale:     { label: '銷售', color: 'var(--blue)',   icon: '🛒' },
                          refund:   { label: '退貨', color: 'var(--amber)',  icon: '↩️' },
                          purchase: { label: '進貨', color: 'var(--green)',  icon: '📦' },
                          waste:    { label: '損耗', color: 'var(--red)',    icon: '🗑️' },
                        }[h.type] || { label: h.type, color: 'var(--text-secondary)', icon: '·' }
                        return (
                          <div key={i} style={{
                            display:'flex', alignItems:'center', gap:10,
                            padding:'8px 14px',
                            borderTop:'1px solid var(--border-dim)',
                            fontSize:12,
                          }}>
                            <span style={{fontSize:14}}>{typeMeta.icon}</span>
                            <div style={{flex:1, minWidth:0}}>
                              <div style={{display:'flex', gap:6, alignItems:'center'}}>
                                <span style={{color:typeMeta.color, fontWeight:600, fontSize:11}}>{typeMeta.label}</span>
                                <span style={{color:'var(--text-tertiary)', fontSize:11}}>{h.note}</span>
                              </div>
                              <div style={{fontSize:10, color:'var(--text-tertiary)', marginTop:2, fontFamily:'var(--font-mono)'}}>
                                {new Date(h.time).toLocaleString('zh-TW',{ month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit' })}
                                {h.unitPrice ? ` · @$${h.unitPrice}` : ''}
                              </div>
                            </div>
                            <span style={{
                              fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13,
                              color: positive ? 'var(--green)' : 'var(--red)',
                            }}>
                              {positive ? '+' : ''}{h.delta}
                            </span>
                          </div>
                        )
                      })}
                      {history.length > 30 && (
                        <div style={{padding:'8px 14px', textAlign:'center', fontSize:11, color:'var(--text-tertiary)', borderTop:'1px solid var(--border-dim)'}}>
                          僅顯示最近 30 筆（共 {history.length} 筆）
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={save}><Check size={15}/>儲存</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setEditing(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div style={iv.overlay}>
          <div style={{...iv.drawer, maxWidth:360}} className="animate-scale">
            <div style={{textAlign:'center', padding:'8px 0 20px'}}>
              <div style={{fontSize:32, marginBottom:12}}>🗑️</div>
              <div style={{fontWeight:600, marginBottom:6}}>確認刪除？</div>
              <div style={{fontSize:13, color:'var(--text-secondary)'}}>此操作無法復原</div>
            </div>
            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-danger" style={{flex:1}} onClick={()=>handleDelete(confirmDel)}>確認刪除</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setConfirmDel(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 條碼預覽 Modal */}
      {barcodePreview && (
        <div style={iv.overlay} onClick={() => setBarcodePreview(null)}>
          <div style={{...iv.drawer, maxWidth:420, textAlign:'center'}} className="animate-scale" onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <h3 style={{fontSize:15, fontWeight:600}}>條碼預覽</h3>
              <button className="btn-icon btn-sm" onClick={() => setBarcodePreview(null)}><X size={16}/></button>
            </div>
            <div style={{marginBottom:12, fontWeight:600, fontSize:16}}>{barcodePreview.product.name}</div>
            <div style={{marginBottom:12, color:'var(--accent)', fontWeight:700, fontSize:18}}>
              ${barcodePreview.product.price} / {barcodePreview.product.unit || '個'}
            </div>
            <div style={{
              marginTop:12, padding:'16px', background:'#fff', borderRadius:8,
              border:'1px solid var(--border-dim)', display:'flex', flexDirection:'column', alignItems:'center',
            }}>
              <BarcodeDisplay value={barcodePreview.barcodeText} />
            </div>
            <div style={{marginTop:6, fontSize:11, color:'var(--text-tertiary)'}}>
              CODE128 格式 · {barcodePreview.barcodeText}
            </div>
            <div style={{display:'flex', gap:10, marginTop:16}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={() => { handlePrintLabel(barcodePreview.product); setBarcodePreview(null) }}>
                <Printer size={14}/> 列印標籤
              </button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={() => setBarcodePreview(null)}>關閉</button>
            </div>
          </div>
        </div>
      )}

      {/* CSV 匯入預覽 */}
      {csvImport && (
        <div style={iv.overlay}>
          <div style={{...iv.drawer, maxWidth:680}} className="animate-scale">
            <div style={iv.drawerHeader}>
              <span style={{fontWeight:600, fontSize:15}}>CSV 匯入預覽</span>
              <button className="btn-icon" onClick={()=>setCsvImport(null)}><X size={16}/></button>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14}}>
              <div style={{padding:'10px 14px', background:'var(--green-dim)', borderRadius:8, borderTop:'2px solid var(--green)'}}>
                <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:3}}>將新增</div>
                <div style={{fontSize:22, fontWeight:600, color:'var(--green)', fontFamily:'var(--font-mono)'}}>{csvImport.toAdd.length}</div>
              </div>
              <div style={{padding:'10px 14px', background:'var(--blue-dim)', borderRadius:8, borderTop:'2px solid var(--blue)'}}>
                <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:3}}>將更新</div>
                <div style={{fontSize:22, fontWeight:600, color:'var(--blue)', fontFamily:'var(--font-mono)'}}>{csvImport.toUpdate.length}</div>
              </div>
              <div style={{padding:'10px 14px', background: csvImport.errors.length ? 'var(--red-dim)' : 'var(--bg-overlay)', borderRadius:8, borderTop:`2px solid ${csvImport.errors.length ? 'var(--red)' : 'var(--text-tertiary)'}`}}>
                <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:3}}>錯誤</div>
                <div style={{fontSize:22, fontWeight:600, color: csvImport.errors.length ? 'var(--red)' : 'var(--text-tertiary)', fontFamily:'var(--font-mono)'}}>{csvImport.errors.length}</div>
              </div>
            </div>

            {csvImport.errors.length > 0 && (
              <div style={{marginBottom:12, padding:'10px 12px', background:'var(--red-dim)', borderRadius:6, fontSize:11, color:'var(--red)', maxHeight:120, overflowY:'auto'}}>
                {csvImport.errors.slice(0,10).map((e,i) => <div key={i}>{e}</div>)}
                {csvImport.errors.length > 10 && <div style={{opacity:0.7, marginTop:4}}>...還有 {csvImport.errors.length - 10} 個錯誤</div>}
              </div>
            )}

            <div style={{maxHeight:260, overflowY:'auto', border:'1px solid var(--border-dim)', borderRadius:8}}>
              <table style={{width:'100%', fontSize:11}}>
                <thead>
                  <tr style={{background:'var(--bg-overlay)', position:'sticky', top:0}}>
                    <th style={{textAlign:'left', padding:'7px 10px'}}>動作</th>
                    <th style={{textAlign:'left', padding:'7px 10px'}}>商品</th>
                    <th style={{textAlign:'left', padding:'7px 10px'}}>分類</th>
                    <th style={{textAlign:'right', padding:'7px 10px'}}>售價</th>
                    <th style={{textAlign:'right', padding:'7px 10px'}}>庫存</th>
                    <th style={{textAlign:'left', padding:'7px 10px'}}>供應商</th>
                  </tr>
                </thead>
                <tbody>
                  {[...csvImport.toAdd.slice(0,30).map(x=>({...x, action:'add'})), ...csvImport.toUpdate.slice(0,30).map(x=>({...x, action:'update'}))].map((row, i) => (
                    <tr key={i} style={{borderTop:'1px solid var(--border-dim)'}}>
                      <td style={{padding:'6px 10px'}}>
                        <span style={{
                          fontSize:10, padding:'1px 6px', borderRadius:10,
                          background: row.action==='add' ? 'var(--green-dim)' : 'var(--blue-dim)',
                          color: row.action==='add' ? 'var(--green)' : 'var(--blue)',
                          fontWeight:600,
                        }}>{row.action==='add' ? '新增' : '更新'}</span>
                      </td>
                      <td style={{padding:'6px 10px'}}>{row.data.name}</td>
                      <td style={{padding:'6px 10px'}}>{row.data.category}</td>
                      <td style={{padding:'6px 10px', textAlign:'right', fontFamily:'var(--font-mono)'}}>${row.data.price}</td>
                      <td style={{padding:'6px 10px', textAlign:'right', fontFamily:'var(--font-mono)'}}>{row.data.stock}</td>
                      <td style={{padding:'6px 10px', color:'var(--text-tertiary)'}}>{row.data.supplierName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{display:'flex', gap:10, marginTop:16}}>
              <button
                className="btn btn-primary"
                style={{flex:1}}
                disabled={csvImport.toAdd.length + csvImport.toUpdate.length === 0}
                onClick={confirmCSVImport}
              >
                <Check size={15}/>確認匯入（{csvImport.toAdd.length + csvImport.toUpdate.length} 筆）
              </button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setCsvImport(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 相機掃條碼 */}
      {showCamera && (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            title="掃條碼查找或新增商品"
            onScan={handleCameraScan}
            onClose={()=>setShowCamera(false)}
          />
        </Suspense>
      )}

      {/* 浮動批量操作工具列 */}
      {selectedIds.size > 0 && (
        <div style={{
          position:'fixed', bottom:24, right:24, zIndex:100,
          display:'flex', gap:8, alignItems:'center',
          background:'var(--bg-raised)', padding:'10px 14px',
          borderRadius:'var(--r-pill)', boxShadow:'0 6px 20px rgba(0,0,0,0.18)',
          border:'1px solid var(--border-mid)',
        }}>
          <span style={{fontSize:13, fontWeight:600, color:'var(--text-secondary)', marginRight:4}}>
            已選 {selectedIds.size}
          </span>
          <button className="btn btn-primary btn-sm" onClick={()=>setShowBatch(true)}>
            <Pencil size={14}/> 批量編輯
          </button>
          {window.electronAPI && (
            <button className="btn btn-ghost btn-sm" onClick={handleBatchPrint}>
              <Printer size={14}/> 列印標籤
            </button>
          )}
          <button className="btn-icon btn-sm" onClick={()=>setSelectedIds(new Set())} title="清除選取">
            <X size={14}/>
          </button>
        </div>
      )}

      {/* 批量編輯 modal */}
      {showBatch && (
        <div style={iv.overlay}>
          <div style={iv.drawer} className="animate-scale">
            <div style={iv.drawerHeader}>
              <span style={{fontWeight:600, fontSize:15}}>批量編輯 {selectedIds.size} 項商品</span>
              <button className="btn-icon" onClick={()=>setShowBatch(false)}><X size={16}/></button>
            </div>
            <FieldLabel>批量動作</FieldLabel>
            <select className="field" value={batchForm.action} onChange={e=>setBatchForm(f=>({...f, action:e.target.value, value:''}))} style={{cursor:'pointer', marginBottom:12}}>
              <option value="price">設定售價</option>
              <option value="priceAdjust">售價調整百分比（例：+10 = 漲 10%）</option>
              <option value="cost">設定成本</option>
              <option value="reorderLevel">設定安全庫存</option>
              <option value="supplier">設定主要供應商</option>
              <option value="category">設定分類</option>
            </select>

            {batchForm.action === 'supplier' ? (
              <>
                <FieldLabel>供應商</FieldLabel>
                <select className="field" value={batchForm.supplierId} onChange={e=>setBatchForm(f=>({...f, supplierId:e.target.value}))} style={{cursor:'pointer'}}>
                  <option value="">— 未指定 —</option>
                  {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </>
            ) : batchForm.action === 'category' ? (
              <>
                <FieldLabel>分類</FieldLabel>
                <input className="field" value={batchForm.category} list="cat-list" onChange={e=>setBatchForm(f=>({...f, category:e.target.value}))} placeholder="輸入或選擇分類"/>
                <div style={{display:'flex', flexWrap:'wrap', gap:4, marginTop:6}}>
                  {DEFAULT_CATEGORIES.slice(0,8).map(c => (
                    <button key={c} type="button" onClick={()=>setBatchForm(f=>({...f,category:c}))} style={{
                      fontSize:11, padding:'3px 8px', borderRadius:12,
                      background: batchForm.category===c ? 'var(--gold-dim)' : 'var(--bg-overlay)',
                      color: batchForm.category===c ? 'var(--gold)' : 'var(--text-secondary)',
                      border:'1px solid var(--border-dim)',
                    }}>{CATEGORY_META[c]?.icon} {c}</button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <FieldLabel>
                  {batchForm.action === 'priceAdjust' ? '百分比（+/-，例：+10 / -5）' : '數值'}
                </FieldLabel>
                <input className="field" type="number" value={batchForm.value} onChange={e=>setBatchForm(f=>({...f, value:e.target.value}))} placeholder={batchForm.action==='priceAdjust' ? '+10 = 漲 10%' : '0'}/>
              </>
            )}

            <div style={{display:'flex', gap:10, marginTop:18}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={applyBatch}>
                <Check size={15}/>套用到 {selectedIds.size} 項
              </button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setShowBatch(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FieldLabel({ children }) {
  return <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:5, letterSpacing:'.03em'}}>{children}</div>
}

const iv = {
  root:{ display:'flex', flexDirection:'column', height:'100%', padding:'16px', gap:14, overflow:'hidden' },
  header:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexShrink:0, flexWrap:'wrap', gap:10 },
  title:{ fontFamily:'var(--font-serif)', fontSize:20, fontWeight:600 },
  toolbar:{ display:'flex', gap:10, alignItems:'center', flexShrink:0, flexWrap:'wrap' },
  filterBtn:{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:6, fontSize:12, cursor:'pointer', transition:'all 120ms' },
  filterCount:{ borderRadius:20, padding:'0 6px', fontSize:10, fontFamily:'var(--font-mono)' },
  tableWrap:{ flex:1, display:'flex', flexDirection:'column', background:'var(--bg-raised)', border:'1px solid var(--border-dim)', borderRadius:'var(--r3)', overflow:'auto', boxShadow:'var(--shadow-sm)' },
  row:{ display:'grid', gap:10, padding:'10px 16px', borderBottom:'1px solid var(--border-dim)', alignItems:'center', minWidth:700 },
  rowHead:{ background:'var(--bg-overlay)', flexShrink:0 },
  colHead:{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.06em', textTransform:'uppercase', cursor:'pointer', background:'none', fontFamily:'var(--font-sans)' },
  empty:{ textAlign:'center', padding:'48px', color:'var(--text-tertiary)', fontSize:13 },
  overlay:{ position:'fixed', inset:0, background:'rgba(44,42,38,0.3)', backdropFilter:'blur(2px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 },
  drawer:{ background:'var(--bg-raised)', border:'1px solid var(--border-dim)', borderRadius:16, padding:24, width:'90%', maxWidth:460, boxShadow:'var(--shadow-lg)' },
  drawerHeader:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 },
}
