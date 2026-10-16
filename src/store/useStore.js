import { settledOrders, netSale, orderCost } from '../utils/orderLedger'
import { executeFinancial, FINANCIAL_PENDING,readPendingFinancial } from '../utils/financialCommand'
import { browserStorage, writeRecords, acquireBrowserEditor } from '../utils/browserStorage'
import { prepareCheckout } from '../utils/checkoutSafety.mjs'
import { createCheckoutCoordinator } from '../utils/checkoutCoordinator.mjs'
import {getRecoveryState} from '../utils/recoveryClient'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { orderToJournalEntries, topupToJournalEntries,wasteToJournalEntries } from '../utils/accounting'
import {PROCUREMENT_KINDS,procurementToJournalEntries} from '../../electron/procurementRules.mjs'
import {salesToJournalEntries,salesDayMetrics} from '../../electron/salesJournal.mjs'
import {customerLedgerToJournalEntries} from '../../electron/customerJournal.mjs'
import {supplierLedgerToJournalEntries} from '../../electron/supplierJournal.mjs'
import {finalizeSupplierDraft} from '../utils/supplierDraftReceipt.mjs'
import {supplierInventoryCommand} from '../utils/supplierInventoryCommand.mjs'
import {salesDate} from '../../electron/salesRules.mjs'
import {finalizeCustomerDraft} from '../utils/customerDraftReceipt.mjs'
import {
  isElectron,isSharedStore, checkAndMigrate,
  loadProducts, saveProducts, dbAddProduct, dbUpdateProduct, dbDeleteProduct,
  loadPurchases,
  loadMembers, saveMembers, dbAddMember, dbUpdateMember, dbDeleteMember,
  loadOrders, saveOrders, dbCheckout, lookupCheckout, dbRefund,
  loadManualJournal, saveManualJournal, dbAddManualEntry, dbDeleteManualEntry,
  loadHeldOrders, addHeldOrder, deleteHeldOrder,
  getOpenShift, openShift as apiOpenShift, closeShift as apiCloseShift, addCashLog,
  loadWasteLog, addWaste, deleteWaste,
  addTopup, loadTopups,
  getSetting, setSetting,setSettings,
  applyInventoryOperation,
  applyExchangeOperation,
  loadSalesState,applySalesOperation,applyCustomerLedgerOperation,
  loadSupplierState,applySupplierLedgerOperation,
  applyRestaurantOperation,
  loadRestaurantState,
} from '../utils/dataAccess'
import { fireWebhook, payloadFromOrder, payloadFromLowStock, payloadFromShift, payloadFromExpiring, getWebhookConfig } from '../utils/webhook'
import { getReorderList, getExpiringProducts } from '../utils/analytics'
import {validateManualEntry} from '../../electron/manualJournalRules.mjs'
import {defaultRestaurantConfig} from '../../electron/restaurantRules.mjs'

function loadLS(k,fb){const v=browserStorage.getItem(k);return v?JSON.parse(v):fb}
function saveLS(k,v){browserStorage.setItem(k,JSON.stringify(v))}
// DB 寫入錯誤至少 log 出來，避免 silent fail（audit #3）
const logDbErr = op => e => { console.error(`[POS DB] ${op} failed:`,e);window.dispatchEvent(new CustomEvent('pos-persistence-error',{detail:'資料保存失敗（'+op+'），請停止異動並核對：'+e.message})) }

