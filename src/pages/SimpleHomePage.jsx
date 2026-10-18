import {tr} from "../i18n"
import {useEffect,useRef,useState,lazy,Suspense} from 'react'
import {ArrowRight,Search,ShoppingCart,Sparkles,ClipboardList,Truck,Clock,Package,Users,Briefcase} from 'lucide-react'
import {WORKSPACE_AREAS,workspaceTasks,workspaceReminders} from '../utils/workspaceTasks'
import {isElectron,isSharedStore} from '../utils/dataAccess'

const icons={sale:ShoppingCart,quick:Sparkles,restaurant:ClipboardList,purchase:Truck,shifts:Clock,inventory:Package}
const AgentMigrationPanel=lazy(()=>import('../components/AgentMigrationPanel.jsx'))
export default function SimpleHomePage({store,session,area='all',onAreaChange}){
  const [query,setQuery]=useState(''),[showAll,setShowAll]=useState(false),[migration,setMigration]=useState(false)
  const heading=useRef(null),areaHeading=useRef(null),lastArea=useRef(area)
  const activeArea=WORKSPACE_AREAS.find(a=>a.id===area)
  const tasks=workspaceTasks(session,query,query?'all':area,{stockSetupEnabled:store.stockSetupEnabled}),visible=query||showAll||activeArea?tasks:tasks.filter(t=>icons[t.id]),reminders=workspaceReminders(store,session)
  useEffect(()=>{if(lastArea.current!==area){lastArea.current=area;const target=area==='all'?areaHeading.current:heading.current;target?.scrollIntoView?.({block:'start'});target?.focus({preventScroll:true})}},[area])
  function chooseArea(id){setQuery('');setShowAll(false);onAreaChange(id)}
  return <div className="easy-home"><div className="easy-home-inner">
    <header><div className="easy-heading-copy"><p className="easy-eyebrow">{tr("所有店家・全部功能免費")}</p><h1>{tr("現在要做什麼？")}</h1><p>{tr("選一件事，跟著畫面就能完成。")}</p></div><div className="easy-poster" aria-hidden="true"><span>ERP</span><span>CRM</span><i/></div></header>
    <section className="easy-areas" aria-label={tr("選擇工作區")}><h2 ref={areaHeading} tabIndex={-1}>{tr("先選工作區")}</h2><p>{tr("同一間店，資料共用。切換不用重新建資料。")}</p><div className="easy-area-grid">{WORKSPACE_AREAS.filter(a=>workspaceTasks(session,'',a.id).length).map(a=>{const Icon=a.id==='crm'?Users:Briefcase;return <button key={a.id} className="easy-area" aria-label={tr(a.title)+'（'+a.code+'）'} aria-describedby={'area-detail-'+a.id} aria-pressed={area===a.id} onClick={()=>chooseArea(a.id)}><div className="easy-area-top"><Icon size={25} aria-hidden="true"/><span className="easy-area-code">{a.code}</span></div><strong>{tr(a.title)}</strong><span className="easy-area-intro">{tr(a.intro)}</span><span id={'area-detail-'+a.id}>{tr(a.detail)}</span><span className="easy-area-enter">{tr("進入工作區 ")}<ArrowRight size={18} aria-hidden="true"/></span></button>})}</div></section>
    <div className="easy-direct"><button className="btn btn-primary" onClick={()=>store.setView('pos')}>{tr("直接收銀")}</button><button className="btn btn-ghost" onClick={()=>store.setView('quick')}>{tr("Agent 幫我建單")}</button>{session.role==='owner'&&<button className="btn btn-ghost" data-open-agent-migration onClick={()=>setMigration(true)}>{tr('Agent 幫我搬家')}</button>}</div>
    <div className="easy-summary" aria-label={tr("今天的店面狀態")}><span>{store.openShift?tr("營業中"):tr("尚未開班")}</span><span>{tr("今天 {0} 筆",{0:store.todayBusinessCount??store.todayOrders.length})}</span><strong>NT$ {store.todayRevenue.toLocaleString('zh-TW')}</strong></div>
    {reminders.length>0&&<section className="easy-reminders" aria-label={tr("接著處理")}><h2>{tr("接著處理")}</h2>{reminders.map(r=><button key={r.id} className="easy-reminder" onClick={()=>store.setView(r.view)}><span><strong>{tr(r.title)}</strong><small>{tr(r.detail)}</small></span><ArrowRight size={22} aria-hidden="true"/></button>)}</section>}
    <label className="easy-search"><Search size={22} aria-hidden="true"/><input type="search" aria-label={tr("找想做的事")} placeholder={tr("找功能，例如：退款、備份、手機")} value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="easy-work-heading"><h2 ref={heading} tabIndex={-1}>{query?tr("搜尋全部工作"):activeArea?tr(activeArea.title)+'（'+activeArea.code+'）':tr("常用捷徑")}</h2>{activeArea&&!query&&<button className="btn btn-ghost" onClick={()=>chooseArea('all')}>{tr("換工作區")}</button>}</div>
    {activeArea&&!query&&<p className="easy-area-note"><strong>{tr(activeArea.intro)}。</strong>{tr(activeArea.description)}</p>}
    <div className="easy-task-grid" aria-label={tr("日常工作")}>{visible.map(t=>{const Icon=icons[t.id]||ArrowRight;return <button key={t.id} className={'easy-task'+(t.id==='quick'?' easy-task-primary':'')} onClick={()=>store.setView(t.view)}><Icon size={30} aria-hidden="true"/><strong>{tr(t.title)}</strong><span>{tr(t.detail)}</span></button>})}</div>
    {!visible.length&&<p role="status">{tr("找不到「{0}」。可以試「進貨」「收款」「設定」。",{0:query})}</p>}
    {!query&&!activeArea&&<button className="btn btn-ghost easy-more" aria-expanded={showAll} onClick={()=>setShowAll(v=>!v)}>{showAll?tr("只看常用工作"):tr("查看全部工作")}</button>}
    <section className="easy-help"><h2>{tr("第一次使用")}</h2><ol><li>{tr("在「商品、庫存」新增商品與實際數量。")}</li><li>{tr("在「開始營業、收攤」確認零用金、開班。")}</li><li>{tr("選「賣東西、收款」，或用「幫我建單」。")}</li></ol><button className="btn btn-ghost" onClick={()=>store.setView('readiness')}>{tr("帶我做營業前檢查")}</button></section>
    <p className="easy-connection">{isSharedStore?tr("這台裝置已連到店面電腦，共用訂單與庫存。"):isElectron?tr("要讓手機一起用，搜尋「手機」完成配對。"):tr("這台瀏覽器目前獨立保存。要共用電腦資料，請用桌面版產生的手機配對網址。")}</p>
    {migration&&<Suspense fallback={<p role="status">{tr('正在核對庫存…')}</p>}><AgentMigrationPanel session={session} store={store} onClose={()=>setMigration(false)}/></Suspense>}
  </div></div>
}
