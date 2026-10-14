import { browserStorage } from './utils/browserStorage'
import { useState, useEffect, useCallback } from 'react'
import { Menu, X, Cloud } from 'lucide-react'
import { useStore } from './store/useStore'
import { getSession, destroySession, writeAuditLog, startIdleTimer, hasPermission, createBackup, getBackupList } from './utils/security'
import LoginScreen from './pages/LoginScreen'
import Sidebar from './components/Sidebar'
import POSPage from './pages/POSPage'
import InventoryPage from './pages/InventoryPage'
import MembersPage from './pages/MembersPage'
import ReportsPage from './pages/ReportsPage'
import AccountingPage from './pages/AccountingPage'
import PurchasePage from './pages/PurchasePage'
import StocktakePage from './pages/StocktakePage'
import PromotionsPage from './pages/PromotionsPage'
import SettingsPage from './pages/SettingsPage'
import ScenarioTemplatesPage from './pages/ScenarioTemplatesPage'
import ReadinessPage from './pages/ReadinessPage'
import SharedDevicesPage from './pages/SharedDevicesPage'
import RestaurantPage from './pages/RestaurantPage'
import OrdersPage from './pages/OrdersPage'
import DashboardPage from './pages/DashboardPage'
import ShiftPage from './pages/ShiftPage'
import WastePage from './pages/WastePage'
import { isElectron } from './utils/dataAccess'
import useIsMobile from './hooks/useIsMobile'


