import {tr,trMessage} from "./i18n"
import { browserStorage } from './utils/browserStorage'
import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Menu, X } from 'lucide-react'
import { useStore } from './store/useStore'
import { getSession, destroySession, writeAuditLog, startIdleTimer, hasPermission, createBackup, getBackupList } from './utils/security'
import LoginScreen from './pages/LoginScreen'
import Sidebar from './components/Sidebar'
import DisplayPreferences from './components/DisplayPreferences'
import PendingTransactionNotice from './components/PendingTransactionNotice'
import ReadinessReturnBar from './components/ReadinessReturnBar'
import {readRecoveryCommand} from './utils/recoveryClient'
const POSPage=lazy(()=>import('./pages/POSPage'))
const InventoryPage=lazy(()=>import('./pages/InventoryPage'))
const MembersPage=lazy(()=>import('./pages/MembersPage'))
const RefundPage=lazy(()=>import('./pages/RefundPage'))
const StockSetupPage=lazy(()=>import('./pages/StockSetupPage'))
const LotPage=lazy(()=>import('./pages/LotPage'))
const WarehousePage=lazy(()=>import('./pages/WarehousePage'))
const StockHistoryPage=lazy(()=>import('./pages/StockHistoryPage'))
const ReportsPage=lazy(()=>import('./pages/ReportsPage'))
const AccountingPage=lazy(()=>import('./pages/AccountingPage'))
const PurchasePage=lazy(()=>import('./pages/PurchasePage'))
const StocktakePage=lazy(()=>import('./pages/StocktakeRouter'))
import {readPendingFinancial} from './utils/financialCommand'
const PromotionsPage=lazy(()=>import('./pages/PromotionsPage'))
const SettingsPage=lazy(()=>import('./pages/SettingsPage'))
const ScenarioTemplatesPage=lazy(()=>import('./pages/ScenarioTemplatesPage'))
const ReadinessPage=lazy(()=>import('./pages/ReadinessPage'))
const SharedDevicesPage=lazy(()=>import('./pages/SharedDevicesPage'))
const ReservationsPage=lazy(()=>import('./pages/ReservationsPage'))
const RestaurantPage=lazy(()=>import('./pages/RestaurantPage'))
const QuickDocumentPage=lazy(()=>import('./pages/QuickDocumentPage'))
const BusinessExchangePage=lazy(()=>import('./pages/BusinessExchangePage'))
const SalesPage=lazy(()=>import('./pages/SalesPage'))
const CustomerLedgerPage=lazy(()=>import('./pages/CustomerLedgerPage'))
const SupplierLedgerPage=lazy(()=>import('./pages/SupplierLedgerPage'))
const RecoveryPage=lazy(()=>import('./pages/RecoveryPage'))
const OrdersPage=lazy(()=>import('./pages/OrdersPage'))
const DashboardPage=lazy(()=>import('./pages/DashboardPage'))
import SimpleHomePage from './pages/SimpleHomePage'
import './styles/easy-workspace.css'
const ShiftPage=lazy(()=>import('./pages/ShiftPage'))
const WastePage=lazy(()=>import('./pages/WastePage'))
import { isElectron } from './utils/dataAccess'
import useIsMobile from './hooks/useIsMobile'
import {useDisplayPreferences} from './i18n'


