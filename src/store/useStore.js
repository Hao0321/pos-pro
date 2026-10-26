import {verifySupplierRefundProof} from '../../electron/supplierRefund.mjs'
import {verifyPurchaseInvoiceProof} from '../../electron/purchaseInvoice.mjs'
import {verifyOrdinaryReturnProof} from '../../electron/ordinarySupplierReturn.mjs'
import {verifyPurchaseCorrectionProof} from '../../electron/purchaseCorrection.mjs'
import {verifyPurchasePaymentProof} from '../../electron/purchasePayment.mjs'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {saveExpenseEntry as persistExpenseEntry} from '../utils/dataAccess'
import {DRAWER_EXPENSE,DRAWER_RETURN,verifyDrawerProof} from '../../electron/expenseDrawer.mjs'
import {verifyExpenseProof} from '../../electron/expenseEntry.mjs'
import {isPurchaseCreate} from '../../electron/procurementRules.mjs'
import {isCashMovementRejection} from '../../electron/cashMovementDraft.mjs'
import {isProductEdit,isProductEditRejection} from '../../electron/productEditDraft.mjs'
import {loyaltyRules} from '../../electron/loyaltyProgram.mjs'
import {finalizePurchaseDraft} from '../utils/purchaseDraftReceipt.mjs'
import { settledOrders, netSale, orderCost } from '../utils/orderLedger'
import {finalizeReceiptLotDraft} from '../utils/receiptLotDraftReceipt.mjs'
import { executeFinancial, FINANCIAL_PENDING,readPendingFinancial } from '../utils/financialCommand'
import {reservationDepositReportEntries} from '../../electron/reservationDeposits.mjs'
import {getReservationState,applyReservationOperation} from '../utils/dataAccess'
import {loadRefundContext} from '../utils/dataAccess'
import {loadStockSetupAccess,loadStockSetupState,applyStockSetupOperation,loadWarehouseState,applyWarehouseOperation,loadLotState,applyLotOperation} from '../utils/dataAccess'
import { browserStorage, writeRecords, acquireBrowserEditor } from '../utils/browserStorage'
import { prepareCheckout } from '../utils/checkoutSafety.mjs'
import { createCheckoutCoordinator } from '../utils/checkoutCoordinator.mjs'
import {getRecoveryState} from '../utils/recoveryClient'
import useCartWorkspace from '../hooks/useCartWorkspace'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {automaticBusinessJournal} from '../../electron/businessJournal.mjs'
import {PROCUREMENT_KINDS} from '../../electron/procurementRules.mjs'
import {salesDayMetrics} from '../../electron/salesJournal.mjs'
import {finalizeSupplierDraft} from '../utils/supplierDraftReceipt.mjs'
import {supplierInventoryCommand} from '../utils/supplierInventoryCommand.mjs'
import {salesDate} from '../../electron/salesRules.mjs'
import {finalizeCustomerDraft} from '../utils/customerDraftReceipt.mjs'
import {
  isElectron,isSharedStore, checkAndMigrate,
  loadProducts, saveProducts, dbAddProduct, dbUpdateProduct, dbDeleteProduct,
  loadPurchases,
  loadMembers, saveMembers, dbAddMember, dbUpdateMember, dbDeleteMember,
  loadOrders, saveOrders, dbCheckout, lookupCheckout, dbRefund,verifyCheckoutCostReceipt,
  loadManualJournal, saveManualJournal, dbAddManualEntry, dbDeleteManualEntry,
  loadHeldOrders, addHeldOrder, deleteHeldOrder,
  getOpenShift, openShift as apiOpenShift, closeShift as apiCloseShift, addCashLog,
  loadWasteLog, addWaste, deleteWaste, readWasteEntryOriginal,
  addTopup, loadTopups, readMemberTopupOriginal,
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
import {createReadinessTask,readinessTaskFor} from '../utils/openingGuide.mjs'
import {isShiftCountRejection} from '../../electron/shiftCountDraft.mjs'
import {prepareRestaurantCommand} from '../utils/restaurantCommand.mjs'

function loadLS(k,fb){const v=browserStorage.getItem(k);return v?JSON.parse(v):fb}
function saveLS(k,v){browserStorage.setItem(k,JSON.stringify(v))}
// DB 寫入錯誤至少 log 出來，避免 silent fail（audit #3）
const logDbErr = op => e => { console.error(`[POS DB] ${op} failed:`,e);window.dispatchEvent(new CustomEvent('pos-persistence-error',{detail:'資料保存失敗（'+op+'），請停止異動並核對：'+e.message})) }

export function useStore(session){
  const sessionRef=useRef(session);sessionRef.current=session
  const [stockSetupEnabled,setStockSetupEnabled]=useState(false)
  useEffect(()=>{let active=true;setStockSetupEnabled(false);if(session?.role==='owner')loadStockSetupAccess().then(result=>{if(active)setStockSetupEnabled(result?.enabled===true)}).catch(()=>{});return()=>{active=false}},[session?.userId,session?.role])
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
  const [restaurantTarget,setRestaurantTarget]=useState(null),[reservationTarget,setReservationTarget]=useState(null)
  const [salesQuote,setSalesQuote]=useState(null)
  const [manualEntries, setManualEntries] = useState([])
  const [view,          setView]          = useState('dashboard')
  const [readinessTask,setReadinessTask]=useState(null),readinessTaskRef=useRef(null)
  const startReadinessTask=useCallback((kind,productId='')=>{const task=createReadinessTask(kind,productId,sessionRef.current);readinessTaskRef.current=task;setReadinessTask(task);setView(task.view);return task.id},[])
  const finishReadinessTask=useCallback(id=>{const task=readinessTaskRef.current;if(!task||task.id!==id||!readinessTaskFor(task,sessionRef.current,task.view))return false;readinessTaskRef.current=null;setReadinessTask(null);setView('readiness');return true},[])
  useEffect(()=>{const task=readinessTaskRef.current;if(task&&(view!==task.view||!readinessTaskFor(task,sessionRef.current,task.view))){readinessTaskRef.current=null;setReadinessTask(null)}},[view,session?.userId,session?.role])
  const [settingsTarget,setSettingsTarget]=useState(null)
  const [ready,         setReady]         = useState(false)
  const [dataError, setDataError] = useState('')
  const [checkoutState, setCheckoutState] = useState({phase:'idle'})
  const [financialState,setFinancialState]=useState({phase:'idle'})
  const [heldOrders,    setHeldOrders]    = useState([])
  const [wasteLog,      setWasteLog]      = useState([])
  const [topups,        setTopups]        = useState([])   // 會員儲值紀錄（給會計自動分錄用）
  const [openShift,     setOpenShiftState] = useState(null)
  const [pointsRule,    setPointsRule]    = useState({ earn: 10, redeem: 1 }) // 消費 X 元 1 點；1 點折抵 X 元
  const [birthdayBonus, setBirthdayBonus] = useState(100)
  const [restaurantConfig,setRestaurantConfig]=useState(defaultRestaurantConfig)
  const [restaurantEntries,setRestaurantEntries]=useState([])
  const [reservationEntries,setReservationEntries]=useState([])

  const cartWorkspace=useCartWorkspace({session,enabled:ready,members,onHeldOrders:setHeldOrders}),cartWorkspaceRef=useRef(cartWorkspace)
  cartWorkspaceRef.current=cartWorkspace
  const {cart,activeMember,manualDiscount,setCart,setActiveMember,setManualDiscount}=cartWorkspace
  const pendingCheckout=()=>{const raw=browserStorage.getItem('pos_pending_checkout_v1'),local=cartWorkspaceRef.current.checkout();if(raw){const saved=JSON.parse(raw);if(local&&local.plan.order.id!==saved.plan.order.id)throw Error('原交易紀錄需要核對，請保留購物車。');return saved}return local}

  const checkoutRef = useRef(null)
  if (!checkoutRef.current) checkoutRef.current=createCheckoutCoordinator({
    prepare:input=>{cartWorkspaceRef.current.assertProducts(input.products);return prepareCheckout(input)},persist:plan=>dbCheckout(plan.order,plan.stockUpdates,plan.memberUpdate,sessionRef.current,pendingCheckout()?.cartWorkspace),lookup:id=>lookupCheckout(id,sessionRef.current),verifyReceipt:verifyCheckoutCostReceipt,
    readPending:pendingCheckout,
    writePending:value=>{const saved=cartWorkspaceRef.current.freezeCheckout(value);browserStorage.setItem('pos_pending_checkout_v1',JSON.stringify(saved))},
    clearPending:id=>{const raw=browserStorage.getItem('pos_pending_checkout_v1');if(raw&&JSON.parse(raw).plan.order.id!==id)throw new Error('待確認單號不符');browserStorage.removeItem('pos_pending_checkout_v1');cartWorkspaceRef.current.releaseCheckout(id)},
    apply:result=>{
      cartWorkspaceRef.current.acceptCheckout(result,pendingCheckout())
      setProducts(prev=>prev.map(p=>result.products.find(n=>n.id===p.id)||p))
      if(result.member)setMembers(prev=>prev.map(m=>m.id===result.member.id?result.member:m))
      setOrders(prev=>[result.order,...prev.filter(o=>o.id!==result.order.id)])
    },onState:setCheckoutState,replayVerified:true,
  })
  useEffect(()=>{const handler=e=>setDataError(e.detail);window.addEventListener('pos-persistence-error',handler);return()=>window.removeEventListener('pos-persistence-error',handler)},[])
  const reconcileCheckout=()=>{if(checkoutRef.current.getState().phase==='idle')checkoutRef.current.restore();return checkoutRef.current.reconcile()}
  const retryCheckout=()=>{if(checkoutRef.current.getState().phase==='idle')checkoutRef.current.restore();return checkoutRef.current.retry()}
  useEffect(()=>{if(cartWorkspace.ready&&checkoutRef.current.getState().phase==='idle')try{checkoutRef.current.restore()}catch(error){setDataError(error.message)}},[cartWorkspace.ready,cartWorkspace.value.checkout?.plan.order.id])
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
        session.role==='owner'?getReservationState(session).then(reservationDepositReportEntries):Promise.resolve([]),
      ])
      if(cancelled)return
      const fallbacks = [[], [], [], [], [], [], [], null,{config:defaultRestaurantConfig()},[],{documents:[]},null,[]]
      const [p, m, o, j, held, waste, tps, shift,restaurant,po,salesState,supplierSnapshot,reservations] = results.map((r, i) => {
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
      setRestaurantEntries(restaurant.entries||[]);setReservationEntries(reservations)
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

  const autoJournal = useMemo(()=>automaticBusinessJournal({orders,products,topups,wasteLog,purchases,salesDocuments:sales.documents,customerEntries:sales.customerLedger?.entries||[],supplierEntries:supplierState?.supplierLedger.entries||[],restaurantEntries,reservationEntries,openingJournals:[...(sales.customerLedger?.openingJournals||[]),...(supplierState?.supplierLedger.openingJournals||[])]}),[orders,products,topups,wasteLog,purchases,sales,supplierState,restaurantEntries,reservationEntries])
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
    const r=await dbDeleteManualEntry(id,sessionRef.current);if(r?.success!==true)throw Error(r?.error||'帳務刪除失敗')
    setManualEntries(p=>p.filter(e=>e.id!==id))
  },[])

  const ensureCartEditable=()=>{if(checkoutRef.current.getState().phase!=='idle')throw new Error('請先確認原交易結果');cartWorkspaceRef.current.guard()}
  function stageQuickSale(items){
    ensureCartEditable();if(dataError)throw Error(dataError)
    if(financialState.phase!=='idle')throw Error('請先確認上一筆單據')
    if(cart.length)throw Error('收銀台已有商品，已保留原購物車。請先完成或處理原單')
    const rows=items.map(item=>{const p=products.find(p=>p.id===item.id);if(!p||p.price!==item.price||!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>p.stock)throw Error('商品價格或可售數量已改變，請重新核對');return {...p,qty:item.qty}})
    cartWorkspaceRef.current.replace({cart:rows,memberId:'',manualDiscount:0});setView('pos')
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
  const clearCart      = useCallback(()=>{ensureCartEditable();cartWorkspaceRef.current.clear()},[])

  const cartSubtotal = cart.reduce((s,i)=>s+i.price*i.qty,0)
  const cartCount    = cart.reduce((s,i)=>s+i.qty,0)

  // payments: [{method:'cash',amount:50},{method:'card',amount:50}]，若沒帶就用 payMethod+paid
  const checkout = useCallback(async (payMethod, paid, pointsUsed=0, opts={}) => {
    ensureCartEditable()
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
    const input={refundOf:origOrder.id,items:refundItems.map(i=>({id:i.id,qty:i.qty})),reason:opts.reason||'',cashier:opts.cashier||'',shiftId:opts.shiftId||openShift?.id||'',...(opts.review===undefined?{}:{review:opts.review})}
    let identity=null
    if(opts.review&&!readPendingFinancial()){
      const context=await loadRefundContext(sessionRef.current)
      if(context.storeId!==opts.review.storeId||context.epoch!==opts.review.epoch||context.openShift?.id!==input.shiftId)throw Object.assign(Error('店面、資料或班別已更新，請重新看退款'),{notCommitted:true})
      identity={id:'refund-'+crypto.randomUUID(),time:context.now}
    }
    const result=await executeFinancial('refund',input,request=>dbRefund(request.refundOf,request,null,null,sessionRef.current),setFinancialState,identity)
    setOrders(prev=>[result.order,...prev.filter(o=>o.id!==result.order.id).map(o=>o.id===result.original.id?result.original:o)])
    setProducts(prev=>prev.map(p=>result.products.find(n=>n.id===p.id)||p))
    if(result.member)setMembers(prev=>prev.map(m=>m.id===result.member.id?result.member:m))
    fireWebhook('refund',payloadFromOrder(result.order,null)).catch(()=>{})
    return result.order
  }, [openShift,dataError])

  // The cart workspace owns acknowledgement and recovery of the original command.
  const holdCart=useCallback(label=>{ensureCartEditable();return cartWorkspaceRef.current.hold(label||'')},[])
  const recallHeld=useCallback(row=>{ensureCartEditable();return cartWorkspaceRef.current.recall(row)},[])
  const removeHeld=useCallback(id=>{ensureCartEditable();const row=heldOrders.find(row=>row.id===id);if(!row)throw Error('這張掛單已變更，請重新查看。');return cartWorkspaceRef.current.remove(row)},[heldOrders])

  // 班別
  const startShift = useCallback(async (cashier, openCash, cashierId='',draft=null) => {
    const data = {
      id: draft?.id||'S' + Date.now(),
      cashier, cashierId:draft?.draftContext?.userId||cashierId, openCash,
      openTime: draft?.time||new Date().toISOString(),
    }
    // 記住這次的零用金 → 明天開班自動帶入，不用每天重打
    try { browserStorage.setItem('pos_last_open_cash', String(openCash || 0)) } catch {}
    const input={...data,...(draft?{draftContext:draft.draftContext,draftBasis:draft.draftBasis}:{})},result=await apiOpenShift(input,sessionRef.current)
    if (result?.success!==true) throw Object.assign(new Error(result?.error||'開班保存失敗'),{shiftDraftRejected:!!draft&&isShiftCountRejection(result,'open',data.id,input)})
    const saved=result.shift||{...data,status:'open'};setOpenShiftState(saved.status==='open'?saved:null)
    if(!result.alreadySaved)fireWebhook('shift_open', payloadFromShift(saved, 'open')).catch(()=>{})
    return saved
  }, [])

  const endShift = useCallback(async (closeCash, note='',draft=null) => {
    if (!openShift) return null
    const input={closeCash,note,...(draft?{draftContext:draft.draftContext,draftBasis:draft.draftBasis}:{})},r=await apiCloseShift(openShift.id,input,sessionRef.current)
    if (r?.success!==true) throw Object.assign(new Error(r?.error||'交班保存失敗'),{shiftDraftRejected:!!draft&&isShiftCountRejection(r,'close',openShift.id,input)})
    if(!r.alreadySaved)fireWebhook('shift_close', payloadFromShift(openShift, 'close', { ...r, closeCash })).catch(()=>{})
    setOpenShiftState(null)
    return r
  }, [openShift])

  const logCash = useCallback(async (type, amount, reason, cashier='',draft=null) => {
    if(draft){const input={...draft.request,draftContext:draft.draftContext},result=await addCashLog(input,sessionRef.current);if(isCashMovementRejection(result,input))throw Object.assign(Error(result.error),{cashDraftRejected:true});acknowledge(result);return result.cashLog}
    const data = {
      shiftId: openShift?.id || '',
      type, amount, reason, cashier,
    }
    const result=await executeFinancial('cashlog',data,addCashLog,setFinancialState)
    return result.cashLog
  }, [openShift])
  const reloadOpenShift=useCallback(async()=>{const who=sessionRef.current,value=await getOpenShift();if(who?.userId===sessionRef.current?.userId&&who?.role===sessionRef.current?.role)setOpenShiftState(value||null);return value},[])

  // 損耗
  const recordWaste = useCallback(async (data) => {
    const result=await executeFinancial('waste',data,request=>addWaste(request,sessionRef.current),setFinancialState)
    if(result?.success!==true)throw new Error(result?.error||'損耗保存失敗')
    setWasteLog(p=>[result.waste,...p.filter(w=>w.id!==result.waste.id)])
    setProducts(prev=>prev.map(p=>p.id===result.product.id?result.product:p))
    return result.waste
  }, [])

  function applyWasteEntry(result){setWasteLog(prev=>[result.waste,...prev.filter(row=>row.id!==result.waste.id)]);setProducts(prev=>prev.map(row=>row.id===result.product.id?result.product:row));return result}
  async function saveWasteEntry(request){
    if(dataError)throw Error(dataError)
    const {id,time,...input}=request
    return applyWasteEntry(await executeFinancial('waste',input,value=>addWaste(value,sessionRef.current),setFinancialState,{id,time}))
  }
  async function confirmWasteEntry(request){
    const {id,time,...input}=request,pending=readPendingFinancial()
    if(!pending)return readWasteEntryOriginal(request,sessionRef.current)
    if(pending.kind!=='waste'||pending.request.id!==id)throw Error('請先核對上一筆異動')
    return applyWasteEntry(await executeFinancial('waste',input,value=>readWasteEntryOriginal(value,sessionRef.current),setFinancialState,{id,time}))
  }

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

  function applyMemberTopup(result){setMembers(prev=>prev.map(m=>m.id===result.member.id?result.member:m));setTopups(prev=>[result.topup,...prev.filter(t=>t.id!==result.topup.id)]);return result}
  async function saveMemberTopupDraft(request){
    if(dataError)throw Error(dataError)
    const {id,time,...input}=request
    return applyMemberTopup(await executeFinancial('topup',input,value=>addTopup(value,sessionRef.current),setFinancialState,{id,time}))
  }
  async function confirmMemberTopupDraft(request){
    const {id,time,...input}=request,pending=readPendingFinancial()
    if(!pending)return readMemberTopupOriginal(request,sessionRef.current)
    if(pending.kind!=='topup'||pending.request.id!==id)throw Error('請先核對上一筆異動')
    return applyMemberTopup(await executeFinancial('topup',input,value=>readMemberTopupOriginal(value,sessionRef.current),setFinancialState,{id,time}))
  }

  function applyInventoryResult(result){
    result=finalizePurchaseDraft(finalizeReceiptLotDraft(result,sessionRef.current),sessionRef.current)
    if(result.supplierLedger){const current=supplierRef.current;const next={...current,supplierLedger:result.supplierLedger,legacyReadOnly:true,purchases:result.purchase?[result.purchase,...(current?.purchases||[]).filter(po=>po.id!==result.purchase.id)]:current?.purchases||[]};supplierRef.current=next;setSupplierState(next)}
    setProducts(previous=>[...previous.map(p=>result.products.find(n=>n.id===p.id)||p),...result.products.filter(p=>!previous.some(old=>old.id===p.id))])
    if(result.purchase)setPurchases(previous=>[result.purchase,...previous.filter(p=>p.id!==result.purchase.id)])
    if(result.cashLog)window.dispatchEvent(new Event('pos-cash-operation'))
    window.dispatchEvent(new CustomEvent('pos-inventory-operation',{detail:result}))
    return result
  }
  async function commitInventory(kind,input,identity=null,prepare=null){
    if(dataError)throw Error(dataError)
    const state=isPurchaseCreate(kind)&&identity?await refreshSuppliers():supplierRef.current,original=['receive','receive-lots','receive-reviewed'].includes(kind)?purchases.find(po=>po.id===input.purchaseId):null
    const controlled=kind!=='stocktake'&&!(['receive','receive-lots','receive-reviewed'].includes(kind)&&!original?.procurement&&!state?.legacyReadOnly)
    if(controlled&&!state)throw Error('請先載入供應商與採購資料，再保存原草稿')
    const command=supplierInventoryCommand(kind,input,identity,state,{controlled})
    const result=await executeFinancial(kind,command.input,request=>applyInventoryOperation(request,session),setFinancialState,command.identity,null,prepare)
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
  async function commitRestaurant(input,identity=null,prepare=null){
    if(dataError)throw Error(dataError)
    if(checkoutRef.current.getState().phase!=='idle')throw Error('請先確認原收款交易')
    const pending=readPendingFinancial(),state=!pending&&input.action!=='configure'?await loadRestaurantState():null,command=prepareRestaurantCommand(input,{state,pending,identity})
    const result=await executeFinancial('restaurant',command.input,request=>applyRestaurantOperation(request,session),setFinancialState,command.identity,null,prepare)
    await applyRestaurantResult(result)
    return result
  }
  async function commitReservation(input,identity=null,prepare=null){
    if(dataError)throw Error(dataError)
    if(checkoutRef.current.getState().phase!=='idle')throw Error('請先確認原收款交易')
    const result=await executeFinancial('reservation',input,request=>applyReservationOperation(request,sessionRef.current),setFinancialState,identity,null,prepare)
    if(result.dining)await applyRestaurantResult(result.dining)
    setReservationEntries(result.state.entries);window.dispatchEvent(new CustomEvent('pos-reservation-operation',{detail:result}));return result
  }
  async function retryFinancial(){
    const pending=readPendingFinancial();if(!pending)return
    const ports={restaurant:r=>applyRestaurantOperation(r,session),refund:r=>dbRefund(r.refundOf,r,null,null,sessionRef.current),topup:r=>addTopup(r,sessionRef.current),waste:r=>addWaste(r,sessionRef.current),cashlog:addCashLog,stocktake:r=>applyInventoryOperation(r,session),receive:r=>applyInventoryOperation(r,session),'receive-lots':r=>applyInventoryOperation(r,session),'receive-reviewed':r=>applyInventoryOperation(r,session)}
    ports.reservation=r=>applyReservationOperation(r,sessionRef.current)
    ports.exchange=r=>applyExchangeOperation(r,session)
    ports['stock-cost']=r=>applyStockSetupOperation(r,sessionRef.current)
    ports.lots=r=>applyLotOperation(r,sessionRef.current)
    ports.warehouse=r=>applyWarehouseOperation(r,sessionRef.current)
    ports.sales=r=>applySalesOperation(r,session)
    ports['customer-ledger']=r=>applyCustomerLedgerOperation(r,session)
    ports['supplier-ledger']=r=>applySupplierLedgerOperation(r,session)
    for(const kind of PROCUREMENT_KINDS)ports[kind]=r=>applyInventoryOperation(r,session)
    const result=await executeFinancial(pending.kind,JSON.parse(pending.signature).input,ports[pending.kind],setFinancialState,null,async original=>(await getRecoveryState(original,session)).active==='matched')
    if(pending.kind==='topup'){setMembers(p=>p.map(m=>m.id===result.member.id?result.member:m));setTopups(p=>[result.topup,...p.filter(t=>t.id!==result.topup.id)])}
    if(pending.kind==='refund'){setOrders(p=>[result.order,...p.filter(o=>o.id!==result.order.id).map(o=>o.id===result.original.id?result.original:o)]);setProducts(p=>p.map(i=>result.products.find(n=>n.id===i.id)||i));if(result.member)setMembers(p=>p.map(m=>m.id===result.member.id?result.member:m))}
    if(pending.kind==='waste'){setWasteLog(p=>[result.waste,...p.filter(w=>w.id!==result.waste.id)]);setProducts(p=>p.map(i=>i.id===result.product.id?result.product:i))}
    if(['stocktake','receive','receive-lots','receive-reviewed',...PROCUREMENT_KINDS].includes(pending.kind))applyInventoryResult(result)
    if(pending.kind==='cashlog')window.dispatchEvent(new Event('pos-cash-operation'))
    if(pending.kind==='restaurant')await applyRestaurantResult(result)
    if(pending.kind==='reservation'){setReservationEntries(result.state.entries);if(result.dining)await applyRestaurantResult(result.dining);window.dispatchEvent(new CustomEvent('pos-reservation-operation',{detail:result}))}
    if(pending.kind==='exchange')window.dispatchEvent(new CustomEvent('pos-exchange-operation',{detail:result}))
    if(pending.kind==='sales')applySalesResult(result)
    if(pending.kind==='customer-ledger')applyCustomerLedgerResult(result)
    if(pending.kind==='supplier-ledger')applySupplierResult(result)
    if(['warehouse','lots'].includes(pending.kind))await reloadFromDB()
    return result
  }
  async function commitStockSetup(input){
    if(dataError)throw Error(dataError)
    const state=await loadStockSetupState(sessionRef.current)
    if(state.context.storeId!==input.storeId||state.context.epoch!==input.epoch||state.context.reviewId!==input.review.sourceDigest)throw Object.assign(Error('庫存或成本已更新，請保留輸入重新核對'),{notCommitted:true})
    const identity={id:'stock-cost-'+crypto.randomUUID(),time:state.context.now}
    const result=await executeFinancial('stock-cost',input,request=>applyStockSetupOperation(request,sessionRef.current),setFinancialState,identity)
    window.dispatchEvent(new CustomEvent('pos-stock-cost-changed',{detail:{id:result.receipt.id}}))
    return result
  }
  async function commitLot(input){
    if(dataError)throw Error(dataError)
    if(checkoutRef.current.getState().phase!=='idle')throw Error('請先確認原收款交易')
    const state=await loadLotState(sessionRef.current)
    if(state.context.storeId!==input.storeId||state.context.epoch!==input.epoch||state.context.stateDigest!==input.expectedStateDigest)throw Object.assign(Error('批次或庫存已更新，請重新看結果'),{notCommitted:true})
    const result=await executeFinancial('lots',input,request=>applyLotOperation(request,sessionRef.current),setFinancialState,{id:'lots-'+crypto.randomUUID(),time:state.context.now})
    await reloadFromDB();window.dispatchEvent(new Event('pos-data-refreshed'));return result
  }
  async function commitWarehouse(input){
    if(dataError)throw Error(dataError)
    if(checkoutRef.current.getState().phase!=='idle')throw Error('請先確認原收款交易')
    const state=await loadWarehouseState(sessionRef.current)
    if(state.context.storeId!==input.storeId||state.context.epoch!==input.epoch||state.context.stateDigest!==input.expectedStateDigest)throw Object.assign(Error('庫存或存放地點已更新，請重新看結果'),{notCommitted:true})
    const result=await executeFinancial('warehouse',input,request=>applyWarehouseOperation(request,sessionRef.current),setFinancialState,{id:'warehouse-'+crypto.randomUUID(),time:state.context.now})
    await reloadFromDB();window.dispatchEvent(new Event('pos-data-refreshed'));return result
  }

  // 點數規則設定
  async function applyRestaurantResult(result){
    try{await reloadFromDB();window.dispatchEvent(new Event('pos-data-refreshed'))}catch(e){setDataError('異動已保存，但重新讀取資料失敗；請恢復連線並重新載入：'+e.message)}
    window.dispatchEvent(new CustomEvent('pos-restaurant-operation',{detail:result}))
    if(result.cashLog)window.dispatchEvent(new Event('pos-cash-operation'))
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
  const refreshLoyaltyRules=useCallback(async value=>{const rules=loyaltyRules(value);setPointsRule({earn:rules.earn,redeem:rules.redeem});setBirthdayBonus(rules.birthdayBonus)},[])
  const openLoyaltySettings=useCallback(()=>{if(sessionRef.current?.role!=='owner')return;setSettingsTarget({tab:'business'});setView('settings')},[])

  const acknowledge=result=>{if(result?.success===false)throw Error(result.error||'資料保存失敗');return result}
  const addProduct = useCallback(async p=>{
    // id 加亂數後綴：到貨自動建檔會在迴圈連續建多筆，純 Date.now() 同毫秒會撞號互蓋
    const n={...p,id:p._creationId||'p'+crypto.randomUUID()};delete n._creationId;delete n._expectedStock;delete n._expectedPricing
    const result=acknowledge(await dbAddProduct(n,sessionRef.current)),{draftContext,...localProduct}=n,saved=result?.product||localProduct
    setProducts(x=>[...x.filter(p=>p.id!==saved.id),saved])
    return saved
  },[])
  const updateProduct = useCallback(async(id,u)=>{
    const input={...u},clean={...u};for(const key of ['_expectedStock','_expectedPricing','_creationId','_productEdit','draftContext'])delete clean[key]
    if(!isProductEdit(input)&&Object.hasOwn(input,'stock')&&!Object.hasOwn(input,'_expectedStock'))input._expectedStock=products.find(p=>p.id===id)?.stock
    const result=await dbUpdateProduct(id,input,sessionRef.current);if(isProductEditRejection(result,id,input))throw Object.assign(Error(result.error),{editDraftRejected:true});acknowledge(result)
    setProducts(p=>p.map(x=>x.id===id?result.product||{...x,...clean}:x));return result
  },[products])
  const reloadProducts=useCallback(async()=>{const who=sessionRef.current,rows=await loadProducts([]);if(who?.userId===sessionRef.current?.userId&&who?.role===sessionRef.current?.role)setProducts(rows);return rows},[])
  const deleteProduct = useCallback(async id=>{
    acknowledge(await dbDeleteProduct(id,sessionRef.current))
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
      const s=await window.electronAPI.db.getStoreSnapshot();const reservations=session?.role==='owner'?reservationDepositReportEntries(await getReservationState(session)):[]
      setProducts(s.products);setMembers(s.members);setOrders(s.orders);setManualEntries(s.manualEntries);setHeldOrders(s.heldOrders);setWasteLog(s.wasteLog);setTopups(s.topups);setOpenShiftState(s.openShift);setPurchases(s.purchases||[])
      setRestaurantConfig(s.restaurantConfig||defaultRestaurantConfig())
      setRestaurantEntries(s.restaurantEntries||[]);setReservationEntries(reservations)
      setSales(s.sales||{documents:[]})
      salesRef.current=s.sales||{documents:[]};supplierRef.current=s.supplierState||null;setSupplierState(s.supplierState||null)
      setPointsRule({earn:s.rules.earn==null?10:Number(s.rules.earn),redeem:s.rules.redeem==null?1:Number(s.rules.redeem)});setBirthdayBonus(s.rules.birthdayBonus==null?100:Number(s.rules.birthdayBonus));return
    }
    const [p,m,o,j,restaurant,waste,tps,shift,held,po,salesState,suppliers,reservations] = await Promise.all([
      loadProducts([]),
      loadMembers([]),
      loadOrders([]),
      loadManualJournal([]),
      loadRestaurantState(),loadWasteLog(),loadTopups(),getOpenShift(),loadHeldOrders(),
      session?.role==='owner'?loadPurchases([]):Promise.resolve([]),
      session?.role==='owner'?loadSalesState(session):Promise.resolve({documents:[]}),
      session?.role==='owner'?loadSupplierState(session):Promise.resolve(null),
      session?.role==='owner'?getReservationState(session).then(reservationDepositReportEntries):Promise.resolve([]),
    ])
    setProducts(p)
    setMembers(m)
    setOrders(o)
    setManualEntries(j)
    setPurchases(po);salesRef.current=salesState;setSales(salesState);supplierRef.current=suppliers;setSupplierState(suppliers)
    setWasteLog(waste);setTopups(tps);setOpenShiftState(shift||null);setHeldOrders(held);setRestaurantConfig(restaurant.config);setRestaurantEntries(restaurant.entries||[]);setReservationEntries(reservations)
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
    readinessTask,startReadinessTask,finishReadinessTask,
    settingsTarget,openHardwareSettings:()=>{setSettingsTarget({tab:'hardware'});setView('settings')},consumeSettingsTarget:()=>setSettingsTarget(null),
    stockSetupEnabled,commitStockSetup,commitWarehouse,commitLot,
    supplierState,supplierTarget,openSupplierLedger:(supplierId='',purchaseId='')=>{setSupplierTarget({supplierId,purchaseId});setView('suppliers')},consumeSupplierTarget:()=>setSupplierTarget(null),purchaseTarget,openPurchaseSuppliers:()=>{setPurchaseTarget({tab:'suppliers'});setView('purchase')},openPurchaseDocument:id=>{setPurchaseTarget({id});setView('purchase')},consumePurchaseTarget:()=>setPurchaseTarget(null),commitSupplierLedger,refreshSuppliers,
    restaurantTarget,openRestaurantEntry:(id,bookingId='')=>{setRestaurantTarget({id,bookingId});setView('restaurant')},consumeRestaurantTarget:()=>setRestaurantTarget(null),reservationTarget,openReservationBooking:id=>{setReservationTarget({id});setView('reservations')},consumeReservationTarget:()=>setReservationTarget(null),
    products,members,orders,purchases,sales,salesQuote,openSalesQuote:quote=>{setSalesQuote({id:quote.id,revision:quote.revision});setView('sales')},consumeSalesQuote:()=>setSalesQuote(null),cart,view,setView,ready:ready&&cartWorkspace.settled,cartWorkspace,dataError,checkoutState,reconcileCheckout,retryCheckout,financialState,retryFinancial,commitReservation,commitInventory,commitRestaurant,commitExchange,commitSales,commitCustomerLedger,refreshTrading,customerTarget,openCustomerLedger:id=>{setCustomerTarget(id);setView("customers")},consumeCustomerTarget:()=>setCustomerTarget(""),salesTarget,openSalesDocument:id=>{setSalesTarget(id);setView("sales")},consumeSalesTarget:()=>setSalesTarget(""),restaurantConfig,
    activeMember,setActiveMember:value=>{ensureCartEditable();setActiveMember(value)},
    addToCart,removeFromCart,updateCartQty,updateCartItemPrice,clearCart,stageQuickSale,
    cartSubtotal,cartCount,checkout,refund,
    addProduct,updateProduct,deleteProduct,findByBarcode,reloadProducts,
    addMember,updateMember,deleteMember,findMember,
    categories,todayOrders,todayRevenue,lowStockCount,todayProfit,todaySales,todayBusinessCount:todayOrders.length+todaySales.deliveries,
    allJournal,autoJournal,manualEntries,reservationEntries,restaurantEntries,
    addManualEntry,deleteManualEntry,
    confirmSupplierRefund:async(input,proof,metadata)=>{
      const result=verifySupplierRefundProof(input,proof);if(!metadata?.isCurrent())return
      const pending=readPendingFinancial();if(pending?.request.id===input.id){if(pending.kind!==proof.request.kind||privateDraftDigest(pending.request)!==input.digest)throw Error('退款原紀錄需要核對，請保留輸入，勿重複記帳。');const {id,time,...body}=proof.request;await executeFinancial(proof.request.kind,body,async()=>result,setFinancialState,{id,time})}
      if(!metadata?.isCurrent())return;return applyInventoryResult(result)
    },
    confirmPurchaseInvoice:async(input,proof,metadata)=>{
      const result=verifyPurchaseInvoiceProof(input,proof);if(!metadata?.isCurrent())return
      const pending=readPendingFinancial();if(pending?.request.id===input.id){if(pending.kind!=='purchase-bill'||privateDraftDigest(pending.request)!==input.digest)throw Error('請款原紀錄需要核對，請保留輸入，勿重複建單。');const {id,time,...body}=proof.request;await executeFinancial('purchase-bill',body,async()=>result,setFinancialState,{id,time})}
      if(!metadata?.isCurrent())return;return applyInventoryResult(result)
    },
    confirmPurchaseCorrection:async(input,proof,metadata)=>{
      const result=verifyPurchaseCorrectionProof(input,proof);if(!metadata?.isCurrent())return
      const pending=readPendingFinancial();if(pending?.request.id===input.id){if(pending.kind!==proof.request.kind||privateDraftDigest(pending.request)!==input.digest)throw Error('更正原紀錄需要核對，請保留原因，勿重複操作。');const {id,time,...body}=proof.request;await executeFinancial(proof.request.kind,body,async()=>result,setFinancialState,{id,time})}
      if(!metadata?.isCurrent())return;return applyInventoryResult(result)
    },
    confirmOrdinaryReturn:async(input,proof,metadata)=>{
      const result=verifyOrdinaryReturnProof(input,proof);if(!metadata?.isCurrent())return
      const pending=readPendingFinancial();if(pending?.request.id===input.id){if(pending.kind!=='purchase-return'||privateDraftDigest(pending.request)!==input.digest)throw Error('退貨原紀錄需要核對，請保留輸入，勿重複退貨。');const {id,time,...body}=proof.request;await executeFinancial('purchase-return',body,async()=>result,setFinancialState,{id,time})}
      if(!metadata?.isCurrent())return;return applyInventoryResult(result)
    },
    confirmPurchasePayment:async(input,proof,metadata)=>{
      const result=verifyPurchasePaymentProof(input,proof);if(!metadata?.isCurrent())return
      const pending=readPendingFinancial();if(pending?.request.id===input.id){if(pending.kind!=='purchase-pay'||privateDraftDigest(pending.request)!==input.digest)throw Error('付款原紀錄需要核對，請保留輸入，勿重複付款。');const {id,time,...body}=proof.request;await executeFinancial('purchase-pay',body,async()=>result,setFinancialState,{id,time})}
      if(!metadata?.isCurrent())return;return applyInventoryResult(result)
    },
    saveExpenseEntry:input=>persistExpenseEntry(input,sessionRef.current),
    confirmExpenseEntry:(input,proof,metadata)=>{
      const linked=[DRAWER_EXPENSE,DRAWER_RETURN].includes(input.protocol),result=(linked?verifyDrawerProof:verifyExpenseProof)(input,proof);if(!metadata?.isCurrent())return
      const entries=linked?result.entries:result.removed?[]:[result.entry],ids=new Set([input.id,...entries.map(row=>row.id)])
      setManualEntries(previous=>[...entries,...previous.filter(row=>!ids.has(row.id))])
      if(linked){window.dispatchEvent(new Event('pos-cash-operation'));window.dispatchEvent(new Event('pos-expense-drawer-changed'))}return result.entry
    },
    reloadFromDB,reloadAfterRecovery,
    // v2.1
    heldOrders, holdCart, recallHeld, removeHeld,
    wasteLog, recordWaste, removeWaste,saveWasteEntry,confirmWasteEntry,
    openShift, startShift, endShift, logCash,reloadOpenShift,
    topupMember,saveMemberTopupDraft,confirmMemberTopupDraft,
    pointsRule, updatePointsRule,
    birthdayBonus, updateBirthdayBonus,
    updateBusinessSettings,
    refreshLoyaltyRules,
    openLoyaltySettings,
    manualDiscount, setManualDiscount:value=>{ensureCartEditable();setManualDiscount(value)},
  }
}
