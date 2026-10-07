import { settledOrders, netSale, orderCost } from '../utils/orderLedger'
import { executeFinancial, FINANCIAL_PENDING } from '../utils/financialCommand'
import { browserStorage, writeRecords, acquireBrowserEditor } from '../utils/browserStorage'
import { prepareCheckout } from '../utils/checkoutSafety.mjs'
import { createCheckoutCoordinator } from '../utils/checkoutCoordinator.mjs'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { orderToJournalEntries, topupToJournalEntries } from '../utils/accounting'
import {
  isElectron, checkAndMigrate,
  loadProducts, saveProducts, dbAddProduct, dbUpdateProduct, dbDeleteProduct,
  loadMembers, saveMembers, dbAddMember, dbUpdateMember, dbDeleteMember,
  loadOrders, saveOrders, dbCheckout, lookupCheckout, dbRefund,
  loadManualJournal, saveManualJournal, dbAddManualEntry, dbDeleteManualEntry,
  loadHeldOrders, addHeldOrder, deleteHeldOrder,
  getOpenShift, openShift as apiOpenShift, closeShift as apiCloseShift, addCashLog,
  loadWasteLog, addWaste, deleteWaste,
  addTopup, loadTopups,
  getSetting, setSetting,
} from '../utils/dataAccess'
import { fireWebhook, payloadFromOrder, payloadFromLowStock, payloadFromShift, payloadFromExpiring, getWebhookConfig } from '../utils/webhook'
import { getReorderList, getExpiringProducts } from '../utils/analytics'

function loadLS(k,fb){try{const v=browserStorage.getItem(k);return v?JSON.parse(v):fb}catch{return fb}}
function saveLS(k,v){browserStorage.setItem(k,JSON.stringify(v))}
// DB 寫入錯誤至少 log 出來，避免 silent fail（audit #3）
const logDbErr = op => e => { console.error(`[POS DB] ${op} failed:`,e);window.dispatchEvent(new CustomEvent('pos-persistence-error',{detail:'資料保存失敗（'+op+'），請停止異動並核對：'+e.message})) }