export default function App() {
  const {locale}=useDisplayPreferences()
  useEffect(()=>{document.title=tr('POS Pro｜ERP・點餐・CRM')},[locale])
  const [session, setSession] = useState(() => isElectron ? null : getSession())
  const [incomingDraft,setIncomingDraft]=useState('')
  const consumeIncoming=useCallback(raw=>setIncomingDraft(current=>current===raw?'':current),[])
  const [largeText,setLargeText]=useState(()=>{try{return localStorage.getItem('pos_large_text_v1')==='true'}catch{return false}})
  const [simpleMode,setSimpleMode]=useState(()=>{try{return localStorage.getItem('pos_simple_mode_v1')!=='false'}catch{return true}})
  const [workspaceArea,setWorkspaceArea]=useState('all')
  const [recoveryPending,setRecoveryPending]=useState(false)
  useEffect(()=>{
    const refresh=()=>{try{setRecoveryPending(!!readRecoveryCommand('restore')||!!readRecoveryCommand('recover'))}catch{setRecoveryPending(true)}}
    refresh();window.addEventListener('pos-recovery-pending-changed',refresh);window.addEventListener('storage',refresh)
    return()=>{window.removeEventListener('pos-recovery-pending-changed',refresh);window.removeEventListener('storage',refresh)}
  },[])
  useEffect(()=>{setWorkspaceArea('all')},[session?.userId,session?.role])
  const store = useStore(session)
  const { view, setView, lowStockCount, todayRevenue, todayOrders } = store
  useEffect(()=>{if(store.financialState.kind==='lots'&&store.financialState.phase==='uncertain')setView(current=>{if(current==='recovery')return current;try{return readPendingFinancial()?.request.action==='count'?'stocktake':'lots'}catch{return'lots'}})},[store.financialState.kind,store.financialState.phase,setView])
  useEffect(()=>{if(store.financialState.kind==='warehouse'&&store.financialState.phase==='uncertain')setView(current=>current==='recovery'?current:'warehouse')},[store.financialState.kind,store.financialState.phase,setView])
  useEffect(()=>{if(session?.role==='owner'&&store.financialState.kind==='stock-cost'&&store.financialState.phase==='uncertain')setView(current=>current==='recovery'?current:'stocksetup')},[session?.userId,store.financialState.kind,store.financialState.phase,setView])
  useEffect(()=>{if(session?.role==='owner'&&store.financialState.kind==='refund'&&store.financialState.phase==='uncertain')setView(current=>current==='recovery'?current:'refunds')},[session?.userId,store.financialState.kind,store.financialState.phase,setView])
  useEffect(()=>{if(session?.role==='owner'&&store.financialState.kind==='exchange'&&store.financialState.phase==='uncertain')setView(current=>current==='recovery'?current:'exchange')},[session?.userId,store.financialState.kind,store.financialState.phase,setView])
  useEffect(()=>{if(session?.role==='owner'&&store.financialState.kind==='sales'&&store.financialState.phase==='uncertain')setView(current=>current==='recovery'?current:'sales')},[session?.userId,store.financialState.kind,store.financialState.phase,setView])
  useEffect(()=>{if(session?.role==='owner'&&store.financialState.kind==='customer-ledger'&&store.financialState.phase==='uncertain')setView(current=>current==='recovery'?current:'customers')},[session?.userId,store.financialState.kind,store.financialState.phase,setView])
  useEffect(()=>{if(session?.role==='owner'&&store.financialState.kind==='supplier-ledger'&&store.financialState.phase==='uncertain')setView(current=>current==='recovery'?current:'suppliers')},[session?.userId,store.financialState.kind,store.financialState.phase,setView])
  useEffect(()=>{if(session&&store.financialState.kind==='stocktake'&&store.financialState.phase==='uncertain')setView(current=>current==='recovery'?current:'stocktake')},[session?.userId,store.financialState.kind,store.financialState.phase,store.financialState.id,setView])
  useEffect(()=>{if(session&&store.financialState.kind==='reservation'&&store.financialState.phase==='uncertain')try{if(['deposit-policy','deposit-receive','deposit-refund'].includes(readPendingFinancial()?.request.action))setView(current=>current==='recovery'?current:'reservations')}catch{}},[session?.userId,store.financialState.kind,store.financialState.phase,store.financialState.id,setView])
  useEffect(()=>{document.documentElement.dataset.largeText=String(largeText);try{localStorage.setItem('pos_large_text_v1',String(largeText))}catch{}},[largeText])
  useEffect(()=>{document.documentElement.dataset.simpleMode=String(simpleMode);try{localStorage.setItem('pos_simple_mode_v1',String(simpleMode))}catch{}},[simpleMode])
  useEffect(()=>{
    function read(){const params=new URLSearchParams(location.hash.slice(1)),raw=params.get('agentDraft');if(raw&&!params.has('pair')){history.replaceState(null,'',location.pathname+location.search);if(raw.length<=32768){setIncomingDraft(raw);setView('quick')}}}
    read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read)
  },[setView])
  useEffect(()=>{if(isElectron)window.electronAPI.auth.session().then(setSession).catch(()=>setSession(null))},[])
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingOrders, setPendingOrders] = useState(0)
  const [backupIssue,setBackupIssue]=useState('')
  const [sharedConnected,setSharedConnected]=useState(true)
  useEffect(()=>{const changed=e=>setSharedConnected(e.detail.connected);window.addEventListener('pos-shared-connection',changed);return()=>window.removeEventListener('pos-shared-connection',changed)},[])
  useEffect(()=>{const expired=()=>{destroySession();setSession(null)};window.addEventListener('pos-shared-auth-expired',expired);return()=>window.removeEventListener('pos-shared-auth-expired',expired)},[])
  const isMobile = useIsMobile()

  // 監聽顧客點餐通知
  useEffect(() => {
    if (!isElectron) return
    const unsub = window.electronAPI.onNewOrder(() => {
      setPendingOrders(c => c + 1)
    })
    return unsub
  }, [])

  const handleLogout = useCallback(async () => {
    writeAuditLog('LOGOUT', session, {})
    if(session?.role==='owner')try{await createBackup(session,'自動備份（登出）');setBackupIssue('')}catch(e){setBackupIssue(e.message)}
    if(isElectron)window.electronAPI.auth.logout().catch(()=>{})
    destroySession()
    setSession(null)
  }, [session])

  const handleLogin = useCallback(async (newSession) => {
    setSession(newSession)
    if(newSession.role!=='owner')return
    let backups
    try{backups=await getBackupList()}catch(e){setBackupIssue(e.message);return}
    const today = new Date().toDateString()
    const hasToday = backups.some(b => new Date(b.createdAt).toDateString() === today)
    if(!hasToday)try{await createBackup(newSession,'自動備份（'+today+'）');setBackupIssue('')}catch(e){setBackupIssue(e.message)}

    // Cloud replacement requires an explicit action in Settings; login never overwrites local sales.

  }, [])

  useEffect(() => {
    if (!session) return
    const cleanup = startIdleTimer(handleLogout)
    return cleanup
  }, [session, handleLogout])

  const handleNavChange = useCallback((v) => {
    setView(v)
    setMenuOpen(false)
  }, [setView])

  if (!session) return <LoginScreen onLogin={handleLogin}/>
  if (store.dataError&&view!=='recovery') return <div role="alert" style={{padding:30}}><h2>{tr("資料需要核對")}</h2><p>{trMessage(store.dataError)}</p><button onClick={()=>location.reload()}>{tr("重新載入")}</button>{session.role==='owner'&&<button className="btn btn-primary" data-recovery-open onClick={()=>setView('recovery')}>{tr('一步一步找回資料')}</button>}</div>
  if (!store.ready&&view!=='recovery') return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100dvh',background:'var(--bg-base)',color:'var(--text-secondary)',fontSize:14}}>{tr("載入中...")}</div>
  )
  const can = (perm) => hasPermission(session, perm)

  const NAV_LABELS = {
    recovery:'資料復原',dashboard:'首頁',overview:'營運總覽',quick:'快速建單', pos:'收銀台',reservations:'訂位與候位',restaurant:'預訂出餐', shifts:'班別交班', readiness:'營業前檢查',devices:'共用店面',
    inventory:'庫存管理', purchase:'進貨管理',suppliers:'供應商與預付款',exchange:'報價與價目表',sales:'銷售與應收',customers:'客戶與款項', waste:'損耗管理',
    stocktake:'每日盤點', stockhistory:'庫存去哪了', lots:'批次與效期', warehouse:'搬貨、存放地點', promotions:'促銷活動', members:'會員',
    reports:'報表分析', accounting:'會計帳務', orders:'顧客點餐', settings:'設定', scenarios:'情境模板',
  }

  return (
    <div style={{ display:'flex', height:'100dvh', background:'var(--bg-base)', overflow:'hidden' }}>
      {!isMobile && (
        <Sidebar stockSetupEnabled={store.stockSetupEnabled} view={view} setView={setView} session={session}
          lowStockCount={lowStockCount} todayRevenue={todayRevenue}
          todayOrders={todayOrders} todayBusinessCount={store.todayBusinessCount} onLogout={handleLogout}
          pendingOrders={pendingOrders} openShift={store.openShift} largeText={largeText} toggleLargeText={()=>setLargeText(v=>!v)} simpleMode={simpleMode} toggleSimpleMode={()=>setSimpleMode(v=>!v)}/>
      )}

      {isMobile && menuOpen && (
        <div style={mob.overlay} onClick={() => setMenuOpen(false)} />
      )}
      {isMobile && (
        <div style={{...mob.drawer, transform: menuOpen ? 'translateX(0)' : 'translateX(-100%)'}}>
          <Sidebar stockSetupEnabled={store.stockSetupEnabled} view={view} setView={handleNavChange} session={session}
            lowStockCount={lowStockCount} todayRevenue={todayRevenue}
            todayOrders={todayOrders} todayBusinessCount={store.todayBusinessCount} onLogout={handleLogout}
            pendingOrders={pendingOrders} openShift={store.openShift} largeText={largeText} toggleLargeText={()=>setLargeText(v=>!v)} simpleMode={simpleMode} toggleSimpleMode={()=>setSimpleMode(v=>!v)}/>
        </div>
      )}

      <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', minWidth:0 }}>
        {session.role==='owner'&&view!=='recovery'&&recoveryPending&&<div role="status" style={{padding:12,background:'var(--amber-dim)'}}><button className="btn btn-primary" data-recovery-open onClick={()=>handleNavChange('recovery')}>{tr('一步一步找回資料')}</button></div>}
        {!sharedConnected&&<div role="alert" style={{padding:12,background:'var(--red-dim)'}}>{tr("連不上店面電腦。請恢復店面 Wi-Fi；未確認的交易請沿用原單號核對。")}</div>}
        {view!=='recovery'&&<PendingTransactionNotice key={session.userId+':'+session.role} store={store} owner={session.role==='owner'} view={view} onRecovery={()=>handleNavChange('recovery')}/>}
        {backupIssue&&session.role==='owner'&&<div role="alert" style={{padding:10,background:'var(--amber-dim)'}}>{tr("自動備份未完成。")}<button onClick={()=>handleNavChange('readiness')}>{tr("查看與補做備份")}</button></div>}
        {isMobile && (
          <div className="workspace-mobile-bar" style={mob.topBar}>
            <button aria-label={menuOpen?tr("關閉功能選單"):tr("開啟功能選單")} onClick={() => setMenuOpen(v => !v)} style={mob.menuBtn}>
              {menuOpen ? <X size={20}/> : <Menu size={20}/>}
            </button>
            {view==='dashboard'?<div style={mob.topTitle}>{tr("首頁")}</div>:<button className="btn btn-ghost" style={{minHeight:48}} onClick={()=>handleNavChange('dashboard')}>{tr("回首頁")}</button>}
            {view!=='dashboard'&&<span style={{...mob.topTitle,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tr(NAV_LABELS[view]||'POS')}</span>}
            <DisplayPreferences toolbar/>
            <button className="btn btn-ghost" aria-label={tr("切換大字模式")} aria-pressed={largeText} onClick={()=>setLargeText(v=>!v)} style={{minHeight:48,minWidth:48,fontSize:16}}>{tr("大字")}</button>
          </div>
        )}
        {/* Quick entry locks its fields while retaining the same-document recovery action. */}
        <main className="workspace-content" data-view={view} inert={store.checkoutState.phase!=='idle'&&view!=='recovery'||store.financialState.phase!=='idle'&&!['quick','exchange','sales','customers','suppliers','stocktake','refunds','stocksetup','warehouse','recovery','lots'].includes(view)&&!(view==='reservations'&&store.financialState.kind==='reservation'&&store.financialState.phase==='uncertain')?'':undefined} style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <ReadinessReturnBar store={store} session={session} view={view}/>
          <Suspense fallback={<p role="status">{tr('正在載入…')}</p>}>
          {view==='recovery'&&session.role==='owner'&&<RecoveryPage store={store} session={session}/>}
          {view === 'dashboard' && can('pos.use') && (simpleMode?<SimpleHomePage store={store} session={session} area={workspaceArea} onAreaChange={setWorkspaceArea}/>:<DashboardPage store={store} session={session}/>)}
          {view === 'overview' && can('reports.view') && <DashboardPage store={store} session={session}/>}
          {view === 'quick' && can('pos.use') && <QuickDocumentPage key={session.userId+':'+session.role} store={store} session={session} incoming={incomingDraft} onIncomingConsumed={consumeIncoming}/>}
          {view === 'exchange' && can('purchase.edit') && <BusinessExchangePage key={session.userId+':'+session.role} store={store} session={session}/>}
          {view === 'customers' && session.role==='owner' && <CustomerLedgerPage store={store} session={session}/>}
          {view === 'suppliers' && session.role==='owner' && <SupplierLedgerPage key={session.userId} store={store} session={session}/>}
          {view === 'sales' && session.role==='owner' && <SalesPage key={session.userId+':'+session.role} store={store} session={session}/>}
          {view === 'pos'        && can('pos.use')         && <POSPage        store={store} session={session}/>}
          {view === 'reservations' && can('pos.use') && <ReservationsPage store={store} session={session}/>}
          {view === 'restaurant' && can('pos.use') && <RestaurantPage store={store} session={session}/>}
          {view === 'shifts'     && can('pos.use')         && <ShiftPage      store={store} session={session}/>}
          {view === 'inventory'  && can('inventory.view')  && <InventoryPage  store={store} session={session}/>}
          {view === 'lots' && can('inventory.view') && <LotPage key={session.userId+':'+session.role} store={store} session={session}/>}
          {view === 'warehouse' && can('inventory.view') && <WarehousePage key={session.userId+':'+session.role} store={store} session={session}/>}
          {view === 'waste'      && can('inventory.view')  && <WastePage      store={store} session={session}/>}
          {view === 'members'    && can('members.view')    && <MembersPage    store={store} session={session}/>}
          {view === 'refunds' && can('pos.refund') && <RefundPage key={session.userId+':'+session.role} store={store} session={session}/>}
          {view === 'reports'    && can('reports.view')    && <ReportsPage store={store} session={session}/>}
          {view === 'accounting' && can('accounting.view') && <AccountingPage store={store} session={session}/>}
          {view === 'purchase'   && can('purchase.view')   && <PurchasePage   store={store} session={session}/>}
          {view === 'stocktake'  && can('stocktake.view')  && <StocktakePage  store={store} session={session}/>}
          {view === 'stocksetup' && can('inventory.cost') && (store.stockSetupEnabled||store.financialState.kind==='stock-cost') && <StockSetupPage key={session.userId+':'+session.role} store={store} session={session}/>}
          {view === 'stockhistory' && can('inventory.cost') && <StockHistoryPage key={session.userId+':'+session.role} store={store} session={session}/>}
          {view === 'promotions' && can('promotions.view') && <PromotionsPage store={store} session={session}/>}
          {view === 'orders'     && can('pos.use')         && <OrdersPage store={store} session={session}/>}
          {view === 'settings'   && can('settings.view')   && <SettingsPage   session={session} onLogout={handleLogout} store={store}/>}
          {view === 'scenarios'  && can('settings.edit')   && <ScenarioTemplatesPage session={session} store={store}/>}
          {view === 'readiness' && can('pos.use') && <ReadinessPage store={store} session={session} backupIssue={backupIssue} onBackupVerified={()=>setBackupIssue('')}/>}
          {view === 'devices' && can('settings.edit') && <SharedDevicesPage/>}
          </Suspense>
        </main>
      </div>


    </div>
  )
}

const mob = {
  overlay: {
    position:'fixed', inset:0, zIndex:998,
    background:'rgba(23,37,60,0.30)', backdropFilter:'blur(2px)',
  },
  drawer: {
    position:'fixed', top:0, left:0, bottom:0,
    width:260, zIndex:999,
    transition:'transform 0.3s cubic-bezier(0.16,1,0.3,1)',
  },
  topBar: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'10px 14px', background:'var(--bg-raised)',
    borderBottom:'1px solid var(--border-dim)',
    boxShadow:'var(--shadow-sm)', flexShrink:0,
  },
  menuBtn: {
    width:48, height:48, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
    borderRadius:'var(--r2)', color:'var(--text-primary)',
  },
  topTitle: { fontSize:15, fontWeight:600, color:'var(--text-primary)' },
}