export default function App() {
  const [session, setSession] = useState(() => isElectron ? null : getSession())
  const store = useStore(session)
  const { view, setView, lowStockCount, todayRevenue, todayOrders } = store
  useEffect(()=>{if(isElectron)window.electronAPI.auth.session().then(setSession).catch(()=>setSession(null))},[])
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingOrders, setPendingOrders] = useState(0)
  const [autoSync, setAutoSync] = useState(null) // 'syncing' | 'done' | 'failed' | null
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
  if (store.dataError) return <div role="alert" style={{padding:30}}><h2>資料需要核對</h2><p>{store.dataError}</p><button onClick={()=>location.reload()}>重新載入</button></div>
  if (!store.ready) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100dvh',background:'var(--bg-base)',color:'var(--text-secondary)',fontSize:14}}>
      載入中...
    </div>
  )
  const can = (perm) => hasPermission(session, perm)

  const NAV_LABELS = {
    dashboard:'首頁', pos:'收銀台',restaurant:'預訂出餐', shifts:'班別交班', readiness:'營業前檢查',devices:'共用店面',
    inventory:'庫存管理', purchase:'進貨管理', waste:'損耗管理',
    stocktake:'每日盤點', promotions:'促銷活動', members:'會員',
    reports:'報表分析', accounting:'會計帳務', orders:'顧客點餐', settings:'設定', scenarios:'情境模板',
  }

  return (
    <div style={{ display:'flex', height:'100dvh', background:'var(--bg-base)', overflow:'hidden' }}>
      {!isMobile && (
        <Sidebar view={view} setView={setView} session={session}
          lowStockCount={lowStockCount} todayRevenue={todayRevenue}
          todayOrders={todayOrders} onLogout={handleLogout}
          pendingOrders={pendingOrders} openShift={store.openShift}/>
      )}

      {isMobile && menuOpen && (
        <div style={mob.overlay} onClick={() => setMenuOpen(false)} />
      )}
      {isMobile && (
        <div style={{...mob.drawer, transform: menuOpen ? 'translateX(0)' : 'translateX(-100%)'}}>
          <Sidebar view={view} setView={handleNavChange} session={session}
            lowStockCount={lowStockCount} todayRevenue={todayRevenue}
            todayOrders={todayOrders} onLogout={handleLogout}
            pendingOrders={pendingOrders} openShift={store.openShift}/>
        </div>
      )}

      <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', minWidth:0 }}>
        {!sharedConnected&&<div role="alert" style={{padding:12,background:'var(--red-dim)'}}>連不上店面電腦。請恢復店面 Wi-Fi；未確認的交易請沿用原單號核對。</div>}
        {store.financialState.phase!=='idle'&&<div role="alert" style={{padding:12,background:'var(--gold-dim)'}}>{store.financialState.message} {store.financialState.id} {store.financialState.phase==='uncertain'&&<button onClick={()=>store.retryFinancial().catch(e=>alert(e.message))}>原編號重試保存異動</button>}</div>}
        {backupIssue&&session.role==='owner'&&<div role="alert" style={{padding:10,background:'var(--amber-dim)'}}>自動備份未完成。<button onClick={()=>handleNavChange('readiness')}>查看與補做備份</button></div>}
        {store.checkoutState.phase !== 'idle' && <div role="alert" style={{padding:12,background:'var(--gold-dim)'}}>
          {store.checkoutState.message} {store.checkoutState.orderId}
          {store.checkoutState.phase === 'uncertain' && <><button onClick={()=>store.reconcileCheckout().catch(e=>alert(e.message))}>查詢原交易</button><button onClick={()=>store.retryCheckout().catch(e=>alert(e.message))}>原單號重試保存</button></>}
        </div>}
        {isMobile && (
          <div style={mob.topBar}>
            <button aria-label={menuOpen?'關閉功能選單':'開啟功能選單'} onClick={() => setMenuOpen(v => !v)} style={mob.menuBtn}>
              {menuOpen ? <X size={20}/> : <Menu size={20}/>}
            </button>
            <div style={mob.topTitle}>{NAV_LABELS[view] || 'POS'}</div>
            <div style={{ width: 36 }}/>
          </div>
        )}
        <main inert={store.checkoutState.phase!=='idle'||store.financialState.phase!=='idle'?'':undefined} style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          {view === 'dashboard'  && can('pos.use')         && <DashboardPage  store={store} session={session}/>}
          {view === 'pos'        && can('pos.use')         && <POSPage        store={store} session={session}/>}
          {view === 'restaurant' && can('pos.use') && <RestaurantPage store={store} session={session}/>}
          {view === 'shifts'     && can('pos.use')         && <ShiftPage      store={store} session={session}/>}
          {view === 'inventory'  && can('inventory.view')  && <InventoryPage  store={store} session={session}/>}
          {view === 'waste'      && can('inventory.view')  && <WastePage      store={store} session={session}/>}
          {view === 'members'    && can('members.view')    && <MembersPage    store={store} session={session}/>}
          {view === 'reports'    && can('reports.view')    && <ReportsPage    store={store} session={session}/>}
          {view === 'accounting' && can('accounting.view') && <AccountingPage store={store} session={session}/>}
          {view === 'purchase'   && can('purchase.view')   && <PurchasePage   store={store} session={session}/>}
          {view === 'stocktake'  && can('stocktake.view')  && <StocktakePage  store={store} session={session}/>}
          {view === 'promotions' && can('promotions.view') && <PromotionsPage store={store} session={session}/>}
          {view === 'orders'     && can('pos.use')         && <OrdersPage />}
          {view === 'settings'   && can('settings.view')   && <SettingsPage   session={session} onLogout={handleLogout} store={store}/>}
          {view === 'scenarios'  && can('settings.edit')   && <ScenarioTemplatesPage session={session} store={store}/>}
          {view === 'readiness' && can('pos.use') && <ReadinessPage store={store} session={session} backupIssue={backupIssue} onBackupVerified={()=>setBackupIssue('')}/>}
          {view === 'devices' && can('settings.edit') && <SharedDevicesPage/>}
        </main>
      </div>

      {autoSync && (
        <div style={syncOverlay.root}>
          <div style={syncOverlay.box}>
            <Cloud size={28} style={{
              color: autoSync === 'failed' ? 'var(--red)' : 'var(--blue)',
              animation: autoSync === 'syncing' ? 'spin 1.4s linear infinite' : 'none',
            }}/>
            <div style={{textAlign:'center'}}>
              <div style={{fontWeight:600, fontSize:15}}>
                {autoSync === 'syncing' && '同步雲端資料中...'}
                {autoSync === 'done' && '✓ 同步完成，重新載入中'}
                {autoSync === 'failed' && '雲端同步失敗，使用本機資料'}
              </div>
              <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:4}}>
                {autoSync === 'syncing' && '從雲端拉取最新資料'}
                {autoSync === 'failed' && '檢查網路或稍後再從設定手動同步'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const syncOverlay = {
  root: {
    position:'fixed', inset:0, zIndex:9999,
    background:'rgba(23,37,60,0.40)', backdropFilter:'blur(4px)',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  box: {
    background:'var(--bg-raised)', borderRadius:'var(--r4)',
    padding:'28px 36px', display:'flex', flexDirection:'column',
    alignItems:'center', gap:14,
    boxShadow:'var(--shadow-lg)', border:'1px solid var(--border-dim)',
    minWidth:260, maxWidth:360,
  },
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
    width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center',
    borderRadius:'var(--r2)', color:'var(--text-primary)',
  },
  topTitle: { fontSize:15, fontWeight:600, color:'var(--text-primary)' },
}