export function useStore(session){
  const [products,      setProducts]      = useState([])
  const [members,       setMembers]       = useState([])
  const [orders,        setOrders]        = useState([])
  const [purchases,setPurchases]=useState([])
  const [sales,setSales]=useState({documents:[]})
  const [supplierState,setSupplierState]=useState(null),supplierRef=useRef(null)
  const [supplierTarget,setSupplierTarget]=useState(null),[purchaseTarget,setPurchaseTarget]=useState(null)
  const salesRef=useRef(sales)
  useEffect(()=>{salesRef.current=sales},[sales])
  const [customerTarget,setCustomerTarget]=useState(''),[salesTarget,setSalesTarget]=useState('')
  const [salesQuote,setSalesQuote]=useState(null)
  const [manualEntries, setManualEntries] = useState([])
  const [cart,          setCart]          = useState([])
  const [view,          setView]          = useState('dashboard')
  const [activeMember,  setActiveMember]  = useState(null)
  const [ready,         setReady]         = useState(false)
  const [dataError, setDataError] = useState('')
  const [checkoutState, setCheckoutState] = useState({phase:'idle'})
  const [financialState,setFinancialState]=useState({phase:'idle'})
  const [heldOrders,    setHeldOrders]    = useState([])
  const [wasteLog,      setWasteLog]      = useState([])
  const [topups,        setTopups]        = useState([])   // 會員儲值紀錄（給會計自動分錄用）
  const [openShift,     setOpenShiftState] = useState(null)
  const [manualDiscount,setManualDiscount] = useState(0)
  const [pointsRule,    setPointsRule]    = useState({ earn: 10, redeem: 1 }) // 消費 X 元 1 點；1 點折抵 X 元
  const [birthdayBonus, setBirthdayBonus] = useState(100)
  const [restaurantConfig,setRestaurantConfig]=useState(defaultRestaurantConfig)

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
      if (isElectron && !isSharedStore && session.role === 'owner') {
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
        loadRestaurantState(),
        session.role==='owner'?loadPurchases([]):Promise.resolve([]),
        session.role==='owner'?loadSalesState(session):Promise.resolve({documents:[]}),
        session.role==='owner'?loadSupplierState(session):Promise.resolve(null),
      ])
      if(cancelled)return
      const fallbacks = [[], [], [], [], [], [], [], null,{config:defaultRestaurantConfig()},[],{documents:[]},null]
      const [p, m, o, j, held, waste, tps, shift,restaurant,po,salesState,supplierSnapshot] = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value
        setDataError('資料載入失敗，請保留原資料並重試：' + String(r.reason?.message || '讀取失敗'))
        console.error('[POS] init load failed:', i, r.reason)
        return fallbacks[i]
      })
      setProducts(Array.isArray(p) ? p : [])
      setMembers(Array.isArray(m) ? m : [])
      setOrders(Array.isArray(o) ? o : [])
      setPurchases(Array.isArray(po)?po:[])
      salesRef.current=salesState;setSales(salesState)
      supplierRef.current=supplierSnapshot;setSupplierState(supplierSnapshot)
      setManualEntries(Array.isArray(j) ? j : [])
      setHeldOrders(Array.isArray(held) ? held : [])
      setWasteLog(Array.isArray(waste) ? waste : [])
      setTopups(Array.isArray(tps) ? tps : [])
      setOpenShiftState(shift || null)
      setRestaurantConfig(restaurant.config)
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
        const bonus=bday==null?100:Number(bday)
        if(!Number.isInteger(bonus)||bonus<0)throw Error('生日贈點設定不正確')
        setBirthdayBonus(bonus)
      } catch(e) {setDataError('營業設定讀取失敗：'+e.message)}
      if(cancelled)return
      try { checkoutRef.current.restore() } catch(e) { setDataError(e.message) }
      try{const pending=readPendingFinancial();if(pending)setFinancialState({phase:'uncertain',kind:pending.kind,id:pending.request.id,message:'找到上一筆未確認異動，請以原編號重試保存；勿重新收款或扣庫存'})}catch(e){setDataError(e.message)}
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

  // Each browser command commits before updating state. Re-saving UI snapshots
  // here could overwrite a newer durable operation when its reply is delayed.

  const autoJournal = useMemo(()=>[
    ...orders.flatMap(o=>orderToJournalEntries(o,products)),
    ...topups.flatMap(topupToJournalEntries),   // 會員儲值（加值 + 折抵）一併入帳，損益表才完整
    ...wasteLog.flatMap(wasteToJournalEntries),
    ...purchases.flatMap(procurementToJournalEntries),
    ...sales.documents.flatMap(salesToJournalEntries),
    ...customerLedgerToJournalEntries(sales.customerLedger?.entries||[]),
    ...supplierLedgerToJournalEntries(supplierState?.supplierLedger.entries||[]),
  ],[orders,products,topups,wasteLog,purchases,sales,supplierState])
  const allJournal  = useMemo(()=>[...autoJournal,...manualEntries].sort((a,b)=>b.date.localeCompare(a.date)),[autoJournal,manualEntries])

  const addManualEntry = useCallback(async e=>{
    validateManualEntry(e)
    const n={...e,id:e._creationId||'JM'+crypto.randomUUID(),type:'manual'};delete n._creationId
    if (isElectron){const r=await dbAddManualEntry(n);if(r?.success!==true)throw Error(r?.error||'帳務保存失敗')}
    else saveLS('pos2_manual_j',[n,...loadLS('pos2_manual_j',[])])
    setManualEntries(p=>[n,...p.filter(j=>j.id!==n.id)])
    return n
  },[])
  const deleteManualEntry = useCallback(async id=>{
    if (isElectron){const r=await dbDeleteManualEntry(id);if(r?.success!==true)throw Error(r?.error||'帳務刪除失敗')}
    else saveLS('pos2_manual_j',loadLS('pos2_manual_j',[]).filter(j=>j.id!==id))
    setManualEntries(p=>p.filter(e=>e.id!==id))
  },[])

  const ensureCartEditable=()=>{if(checkoutRef.current.getState().phase!=='idle')throw new Error('請先確認原交易結果')}
  function stageQuickSale(items){
    ensureCartEditable();if(dataError)throw Error(dataError)
    if(financialState.phase!=='idle')throw Error('請先確認上一筆單據')
    if(cart.length)throw Error('收銀台已有商品，已保留原購物車。請先完成或處理原單')
    const rows=items.map(item=>{const p=products.find(p=>p.id===item.id);if(!p||p.price!==item.price||!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>p.stock)throw Error('商品價格或可售數量已改變，請重新核對');return {...p,qty:item.qty}})
    setCart(rows);setActiveMember(null);setManualDiscount(0);setView('pos')
  }
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
      reason:opts.reason||'',cashier:opts.cashier||'',shiftId:openShift?.id||''},request=>dbRefund(request.refundOf,request),setFinancialState)
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
      shiftId: openShift?.id || '',
      type, amount, reason, cashier,
    }
    const result=await executeFinancial('cashlog',data,addCashLog,setFinancialState)
    return result.cashLog
  }, [openShift])

  // 損耗
  const recordWaste = useCallback(async (data) => {
    const result=await executeFinancial('waste',data,addWaste,setFinancialState)
    if(result?.success!==true)throw new Error(result?.error||'損耗保存失敗')
    setWasteLog(p=>[result.waste,...p.filter(w=>w.id!==result.waste.id)])
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
    const result=await executeFinancial('topup',{memberId,amount,bonus,payMethod,cashier,shiftId:openShift?.id||''},addTopup,setFinancialState)
    setMembers(prev=>prev.map(m=>m.id===result.member.id?result.member:m))
    setTopups(prev=>[result.topup,...prev.filter(t=>t.id!==result.topup.id)])
    return result.topup
  }, [dataError,openShift])

  function applyInventoryResult(result){
    if(result.supplierLedger){const current=supplierRef.current;const next={...current,supplierLedger:result.supplierLedger,legacyReadOnly:true,purchases:result.purchase?[result.purchase,...(current?.purchases||[]).filter(po=>po.id!==result.purchase.id)]:current?.purchases||[]};supplierRef.current=next;setSupplierState(next)}
    setProducts(previous=>[...previous.map(p=>result.products.find(n=>n.id===p.id)||p),...result.products.filter(p=>!previous.some(old=>old.id===p.id))])
    if(result.purchase)setPurchases(previous=>[result.purchase,...previous.filter(p=>p.id!==result.purchase.id)])
    if(result.cashLog)window.dispatchEvent(new Event('pos-cash-operation'))
    window.dispatchEvent(new CustomEvent('pos-inventory-operation',{detail:result}))
    return result
  }
  async function commitInventory(kind,input,identity=null){
    if(dataError)throw Error(dataError)
    const state=kind==='purchase-create'&&identity?await refreshSuppliers():supplierRef.current,original=kind==='receive'?purchases.find(po=>po.id===input.purchaseId):null
    const controlled=kind!=='stocktake'&&!(kind==='receive'&&!original?.procurement&&!state?.legacyReadOnly)
    if(controlled&&!state)throw Error('請先載入供應商與採購資料，再保存原草稿')
    const command=supplierInventoryCommand(kind,input,identity,state,{controlled})
    const result=await executeFinancial(kind,command.input,request=>applyInventoryOperation(request,session),setFinancialState,command.identity)
    return applyInventoryResult(result)
  }
  function applySupplierResult(result){
    result={...result,draftWarning:finalizeSupplierDraft(result,session.userId)}
    const current=supplierRef.current,next={...current,supplierLedger:result.supplierLedger,legacyReadOnly:true,purchases:[...result.purchases,...(current?.purchases||[]).filter(po=>!result.purchases.some(row=>row.id===po.id))]}
    supplierRef.current=next;setSupplierState(next)
    setPurchases(previous=>[...result.purchases,...previous.filter(po=>!result.purchases.some(row=>row.id===po.id))])
    if(result.cashLog)window.dispatchEvent(new Event('pos-cash-operation'))
    window.dispatchEvent(new CustomEvent('pos-supplier-ledger-operation',{detail:result}));return result
  }
  async function commitSupplierLedger(input,identity=null,prepare=null){
    if(dataError)throw Error(dataError)
    if(checkoutRef.current.getState().phase!=='idle')throw Error('請先確認原收款交易')
    const state=supplierRef.current;if(!state)throw Error('請先載入供應商與採購資料，再保存原草稿')
    return applySupplierResult(await executeFinancial('supplier-ledger',{storeId:state.storeId,epoch:state.epoch,date:state.today,expectedRevision:state.supplierLedger.revision,...input,kind:'supplier-ledger'},request=>applySupplierLedgerOperation(request,session),setFinancialState,identity,null,prepare))
  }
  async function refreshSuppliers(){const next=await loadSupplierState(session);supplierRef.current=next;setSupplierState(next);setPurchases(next.purchases);return next}
  async function commitExchange(input){
    if(dataError)throw Error(dataError)
    if(checkoutRef.current.getState().phase!=='idle')throw Error('請先確認原收款交易')
    const result=await executeFinancial('exchange',{...input,kind:'exchange'},request=>applyExchangeOperation(request,session),setFinancialState)
    window.dispatchEvent(new CustomEvent('pos-exchange-operation',{detail:result}))
    return result
  }
  function applySalesResult(result){
    setSales(previous=>({...previous,documents:[result.document,...previous.documents.filter(doc=>doc.id!==result.document.id)]}))
    setProducts(previous=>previous.map(product=>result.products.find(row=>row.id===product.id)||product))
    if(result.cashLog)window.dispatchEvent(new Event('pos-cash-operation'))
    window.dispatchEvent(new CustomEvent('pos-sales-operation',{detail:result}))
    return result
  }
  async function commitSales(input,identity=null){
    if(dataError)throw Error(dataError)
    if(checkoutRef.current.getState().phase!=='idle')throw Error('請先確認原收款交易')
    return applySalesResult(await executeFinancial('sales',{expectedLedgerRevision:salesRef.current.customerLedger?.revision||0,...input,kind:'sales'},request=>applySalesOperation(request,session),setFinancialState,identity))
  }
  function applyCustomerLedgerResult(result){
    result={...result,draftWarning:finalizeCustomerDraft(result,session.userId)}
    salesRef.current={...salesRef.current,customerLedger:result.customerLedger}
    setSales(previous=>({...previous,customerLedger:result.customerLedger,documents:[...result.documents,...previous.documents.filter(doc=>!result.documents.some(row=>row.id===doc.id))]}))
    if(result.cashLog)window.dispatchEvent(new Event('pos-cash-operation'))
    window.dispatchEvent(new CustomEvent('pos-customer-ledger-operation',{detail:result}))
    return result
  }
  async function commitCustomerLedger(input,identity=null,prepare=null){
    if(dataError)throw Error(dataError)
    if(checkoutRef.current.getState().phase!=='idle')throw Error('請先確認原收款交易')
    const state=salesRef.current
    return applyCustomerLedgerResult(await executeFinancial('customer-ledger',{storeId:state.storeId,epoch:state.epoch,date:state.today,expectedRevision:state.customerLedger?.revision||0,...input,kind:'customer-ledger'},request=>applyCustomerLedgerOperation(request,session),setFinancialState,identity,null,prepare))
  }
  async function refreshTrading(){
    const next=await loadSalesState(session);salesRef.current=next;setSales(next);return next
  }
  async function commitRestaurant(input,identity=null){
    if(dataError)throw Error(dataError)
    if(checkoutRef.current.getState().phase!=='idle')throw Error('請先確認原收款交易')
    const result=await executeFinancial('restaurant',{...input,kind:'restaurant'},request=>applyRestaurantOperation(request,session),setFinancialState,identity)
    await applyRestaurantResult(result)
    return result
  }
  async function retryFinancial(){
    const pending=readPendingFinancial();if(!pending)return
    const ports={restaurant:r=>applyRestaurantOperation(r,session),refund:r=>dbRefund(r.refundOf,r),topup:addTopup,waste:addWaste,cashlog:addCashLog,stocktake:r=>applyInventoryOperation(r,session),receive:r=>applyInventoryOperation(r,session)}
    ports.exchange=r=>applyExchangeOperation(r,session)
    ports.sales=r=>applySalesOperation(r,session)
    ports['customer-ledger']=r=>applyCustomerLedgerOperation(r,session)
    ports['supplier-ledger']=r=>applySupplierLedgerOperation(r,session)
    for(const kind of PROCUREMENT_KINDS)ports[kind]=r=>applyInventoryOperation(r,session)
    const result=await executeFinancial(pending.kind,JSON.parse(pending.signature).input,ports[pending.kind],setFinancialState,null,async original=>(await getRecoveryState(original,session)).active==='matched')
    if(pending.kind==='topup'){setMembers(p=>p.map(m=>m.id===result.member.id?result.member:m));setTopups(p=>[result.topup,...p.filter(t=>t.id!==result.topup.id)])}
    if(pending.kind==='refund'){setOrders(p=>[result.order,...p.filter(o=>o.id!==result.order.id).map(o=>o.id===result.original.id?result.original:o)]);setProducts(p=>p.map(i=>result.products.find(n=>n.id===i.id)||i));if(result.member)setMembers(p=>p.map(m=>m.id===result.member.id?result.member:m))}
    if(pending.kind==='waste'){setWasteLog(p=>[result.waste,...p.filter(w=>w.id!==result.waste.id)]);setProducts(p=>p.map(i=>i.id===result.product.id?result.product:i))}
    if(['stocktake','receive',...PROCUREMENT_KINDS].includes(pending.kind))applyInventoryResult(result)
    if(pending.kind==='cashlog')window.dispatchEvent(new Event('pos-cash-operation'))
    if(pending.kind==='restaurant')await applyRestaurantResult(result)
    if(pending.kind==='exchange')window.dispatchEvent(new CustomEvent('pos-exchange-operation',{detail:result}))
    if(pending.kind==='sales')applySalesResult(result)
    if(pending.kind==='customer-ledger')applyCustomerLedgerResult(result)
    if(pending.kind==='supplier-ledger')applySupplierResult(result)
    return result
  }

  // 點數規則設定
  async function applyRestaurantResult(result){
    window.dispatchEvent(new CustomEvent('pos-restaurant-operation',{detail:result}))
    setProducts(p=>p.map(i=>result.products.find(n=>n.id===i.id)||i))
    const rows=[result.refund,result.order].filter(Boolean)
    if(rows.length)setOrders(p=>[...rows,...p.filter(o=>!rows.some(n=>n.id===o.id))])
    try{await reloadFromDB();window.dispatchEvent(new Event('pos-data-refreshed'))}catch(e){setDataError('異動已保存，但重新讀取資料失敗；請恢復連線並重新載入：'+e.message)}
  }
  const updatePointsRule = useCallback(async (earn, redeem) => {
    if(!Number.isInteger(Number(earn))||Number(earn)<=0||!Number.isFinite(Number(redeem))||Number(redeem)<=0)throw Error('點數規則需為正數')
    await setSettings({pointsEarnRate:String(earn),pointsRedeemRate:String(redeem)})
    setPointsRule({ earn, redeem })
  }, [])

  const updateBirthdayBonus = useCallback(async (val) => {
    const n = Number(val)
    if(!Number.isInteger(n)||n<0)throw Error('生日贈點需為零或正整數')
    await setSetting('birthdayBonus', String(n))
    setBirthdayBonus(n)
  }, [])
  const updateBusinessSettings=useCallback(async(earn,redeem,bonus)=>{
    const e=Number(earn),r=Number(redeem),b=Number(bonus)
    if(!Number.isInteger(e)||e<=0||!Number.isFinite(r)||r<=0||!Number.isInteger(b)||b<0)throw Error('每點消費額需為正整數、折抵額需為正數，生日贈點需為零或正整數')
    await setSettings({pointsEarnRate:String(e),pointsRedeemRate:String(r),birthdayBonus:String(b)})
    setPointsRule({earn:e,redeem:r});setBirthdayBonus(b)
  },[])

  const acknowledge=result=>{if(result?.success===false)throw Error(result.error||'資料保存失敗');return result}
  const addProduct = useCallback(async p=>{
    // id 加亂數後綴：到貨自動建檔會在迴圈連續建多筆，純 Date.now() 同毫秒會撞號互蓋
    const n={...p,id:p._creationId||'p'+crypto.randomUUID()};delete n._creationId;delete n._expectedStock
    if (isElectron) acknowledge(await dbAddProduct(n))
    else saveLS('pos2_products',[...loadLS('pos2_products',[]),n])
    setProducts(x=>[...x.filter(p=>p.id!==n.id),n])
    return n
  },[])
  const updateProduct = useCallback(async(id,u)=>{
    const input={...u}
    if(Object.hasOwn(input,'stock')&&!Object.hasOwn(input,'_expectedStock'))input._expectedStock=products.find(p=>p.id===id)?.stock
    if (isElectron) acknowledge(await dbUpdateProduct(id,input))
    else {const current=loadLS('pos2_products',[]);if(Object.hasOwn(input,'stock')&&current.find(p=>p.id===id)?.stock!==input._expectedStock)throw Error('庫存已變更，請重新核對');saveLS('pos2_products',current.map(p=>p.id===id?{...p,...u}:p))}
    setProducts(p=>p.map(x=>x.id===id?{...x,...u}:x))
  },[products])
  const deleteProduct = useCallback(async id=>{
    if (isElectron) acknowledge(await dbDeleteProduct(id))
    else saveLS('pos2_products',loadLS('pos2_products',[]).filter(p=>p.id!==id))
    setProducts(p=>p.filter(x=>x.id!==id))
  },[])
  const findByBarcode = useCallback(code=>products.find(p=>p.barcode===code),[products])

  const addMember = useCallback(async m=>{
    const n={...m,id:m._creationId||'m'+crypto.randomUUID(),points:0,totalSpent:0,tier:'normal',joinDate:new Date().toISOString().slice(0,10)};delete n._creationId
    if (isElectron) acknowledge(await dbAddMember(n))
    else saveLS('pos2_members',[...loadLS('pos2_members',[]),n])
    setMembers(p=>[...p.filter(m=>m.id!==n.id),n])
    return n
  },[])
  const updateMember = useCallback(async(id,u)=>{
    if (isElectron) acknowledge(await dbUpdateMember(id,u))
    else saveLS('pos2_members',loadLS('pos2_members',[]).map(p=>p.id===id?{...p,...u}:p))
    setMembers(p=>p.map(m=>m.id===id?{...m,...u}:m))
  },[])
  const deleteMember = useCallback(async id=>{
    if (isElectron) acknowledge(await dbDeleteMember(id))
    else saveLS('pos2_members',loadLS('pos2_members',[]).filter(p=>p.id!==id))
    setMembers(p=>p.filter(m=>m.id!==id))
  },[])
  // audit #25: m.phone 可能為 null（舊資料），用 (m.phone||'').replace 防呆
  const findMember = useCallback(q=>members.find(m=>(m.phone||'').replace(/-/g,'').includes(q.replace(/-/g,''))||(m.name||'').includes(q)),[members])

  // 從 SQLite 重新載入資料（用於備份還原後）
  const reloadFromDB = useCallback(async () => {
    if(isElectron&&window.electronAPI.db.getStoreSnapshot){
      const s=await window.electronAPI.db.getStoreSnapshot()
      setProducts(s.products);setMembers(s.members);setOrders(s.orders);setManualEntries(s.manualEntries);setHeldOrders(s.heldOrders);setWasteLog(s.wasteLog);setTopups(s.topups);setOpenShiftState(s.openShift);setPurchases(s.purchases||[])
      setRestaurantConfig(s.restaurantConfig||defaultRestaurantConfig())
      setSales(s.sales||{documents:[]})
      salesRef.current=s.sales||{documents:[]};supplierRef.current=s.supplierState||null;setSupplierState(s.supplierState||null)
      setPointsRule({earn:s.rules.earn==null?10:Number(s.rules.earn),redeem:s.rules.redeem==null?1:Number(s.rules.redeem)});setBirthdayBonus(s.rules.birthdayBonus==null?100:Number(s.rules.birthdayBonus));return
    }
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
    if(session?.role==='owner'){setPurchases(await loadPurchases([]));const salesState=await loadSalesState(session);salesRef.current=salesState;setSales(salesState);const suppliers=await loadSupplierState(session);supplierRef.current=suppliers;setSupplierState(suppliers)}
    else {setSales({documents:[]});salesRef.current={documents:[]};supplierRef.current=null;setSupplierState(null)}
    setWasteLog(await loadWasteLog());setRestaurantConfig((await loadRestaurantState()).config)
  }, [session?.userId,session?.role])
  async function reloadAfterRecovery(){
    try{await reloadFromDB();setDataError('');window.dispatchEvent(new Event('pos-data-refreshed'))}
    catch(error){setDataError('復原已保存，但重新讀取未完成。請保持原單號並重新載入：'+error.message);throw error}
  }
  useEffect(()=>{
    if(!ready||!session||!isElectron||!window.electronAPI.onStoreChanged)return
    let cancelled=false,timer,running=false,again=false
    async function refresh(){if(running){again=true;return}running=true;do{again=false;try{await reloadFromDB();if(!cancelled)window.dispatchEvent(new Event('pos-data-refreshed'))}catch(e){if(!isSharedStore&&!cancelled)setDataError(e.message)}}while(again&&!cancelled);running=false}
    const unsubscribe=window.electronAPI.onStoreChanged(()=>{clearTimeout(timer);timer=setTimeout(refresh,100)})
    return()=>{cancelled=true;clearTimeout(timer);unsubscribe()}
  },[ready,session?.userId,reloadFromDB])

  const categories    = [...new Set(products.map(p=>p.category))]
  // 排除完整退貨原訂單（status='refunded'）；部分退貨負數訂單保留，與原單抵銷正確
  const todayOrders   = settledOrders(orders).filter(o=>new Date(o.time).toDateString()===new Date().toDateString())
  const todaySales=useMemo(()=>salesDayMetrics(sales.documents,salesDate(new Date())),[sales.documents])
  const todayRevenue  = Math.round((todayOrders.reduce((s,o)=>s+netSale(o),0)+todaySales.revenue)*100)/100
  const lowStockCount = products.filter(p=>p.stock<=5).length
  const todayProfit= Math.round((todayOrders.reduce((sum,o)=>sum+netSale(o)-orderCost(o,products),0)+todaySales.profit)*100)/100

  return {
    supplierState,supplierTarget,openSupplierLedger:(supplierId='',purchaseId='')=>{setSupplierTarget({supplierId,purchaseId});setView('suppliers')},consumeSupplierTarget:()=>setSupplierTarget(null),purchaseTarget,openPurchaseSuppliers:()=>{setPurchaseTarget({tab:'suppliers'});setView('purchase')},openPurchaseDocument:id=>{setPurchaseTarget({id});setView('purchase')},consumePurchaseTarget:()=>setPurchaseTarget(null),commitSupplierLedger,refreshSuppliers,
    products,members,orders,purchases,sales,salesQuote,openSalesQuote:quote=>{setSalesQuote({id:quote.id,revision:quote.revision});setView('sales')},consumeSalesQuote:()=>setSalesQuote(null),cart,view,setView,ready,dataError,checkoutState,reconcileCheckout,retryCheckout,financialState,retryFinancial,commitInventory,commitRestaurant,commitExchange,commitSales,commitCustomerLedger,refreshTrading,customerTarget,openCustomerLedger:id=>{setCustomerTarget(id);setView("customers")},consumeCustomerTarget:()=>setCustomerTarget(""),salesTarget,openSalesDocument:id=>{setSalesTarget(id);setView("sales")},consumeSalesTarget:()=>setSalesTarget(""),restaurantConfig,
    activeMember,setActiveMember:value=>{ensureCartEditable();setActiveMember(value)},
    addToCart,removeFromCart,updateCartQty,updateCartItemPrice,clearCart,stageQuickSale,
    cartSubtotal,cartCount,checkout,refund,
    addProduct,updateProduct,deleteProduct,findByBarcode,
    addMember,updateMember,deleteMember,findMember,
    categories,todayOrders,todayRevenue,lowStockCount,todayProfit,todaySales,todayBusinessCount:todayOrders.length+todaySales.deliveries,
    allJournal,autoJournal,manualEntries,
    addManualEntry,deleteManualEntry,
    reloadFromDB,reloadAfterRecovery,
    // v2.1
    heldOrders, holdCart, recallHeld, removeHeld,
    wasteLog, recordWaste, removeWaste,
    openShift, startShift, endShift, logCash,
    topupMember,
    pointsRule, updatePointsRule,
    birthdayBonus, updateBirthdayBonus,
    updateBusinessSettings,
    manualDiscount, setManualDiscount:value=>{ensureCartEditable();setManualDiscount(value)},
  }
}
