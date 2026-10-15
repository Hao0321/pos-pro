import {tr,trMessage} from "./i18n"
import { browserStorage } from './utils/browserStorage'
import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Menu, X, Cloud } from 'lucide-react'
import { useStore } from './store/useStore'
import { getSession, destroySession, writeAuditLog, startIdleTimer, hasPermission, createBackup, getBackupList } from './utils/security'
import LoginScreen from './pages/LoginScreen'
import Sidebar from './components/Sidebar'
import DisplayPreferences from './components/DisplayPreferences'
import {readRecoveryCommand} from './utils/recoveryClient'
import POSPage from './pages/POSPage'
import InventoryPage from './pages/InventoryPage'
import MembersPage from './pages/MembersPage'
const ReportsPage=lazy(()=>import('./pages/ReportsPage'))
import AccountingPage from './pages/AccountingPage'
import PurchasePage from './pages/PurchasePage'
import StocktakePage from './pages/StocktakePage'
import PromotionsPage from './pages/PromotionsPage'
import SettingsPage from './pages/SettingsPage'
import ScenarioTemplatesPage from './pages/ScenarioTemplatesPage'
import ReadinessPage from './pages/ReadinessPage'
import SharedDevicesPage from './pages/SharedDevicesPage'
import RestaurantPage from './pages/RestaurantPage'
import QuickDocumentPage from './pages/QuickDocumentPage'
const BusinessExchangePage=lazy(()=>import('./pages/BusinessExchangePage'))
const SalesPage=lazy(()=>import('./pages/SalesPage'))
const RecoveryPage=lazy(()=>import('./pages/RecoveryPage'))
import OrdersPage from './pages/OrdersPage'
const DashboardPage=lazy(()=>import('./pages/DashboardPage'))
import SimpleHomePage from './pages/SimpleHomePage'
import './styles/easy-workspace.css'
import ShiftPage from './pages/ShiftPage'
import WastePage from './pages/WastePage'
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
  useEffect(()=>{if(session?.role==='owner'&&store.financialState.kind==='exchange'&&store.financialState.phase==='uncertain')setView(current=>current==='recovery'?current:'exchange')},[session?.userId,store.financialState.kind,store.financialState.phase,setView])
  useEffect(()=>{if(session?.role==='owner'&&store.financialState.kind==='sales'&&store.financialState.phase==='uncertain')setView(current=>current==='recovery'?current:'sales')},[session?.userId,store.financialState.kind,store.financialState.phase,setView])
  useEffect(()=>{document.documentElement.dataset.largeText=String(largeText);try{localStorage.setItem('pos_large_text_v1',String(largeText))}catch{}},[largeText])
  useEffect(()=>{document.documentElement.dataset.simpleMode=String(simpleMode);try{localStorage.setItem('pos_simple_mode_v1',String(simpleMode))}catch{}},[simpleMode])
  useEffect(()=>{
    function read(){const params=new URLSearchParams(location.hash.slice(1)),raw=params.get('agentDraft');if(raw&&!params.has('pair')){history.replaceState(null,'',location.pathname+location.search);if(raw.length<=32768){setIncomingDraft(raw);setView('quick')}}}
    read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read)
  },[setView])
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
  if (store.dataError&&view!=='recovery') return <div role="alert" style={{padding:30}}><h2>{tr("資料需要核對")}</h2><p>{trMessage(store.dataError)}</p><button onClick={()=>location.reload()}>{tr("重新載入")}</button>{session.role==='owner'&&<button className="btn btn-primary" data-recovery-open onClick={()=>setView('recovery')}>{tr('一步一步找回資料')}</button>}</div>
  if (!store.ready&&view!=='recovery') return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100dvh',background:'var(--bg-base)',color:'var(--text-secondary)',fontSize:14}}>{tr("載入中...")}</div>
  )
  const can = (perm) => hasPermission(session, perm)

  const NAV_LABELS = {
    recovery:'資料復原',dashboard:'首頁',overview:'營運總覽',quick:'快速建單', pos:'收銀台',restaurant:'預訂出餐', shifts:'班別交班', readiness:'營業前檢查',devices:'共用店面',
    inventory:'庫存管理', purchase:'進貨管理',exchange:'報價與價目表',sales:'銷售與應收', waste:'損耗管理',
    stocktake:'每日盤點', promotions:'促銷活動', members:'會員',
    reports:'報表分析', accounting:'會計帳務', orders:'顧客點餐', settings:'設定', scenarios:'情境模板',
  }

  return (
    <div style={{ display:'flex', height:'100dvh', background:'var(--bg-base)', overflow:'hidden' }}>
      {!isMobile && (
        <Sidebar view={view} setView={setView} session={session}
          lowStockCount={lowStockCount} todayRevenue={todayRevenue}
          todayOrders={todayOrders} todayBusinessCount={store.todayBusinessCount} onLogout={handleLogout}
          pendingOrders={pendingOrders} openShift={store.openShift} largeText={largeText} toggleLargeText={()=>setLargeText(v=>!v)} simpleMode={simpleMode} toggleSimpleMode={()=>setSimpleMode(v=>!v)}/>
      )}

      {isMobile && menuOpen && (
        <div style={mob.overlay} onClick={() => setMenuOpen(false)} />
      )}
      {isMobile && (
        <div style={{...mob.drawer, transform: menuOpen ? 'translateX(0)' : 'translateX(-100%)'}}>
          <Sidebar view={view} setView={handleNavChange} session={session}
            lowStockCount={lowStockCount} todayRevenue={todayRevenue}
            todayOrders={todayOrders} todayBusinessCount={store.todayBusinessCount} onLogout={handleLogout}
            pendingOrders={pendingOrders} openShift={store.openShift} largeText={largeText} toggleLargeText={()=>setLargeText(v=>!v)} simpleMode={simpleMode} toggleSimpleMode={()=>setSimpleMode(v=>!v)}/>
        </div>
      )}

      <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', minWidth:0 }}>
        {session.role==='owner'&&view!=='recovery'&&(recoveryPending||store.financialState.phase==='uncertain'||store.checkoutState.phase==='uncertain')&&<div role="status" style={{padding:12,background:'var(--amber-dim)'}}><button className="btn btn-primary" data-recovery-open onClick={()=>handleNavChange('recovery')}>{tr('一步一步找回資料')}</button></div>}
        {!sharedConnected&&<div role="alert" style={{padding:12,background:'var(--red-dim)'}}>{tr("連不上店面電腦。請恢復店面 Wi-Fi；未確認的交易請沿用原單號核對。")}</div>}
        {view!=='recovery'&&store.financialState.phase!=='idle'&&<div data-financial-pending role="alert" style={{padding:12,background:'var(--gold-dim)'}}>{trMessage(store.financialState.message)} {store.financialState.id} {store.financialState.phase==='uncertain'&&<button onClick={()=>store.retryFinancial().catch(e=>alert(trMessage(e.message)))}>{tr("原編號重試保存異動")}</button>}</div>}
        {backupIssue&&session.role==='owner'&&<div role="alert" style={{padding:10,background:'var(--amber-dim)'}}>{tr("自動備份未完成。")}<button onClick={()=>handleNavChange('readiness')}>{tr("查看與補做備份")}</button></div>}
        {view!=='recovery'&&store.checkoutState.phase !== 'idle' && <div role="alert" style={{padding:12,background:'var(--gold-dim)'}}>
          {trMessage(store.checkoutState.message)} {store.checkoutState.orderId}
          {store.checkoutState.phase === 'uncertain' && <><button onClick={()=>store.reconcileCheckout().catch(e=>alert(trMessage(e.message)))}>{tr("查詢原交易")}</button><button onClick={()=>store.retryCheckout().catch(e=>alert(trMessage(e.message)))}>{tr("原單號重試保存")}</button></>}
        </div>}
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
        <main className="workspace-content" data-view={view} inert={store.checkoutState.phase!=='idle'&&view!=='recovery'||store.financialState.phase!=='idle'&&!['quick','exchange','sales','recovery'].includes(view)?'':undefined} style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          {view==='recovery'&&session.role==='owner'&&<Suspense fallback={<p role="status">{tr('正在載入…')}</p>}><RecoveryPage store={store} session={session}/></Suspense>}
          {view === 'dashboard' && can('pos.use') && (simpleMode?<SimpleHomePage store={store} session={session} area={workspaceArea} onAreaChange={setWorkspaceArea}/>:<Suspense fallback={<p role="status">{tr('正在載入…')}</p>}><DashboardPage store={store} session={session}/></Suspense>)}
          {view === 'overview' && can('reports.view') && <Suspense fallback={<p role="status">{tr('正在載入…')}</p>}><DashboardPage store={store} session={session}/></Suspense>}
          {view === 'quick' && can('pos.use') && <QuickDocumentPage key={session.userId+':'+session.role} store={store} session={session} incoming={incomingDraft} onIncomingConsumed={consumeIncoming}/>}
          {view === 'exchange' && can('purchase.edit') && <Suspense fallback={<p role="status">{tr('正在載入…')}</p>}><BusinessExchangePage key={session.userId+':'+session.role} store={store} session={session}/></Suspense>}
          {view === 'sales' && session.role==='owner' && <Suspense fallback={<p role="status">{tr('正在載入…')}</p>}><SalesPage key={session.userId+':'+session.role} store={store} session={session}/></Suspense>}
          {view === 'pos'        && can('pos.use')         && <POSPage        store={store} session={session}/>}
          {view === 'restaurant' && can('pos.use') && <RestaurantPage store={store} session={session}/>}
          {view === 'shifts'     && can('pos.use')         && <ShiftPage      store={store} session={session}/>}
          {view === 'inventory'  && can('inventory.view')  && <InventoryPage  store={store} session={session}/>}
          {view === 'waste'      && can('inventory.view')  && <WastePage      store={store} session={session}/>}
          {view === 'members'    && can('members.view')    && <MembersPage    store={store} session={session}/>}
          {view === 'reports'    && can('reports.view')    && <Suspense fallback={<p role="status">{tr('正在載入…')}</p>}><ReportsPage store={store} session={session}/></Suspense>}
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
                {autoSync === 'syncing' && tr("同步雲端資料中...")}
                {autoSync === 'done' && tr("✓ 同步完成，重新載入中")}
                {autoSync === 'failed' && tr("雲端同步失敗，使用本機資料")}
              </div>
              <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:4}}>
                {autoSync === 'syncing' && tr("從雲端拉取最新資料")}
                {autoSync === 'failed' && tr("檢查網路或稍後再從設定手動同步")}
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
    width:48, height:48, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
    borderRadius:'var(--r2)', color:'var(--text-primary)',
  },
  topTitle: { fontSize:15, fontWeight:600, color:'var(--text-primary)' },
}
