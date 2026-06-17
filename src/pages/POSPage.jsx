import { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react'
import { Search, ScanLine, X, Tag, ShoppingCart, DollarSign, Pause, Eye, Clock, Camera } from 'lucide-react'
import CartPanel from '../components/CartPanel'
import HeldOrdersModal from '../components/HeldOrdersModal'
import PriceLookupModal from '../components/PriceLookupModal'
import { CATEGORY_META } from '../utils/categories'
import useIsMobile from '../hooks/useIsMobile'
// lazy load html5-qrcode (~340KB) — 只在點相機掃描才載入
const BarcodeScannerModal = lazy(() => import('../components/BarcodeScannerModal'))

export default function POSPage({ store, session }) {
  const {
    products, members, cart, cartSubtotal, activeMember, setActiveMember,
    addToCart, removeFromCart, updateCartQty, updateCartItemPrice, clearCart, checkout,
    findByBarcode, findMember, categories,
    heldOrders, holdCart, recallHeld, removeHeld,
    openShift, pointsRule, manualDiscount, setManualDiscount,
    setView,
  } = store

  const [search,    setSearch]    = useState('')
  const [category,  setCategory]  = useState('全部')
  const [scanMode,  setScanMode]  = useState(false)
  const [feedback,  setFeedback]  = useState(null)
  const [showCart,  setShowCart]   = useState(false)
  const [showHeld,  setShowHeld]   = useState(false)
  const [showLookup,setShowLookup] = useState(false)
  const [showCamera,setShowCamera] = useState(false)
  const scanRef = useRef(null)
  const searchRef = useRef(null)
  const isMobile = useIsMobile()

  // memo + 把 toLowerCase 抽出迴圈：避免每次 resize/feedback/scanMode 重渲染都重掃全部商品
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return products.filter(p => {
      const okCat = category === '全部' || p.category === category
      const okSearch = !search
        || (p.name || '').toLowerCase().includes(q)
        || (p.barcode || '').includes(search)
        || (p.category || '').toLowerCase().includes(q)
      return okCat && okSearch
    })
  }, [products, search, category])

  const showFeedback = (ok, msg) => {
    setFeedback({ ok, msg })
    setTimeout(() => setFeedback(null), 2200)
  }

  const handleScan = useCallback(code => {
    const p = findByBarcode(code)
    if (p) { addToCart(p); showFeedback(true, `已加入：${p.name}`) }
    else showFeedback(false, `條碼 ${code} 查無商品`)
  }, [findByBarcode, addToCart])

  const handleHold = useCallback(async (label) => {
    await holdCart(label, session?.username || '')
    showFeedback(true, '已掛單')
  }, [holdCart, session])

  const handleKeyDown = useCallback(e => {
    if (e.key === 'F1') { e.preventDefault(); setShowLookup(true); return }
    if (e.key === 'F2' && cart.length > 0) {
      e.preventDefault()
      handleHold('')
      return
    }
    if (e.key === 'F3') { e.preventDefault(); setShowHeld(true); return }
    // 全域快捷鍵：'/' 聚焦搜尋（不在 input 內時觸發）
    const inInput = document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)
    if (e.key === '/' && !inInput) {
      e.preventDefault()
      searchRef.current?.focus()
      return
    }
    if (e.key === 'Escape' && inInput && document.activeElement === searchRef.current) {
      setSearch('')
      searchRef.current?.blur()
      return
    }
    if (!scanMode) return
    if (e.key === 'Enter') { handleScan(scanRef.current); scanRef.current = ''; return }
    if (e.key.length === 1) scanRef.current = (scanRef.current || '') + e.key
  }, [scanMode, handleScan, cart.length, handleHold])

  const handleUpdatePrice = useCallback((id, newPrice) => {
    updateCartItemPrice(id, newPrice)
  }, [updateCartItemPrice])

  const handleCheckout = useCallback((payMethod, paid, pointsUsed, opts) => {
    return checkout(payMethod, paid, pointsUsed, { ...opts, cashier: session?.username || '' })
  }, [checkout, session])

  const allCats = ['全部', ...categories]
  const cartCount = cart.reduce((s,i)=>s+i.qty, 0)

  // 班別檢查
  if (!openShift) {
    return (
      <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16, padding:40}}>
        <div style={{
          width:64, height:64, borderRadius:'50%', background:'var(--amber-dim)',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <Clock size={28} color="var(--amber)"/>
        </div>
        <div style={{fontSize:18, fontWeight:600, color:'var(--text-primary)'}}>尚未開班</div>
        <div style={{fontSize:13, color:'var(--text-secondary)', textAlign:'center', maxWidth:300}}>
          請先到「班別管理」開班並設定零用金，才能開始收銀。
        </div>
        <button className="btn btn-primary" onClick={()=>setView('shifts')} style={{padding:'10px 24px'}}>
          前往班別管理
        </button>
      </div>
    )
  }

  return (
    <div style={ps.root} tabIndex={0} onKeyDown={handleKeyDown}>
      <div style={ps.left}>
        <div style={ps.topBar}>
          <div style={ps.searchWrap}>
            <Search size={16} color="var(--text-tertiary)"/>
            <input ref={searchRef} style={ps.searchInput} value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isMobile ? "搜尋商品..." : "搜尋商品名稱 / 條碼 / 分類    (按 / 快速聚焦)"}/>
            {search && (
              <button className="btn-icon btn-sm" onClick={() => setSearch('')}>
                <X size={13}/>
              </button>
            )}
            {!isMobile && !search && (
              <kbd style={{...ps.kbd, fontSize:10}}>/</kbd>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={()=>setShowLookup(true)} title="查價 (F1)" style={{display:'flex', alignItems:'center', gap:4}}>
            <Eye size={14}/>{!isMobile && <span>查價</span>}
            {!isMobile && <kbd style={ps.kbd}>F1</kbd>}
          </button>
          {heldOrders.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={()=>setShowHeld(true)} style={{display:'flex', alignItems:'center', gap:4, color:'var(--gold)'}}>
              <Pause size={14}/>{!isMobile && <span>掛單</span>}
              <span className="badge badge-gold" style={{marginLeft:2}}>{heldOrders.length}</span>
            </button>
          )}
          {!isMobile && (
            <button className="btn btn-ghost btn-sm" onClick={() => setScanMode(v => !v)}
              style={{
                gap:6, border:`1px solid ${scanMode ? 'var(--accent)' : 'var(--border-subtle)'}`,
                color: scanMode ? 'var(--accent)' : 'var(--text-secondary)',
                background: scanMode ? 'var(--accent-dim)' : 'var(--bg-raised)',
              }}>
              <ScanLine size={15}/>
              {scanMode ? '掃碼中' : '掃碼'}
            </button>
          )}
          {/* 手機/PWA 相機掃描 */}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowCamera(true)}
            style={{
              gap:6, border:'1px solid var(--border-subtle)',
              color:'var(--text-secondary)', background:'var(--bg-raised)',
            }}
            title="用手機相機掃條碼">
            <Camera size={15}/>
            {!isMobile && <span>相機掃</span>}
          </button>
          {window.electronAPI && !isMobile && (
            <button className="btn btn-ghost btn-sm"
              onClick={() => window.electronAPI.printer.openCashDrawer().catch(() => {})}
              style={{ gap:6, border:'1px solid var(--border-subtle)', color:'var(--text-secondary)', background:'var(--bg-raised)' }}
              title="開啟錢箱">
              <DollarSign size={15}/> 開錢箱
            </button>
          )}
        </div>

        {feedback && (
          <div style={{
            ...ps.feedback,
            background: feedback.ok ? 'var(--green-dim)' : 'var(--red-dim)',
            border: `1px solid ${feedback.ok ? 'rgba(90,158,111,0.2)' : 'rgba(194,85,80,0.2)'}`,
            color: feedback.ok ? 'var(--green)' : 'var(--red)',
          }} className="animate-in">
            {feedback.msg}
          </div>
        )}

        <div style={ps.catWrap}>
          {allCats.map(cat => {
            const meta = CATEGORY_META[cat]
            const count = cat === '全部' ? products.length : products.filter(p => p.category === cat).length
            return (
              <button key={cat} onClick={() => setCategory(cat)} style={{
                ...ps.catTab,
                background: category === cat ? 'var(--accent-dim)' : 'transparent',
                color: category === cat ? 'var(--accent-bright)' : 'var(--text-tertiary)',
                borderBottom: `2px solid ${category === cat ? 'var(--accent)' : 'transparent'}`,
                display:'flex', alignItems:'center', gap:5,
              }}>
                {meta && <span style={{fontSize:13}}>{meta.icon}</span>}
                <span>{cat}</span>
                <span style={{fontSize:10, opacity:0.7, fontFamily:'var(--font-mono)'}}>{count}</span>
              </button>
            )
          })}
        </div>

        <div style={{...ps.grid, gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(100px, 1fr))' : 'repeat(auto-fill, minmax(130px, 1fr))'}}>
          {filtered.map((p, idx) => (
            <ProductCard key={p.id} product={p} idx={idx} onAdd={() => addToCart(p)} isMobile={isMobile}/>
          ))}
          {filtered.length === 0 && (
            <div style={ps.empty}>
              <div style={{fontSize:28, opacity:.3, marginBottom:8}}>📦</div>
              <span style={{color:'var(--text-tertiary)', fontSize:13}}>沒有符合的商品</span>
            </div>
          )}
        </div>
      </div>

      {!isMobile && (
        <div style={ps.cartWrap}>
          <CartPanel cart={cart} cartSubtotal={cartSubtotal} activeMember={activeMember}
            onUpdateQty={updateCartQty} onRemove={removeFromCart} onClear={clearCart}
            onCheckout={handleCheckout} onFindMember={findMember} onSelectMember={setActiveMember}
            onUpdatePrice={handleUpdatePrice} onHold={handleHold}
            pointsRule={pointsRule}
            manualDiscount={manualDiscount} setManualDiscount={setManualDiscount}/>
        </div>
      )}

      {isMobile && cartCount > 0 && !showCart && (
        <button onClick={() => setShowCart(true)} style={ps.fab}>
          <ShoppingCart size={20} color="#fff"/>
          <span style={ps.fabBadge}>{cartCount}</span>
        </button>
      )}

      {isMobile && showCart && (
        <>
          <div style={ps.mobileOverlay} onClick={() => setShowCart(false)}/>
          <div style={ps.mobileCart}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',borderBottom:'1px solid var(--border-dim)'}}>
              <span style={{fontWeight:600,fontSize:15}}>購物車</span>
              <button onClick={() => setShowCart(false)} style={{padding:4}}>
                <X size={18} color="var(--text-secondary)"/>
              </button>
            </div>
            <div style={{flex:1,overflow:'auto'}}>
              <CartPanel cart={cart} cartSubtotal={cartSubtotal} activeMember={activeMember}
                onUpdateQty={updateCartQty} onRemove={removeFromCart} onClear={clearCart}
                onCheckout={(m,p,pts,opts) => { const r = handleCheckout(m,p,pts,opts); if(r) setShowCart(false); return r }}
                onFindMember={findMember} onSelectMember={setActiveMember}
                onUpdatePrice={handleUpdatePrice} onHold={handleHold}
                pointsRule={pointsRule}
                manualDiscount={manualDiscount} setManualDiscount={setManualDiscount}/>
            </div>
          </div>
        </>
      )}

      {showHeld && (
        <HeldOrdersModal heldOrders={heldOrders} members={members}
          onRecall={recallHeld} onRemove={removeHeld}
          onClose={()=>setShowHeld(false)}/>
      )}
      {showLookup && (
        <PriceLookupModal products={products} onClose={()=>setShowLookup(false)}/>
      )}
      {showCamera && (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            title="掃條碼加入購物車"
            mode="continuous"
            onScan={(code) => {
              const p = findByBarcode(code)
              if (p) { addToCart(p); showFeedback(true, `已加入：${p.name}`) }
              else showFeedback(false, `條碼 ${code} 查無商品`)
              return 'keep'
            }}
            onClose={() => setShowCamera(false)}
          />
        </Suspense>
      )}
    </div>
  )
}

