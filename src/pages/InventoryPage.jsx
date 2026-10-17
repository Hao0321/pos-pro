import {tr,trMessage,getLocale} from "../i18n"
import { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react'
import { Plus, Pencil, Trash2, X, Check, AlertTriangle, ChevronUp, ChevronDown, Barcode, Printer, Tag, Truck, Camera, Upload, Download, FileText, Search, MoreHorizontal, CheckSquare } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import { loadSuppliers, loadPurchases, getAgentContext } from '../utils/dataAccess'
import {costDraftKey} from '../utils/costPricingDraft'
import { DEFAULT_CATEGORIES, CATEGORY_META, mergeCategories, groupByCategory } from '../utils/categories'
import { getExpiringProducts, getProductHistory } from '../utils/analytics'
import { parseCSV, stringifyCSV, downloadCSV, readFileAsText, PRODUCT_CSV_HEADERS, productToCSVRow, csvRowToProduct } from '../utils/csv'
const BarcodeScannerModal = lazy(() => import('../components/BarcodeScannerModal'))
const CostPricingPanel = lazy(() => import('../components/CostPricingPanel'))

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

// 低庫存判斷：有設安全庫存就用安全庫存，沒設就用 5（零庫存另計）
const isLowStock = p => p.stock > 0 && (p.reorderLevel > 0 ? p.stock <= p.reorderLevel : p.stock <= 5)

export default function InventoryPage({ store,session }) {
  const { products, addProduct, updateProduct, deleteProduct, categories, orders = [], wasteLog = [] } = store
  const [editing,   setEditing]   = useState(null)
  const [form,      setForm]      = useState(EMPTY)
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')       // 快速篩選：all / low / zero / expiry / nobc
  const [catFilter, setCatFilter] = useState('all')       // 分類 chip
  const [sortMode,  setSortMode]  = useState('category')  // category / name / stockAsc / stockDesc / priceDesc / column
  const [sortKey,   setSortKey]   = useState('name')      // 欄位排序（點表頭時 sortMode='column'）
  const [sortAsc,   setSortAsc]   = useState(true)
  const [confirmDel, setConfirmDel] = useState(null)
  const [barcodePreview, setBarcodePreview] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [suppliers, setSuppliers] = useState([])
  const [showCamera, setShowCamera] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [showTools, setShowTools] = useState(false)   // 「⋯ 更多工具」下拉選單
  const [batchMode, setBatchMode] = useState(false)   // 批量操作模式（顯示勾選欄）
  const [batchForm, setBatchForm] = useState({ action: 'price', value: '', supplierId: '', category: '' })
  const [csvImport, setCsvImport] = useState(null) // { records, toAdd, toUpdate, errors }
  const [purchases, setPurchases] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [pricingOpen,setPricingOpen]=useState(false)
  const [pricingContext,setPricingContext]=useState({ready:false,context:null})
  const csvFileRef = useRef(null)
  const savingRef=useRef(false)
  const pricingInputRef=useRef(null),pricingAppliedRef=useRef(null)

  useEffect(() => { loadSuppliers([]).then(s => setSuppliers(Array.isArray(s) ? s : [])) }, [])
  useEffect(() => { loadPurchases([]).then(p => setPurchases(Array.isArray(p) ? p : [])) }, [])
  useEffect(()=>{let cancelled=false;setPricingContext({ready:false,context:null});getAgentContext(session).then(context=>{if(!cancelled)setPricingContext({ready:true,context})}).catch(()=>{if(!cancelled)setPricingContext({ready:true,context:null})});return()=>{cancelled=true}},[session?.userId,session?.role])

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
      alert(tr("讀取 CSV 失敗：{0}", {0: err.message || err}))
    }
    if (csvFileRef.current) csvFileRef.current.value = ''
  }

  async function confirmCSVImport() {
    if (!csvImport||savingRef.current) return
    savingRef.current=true
    const additions=[...csvImport.toAdd],updates=[...csvImport.toUpdate]
    try{
    while(additions.length){const {data}=additions[0]
      const { id, supplierName, ...rest } = data
      data._creationId ||= 'p'+crypto.randomUUID()
      await addProduct({...rest,_creationId:data._creationId});additions.shift()
    }
    while(updates.length){const {id,data}=updates[0]
      // 更新既有商品時不覆蓋 stock —— 庫存應由結帳/進貨/盤點管理，避免 CSV 把期間異動倒回
      const { id: _, supplierName, stock, ...rest } = data
      await updateProduct(id, rest);updates.shift()
    }
    const total = csvImport.toAdd.length + csvImport.toUpdate.length
    setCsvImport(null)
    alert(tr("✓ 匯入完成：新增 {0}、更新 {1}（共 {2}）\n※ 更新既有商品不會改動庫存", {0: csvImport.toAdd.length, 1: csvImport.toUpdate.length, 2: total}))
    }catch(e){setCsvImport({...csvImport,toAdd:additions,toUpdate:updates});alert(tr("匯入停止，已保存的項目會保留；剩餘項目可重試：{0}", {0: e.message}))}finally{savingRef.current=false}
  }

  function toggleAll(visibleIds, checked) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) visibleIds.forEach(id => next.add(id))
      else visibleIds.forEach(id => next.delete(id))
      return next
    })
  }

  async function applyBatch() {
    if(savingRef.current)return;savingRef.current=true
    try{
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
      if (Object.keys(update).length) {await updateProduct(id, update);setSelectedIds(previous=>{const next=new Set(previous);next.delete(id);return next})}
    }
    setShowBatch(false)
    setBatchForm({ action: 'price', value: '', supplierId: '', category: '' })
    setSelectedIds(new Set())
    }catch(e){alert(tr("批次更新停止，剩餘項目保留：{0}", {0: e.message}))}finally{savingRef.current=false}
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
        await updateProduct(product.id, { barcode: result.barcodeText })
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
    setSortMode('column')
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  // 即將過期 / 已過期商品 id 集合（給 filter 用）— useMemo 避免每次 render 重掃全商品
  const { expiredIds, expiringIds, soon } = useMemo(() => {
    const { expired, soon } = getExpiringProducts(products, 7)
    return {
      soon,
      expiredIds: new Set(expired.map(p => p.id)),
      expiringIds: new Set([...expired.map(p => p.id), ...soon.map(p => p.id)]),
    }
  }, [products])

  // 搜尋（名稱 + 條碼 + 分類）+ 分類 chip + 快速篩選
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      if (q) {
        const hit = (p.name||'').toLowerCase().includes(q)
          || (p.barcode||'').toLowerCase().includes(q)
          || (p.category||'').toLowerCase().includes(q)
        if (!hit) return false
      }
      if (catFilter !== 'all' && (p.category || '未分類') !== catFilter) return false
      if (filter === 'low')    return isLowStock(p)
      if (filter === 'zero')   return p.stock === 0
      if (filter === 'nobc')   return !!p.noBarcode
      if (filter === 'expiry') return expiringIds.has(p.id)
      return true
    })
  }, [products, search, catFilter, filter, expiringIds])

  // 排序 → 展開成列（分類模式插入分組標題列）
  const rows = useMemo(() => {
    const byName = (a, b) => (a.name||'').localeCompare(b.name||'', 'zh-Hant')
    const list = [...filtered]
    if (sortMode === 'name')           list.sort(byName)
    else if (sortMode === 'stockAsc')  list.sort((a, b) => (a.stock||0) - (b.stock||0))
    else if (sortMode === 'stockDesc') list.sort((a, b) => (b.stock||0) - (a.stock||0))
    else if (sortMode === 'priceDesc') list.sort((a, b) => (b.price||0) - (a.price||0))
    else if (sortMode === 'column') {
      list.sort((a, b) => {
        let va = a[sortKey], vb = b[sortKey]
        if (typeof va === 'string') va = va.toLowerCase()
        if (typeof vb === 'string') vb = vb.toLowerCase()
        return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
      })
    } else {
      // 分類分組（預設）：組間依預設分類順序、組內依名稱
      return groupByCategory(list).flatMap(g => [
        { type: 'header', category: g.category, count: g.products.length, fallback:g.products.every(p=>!p.category) },
        ...g.products.slice().sort(byName).map(p => ({ type: 'product', p })),
      ])
    }
    return list.map(p => ({ type: 'product', p }))
  }, [filtered, sortMode, sortKey, sortAsc])

  function startNew()  { pricingAppliedRef.current=null;setPricingOpen(false);setEditing('new'); setForm({...EMPTY,_creationId:'p'+crypto.randomUUID()}) }
  function startEdit(p){ pricingAppliedRef.current=null;setPricingOpen(false);setEditing(p.id);  setForm({...p,_expectedStock:p.stock,_expectedPricing:{price:p.price,cost:p.cost,unit:p.unit}}) }

  async function save() {
    if(savingRef.current)return
    if (!form.name?.trim() || form.price===''||form.price===null||form.price===undefined){alert(tr('請先填商品名稱與售價，內容會保留。'));return}
    if(pricingAppliedRef.current&&(pricingAppliedRef.current.stale||pricingAppliedRef.current.signature!==pricingInputRef.current||pricingAppliedRef.current.unit!==form.unit)){alert(tr('試算已改動，請重新核對並帶入；若改用手動定價，請直接修改商品成本或售價。'));return}
    const data = {
      ...form,
      price: parseFloat(form.price) || 0,
      cost:  parseFloat(form.cost)  || 0,
      stock: Number(form.stock)   || 0,
      reorderLevel: parseInt(form.reorderLevel) || 0,
      noBarcode: !form.barcode || form.noBarcode,
    }
    // A price/cost edit must not resend an unchanged quantity from an old form.
    if(editing!=='new'&&Number(form.stock)===form._expectedStock){delete data.stock;delete data._expectedStock}
    savingRef.current=true
    try{if (editing === 'new') await addProduct(data)
    else await updateProduct(editing, data)
    setEditing(null)}catch(e){alert(tr("商品未確認保存，請保留內容並核對：{0}", {0: trMessage(e.message)}))}finally{savingRef.current=false}
  }

  async function handleDelete(id) {
    if(savingRef.current)return;savingRef.current=true
    try{await deleteProduct(id); setConfirmDel(null)}catch(e){alert(trMessage(e.message))}finally{savingRef.current=false}
  }

  const lowCount    = products.filter(isLowStock).length
  const zeroCount   = products.filter(p => p.stock === 0).length
  const expiryCount = expiringIds.size
  const nobcCount   = products.filter(p => p.noBarcode).length

  // 一鍵快速篩選（可再點一次取消）
  const QUICK_FILTERS = [
    ['low',    '⚠️ 低庫存',        lowCount],
    ['zero',   '🚫 零庫存',        zeroCount],
    ['expiry', '⏰ 快過期/已過期', expiryCount],
    ['nobc',   '🏷️ 無條碼',        nobcCount],
  ]

  // 分類 chips：只列出商品中實際存在的分類（依預設分類順序），附數量
  const catChips = useMemo(
    () => groupByCategory(products).map(g => ({ cat: g.category, count: g.products.length, fallback:g.products.every(p=>!p.category) })),
    [products]
  )

  const filtersActive = search.trim() !== '' || catFilter !== 'all' || filter !== 'all'

  const COLS = [
    { key:'name',  label:'商品名稱',  flex:'2fr' },
    { key:'category', label:'分類',   flex:'1fr' },
    { key:'price', label:'售價',      flex:'80px', mono:true, align:'right' },
    { key:'cost',  label:'成本',      flex:'80px', mono:true, align:'right' },
    { key:'stock', label:'庫存',      flex:'70px', mono:true, align:'right' },
    { key:'barcode', label:'條碼',    flex:'1.4fr', mono:true },
  ]

  const gridTpl = (batchMode ? '32px ' : '') + COLS.map(c=>c.flex).join(' ') + ' 80px'

  return (
    <div style={iv.root}>
      <div style={iv.header}>
        <div>
          <h2 className="page-title" style={iv.title}>{tr("庫存管理")}</h2>
          <button className="btn btn-ghost" onClick={()=>store.setView('warehouse')}>{tr('搬貨、存放地點')} →</button>
          {session?.role==='owner'&&<button className="btn btn-ghost" onClick={()=>store.setView('stockhistory')}>{tr('庫存去哪了')} →</button>}
          <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
            {filtersActive
              ? <>{tr("顯示 ")}{filtered.length} / {products.length}{tr(" 項")}</>
              : <>{tr("共 ")}{products.length}{tr(" 種商品")}</>}
            {(lowCount + zeroCount) > 0 && (
              <span style={{color:'var(--amber)', marginLeft:8}}>
                · {lowCount + zeroCount}{tr(" 項需補貨")}</span>
            )}
          </div>
        </div>
        <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
          <button className="btn btn-ghost" style={{minHeight:44, padding:'8px 16px'}} onClick={()=>setShowCamera(true)} title={tr("用相機掃條碼快速找/新增商品")}>
            <Camera size={15}/>{tr("掃條碼")}</button>
          <div style={{position:'relative'}}>
            <button className="btn btn-ghost" style={{minHeight:44, padding:'8px 16px'}} onClick={()=>setShowTools(v=>!v)} title={tr("CSV 匯入匯出、範本、批量操作")}>
              <MoreHorizontal size={15}/>{tr("更多工具")}</button>
            {showTools && (
              <>
                {/* 透明 backdrop：點外面關閉 */}
                <div style={{position:'fixed', inset:0, zIndex:90}} onClick={()=>setShowTools(false)}/>
                <div style={iv.toolsMenu}>
                  <button style={iv.toolsItem} onClick={()=>{ setShowTools(false); csvFileRef.current?.click() }} title={tr("從 CSV 批量匯入（新增 + 更新）")}>
                    <Upload size={14}/>{tr("匯入 CSV")}</button>
                  <button style={iv.toolsItem} onClick={()=>{ setShowTools(false); handleExportCSV() }} title={tr("匯出全部商品為 CSV")}>
                    <Download size={14}/>{tr("匯出 CSV")}</button>
                  <button style={iv.toolsItem} onClick={()=>{ setShowTools(false); handleDownloadTemplate() }} title={tr("下載 CSV 範本")}>
                    <FileText size={14}/>{tr("下載範本")}</button>
                  <button
                    style={{...iv.toolsItem, color: batchMode ? 'var(--accent)' : 'var(--text-primary)'}}
                    onClick={()=>{ setShowTools(false); if (batchMode) setSelectedIds(new Set()); setBatchMode(!batchMode) }}
                    title={tr("開啟後可勾選多項商品批量編輯 / 列印標籤")}
                  >
                    <CheckSquare size={14}/>{batchMode ? tr("結束批量操作") : tr("批量操作")}
                  </button>
                </div>
              </>
            )}
          </div>
          <button className="btn btn-primary" style={{minHeight:44, padding:'8px 18px'}} onClick={startNew}>
            <Plus size={15}/>{tr("新增商品")}</button>
        </div>
      </div>

      {/* 🔍 找商品優先區：大搜尋框 + 分類 chips + 快速篩選 + 排序 */}
      <div style={iv.findBar}>
        <div style={{position:'relative', width:'100%'}}>
          <Search size={16} style={{position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'var(--text-tertiary)', pointerEvents:'none'}}/>
          <input
            className="field"
            value={search}
            onChange={e=>setSearch(e.target.value)}
            placeholder={tr("搜尋商品名稱 / 條碼 / 分類…")}
            style={{minHeight:44, fontSize:15, paddingLeft:40, paddingRight:46}}
          />
          {search && (
            <button onClick={()=>setSearch('')} title={tr("清除搜尋")} style={iv.searchClear}>
              <X size={16}/>
            </button>
          )}
        </div>

        <div style={iv.chipRow}>
          <button onClick={()=>setCatFilter('all')} style={{...iv.chip, ...(catFilter==='all' ? iv.chipOn : {})}}>{tr("全部 ")}<span style={iv.chipCount}>{products.length}</span>
          </button>
          {catChips.map(({ cat, count, fallback }) => (
            <button key={cat} onClick={()=>setCatFilter(catFilter===cat ? 'all' : cat)} style={{...iv.chip, ...(catFilter===cat ? iv.chipOn : {})}}>
              {CATEGORY_META[cat]?.icon || '📦'} {fallback?tr('未分類'):cat} <span style={iv.chipCount}>{count}</span>
            </button>
          ))}
        </div>

        <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
          {QUICK_FILTERS.map(([k, l, n]) => (
            <button key={k} onClick={()=>setFilter(filter===k ? 'all' : k)} style={{...iv.chip, ...(filter===k ? iv.chipOn : {})}}>
              {tr(l)} <span style={iv.chipCount}>{n}</span>
            </button>
          ))}
          <div style={{flex:1}}/>
          <select
            className="field"
            value={sortMode}
            onChange={e=>setSortMode(e.target.value)}
            title={tr("排序方式")}
            style={{width:'auto', minHeight:40, padding:'6px 12px', fontSize:13, cursor:'pointer'}}
          >
            <option value="category">{tr("排序：分類（預設）")}</option>
            <option value="name">{tr("排序：名稱")}</option>
            <option value="stockAsc">{tr("排序：庫存 少→多")}</option>
            <option value="stockDesc">{tr("排序：庫存 多→少")}</option>
            <option value="priceDesc">{tr("排序：價格 高→低")}</option>
            {sortMode === 'column' && <option value="column">{tr("排序：欄位（點表頭）")}</option>}
          </select>
        </div>

        <input ref={csvFileRef} type="file" accept=".csv" style={{display:'none'}} onChange={handleCSVFile}/>
      </div>

      {/* Table */}
      <div style={iv.tableWrap}>
        {/* Header */}
        <div style={{...iv.row, ...iv.rowHead, gridTemplateColumns: gridTpl}}>
          {batchMode && (
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every(p => selectedIds.has(p.id))}
              onChange={e => toggleAll(filtered.map(p=>p.id), e.target.checked)}
              title={tr("全選")}
              style={{cursor:'pointer', accentColor:'var(--gold)'}}
            />
          )}
          {COLS.map(col => (
            <button key={col.key} onClick={()=>handleSort(col.key)} style={{...iv.colHead, justifyContent: col.align==='right' ? 'flex-end' : 'flex-start'}}>
              {tr(col.label)}
              {sortMode==='column' && sortKey===col.key && (sortAsc ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)}
            </button>
          ))}
          <span style={{...iv.colHead, fontSize:11}}>{tr("操作")}</span>
        </div>

        {/* Rows */}
        <div style={{flex:1, overflowY:'auto'}}>
          {filtered.length === 0 ? (
            <div style={iv.empty}>
              {search.trim() ? (
                <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:14}}>
                  <div>{tr("找不到「")}{search.trim()}{tr("」— 檢查一下關鍵字，或直接新增")}</div>
                  <button
                    className="btn btn-primary"
                    style={{minHeight:44}}
                    onClick={()=>{
                      const q = search.trim()
                      setEditing('new')
                      // 純數字長串 → 當條碼預填；否則當商品名稱預填
                      setForm(/^\d{6,}$/.test(q) ? { ...EMPTY, barcode:q, noBarcode:false } : { ...EMPTY, name:q })
                    }}
                  >
                    <Plus size={15}/>{tr("新增商品")}</button>
                </div>
              ) : tr("沒有符合條件的商品")}
            </div>
          ) : rows.map(r => {
            if (r.type === 'header') return (
              <div key={'hdr-'+r.category} style={iv.catHead}>
                <span style={{fontSize:14}}>{CATEGORY_META[r.category]?.icon || '📦'}</span>
                <span>{r.category}</span>
                <span style={{fontFamily:'var(--font-mono)', fontWeight:400, color:'var(--text-tertiary)'}}>{r.count}</span>
              </div>
            )
            const p = r.p
            const low  = isLowStock(p)
            const zero = p.stock === 0
            return (
              <div key={p.id} className="cv-row" style={{...iv.row, gridTemplateColumns: gridTpl, background: selectedIds.has(p.id) ? 'var(--gold-dim)' : expiredIds.has(p.id) ? 'rgba(217,79,68,0.06)' : zero?'rgba(217,79,68,0.04)': low?'rgba(217,119,6,0.04)' : expiringIds.has(p.id) ? 'rgba(217,119,6,0.05)' : 'transparent'}}>
                {batchMode && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={()=>toggleSelect(p.id)}
                    style={{cursor:'pointer', accentColor:'var(--gold)'}}
                  />
                )}
                <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                  {p.noBarcode && <span style={{fontSize:9, border:'1px solid var(--border-mid)', color:'var(--text-tertiary)', borderRadius:4, padding:'1px 5px', flexShrink:0}}>{tr("自包")}</span>}
                  <span style={{fontWeight:600, fontSize:14}}>{p.name}</span>
                  {expiredIds.has(p.id) && (
                    <span style={{fontSize:9, background:'var(--red-dim)', color:'var(--red)', borderRadius:4, padding:'1px 5px', fontWeight:600}}>{tr("已過期")}</span>
                  )}
                  {!expiredIds.has(p.id) && expiringIds.has(p.id) && (() => {
                    const day = soon.find(s => s.id === p.id)?.daysLeft
                    return <span style={{fontSize:9, background:'var(--amber-dim)', color:'var(--amber)', borderRadius:4, padding:'1px 5px', fontWeight:600}}>{day}{tr("天到期")}</span>
                  })()}
                </div>
                <span style={{fontSize:12, color:'var(--text-secondary)'}}>{p.category}</span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:12, textAlign:'right'}}>
                  {p.price.toLocaleString()}
                </span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-secondary)', textAlign:'right'}}>
                  {p.cost ? p.cost.toLocaleString() : '—'}
                </span>
                <span style={{display:'flex', justifyContent:'flex-end', alignItems:'center'}}>
                  {zero ? (
                    <span className="badge badge-red" style={{fontFamily:'var(--font-mono)'}}>0</span>
                  ) : low ? (
                    <span className="badge badge-amber" style={{fontFamily:'var(--font-mono)'}}>
                      <AlertTriangle size={10}/>{p.stock}
                    </span>
                  ) : (
                    <span style={{fontFamily:'var(--font-mono)', fontSize:13}}>{p.stock}</span>
                  )}
                </span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:11, color: p.noBarcode?'var(--text-tertiary)':'var(--teal)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {p.noBarcode ? '—' : p.barcode || '—'}
                </span>
                <div style={{display:'flex', gap:4, justifyContent:'flex-end'}}>
                  {window.electronAPI && (
                    <button className="btn-icon btn-sm" title={tr("產生條碼")} onClick={()=>handleGenerateBarcode(p)} style={{color:'var(--teal)'}}><Barcode size={13}/></button>
                  )}
                  <button className="btn-icon btn-sm" aria-label={tr('編輯商品')} data-product-edit={p.id} onClick={()=>startEdit(p)}><Pencil size={13}/></button>
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
              <span style={{fontWeight:600, fontSize:15}}>{editing==='new'?tr("新增商品"):tr("編輯商品")}</span>
              <button className="btn-icon" data-product-editor-close aria-label={tr('關閉')} onClick={()=>setEditing(null)}><X size={16}/></button>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14}}>
              <div style={{gridColumn:'1/-1'}}>
                <FieldLabel>{tr("商品名稱 *")}</FieldLabel>
                <input className="field" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder={tr("例：花生糖")}/>
              </div>
              <div>
                <FieldLabel>{tr("分類")}</FieldLabel>
                <input className="field" value={form.category} list="cat-list" onChange={e=>setForm(f=>({...f,category:e.target.value}))} placeholder={tr("例：雜貨、生鮮、調味料...")}/>
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
                <FieldLabel>{tr("單位")}</FieldLabel>
                <input className="field" value={form.unit} onChange={e=>{if(pricingAppliedRef.current)pricingAppliedRef.current.stale=true;setForm(f=>({...f,unit:e.target.value}))}} placeholder={tr("包 / 瓶 / kg")}/>
              </div>
              <div>
                <FieldLabel>{tr("售價 (NT$) *")}</FieldLabel>
                <input className="field" type="number" name="productPrice" aria-label={tr('售價')} value={form.price} onChange={e=>{pricingAppliedRef.current=null;setForm(f=>({...f,price:e.target.value}))}} placeholder="0"/>
              </div>
              <div>
                <FieldLabel>{tr("成本 (NT$)")}</FieldLabel>
                <input className="field" type="number" name="productCost" aria-label={tr('成本')} value={form.cost} onChange={e=>{pricingAppliedRef.current=null;setForm(f=>({...f,cost:e.target.value}))}} placeholder="0"/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <button type="button" className="btn btn-ghost" data-cost-pricing-open style={{minHeight:46,width:'100%',whiteSpace:'normal'}} aria-expanded={pricingOpen} onClick={()=>setPricingOpen(value=>!value)}>{tr('自動算成本與售價')}</button>
                {pricingOpen&&(pricingContext.ready?<Suspense fallback={<p role="status">{tr('正在載入…')}</p>}><CostPricingPanel key={editing==='new'?form._creationId||'new':editing} unit={form.unit} cacheKey={costDraftKey(pricingContext.context,session,editing==='new'?form._creationId:editing)} currentInputRef={pricingInputRef} onDraftEdited={()=>{if(pricingAppliedRef.current)pricingAppliedRef.current.stale=true}} onApply={(values,signature)=>{pricingAppliedRef.current={signature,unit:form.unit,stale:false};setForm(old=>({...old,...values}))}}/></Suspense>:<p role="status">{tr('正在載入…')}</p>)}
              </div>
              <div>
                <FieldLabel>{tr("庫存數量")}</FieldLabel>
                <input className="field" type="number" value={form.stock} onChange={e=>setForm(f=>({...f,stock:e.target.value}))} placeholder="0"/>
              </div>
              <div>
                <FieldLabel>{tr("安全庫存（低於此值提醒補貨）")}</FieldLabel>
                <input className="field" type="number" value={form.reorderLevel} onChange={e=>setForm(f=>({...f,reorderLevel:e.target.value}))} placeholder={tr("例：10")}/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <FieldLabel><Truck size={11} style={{verticalAlign:'-1px',marginRight:4}}/>{tr("主要供應商")}</FieldLabel>
                <select className="field" value={form.supplierId || ''} onChange={e=>setForm(f=>({...f,supplierId:e.target.value}))} style={{cursor:'pointer'}}>
                  <option value="">{tr("— 未指定 —")}</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {suppliers.length === 0 && (
                  <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:4}}>{tr("尚未建立供應商，請至「進貨管理 → 供應商」新增")}</div>
                )}
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'var(--text-secondary)'}}>
                  <input type="checkbox" checked={form.noBarcode} onChange={e=>setForm(f=>({...f,noBarcode:e.target.checked,barcode:e.target.checked?'':f.barcode}))} style={{accentColor:'var(--gold)'}}/>{tr("此商品為自包裝，無條碼")}</label>
              </div>
              {!form.noBarcode && (
                <div style={{gridColumn:'1/-1'}}>
                  <FieldLabel>{tr("條碼")}</FieldLabel>
                  <input className="field" value={form.barcode} onChange={e=>setForm(f=>({...f,barcode:e.target.value}))} placeholder={tr("掃描或手動輸入")} style={{fontFamily:'var(--font-mono)'}}/>
                </div>
              )}
              <div>
                <FieldLabel>{tr("保存期限（選填）")}</FieldLabel>
                <input className="field" type="date" value={form.expiryDate || ''} onChange={e=>setForm(f=>({...f,expiryDate:e.target.value}))}/>
              </div>
              <div>
                <FieldLabel>{tr("商品圖片網址（選填）")}</FieldLabel>
                <input className="field" value={form.imageUrl || ''} onChange={e=>setForm(f=>({...f,imageUrl:e.target.value}))} placeholder="https://..."/>
              </div>
              {form.imageUrl && (
                <div style={{gridColumn:'1/-1', textAlign:'center'}}>
                  <img src={form.imageUrl} alt={tr("預覽")} style={{maxHeight:120, maxWidth:'100%', borderRadius:8, border:'1px solid var(--border-dim)'}} onError={e=>e.target.style.display='none'}/>
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
                  <span>{tr("📋 變動歷史")}</span>
                  {showHistory ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                </button>
                {showHistory && (() => {
                  const history = getProductHistory(editing, { orders, wasteLog, purchases })
                  if (history.length === 0) return (
                    <div style={{padding:'14px', textAlign:'center', color:'var(--text-tertiary)', fontSize:12}}>{tr("此商品尚無變動紀錄")}</div>
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
                                <span style={{color:typeMeta.color, fontWeight:600, fontSize:11}}>{tr(typeMeta.label)}</span>
                                <span style={{color:'var(--text-tertiary)', fontSize:11}}>{h.note}</span>
                              </div>
                              <div style={{fontSize:10, color:'var(--text-tertiary)', marginTop:2, fontFamily:'var(--font-mono)'}}>
                                {new Date(h.time).toLocaleString(getLocale(),{ month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit' })}
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
                        <div style={{padding:'8px 14px', textAlign:'center', fontSize:11, color:'var(--text-tertiary)', borderTop:'1px solid var(--border-dim)'}}>{tr("僅顯示最近 30 筆（共 ")}{history.length}{tr(" 筆）")}</div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={save}><Check size={15}/>{tr("儲存")}</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setEditing(null)}>{tr("取消")}</button>
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
              <div style={{fontWeight:600, marginBottom:6}}>{tr("確認刪除？")}</div>
              <div style={{fontSize:13, color:'var(--text-secondary)'}}>{tr("此操作無法復原")}</div>
            </div>
            <div style={{display:'flex', gap:10}}>
              <button className="btn btn-danger" style={{flex:1}} onClick={()=>handleDelete(confirmDel)}>{tr("確認刪除")}</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setConfirmDel(null)}>{tr("取消")}</button>
            </div>
          </div>
        </div>
      )}

      {/* 條碼預覽 Modal */}
      {barcodePreview && (
        <div style={iv.overlay} onClick={() => setBarcodePreview(null)}>
          <div style={{...iv.drawer, maxWidth:420, textAlign:'center'}} className="animate-scale" onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <h3 style={{fontSize:15, fontWeight:600}}>{tr("條碼預覽")}</h3>
              <button className="btn-icon btn-sm" onClick={() => setBarcodePreview(null)}><X size={16}/></button>
            </div>
            <div style={{marginBottom:12, fontWeight:600, fontSize:16}}>{barcodePreview.product.name}</div>
            <div style={{marginBottom:12, color:'var(--accent)', fontWeight:700, fontSize:18}}>
              ${barcodePreview.product.price} / {barcodePreview.product.unit || tr("個")}
            </div>
            <div style={{
              marginTop:12, padding:'16px', background:'#fff', borderRadius:8,
              border:'1px solid var(--border-dim)', display:'flex', flexDirection:'column', alignItems:'center',
            }}>
              <BarcodeDisplay value={barcodePreview.barcodeText} />
            </div>
            <div style={{marginTop:6, fontSize:11, color:'var(--text-tertiary)'}}>{tr("CODE128 格式 · ")}{barcodePreview.barcodeText}
            </div>
            <div style={{display:'flex', gap:10, marginTop:16}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={() => { handlePrintLabel(barcodePreview.product); setBarcodePreview(null) }}>
                <Printer size={14}/>{tr(" 列印標籤")}</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={() => setBarcodePreview(null)}>{tr("關閉")}</button>
            </div>
          </div>
        </div>
      )}

      {/* CSV 匯入預覽 */}
      {csvImport && (
        <div style={iv.overlay}>
          <div style={{...iv.drawer, maxWidth:680}} className="animate-scale">
            <div style={iv.drawerHeader}>
              <span style={{fontWeight:600, fontSize:15}}>{tr("CSV 匯入預覽")}</span>
              <button className="btn-icon" onClick={()=>setCsvImport(null)}><X size={16}/></button>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14}}>
              <div style={{padding:'10px 14px', background:'var(--green-dim)', borderRadius:8, borderTop:'2px solid var(--green)'}}>
                <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:3}}>{tr("將新增")}</div>
                <div style={{fontSize:22, fontWeight:600, color:'var(--green)', fontFamily:'var(--font-mono)'}}>{csvImport.toAdd.length}</div>
              </div>
              <div style={{padding:'10px 14px', background:'var(--blue-dim)', borderRadius:8, borderTop:'2px solid var(--blue)'}}>
                <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:3}}>{tr("將更新")}</div>
                <div style={{fontSize:22, fontWeight:600, color:'var(--blue)', fontFamily:'var(--font-mono)'}}>{csvImport.toUpdate.length}</div>
              </div>
              <div style={{padding:'10px 14px', background: csvImport.errors.length ? 'var(--red-dim)' : 'var(--bg-overlay)', borderRadius:8, borderTop:`2px solid ${csvImport.errors.length ? 'var(--red)' : 'var(--text-tertiary)'}`}}>
                <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:3}}>{tr("錯誤")}</div>
                <div style={{fontSize:22, fontWeight:600, color: csvImport.errors.length ? 'var(--red)' : 'var(--text-tertiary)', fontFamily:'var(--font-mono)'}}>{csvImport.errors.length}</div>
              </div>
            </div>

            {csvImport.errors.length > 0 && (
              <div style={{marginBottom:12, padding:'10px 12px', background:'var(--red-dim)', borderRadius:6, fontSize:11, color:'var(--red)', maxHeight:120, overflowY:'auto'}}>
                {csvImport.errors.slice(0,10).map((e,i) => <div key={i}>{e}</div>)}
                {csvImport.errors.length > 10 && <div style={{opacity:0.7, marginTop:4}}>{tr("...還有 ")}{csvImport.errors.length - 10}{tr(" 個錯誤")}</div>}
              </div>
            )}

            <div style={{maxHeight:260, overflowY:'auto', border:'1px solid var(--border-dim)', borderRadius:8}}>
              <table style={{width:'100%', fontSize:11}}>
                <thead>
                  <tr style={{background:'var(--bg-overlay)', position:'sticky', top:0}}>
                    <th style={{textAlign:'left', padding:'7px 10px'}}>{tr("動作")}</th>
                    <th style={{textAlign:'left', padding:'7px 10px'}}>{tr("商品")}</th>
                    <th style={{textAlign:'left', padding:'7px 10px'}}>{tr("分類")}</th>
                    <th style={{textAlign:'right', padding:'7px 10px'}}>{tr("售價")}</th>
                    <th style={{textAlign:'right', padding:'7px 10px'}}>{tr("庫存")}</th>
                    <th style={{textAlign:'left', padding:'7px 10px'}}>{tr("供應商")}</th>
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
                        }}>{row.action==='add' ? tr("新增") : tr("更新")}</span>
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
                <Check size={15}/>{tr("確認匯入（")}{csvImport.toAdd.length + csvImport.toUpdate.length}{tr(" 筆）")}</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setCsvImport(null)}>{tr("取消")}</button>
            </div>
          </div>
        </div>
      )}

      {/* 相機掃條碼 */}
      {showCamera && (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            title={tr("掃條碼查找或新增商品")}
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
          borderRadius:'var(--r-pill)', boxShadow:'var(--shadow-lg)',
          border:'1px solid var(--border-mid)',
        }}>
          <span style={{fontSize:13, fontWeight:600, color:'var(--text-secondary)', marginRight:4}}>{tr("已選 ")}{selectedIds.size}
          </span>
          <button className="btn btn-primary btn-sm" onClick={()=>setShowBatch(true)}>
            <Pencil size={14}/>{tr(" 批量編輯")}</button>
          {window.electronAPI && (
            <button className="btn btn-ghost btn-sm" onClick={handleBatchPrint}>
              <Printer size={14}/>{tr(" 列印標籤")}</button>
          )}
          <button className="btn-icon btn-sm" onClick={()=>setSelectedIds(new Set())} title={tr("清除選取")}>
            <X size={14}/>
          </button>
        </div>
      )}

      {/* 批量編輯 modal */}
      {showBatch && (
        <div style={iv.overlay}>
          <div style={iv.drawer} className="animate-scale">
            <div style={iv.drawerHeader}>
              <span style={{fontWeight:600, fontSize:15}}>{tr("批量編輯 ")}{selectedIds.size}{tr(" 項商品")}</span>
              <button className="btn-icon" onClick={()=>setShowBatch(false)}><X size={16}/></button>
            </div>
            <FieldLabel>{tr("批量動作")}</FieldLabel>
            <select className="field" value={batchForm.action} onChange={e=>setBatchForm(f=>({...f, action:e.target.value, value:''}))} style={{cursor:'pointer', marginBottom:12}}>
              <option value="price">{tr("設定售價")}</option>
              <option value="priceAdjust">{tr("售價調整百分比（例：+10 = 漲 10%）")}</option>
              <option value="cost">{tr("設定成本")}</option>
              <option value="reorderLevel">{tr("設定安全庫存")}</option>
              <option value="supplier">{tr("設定主要供應商")}</option>
              <option value="category">{tr("設定分類")}</option>
            </select>

            {batchForm.action === 'supplier' ? (
              <>
                <FieldLabel>{tr("供應商")}</FieldLabel>
                <select className="field" value={batchForm.supplierId} onChange={e=>setBatchForm(f=>({...f, supplierId:e.target.value}))} style={{cursor:'pointer'}}>
                  <option value="">{tr("— 未指定 —")}</option>
                  {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </>
            ) : batchForm.action === 'category' ? (
              <>
                <FieldLabel>{tr("分類")}</FieldLabel>
                <input className="field" value={batchForm.category} list="cat-list" onChange={e=>setBatchForm(f=>({...f, category:e.target.value}))} placeholder={tr("輸入或選擇分類")}/>
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
                  {batchForm.action === 'priceAdjust' ? tr("百分比（+/-，例：+10 / -5）") : tr("數值")}
                </FieldLabel>
                <input className="field" type="number" value={batchForm.value} onChange={e=>setBatchForm(f=>({...f, value:e.target.value}))} placeholder={batchForm.action==='priceAdjust' ? tr("+10 = 漲 10%") : '0'}/>
              </>
            )}

            <div style={{display:'flex', gap:10, marginTop:18}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={applyBatch}>
                <Check size={15}/>{tr("套用到 ")}{selectedIds.size}{tr(" 項")}</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setShowBatch(false)}>{tr("取消")}</button>
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
  findBar:{ display:'flex', flexDirection:'column', gap:8, flexShrink:0 },
  searchClear:{ position:'absolute', right:3, top:'50%', transform:'translateY(-50%)', width:40, height:40, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:8, border:'none', background:'transparent', color:'var(--text-tertiary)', cursor:'pointer' },
  chipRow:{ display:'flex', gap:6, overflowX:'auto', paddingBottom:2, flexShrink:0 },
  chip:{ display:'inline-flex', alignItems:'center', gap:6, minHeight:40, padding:'6px 14px', borderRadius:'var(--r-pill)', fontSize:13, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, background:'var(--bg-raised)', color:'var(--text-secondary)', border:'1px solid var(--border-dim)', transition:'all 120ms' },
  chipOn:{ background:'var(--accent-dim)', color:'var(--accent)', border:'1px solid var(--accent)', fontWeight:600 },
  chipCount:{ fontFamily:'var(--font-mono)', fontSize:11, opacity:0.75 },
  catHead:{ display:'flex', alignItems:'center', gap:8, padding:'6px 16px', minWidth:700, background:'var(--bg-overlay)', borderBottom:'1px solid var(--border-dim)', fontSize:12, fontWeight:600, color:'var(--text-secondary)' },
  toolsMenu:{ position:'absolute', top:'calc(100% + 6px)', right:0, zIndex:95, minWidth:200, background:'var(--bg-raised)', border:'1px solid var(--border-dim)', borderRadius:12, boxShadow:'var(--shadow-lg)', padding:6, display:'flex', flexDirection:'column' },
  toolsItem:{ display:'flex', alignItems:'center', gap:10, minHeight:44, padding:'10px 14px', borderRadius:8, border:'none', fontSize:13, fontWeight:500, color:'var(--text-primary)', background:'transparent', cursor:'pointer', textAlign:'left', width:'100%' },
  tableWrap:{ flex:1, display:'flex', flexDirection:'column', background:'var(--bg-raised)', border:'1px solid var(--border-dim)', borderRadius:'var(--r3)', overflow:'auto', boxShadow:'var(--shadow-sm)' },
  row:{ display:'grid', gap:10, padding:'10px 16px', borderBottom:'1px solid var(--border-dim)', alignItems:'center', minWidth:700 },
  rowHead:{ background:'var(--bg-overlay)', flexShrink:0 },
  colHead:{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.06em', textTransform:'uppercase', cursor:'pointer', background:'none', fontFamily:'var(--font-sans)' },
  empty:{ textAlign:'center', padding:'48px', color:'var(--text-tertiary)', fontSize:13 },
  overlay:{ position:'fixed', inset:0, background:'rgba(23,37,60,0.30)', backdropFilter:'blur(2px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 },
  drawer:{ background:'var(--bg-raised)', border:'1px solid var(--border-dim)', borderRadius:16, padding:24, width:'90%', maxWidth:460, maxHeight:'calc(100dvh - 32px)',overflowY:'auto',boxShadow:'var(--shadow-lg)' },
  drawerHeader:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 },
}