export function useStore(session){
  const [products,      setProducts]      = useState([])
  const [members,       setMembers]       = useState([])
  const [orders,        setOrders]        = useState([])
  const [manualEntries, setManualEntries] = useState([])
  const [cart,          setCart]          = useState([])
  const [view,          setView]          = useState('dashboard')
  const [activeMember,  setActiveMember]  = useState(null)
  const [ready,         setReady]         = useState(false)
  const [dataError, setDataError] = useState('')
  const [checkoutState, setCheckoutState] = useState({phase:'idle'})
  const [heldOrders,    setHeldOrders]    = useState([])
  const [wasteLog,      setWasteLog]      = useState([])
  const [topups,        setTopups]        = useState([])   // 會員儲值紀錄（給會計自動分錄用）
  const [openShift,     setOpenShiftState] = useState(null)
  const [manualDiscount,setManualDiscount] = useState(0)
  const [pointsRule,    setPointsRule]    = useState({ earn: 10, redeem: 1 }) // 消費 X 元 1 點；1 點折抵 X 元
  const [birthdayBonus, setBirthdayBonus] = useState(100)

  const checkoutRef = useRef(null)
  if (!checkoutRef.current) checkoutRef.current=createCheckoutCoordinator({
    prepare:prepareCheckout,persist:plan=>dbCheckout(plan.order,plan.stockUpdates,plan.memberUpdate),lookup:lookupCheckout,
    readPending:()=>{const raw=browserStorage.getItem('pos_pending_checkout_v1');return raw?JSON.parse(raw):null},
    writePending:value=>browserStorage.setItem('pos_pending_checkout_v1',JSON.stringify(value)),
    clearPending:id=>{const raw=browserStorage.getItem('pos_pending_checkout_v1');if(raw&&JSON.parse(raw).plan.order.id!==id)throw new Error('待確認單號不符');browserStorage.removeItem('pos_pending_checkout_v1')},
    apply:result=>{
      setProducts(prev=>prev.map(p=>result.products.find(n=>n.id===p.id)||p))
      if(result.member)setMembers(prev=>prev.map(m=>m.id===result.member.id?result.member:m))
      setOrders(prev=>[result.order,...prev.filter(o=>o.id!==result.order.id)])
      setCart([]);setActiveMember(null);setManualDiscount(0)
    },onState:setCheckoutState,replayVerified:true,
  })
  useEffect(()=>{const handler=e=>setDataError(e.detail);window.addEventListener('pos-persistence-error',handler);return()=>window.removeEventListener('pos-persistence-error',handler)},[])
  const reconcileCheckout=()=>checkoutRef.current.reconcile()
  const retryCheckout=()=>checkoutRef.current.retry()
  // 初始化：從 SQLite 或 localStorage 載入資料
  useEffect(() => {
    if (!session) { setReady(false); return }
    let releaseEditor, cancelled=false
    async function init() {
      if (!isElectron) {
        releaseEditor=await acquireBrowserEditor()
        if(cancelled){releaseEditor();return}
      }
      if (isElectron && session.role === 'owner') {
        await checkAndMigrate()
      }
      // 用 Promise.allSettled 避免單一失敗阻塞整個初始化
      const results = await Promise.allSettled([
        loadProducts([]),
        loadMembers([]),
        loadOrders([]),
        session.role === 'owner' ? loadManualJournal([]) : Promise.resolve([]),
        loadHeldOrders(),
        loadWasteLog(),
        loadTopups(),
        getOpenShift(),
      ])
      if(cancelled)return
      const fallbacks = [[], [], [], [], [], [], [], null]
      const [p, m, o, j, held, waste, tps, shift] = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value
        setDataError('資料載入失敗，請保留原資料並重試：' + String(r.reason?.message || '讀取失敗'))
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
      if(cancelled)return
      try { checkoutRef.current.restore() } catch(e) { setDataError(e.message) }
      setReady(true)
    }
    init().catch(e=>{setDataError(e.message);setReady(true)})
    return ()=>{cancelled=true;releaseEditor?.()}
  }, [session?.userId])

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
  useEffect(() => { if (!isElectron && ready && !dataError) { try { saveLS('pos2_products', products) } catch(e) {setDataError('資料保存失敗：'+e.message)} } }, [products, ready])
  useEffect(() => { if (!isElectron && ready && !dataError) { try { saveLS('pos2_members', members) } catch(e) {setDataError('資料保存失敗：'+e.message)} } }, [members, ready])
  useEffect(() => { if (!isElectron && ready && !dataError) { try { saveLS('pos2_orders', orders) } catch(e) {setDataError('資料保存失敗：'+e.message)} } }, [orders, ready])
  useEffect(() => { if (!isElectron && ready && !dataError) { try { saveLS('pos2_manual_j', manualEntries) } catch(e) {setDataError('資料保存失敗：'+e.message)} } }, [manualEntries, ready])

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

  const ensureCartEditable=()=>{if(checkoutRef.current.getState().phase!=='idle')throw new Error('請先確認原交易結果')}
  const addToCart = useCallback((product,qty=1)=>{
    ensureCartEditable()
    setCart(prev=>{
      const idx=prev.findIndex(i=>i.id===product.id)
      if(idx>=0){const next=[...prev];next[idx]={...next[idx],qty:next[idx].qty+qty};return next}
      return [...prev,{...product,qty}]
    })
  },[])
  const removeFromCart = useCallback(id=>{ensureCartEditable();setCart(p=>p.filter(i=>i.id!==id))},[])
  const updateCartQty  = useCallback((id,qty)=>{ensureCartEditable();if(qty<=0){setCart(p=>p.filter(i=>i.id!==id));return}setCart(p=>p.map(i=>i.id===id?{...i,qty}:i))},[])
  const updateCartItemPrice = useCallback((id, price) => {
    ensureCartEditable()
    if (price < 0 || isNaN(price)) return
    setCart(p => p.map(i => i.id === id ? { ...i, price } : i))
  }, [])
  const clearCart      = useCallback(()=>{ensureCartEditable();setCart([]);setActiveMember(null)},[])

  const cartSubtotal = cart.reduce((s,i)=>s+i.price*i.qty,0)
  const cartCount    = cart.reduce((s,i)=>s+i.qty,0)

  // payments: [{method:'cash',amount:50},{method:'card',amount:50}]，若沒帶就用 payMethod+paid
  const checkout = useCallback(async (payMethod, paid, pointsUsed=0, opts={}) => {
    if (!cart.length) return null
    if (dataError) throw new Error(dataError)
    if (browserStorage.getItem(FINANCIAL_PENDING)) throw new Error('上一筆退款或儲值結果尚未確認，請先以原內容重試並核對。')
    const order=await checkoutRef.current.submit({cart,products,members,activeMember,pointsRule,birthdayBonus,
      openShift,payMethod,paid,pointsUsed,opts})
    const payload=payloadFromOrder(order,activeMember)
    fireWebhook('checkout',payload).catch(()=>{})
    fireWebhook('big_sale',payload).catch(()=>{})
    return order
  }, [cart,products,members,activeMember,pointsRule,birthdayBonus,openShift,dataError])

  const refund = useCallback(async (origOrder, refundItems, opts={}) => {
    if (!origOrder || !refundItems?.length) throw new Error('請選擇退貨品項')
    if (dataError) throw new Error(dataError)
    const result=await executeFinancial('refund',{refundOf:origOrder.id,items:refundItems.map(i=>({id:i.id,qty:i.qty})),
      reason:opts.reason||'',cashier:opts.cashier||'',shiftId:openShift?.id||''},request=>dbRefund(request.refundOf,request))
    setOrders(prev=>[result.order,...prev.filter(o=>o.id!==result.order.id).map(o=>o.id===result.original.id?result.original:o)])
    setProducts(prev=>prev.map(p=>result.products.find(n=>n.id===p.id)||p))
    if(result.member)setMembers(prev=>prev.map(m=>m.id===result.member.id?result.member:m))
    fireWebhook('refund',payloadFromOrder(result.order,null)).catch(()=>{})
    return result.order
  }, [openShift,dataError])

  // 掛單
  const holdCart = useCallback(async (label='', cashier='') => {
    ensureCartEditable()
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
    await addHeldOrder(held)
    setHeldOrders(p => [held, ...p])
    setCart([])
    setActiveMember(null)
    setManualDiscount(0)
    return held
  }, [cart, activeMember, manualDiscount])

  const recallHeld = useCallback(async (h) => {
    ensureCartEditable()
    await deleteHeldOrder(h.id)
    setCart(h.cart || [])
    setManualDiscount(h.manualDiscount || 0)
    if (h.memberId) {
      const m = members.find(x => x.id === h.memberId)
      if (m) setActiveMember(m)
    }
    setHeldOrders(p => p.filter(x => x.id !== h.id))
  }, [members])

  const removeHeld = useCallback(async (id) => {
    await deleteHeldOrder(id)
    setHeldOrders(p => p.filter(x => x.id !== id))
  }, [])

  // 班別
  const startShift = useCallback(async (cashier, openCash, cashierId='') => {
    const data = {
      id: 'S' + Date.now(),
      cashier, cashierId, openCash,
      openTime: new Date().toISOString(),
    }
    // 記住這次的零用金 → 明天開班自動帶入，不用每天重打
    try { browserStorage.setItem('pos_last_open_cash', String(openCash || 0)) } catch {}
    const result=await apiOpenShift(data)
    if (result?.success!==true) throw new Error(result?.error||'開班保存失敗')
    setOpenShiftState({ ...data, status: 'open' })
    fireWebhook('shift_open', payloadFromShift(data, 'open')).catch(()=>{})
    return data
  }, [])

  const endShift = useCallback(async (closeCash, note='') => {
    if (!openShift) return null
    const r = await apiCloseShift(openShift.id, { closeCash, note })
    if (r?.success!==true) throw new Error(r?.error||'交班保存失敗')
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
    await addCashLog(data)
  }, [openShift])

  // 損耗
  const recordWaste = useCallback(async (data) => {
    const w = {
      id: 'W' + Date.now(),
      time: new Date().toISOString(),
      ...data,
    }
    const result=await addWaste(w)
    if(result?.success!==true)throw new Error(result?.error||'損耗保存失敗')
    setWasteLog(p=>[result.waste,...p])
    setProducts(prev=>prev.map(p=>p.id===result.product.id?result.product:p))
    return result.waste
  }, [])

  const removeWaste = useCallback(async (id) => {
    await deleteWaste(id)
    setWasteLog(p => p.filter(w => w.id !== id))
  }, [])

  // 會員儲值
  const topupMember = useCallback(async (memberId, amount, bonus=0, payMethod='cash', cashier='') => {
    if (dataError) throw new Error(dataError)
    const result=await executeFinancial('topup',{memberId,amount,bonus,payMethod,cashier},addTopup)
    setMembers(prev=>prev.map(m=>m.id===result.member.id?result.member:m))
    setTopups(prev=>[result.topup,...prev.filter(t=>t.id!==result.topup.id)])
    return result.topup
  }, [dataError])

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
    // id 加亂數後綴：到貨自動建檔會在迴圈連續建多筆，純 Date.now() 同毫秒會撞號互蓋
    const n={...p,id:'p'+Date.now()+Math.random().toString(36).slice(2,6)}
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
  const todayOrders   = settledOrders(orders).filter(o=>new Date(o.time).toDateString()===new Date().toDateString())
  const todayRevenue  = todayOrders.reduce((s,o)=>s+netSale(o),0)
  const lowStockCount = products.filter(p=>p.stock<=5).length
  const todayProfit= todayOrders.reduce((sum,o)=>sum+netSale(o)-orderCost(o,products),0)

  return {
    products,members,orders,cart,view,setView,ready,dataError,checkoutState,reconcileCheckout,retryCheckout,
    activeMember,setActiveMember:value=>{ensureCartEditable();setActiveMember(value)},
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
    manualDiscount, setManualDiscount:value=>{ensureCartEditable();setManualDiscount(value)},
  }
}