function ProductCard({ product, onAdd, idx, isMobile }) {
  const { name, category, price, stock, noBarcode, imageUrl, expiryDate } = product
  const low  = stock > 0 && stock <= 5
  const zero = stock === 0
  const expSoon = expiryDate ? Math.floor((new Date(expiryDate) - new Date()) / 86400000) : null
  const expWarn = expSoon != null && expSoon <= 7

  return (
    <button className="animate-up pos-card cv-card" onClick={onAdd} disabled={zero}
      style={{
        ...ps.card,
        animationDelay: `${Math.min(idx * 20, 300)}ms`,
        opacity: zero ? 0.45 : 1,
        cursor: zero ? 'not-allowed' : 'pointer',
        padding: isMobile ? '10px' : '14px',
        minHeight: isMobile ? 100 : 130,
      }}>
      {imageUrl ? (
        <div style={{width:'100%', height:64, marginBottom:8, borderRadius:'var(--r2)', overflow:'hidden', background:'var(--bg-overlay)', position:'relative'}}>
          <img src={imageUrl} alt="" style={{width:'100%', height:'100%', objectFit:'cover'}} onError={e => e.target.style.display='none'}/>
          {expWarn && (
            <span style={{position:'absolute', top:4, right:4, padding:'2px 7px', borderRadius:'var(--r-pill)', fontSize:9, fontWeight:700, background:expSoon <= 0 ? 'var(--red)' : 'var(--amber)', color:'#fff', boxShadow:'var(--shadow-xs)'}}>
              {expSoon <= 0 ? '已過期' : `${expSoon}天`}
            </span>
          )}
        </div>
      ) : (
        expWarn && (
          <span style={{position:'absolute', top:8, right:8, padding:'2px 7px', borderRadius:'var(--r-pill)', fontSize:9, fontWeight:700, background:expSoon <= 0 ? 'var(--red)' : 'var(--amber)', color:'#fff'}}>
            {expSoon <= 0 ? '已過期' : `${expSoon}天`}
          </span>
        )
      )}
      <div style={ps.cardCat}>
        {noBarcode && <Tag size={9} style={{marginRight:3, opacity:.5}}/>}
        <span>{category}</span>
      </div>
      <div style={{...ps.cardName, fontSize: isMobile ? 13.5 : 14.5}}>{name}</div>
      <div style={ps.cardFooter}>
        <span style={ps.cardPrice} className="mono tabular">${price}</span>
        <span style={{
          fontSize:10.5, fontWeight:700, fontFamily:'var(--font-mono)',
          padding:'2px 8px', borderRadius:'var(--r-pill)',
          background: zero ? 'var(--red-dim)' : low ? 'var(--amber-dim)' : 'var(--bg-overlay)',
          color: zero ? 'var(--red)' : low ? 'var(--amber)' : 'var(--text-secondary)',
        }}>
          {zero ? '缺貨' : low ? `${stock}` : `${stock}`}
        </span>
      </div>
    </button>
  )
}

