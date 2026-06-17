import { useState, useEffect, useCallback, useMemo } from 'react'
import { orderToJournalEntries, topupToJournalEntries } from '../utils/accounting'
import {
  isElectron, checkAndMigrate,
  loadProducts, saveProducts, dbAddProduct, dbUpdateProduct, dbDeleteProduct,
  loadMembers, saveMembers, dbAddMember, dbUpdateMember, dbDeleteMember,
  loadOrders, saveOrders, dbCheckout, dbRefund,
  loadManualJournal, saveManualJournal, dbAddManualEntry, dbDeleteManualEntry,
  loadHeldOrders, addHeldOrder, deleteHeldOrder,
  getOpenShift, openShift as apiOpenShift, closeShift as apiCloseShift, addCashLog,
  loadWasteLog, addWaste, deleteWaste,
  addTopup, loadTopups,
  getSetting, setSetting,
} from '../utils/dataAccess'
import { fireWebhook, payloadFromOrder, payloadFromLowStock, payloadFromShift, payloadFromExpiring, getWebhookConfig } from '../utils/webhook'
import { getReorderList, getExpiringProducts } from '../utils/analytics'

const SEED_PRODUCTS = [
  { id:'p001', name:'花生糖',    category:'自包裝糖果', price:30,  cost:15,  stock:50, barcode:'',             unit:'包',  noBarcode:true  },
  { id:'p002', name:'芝麻糖',    category:'自包裝糖果', price:25,  cost:12,  stock:40, barcode:'',             unit:'包',  noBarcode:true  },
  { id:'p003', name:'牛軋糖',    category:'自包裝糖果', price:45,  cost:20,  stock:30, barcode:'',             unit:'包',  noBarcode:true  },
  { id:'p004', name:'紫菜',      category:'乾貨',       price:35,  cost:18,  stock:80, barcode:'4710265870234', unit:'包',  noBarcode:false },
  { id:'p005', name:'冬粉',      category:'乾貨',       price:20,  cost:9,   stock:60, barcode:'4714821300018', unit:'包',  noBarcode:false },
  { id:'p006', name:'醬油',      category:'醬料',       price:55,  cost:28,  stock:3,  barcode:'4719015100013', unit:'瓶',  noBarcode:false },
  { id:'p007', name:'花生油',    category:'醬料',       price:120, cost:65,  stock:15, barcode:'4710077070027', unit:'瓶',  noBarcode:false },
  { id:'p008', name:'米粉',      category:'乾貨',       price:30,  cost:14,  stock:45, barcode:'4714821200011', unit:'包',  noBarcode:false },
  { id:'p009', name:'糯米',      category:'米糧',       price:80,  cost:45,  stock:20, barcode:'',             unit:'kg',  noBarcode:true  },
  { id:'p010', name:'黑糯米',    category:'米糧',       price:90,  cost:50,  stock:4,  barcode:'',             unit:'kg',  noBarcode:true  },
  { id:'p011', name:'綠豆',      category:'豆類',       price:40,  cost:22,  stock:35, barcode:'',             unit:'包',  noBarcode:true  },
  { id:'p012', name:'紅豆',      category:'豆類',       price:45,  cost:24,  stock:30, barcode:'',             unit:'包',  noBarcode:true  },
  { id:'p013', name:'十穀米',    category:'米糧',       price:70,  cost:35,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p014', name:'小米',      category:'米糧',       price:50,  cost:25,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p015', name:'黑糯米',    category:'米糧',       price:60,  cost:30,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p016', name:'鷹嘴豆',    category:'豆類',       price:65,  cost:33,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p017', name:'綠豆',      category:'豆類',       price:60,  cost:30,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p018', name:'紅豆',      category:'豆類',       price:100, cost:50,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p019', name:'麥片',      category:'米糧',       price:40,  cost:20,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p020', name:'燕麥',      category:'米糧',       price:40,  cost:20,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p021', name:'蕎麥',      category:'米糧',       price:55,  cost:28,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p022', name:'小麥',      category:'米糧',       price:40,  cost:20,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p023', name:'蓮子',      category:'乾貨',       price:400, cost:200, stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p024', name:'芡實',      category:'乾貨',       price:220, cost:110, stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p025', name:'綠豆仁',    category:'豆類',       price:60,  cost:30,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p026', name:'黃豆',      category:'豆類',       price:45,  cost:23,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p027', name:'黑豆',      category:'豆類',       price:60,  cost:30,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p028', name:'花豆',      category:'豆類',       price:65,  cost:33,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p029', name:'花生',      category:'乾貨',       price:150, cost:75,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p030', name:'生花生',    category:'乾貨',       price:150, cost:75,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p031', name:'西谷米',    category:'米糧',       price:45,  cost:23,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p032', name:'紫駱駝麵粉',category:'粉類',       price:25,  cost:13,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p033', name:'風車太白粉',category:'粉類',       price:45,  cost:23,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
  { id:'p034', name:'地瓜粉',    category:'粉類',       price:40,  cost:20,  stock:30, barcode:'',             unit:'斤',  noBarcode:true  },
]
const SEED_MEMBERS = [
  { id:'m001', name:'陳小明', phone:'0912-345-678', points:380, tier:'silver', totalSpent:12400, joinDate:'2024-06-01' },
  { id:'m002', name:'林美華', phone:'0923-456-789', points:920, tier:'gold',   totalSpent:38600, joinDate:'2024-02-15' },
  { id:'m003', name:'王大同', phone:'0934-567-890', points:120, tier:'normal', totalSpent:4200,  joinDate:'2025-01-10' },
]
const SEED_ORDERS = [
  { id:'O1700000001', items:[{id:'p001',name:'花生糖',price:30,qty:2},{id:'p006',name:'醬油',price:55,qty:1}], subtotal:115, discount:0, total:115, payMethod:'cash', paid:200, change:85, memberId:'m001', pointsUsed:0, pointsEarned:11, time: new Date(Date.now()-3600000).toISOString() },
  { id:'O1700000002', items:[{id:'p004',name:'紫菜',price:35,qty:3}], subtotal:105, discount:20, total:85, payMethod:'card', paid:85, change:0, memberId:'m002', pointsUsed:20, pointsEarned:8, time: new Date(Date.now()-7200000).toISOString() },
  { id:'O1700000003', items:[{id:'p009',name:'糯米',price:80,qty:1},{id:'p012',name:'紅豆',price:45,qty:2}], subtotal:170, discount:0, total:170, payMethod:'cash', paid:200, change:30, memberId:null, pointsUsed:0, pointsEarned:0, time: new Date(Date.now()-86400000).toISOString() },
]
const thisMonth = new Date().toISOString().slice(0,7)
const SEED_MANUAL = [
  { id:'JM001', orderId:null, date:thisMonth+'-01', description:'三月份租金',    type:'manual', lines:[{account:'5202',debit:12000,credit:0,note:'店面租金'},{account:'1101',debit:0,credit:12000,note:'現金'}] },
  { id:'JM002', orderId:null, date:thisMonth+'-05', description:'三月份水電費',  type:'manual', lines:[{account:'5203',debit:2400,credit:0,note:'台電+台水'},{account:'1101',debit:0,credit:2400,note:'現金'}] },
  { id:'JM003', orderId:null, date:thisMonth+'-10', description:'進貨 乾貨批發', type:'manual', lines:[{account:'1211',debit:8500,credit:0,note:'入庫'},{account:'1101',debit:0,credit:8500,note:'現金'}] },
]

function loadLS(k,fb){try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb}catch{return fb}}
function saveLS(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
// DB 寫入錯誤至少 log 出來，避免 silent fail（audit #3）
const logDbErr = (op) => (e) => console.error(`[POS DB] ${op} failed:`, e)

export function useStore(){
  const [products,      setProducts]      = useState([])
  const [members,       setMembers]       = useState([])
  const [orders,        setOrders]        = useState([])
  const [manualEntries, setManualEntries] = useState([])
  const [cart,          setCart]          = useState([])
  const [view,          setView]          = useState('dashboard')
  const [activeMember,  setActiveMember]  = useState(null)
  const [ready,         setReady]         = useState(false)
  const [heldOrders,    setHeldOrders]    = useState([])
  const [wasteLog,      setWasteLog]      = useState([])
  const [topups,        setTopups]        = useState([])   // 會員儲值紀錄（給會計自動分錄用）
  const [openShift,     setOpenShiftState] = useState(null)
  const [manualDiscount,setManualDiscount] = useState(0)
  const [pointsRule,    setPointsRule]    = useState({ earn: 10, redeem: 1 }) // 消費 X 元 1 點；1 點折抵 X 元
  const [birthdayBonus, setBirthdayBonus] = useState(100)

  // 初始化：從 SQLite 或 localStorage 載入資料
  useEffect(() => {
    async function init() {
      if (isElectron) {
        try { await checkAndMigrate() } catch (e) { console.error('[POS] migrate fail:', e) }
      }
      // 用 Promise.allSettled 避免單一失敗阻塞整個初始化
      const results = await Promise.allSettled([
        loadProducts(SEED_PRODUCTS),
        loadMembers(SEED_MEMBERS),
        loadOrders(SEED_ORDERS),
        loadManualJournal(SEED_MANUAL),
        loadHeldOrders(),
        loadWasteLog(),
        loadTopups(),
        getOpenShift(),
      ])
      const fallbacks = [SEED_PRODUCTS, SEED_MEMBERS, SEED_ORDERS, SEED_MANUAL, [], [], [], null]
      const [p, m, o, j, held, waste, tps, shift] = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value
        console.error('[POS] init load failed:', i, r.reason)
        return fallbacks[i]
      })
      setProducts(Array.isArray(p) ? p : [])
      setMembers(Array.isArray(m) ? m : [])
      setOrders(Array.isArray(o) ? o : [])
      setManualEntries(Array.isArray(j) ? j : [])
      setHeldOrders(Array.isArray(held) ? held : [])
      setWasteLog(Array.isArray(waste) ? waste : [])
      setTopups(Array.isArray(tps) ? tps : [])
      setOpenShiftState(shift || null)
      // 載入點數規則 / 生日贈點
      try {
        const [earn, redeem, bday] = await Promise.all([
          getSetting('pointsEarnRate'),
          getSetting('pointsRedeemRate'),
          getSetting('birthdayBonus'),
        ])
        setPointsRule({
          earn: parseInt(earn) || 10,
          redeem: parseFloat(redeem) || 1,
        })
        setBirthdayBonus(parseInt(bday) || 100)
      } catch {}
      setReady(true)
    }
    init()
  }, [])

  // 監聽商品變化觸發 webhook 通知
  // 效能：多數使用者沒設 webhook → 直接短路，不掃全商品；有設才計算（fireWebhook 內 throttle 6/24h）
  useEffect(() => {
    if (!ready) return
    const cfg = getWebhookConfig()
    if (!cfg?.url) return
    const wantLow = cfg.events?.includes('low_stock')
    const wantExp = cfg.events?.includes('expiring')
    if (!wantLow && !wantExp) return
    if (wantLow) {
      const lowList = getReorderList(products)
      if (lowList.length > 0) fireWebhook('low_stock', payloadFromLowStock(lowList)).catch(()=>{})
    }
    if (wantExp) {
      const { expired, soon } = getExpiringProducts(products, 7)
      if (expired.length > 0 || soon.length > 0) fireWebhook('expiring', payloadFromExpiring(expired, soon)).catch(()=>{})
    }
  }, [products, ready])

  // 瀏覽器模式: 持久化到 localStorage
  useEffect(() => { if (!isElectron && ready) saveLS('pos2_products', products) }, [products, ready])
  useEffect(() => { if (!isElectron && ready) saveLS('pos2_members', members) }, [members, ready])
  useEffect(() => { if (!isElectron && ready) saveLS('pos2_orders', orders) }, [orders, ready])
  useEffect(() => { if (!isElectron && ready) saveLS('pos2_manual_j', manualEntries) }, [manualEntries, ready])

  const autoJournal = useMemo(()=>[
    ...orders.flatMap(o=>orderToJournalEntries(o,products)),
    ...topups.flatMap(topupToJournalEntries),   // 會員儲值（加值 + 折抵）一併入帳，損益表才完整
  ],[orders,products,topups])
  const allJournal  = useMemo(()=>[...autoJournal,...manualEntries].sort((a,b)=>b.date.localeCompare(a.date)),[autoJournal,manualEntries])

  const addManualEntry = useCallback(e=>{
    const n={...e,id:'JM'+Date.now(),type:'manual'}
    setManualEntries(p=>[n,...p])
    if (isElectron) dbAddManualEntry(n).catch(logDbErr('addManualEntry'))
    return n
  },[])
  const deleteManualEntry = useCallback(id=>{
    setManualEntries(p=>p.filter(e=>e.id!==id))
    if (isElectron) dbDeleteManualEntry(id).catch(logDbErr('deleteManualEntry'))
  },[])

  const addToCart = useCallback((product,qty=1)=>{
    setCart(prev=>{
      const idx=prev.findIndex(i=>i.id===product.id)
      if(idx>=0){const next=[...prev];next[idx]={...next[idx],qty:next[idx].qty+qty};return next}
      return [...prev,{...product,qty}]
    })
  },[])
  const removeFromCart = useCallback(id=>setCart(p=>p.filter(i=>i.id!==id)),[])
  const updateCartQty  = useCallback((id,qty)=>{if(qty<=0){setCart(p=>p.filter(i=>i.id!==id));return}setCart(p=>p.map(i=>i.id===id?{...i,qty}:i))},[])
  const updateCartItemPrice = useCallback((id, price) => {
    if (price < 0 || isNaN(price)) return
    setCart(p => p.map(i => i.id === id ? { ...i, price } : i))
  }, [])
  const clearCart      = useCallback(()=>{setCart([]);setActiveMember(null)},[])

  const cartSubtotal = cart.reduce((s,i)=>s+i.price*i.qty,0)
  const cartCount    = cart.reduce((s,i)=>s+i.qty,0)

  // payments: [{method:'cash',amount:50},{method:'card',amount:50}]，若沒帶就用 payMethod+paid
  const checkout = useCallback((payMethod, paid, pointsUsed=0, opts={}) => {
    if(!cart.length) return null
    const { taxId='', payments=null, manualDiscountAmt=0, balanceUsed=0, cashier='' } = opts
    // 夾限：不可超用會員點數/儲值（UI 已擋，這裡再防呆——避免 stale snapshot、跨裝置或直接呼叫造成負值/超折抵）
    const usePoints  = activeMember ? Math.min(Math.max(0, pointsUsed),  activeMember.points  || 0) : 0
    const useBalance = activeMember ? Math.min(Math.max(0, balanceUsed), activeMember.balance || 0) : 0
    const subtotal = cartSubtotal
    const pointsDiscount = usePoints * (pointsRule.redeem || 1)
    const totalDiscount = pointsDiscount + manualDiscountAmt + useBalance
    const total = Math.max(0, subtotal - totalDiscount)
    let pointsEarned = Math.floor(total / (pointsRule.earn || 10))

    // 生日贈點：本月生日 & 本月尚未發放
    let birthdayBonusGiven = 0
    if (activeMember && activeMember.birthday) {
      const thisMonth = new Date().toISOString().slice(0,7)
      const birthMonth = activeMember.birthday.slice(5,7)
      const curMonth = String(new Date().getMonth()+1).padStart(2,'0')
      const lastBonusMonth = (activeMember.lastBirthdayBonus || '').slice(0,7)
      if (birthMonth === curMonth && lastBonusMonth !== thisMonth) {
        birthdayBonusGiven = birthdayBonus || 100
        pointsEarned += birthdayBonusGiven
      }
    }

    // 計算實際付款方式
    let actualPayments = payments
    if (!actualPayments || !actualPayments.length) {
      actualPayments = [{ method: payMethod || 'cash', amount: total }]
    }
    const totalPaid = actualPayments.reduce((s,p) => s + (p.amount||0), 0)
    const change = (payMethod === 'cash' || actualPayments.some(p=>p.method==='cash'))
      ? Math.max(0, paid - total) : 0

    const order = {
      id: 'O' + Date.now(),
      items: [...cart],
      subtotal, discount: pointsDiscount, manualDiscount: manualDiscountAmt,
      balanceUsed: useBalance,
      total,
      payMethod: actualPayments.length > 1 ? 'mixed' : (actualPayments[0]?.method || payMethod),
      paid: totalPaid, change,
      payments: actualPayments,
      memberId: activeMember?.id || null,
      pointsUsed: usePoints, pointsEarned,
      time: new Date().toISOString(),
      taxId, cashier,
      shiftId: openShift?.id || '',
      status: 'completed',
    }

    // 更新本地狀態
    setProducts(prev => prev.map(p => {
      const item = cart.find(i => i.id === p.id)
      return item ? { ...p, stock: Math.max(0, p.stock - item.qty) } : p
    }))
    if (activeMember) {
      setMembers(prev => prev.map(m => {
        if (m.id !== activeMember.id) return m
        const newPoints = Math.max(0, m.points - usePoints + pointsEarned)
        const newSpent = (m.totalSpent || 0) + total
        const newBalance = Math.max(0, (m.balance || 0) - useBalance)
        const tier = newSpent >= 30000 ? 'gold' : newSpent >= 10000 ? 'silver' : 'normal'
        const updated = { ...m, points: newPoints, totalSpent: newSpent, tier, balance: newBalance }
        if (birthdayBonusGiven > 0) updated.lastBirthdayBonus = new Date().toISOString().slice(0,10)
        return updated
      }))
    }
    setOrders(prev => [order, ...prev])
    setCart([])
    setActiveMember(null)
    setManualDiscount(0)

    if (isElectron) {
      const stockUpdates = cart.map(i => ({ id: i.id, delta: -i.qty }))
      const memberUpdate = activeMember ? {
        id: activeMember.id,
        pointsDelta: -usePoints + pointsEarned,
        spentDelta: total,
        balanceDelta: -useBalance,
        tier: (activeMember.totalSpent + total) >= 30000 ? 'gold'
            : (activeMember.totalSpent + total) >= 10000 ? 'silver' : 'normal',
        // 生日贈點：把發放月份一起寫回 DB（見 checkoutTx），否則重開後本月會重複贈點
        ...(birthdayBonusGiven > 0 ? { lastBirthdayBonus: new Date().toISOString().slice(0,10) } : {}),
      } : null
      dbCheckout(order, stockUpdates, memberUpdate).catch(logDbErr('checkout'))
    }
    // webhook：每筆結帳 + 大額訂單
    const payload = payloadFromOrder(order, activeMember)
    fireWebhook('checkout', payload).catch(()=>{})
    fireWebhook('big_sale', payload).catch(()=>{}) // 內部會檢查門檻
    return order
  }, [cart, cartSubtotal, activeMember, pointsRule, openShift, birthdayBonus])

  // 退貨：建立負數訂單，補回庫存與會員資料
  const refund = useCallback(async (origOrder, refundItems, opts={}) => {
    if (!origOrder || !refundItems?.length) return null
    const { reason = '', cashier = '' } = opts
    // 累計退貨守衛：算出這張原單每個品項「之前已退數量」，把本次退貨夾在剩餘可退範圍內，
    // 防止同一張單被反覆部分退貨而超退現金 / 庫存 / 點數（部分退貨後原單仍是 completed、退貨鈕還在）。
    const refundedById = {}
    for (const ro of orders) {
      if (ro.refundOf !== origOrder.id) continue
      for (const it of (ro.items || [])) refundedById[it.id] = (refundedById[it.id] || 0) + Math.abs(it.qty || 0)
    }
    const origQtyById = {}
    for (const it of (origOrder.items || [])) origQtyById[it.id] = Math.abs(it.qty || 0)
    const clampedItems = refundItems.map(i => {
      const remaining = Math.max(0, (origQtyById[i.id] || 0) - (refundedById[i.id] || 0))
      return { ...i, qty: Math.min(Math.abs(i.qty || 0), remaining) }
    }).filter(i => i.qty > 0)
    if (!clampedItems.length) return null   // 已全部退完，無可退數量

    const refundSubtotal = clampedItems.reduce((s,i) => s + i.price * i.qty, 0)
    // 守衛分母用 subtotal（折扣按小計比例分攤），避免全額折抵(total=0) 時誤判或除以零
    const ratio = origOrder.subtotal > 0 ? refundSubtotal / origOrder.subtotal : 0
    const refundDiscount = Math.round((origOrder.discount || 0) * ratio)
    const refundManual = Math.round((origOrder.manualDiscount || 0) * ratio)
    const refundTotal = refundSubtotal - refundDiscount - refundManual
    // 原單若用儲值付款，按比例退回儲值，其餘才退現金/原付款；避免「用儲值買、退貨卻全拿現金而儲值沒還」
    const restoredBalance = Math.round((origOrder.balanceUsed || 0) * ratio)
    const cashRefund = refundTotal - restoredBalance   // 真正退回現金/電子的金額（restoredBalance 退回儲值卡）
    const refundPointsEarned = -(Math.floor(refundTotal / (pointsRule.earn || 10)))
    const refundPointsUsed = -Math.round((origOrder.pointsUsed || 0) * ratio)

    // 退款付款方式：原訂單若是 mixed 就按比例退；否則一致
    const refundPayMethod = origOrder.payMethod === 'mixed' ? 'mixed' : (origOrder.payMethod || 'cash')
    let refundPayments
    if (origOrder.payMethod === 'mixed' && Array.isArray(origOrder.payments)) {
      refundPayments = origOrder.payments.map(p => ({
        method: p.method,
        amount: -Math.round((p.amount || 0) * ratio * 100) / 100,
      }))
    } else {
      refundPayments = [{ method: refundPayMethod, amount: -cashRefund }]
    }

    const refundOrder = {
      id: 'R' + Date.now(),
      items: clampedItems.map(i => ({ ...i, qty: -Math.abs(i.qty) })),
      subtotal: -refundSubtotal,
      discount: -refundDiscount,
      manualDiscount: -refundManual,
      total: -cashRefund,
      balanceUsed: -restoredBalance,   // 負數 → auto_balance 反向沖回預收款、回補儲值消費營收
      payMethod: refundPayMethod,
      paid: -cashRefund,
      change: 0,
      payments: refundPayments,
      memberId: origOrder.memberId || null,
      pointsUsed: refundPointsUsed,
      pointsEarned: refundPointsEarned,
      time: new Date().toISOString(),
      status: 'completed',
      refundOf: origOrder.id,
      note: reason,
      cashier,
      shiftId: openShift?.id || '',
    }

    // 判斷是否為完整退貨（含本次在內，每個品項累計退貨量都 >= 原始量）
    const isFullRefund = (origOrder.items || []).every(orig => {
      const already = refundedById[orig.id] || 0
      const r = clampedItems.find(i => i.id === orig.id)
      return (already + (r ? r.qty : 0)) >= Math.abs(orig.qty || 0)
    })
    refundOrder.fullRefund = isFullRefund

    setOrders(prev => {
      const next = isFullRefund
        ? prev.map(o => o.id === origOrder.id ? { ...o, status: 'refunded' } : o)
        : [...prev]
      return [refundOrder, ...next]
    })
    setProducts(prev => prev.map(p => {
      const item = clampedItems.find(i => i.id === p.id)
      return item ? { ...p, stock: p.stock + Math.abs(item.qty) } : p
    }))
    if (origOrder.memberId) {
      setMembers(prev => prev.map(m => {
        if (m.id !== origOrder.memberId) return m
        const newPoints = Math.max(0, (m.points || 0) + refundPointsEarned - refundPointsUsed)
        const newSpent = Math.max(0, (m.totalSpent || 0) - refundTotal)
        const tier = newSpent >= 30000 ? 'gold' : newSpent >= 10000 ? 'silver' : 'normal'
        return { ...m, points: newPoints, totalSpent: newSpent, tier, balance: Math.max(0, (m.balance || 0) + restoredBalance) }
      }))
    }

    if (isElectron) {
      const stockUpdates = clampedItems.map(i => ({ id: i.id, delta: Math.abs(i.qty) }))
      const memberUpdate = origOrder.memberId ? {
        id: origOrder.memberId,
        pointsDelta: refundPointsEarned - refundPointsUsed,
        spentDelta: -refundTotal,
        balanceDelta: restoredBalance,   // 退回儲值（refundTx 已支援 balanceDelta）
      } : null
      // 只有完整退貨才把原訂單標記為 refunded
      await dbRefund(isFullRefund ? origOrder.id : null, refundOrder, stockUpdates, memberUpdate)
    }
    // webhook
    fireWebhook('refund', payloadFromOrder(refundOrder, null)).catch(()=>{})
    return refundOrder
  }, [orders, pointsRule, openShift])

  // 掛單
  const holdCart = useCallback(async (label='', cashier='') => {
    if (!cart.length) return null
    const held = {
      id: 'H' + Date.now(),
      label: label || `掛單 ${new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`,
      cart: [...cart],
      memberId: activeMember?.id || '',
      manualDiscount,
      createdAt: new Date().toISOString(),
      cashier,
    }
    setHeldOrders(p => [held, ...p])
    setCart([])
    setActiveMember(null)
    setManualDiscount(0)
    if (isElectron) await addHeldOrder(held)
    return held
  }, [cart, activeMember, manualDiscount])

  const recallHeld = useCallback(async (h) => {
    setCart(h.cart || [])
    setManualDiscount(h.manualDiscount || 0)
    if (h.memberId) {
      const m = members.find(x => x.id === h.memberId)
      if (m) setActiveMember(m)
    }
    setHeldOrders(p => p.filter(x => x.id !== h.id))
    if (isElectron) await deleteHeldOrder(h.id)
  }, [members])

  const removeHeld = useCallback(async (id) => {
    setHeldOrders(p => p.filter(x => x.id !== id))
    if (isElectron) await deleteHeldOrder(id)
  }, [])

  // 班別
  const startShift = useCallback(async (cashier, openCash, cashierId='') => {
    const data = {
      id: 'S' + Date.now(),
      cashier, cashierId, openCash,
      openTime: new Date().toISOString(),
    }
    if (isElectron) await apiOpenShift(data)
    setOpenShiftState({ ...data, status: 'open' })
    fireWebhook('shift_open', payloadFromShift(data, 'open')).catch(()=>{})
    return data
  }, [])

  const endShift = useCallback(async (closeCash, note='') => {
    if (!openShift) return null
    const r = isElectron
      ? await apiCloseShift(openShift.id, { closeCash, note })
      : { success: true }
    fireWebhook('shift_close', payloadFromShift(openShift, 'close', { ...r, closeCash })).catch(()=>{})
    setOpenShiftState(null)
    return r
  }, [openShift])

  const logCash = useCallback(async (type, amount, reason, cashier='') => {
    const data = {
      id: 'CL' + Date.now() + Math.random().toString(36).slice(2,5),
      shiftId: openShift?.id || '',
      time: new Date().toISOString(),
      type, amount, reason, cashier,
    }
    if (isElectron) await addCashLog(data)
  }, [openShift])

  // 損耗
  const recordWaste = useCallback(async (data) => {
    const w = {
      id: 'W' + Date.now(),
      time: new Date().toISOString(),
      ...data,
    }
    setWasteLog(p => [w, ...p])
    setProducts(prev => prev.map(p => p.id === data.productId
      ? { ...p, stock: Math.max(0, p.stock - Math.abs(data.qty)) } : p))
    if (isElectron) await addWaste(w)
    return w
  }, [])

  const removeWaste = useCallback(async (id) => {
    setWasteLog(p => p.filter(w => w.id !== id))
    if (isElectron) await deleteWaste(id)
  }, [])

  // 會員儲值
  const topupMember = useCallback(async (memberId, amount, bonus=0, payMethod='cash', cashier='') => {
    const data = {
      id: 'TP' + Date.now(),
      memberId, amount, bonus, payMethod,
      time: new Date().toISOString(),
      cashier,
    }
    setMembers(prev => prev.map(m => m.id === memberId
      ? { ...m, balance: (m.balance || 0) + amount + bonus } : m))
    setTopups(prev => [data, ...prev])                                    // 進 state → 自動產生會計分錄
    await addTopup(data).catch(e => console.error('[POS] topup persist fail:', e)) // 一律持久化（舊版 web 模式根本沒存到儲值紀錄）
    return data
  }, [])

  // 點數規則設定
  const updatePointsRule = useCallback(async (earn, redeem) => {
    setPointsRule({ earn, redeem })
    if (isElectron) {
      await setSetting('pointsEarnRate', String(earn))
      await setSetting('pointsRedeemRate', String(redeem))
    }
  }, [])

  const updateBirthdayBonus = useCallback(async (val) => {
    const n = parseInt(val) || 100
    setBirthdayBonus(n)
    await setSetting('birthdayBonus', String(n))
  }, [])

  const addProduct = useCallback(p=>{
    const n={...p,id:'p'+Date.now()}
    setProducts(x=>[...x,n])
    if (isElectron) dbAddProduct(n).catch(logDbErr('addProduct'))
    return n
  },[])
  const updateProduct = useCallback((id,u)=>{
    setProducts(p=>p.map(x=>x.id===id?{...x,...u}:x))
    if (isElectron) dbUpdateProduct(id, u).catch(logDbErr('updateProduct'))
  },[])
  const deleteProduct = useCallback(id=>{
    setProducts(p=>p.filter(x=>x.id!==id))
    if (isElectron) dbDeleteProduct(id).catch(logDbErr('deleteProduct'))
  },[])
  const findByBarcode = useCallback(code=>products.find(p=>p.barcode===code),[products])

  const addMember = useCallback(m=>{
    const n={...m,id:'m'+Date.now(),points:0,totalSpent:0,tier:'normal',joinDate:new Date().toISOString().slice(0,10)}
    setMembers(p=>[...p,n])
    if (isElectron) dbAddMember(n).catch(logDbErr('addMember'))
    return n
  },[])
  const updateMember = useCallback((id,u)=>{
    setMembers(p=>p.map(m=>m.id===id?{...m,...u}:m))
    if (isElectron) dbUpdateMember(id, u).catch(logDbErr('updateMember'))
  },[])
  const deleteMember = useCallback(id=>{
    setMembers(p=>p.filter(m=>m.id!==id))
    if (isElectron) dbDeleteMember(id).catch(logDbErr('deleteMember'))
  },[])
  // audit #25: m.phone 可能為 null（舊資料），用 (m.phone||'').replace 防呆
  const findMember = useCallback(q=>members.find(m=>(m.phone||'').replace(/-/g,'').includes(q.replace(/-/g,''))||(m.name||'').includes(q)),[members])

  // 從 SQLite 重新載入資料（用於備份還原後）
  const reloadFromDB = useCallback(async () => {
    const [p, m, o, j] = await Promise.all([
      loadProducts([]),
      loadMembers([]),
      loadOrders([]),
      loadManualJournal([]),
    ])
    setProducts(p)
    setMembers(m)
    setOrders(o)
    setManualEntries(j)
  }, [])

  const categories    = [...new Set(products.map(p=>p.category))]
  // 排除完整退貨原訂單（status='refunded'）；部分退貨負數訂單保留，與原單抵銷正確
  const todayOrders   = orders.filter(o=>new Date(o.time).toDateString()===new Date().toDateString() && o.status!=='refunded' && !(o.refundOf && o.fullRefund))
  const todayRevenue  = todayOrders.reduce((s,o)=>s+o.total,0)
  const lowStockCount = products.filter(p=>p.stock<=5).length
  const todayProfit   = todayOrders.reduce((s,o)=>s+o.items.reduce((a,i)=>{const prod=products.find(p=>p.id===i.id);return a+(prod?(i.price-(prod.cost||0))*i.qty:0)},0),0)

  return {
    products,members,orders,cart,view,setView,ready,
    activeMember,setActiveMember,
    addToCart,removeFromCart,updateCartQty,updateCartItemPrice,clearCart,
    cartSubtotal,cartCount,checkout,refund,
    addProduct,updateProduct,deleteProduct,findByBarcode,
    addMember,updateMember,deleteMember,findMember,
    categories,todayOrders,todayRevenue,lowStockCount,todayProfit,
    allJournal,autoJournal,manualEntries,
    addManualEntry,deleteManualEntry,
    reloadFromDB,
    // v2.1
    heldOrders, holdCart, recallHeld, removeHeld,
    wasteLog, recordWaste, removeWaste,
    openShift, startShift, endShift, logCash,
    topupMember,
    pointsRule, updatePointsRule,
    birthdayBonus, updateBirthdayBonus,
    manualDiscount, setManualDiscount,
  }
}