const ps = {
  root:{ display:'flex', height:'100%', background:'var(--bg-base)', outline:'none', position:'relative' },
  left:{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 },
  topBar:{
    display:'flex', gap:10, padding:'14px 20px',
    borderBottom:'1px solid var(--border-dim)',
    flexShrink:0, background:'var(--bg-raised)',
    alignItems:'center',
  },
  searchWrap:{
    flex:1, display:'flex', alignItems:'center', gap:10,
    background:'var(--bg-base)',
    border:'1.5px solid var(--border-subtle)',
    borderRadius:'var(--r2)', padding:'10px 14px',
    transition:'border-color var(--t2), box-shadow var(--t2)',
  },
  searchInput:{ flex:1, background:'none', fontSize:14, color:'var(--text-primary)', fontWeight:500 },
  kbd:{
    fontFamily:'var(--font-mono)', fontSize:10, fontWeight:600,
    padding:'2px 6px', borderRadius:'var(--r1)',
    background:'var(--bg-overlay)', color:'var(--text-secondary)',
    border:'1px solid var(--border-dim)', marginLeft:6,
  },
  feedback:{
    margin:'10px 20px 0', padding:'10px 16px',
    borderRadius:'var(--r2)',
    fontSize:13, fontWeight:600, textAlign:'center', flexShrink:0,
  },
  catWrap:{
    display:'flex', gap:6, overflowX:'auto', flexShrink:0,
    borderBottom:'1px solid var(--border-dim)',
    padding:'12px 20px',
    background:'var(--bg-raised)',
  },
  catTab:{
    padding:'8px 16px', fontSize:12.5, fontWeight:600,
    whiteSpace:'nowrap', flexShrink:0,
    borderRadius:'var(--r-pill)',
    transition:'all 200ms var(--ease-snap)',
    letterSpacing:'.02em',
  },
  grid:{
    flex:1, overflowY:'auto',
    padding:'18px 20px',
    display:'grid', gap:12, alignContent:'start',
  },
  card:{
    background:'var(--bg-raised)',
    border:'1px solid var(--border-dim)',
    borderRadius:'var(--r3)',
    display:'flex', flexDirection:'column', gap:4,
    textAlign:'left', position:'relative',
    overflow:'hidden',
    transition:'transform 240ms var(--ease-spring), box-shadow var(--t3) var(--ease), border-color var(--t2)',
    boxShadow:'var(--shadow-xs)',
  },
  cardCat:{
    fontSize:10.5, color:'var(--text-tertiary)',
    display:'flex', alignItems:'center',
    letterSpacing:'.04em', fontWeight:600, textTransform:'uppercase',
  },
  cardName:{
    fontWeight:600, color:'var(--text-primary)',
    lineHeight:1.35, flex:1, marginTop:3,
    overflow:'hidden', textOverflow:'ellipsis',
    display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical',
  },
  cardFooter:{
    display:'flex', justifyContent:'space-between', alignItems:'center',
    marginTop:8, gap:8,
  },
  cardPrice:{
    fontSize:17, fontWeight:800,
    background:'var(--accent-grad)',
    WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
    letterSpacing:'-.01em',
  },
  empty:{
    gridColumn:'1/-1', display:'flex', flexDirection:'column',
    alignItems:'center', justifyContent:'center', padding:'80px 0',
  },
  cartWrap:{ width:340, flexShrink:0 },
  fab:{
    position:'fixed', bottom:'calc(20px + env(safe-area-inset-bottom))', right:20, zIndex:100,
    width:60, height:60, borderRadius:'50%',
    background:'var(--accent-grad)',
    boxShadow:'0 8px 24px rgba(184,137,90,0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
    display:'flex', alignItems:'center', justifyContent:'center',
    transition:'transform var(--t2) var(--ease-spring)',
  },
  fabBadge:{
    position:'absolute', top:-4, right:-4,
    background:'var(--red)', color:'#fff', fontSize:11, fontWeight:800,
    minWidth:22, height:22, padding:'0 6px', borderRadius:'var(--r-pill)',
    display:'flex', alignItems:'center', justifyContent:'center',
    border:'2px solid var(--bg-base)',
    boxShadow:'var(--shadow-sm)',
  },
  mobileOverlay:{
    position:'fixed', inset:0, zIndex:200,
    background:'rgba(31,29,26,0.4)', backdropFilter:'blur(8px)',
  },
  mobileCart:{
    position:'fixed', bottom:0, left:0, right:0, zIndex:201,
    maxHeight:'82vh', background:'var(--bg-raised)',
    borderRadius:'var(--r5) var(--r5) 0 0',
    boxShadow:'var(--shadow-xl)',
    display:'flex', flexDirection:'column',
    paddingBottom:'env(safe-area-inset-bottom)', // iPhone home indicator 不遮到結帳鈕
  },
}
