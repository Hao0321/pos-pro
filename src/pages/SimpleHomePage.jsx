import {tr} from '../i18n'
import {useEffect,useRef,useState,lazy,Suspense} from 'react'
import {ArrowRight,Search,Sparkles,ChevronDown} from 'lucide-react'
import {WORKSPACE_AREAS,workspaceTasks,workspaceReminders,homePrimaryTask} from '../utils/workspaceTasks'
import {isElectron,isSharedStore} from '../utils/dataAccess'
import '../styles/opening-guide.css'
import '../styles/home-focus.css'

const AgentMigrationPanel=lazy(()=>import('../components/AgentMigrationPanel.jsx'))

export default function SimpleHomePage({store,session,area='all',onAreaChange}){
  const [query,setQuery]=useState(''),[migration,setMigration]=useState(false)
  const finder=useRef(null),heading=useRef(null),lastArea=useRef(area)
  const searching=Boolean(query.trim()),activeArea=WORKSPACE_AREAS.find(row=>row.id===area)
  const tasks=workspaceTasks(session,query,searching?'all':area,{stockSetupEnabled:store.stockSetupEnabled})
  const primary=homePrimaryTask(store,session),quick=workspaceTasks(session).find(row=>row.id==='quick')
  const reminders=workspaceReminders(store,session).filter(row=>!(primary?.id==='start'&&['first-product','open-shift'].includes(row.id))&&!(primary?.id==='continue'&&row.id==='cart'))

  useEffect(()=>{
    if(lastArea.current===area)return
    lastArea.current=area
    heading.current?.scrollIntoView?.({block:'nearest'})
    heading.current?.focus({preventScroll:true})
  },[area])

  function chooseArea(id){setQuery('');onAreaChange?.(id)}
  function closeFinder(event){
    if(event.key!=='Escape')return
    event.preventDefault()
    finder.current.open=false
    finder.current.querySelector('summary').focus()
  }

  return <div className="easy-home easy-home-focused"><div className="easy-home-inner">
    <header><div className="easy-heading-copy"><h1>{tr('現在要做什麼？')}</h1><p>{tr('先選一件要做的事。')}</p></div></header>
    <div className="easy-summary home-status" aria-label={tr('今天的店面狀態')}>
      <span>{tr('今天 {0} 筆',{0:store.todayBusinessCount??store.todayOrders.length})}</span>
      <strong>NT$ {store.todayRevenue.toLocaleString('zh-TW')}</strong>
    </div>
    {primary&&<button type="button" className="btn btn-primary home-primary" data-home-primary={primary.id} data-opening-guide-entry={primary.id==='start'?'':undefined} onClick={()=>store.setView(primary.view)}>
      <span><strong>{tr(primary.title)}</strong><small>{tr(primary.detail)}</small></span><ArrowRight size={24} aria-hidden="true"/>
    </button>}
    {quick&&<button type="button" className="btn home-quick" data-home-quick onClick={()=>store.setView(quick.view)}><Sparkles size={23} aria-hidden="true"/><strong>{tr('幫我建單')}</strong><ArrowRight size={20} aria-hidden="true"/></button>}
    {reminders.length>0&&<details className="home-reminders" data-home-reminders>
      <summary>{tr('還有 {0} 件待處理',{0:reminders.length})}<ChevronDown size={20} aria-hidden="true"/></summary>
      {reminders.map(row=><button key={row.id} className="easy-reminder" onClick={()=>store.setView(row.view)}><span><strong>{tr(row.title)}</strong><small>{tr(row.detail)}</small></span><ArrowRight size={22} aria-hidden="true"/></button>)}
    </details>}
    <details ref={finder} className="home-finder" data-home-more onKeyDown={closeFinder}>
      <summary><Search size={23} aria-hidden="true"/><strong>{tr('其他工作')}</strong><ChevronDown size={20} aria-hidden="true"/></summary>
      <div className="home-finder-content">
        <label className="easy-search"><Search size={22} aria-hidden="true"/><input type="search" aria-label={tr('找想做的事')} placeholder={tr('找想做的事')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
        <div className="home-area-filters" role="group" aria-label={tr('選擇工作區')}>
          <button type="button" aria-pressed={area==='all'} onClick={()=>chooseArea('all')}>{tr('全部功能')}</button>
          {WORKSPACE_AREAS.filter(row=>workspaceTasks(session,'',row.id,{stockSetupEnabled:store.stockSetupEnabled}).length).map(row=><button type="button" key={row.id} data-home-area={row.id} aria-label={tr(row.title)+'（'+row.code+'）'} aria-pressed={area===row.id} onClick={()=>chooseArea(row.id)}><strong>{tr(row.title)}</strong><small>{row.code}</small></button>)}
        </div>
        <h2 ref={heading} tabIndex={-1}>{searching?tr('搜尋全部工作'):activeArea?tr(activeArea.title):tr('日常工作')}</h2>
        <div className="easy-task-grid" aria-label={tr('日常工作')}>
          {tasks.map(task=><button type="button" key={task.id} className="easy-task" data-home-task={task.id} aria-description={tr(task.detail)} onClick={()=>store.setView(task.view)}><strong>{tr(task.title)}</strong><ArrowRight size={20} aria-hidden="true"/></button>)}
        </div>
        {!tasks.length&&<p role="status">{tr('找不到「{0}」。可以試「進貨」「收款」「設定」。',{0:query})}</p>}
        {session.role==='owner'&&<button type="button" className="btn home-migration" data-open-agent-migration onClick={()=>setMigration(true)}>{tr('Agent 幫我搬家')}<ArrowRight size={20} aria-hidden="true"/></button>}
        <details className="easy-help"><summary>{tr('第一次使用')}</summary><ol><li>{tr('在「商品、庫存」新增商品與實際數量。')}</li><li>{tr('在「開始營業、收攤」確認零用金、開班。')}</li><li>{tr('選「賣東西、收款」，或用「幫我建單」。')}</li></ol><button type="button" className="btn btn-ghost" onClick={()=>store.setView('readiness')}>{tr('帶我做營業前檢查')}</button></details>
      </div>
    </details>
    <p className="easy-connection">{isSharedStore?tr('這台裝置已連到店面電腦，共用訂單與庫存。'):isElectron?tr('要讓手機一起用，搜尋「手機」完成配對。'):tr('這台瀏覽器目前獨立保存。要共用電腦資料，請用桌面版產生的手機配對網址。')}</p>
    <p className="easy-eyebrow home-free">{tr('所有店家・全部功能免費')}</p>
    {migration&&<Suspense fallback={<p role="status">{tr('正在核對庫存…')}</p>}><AgentMigrationPanel session={session} store={store} onClose={()=>setMigration(false)}/></Suspense>}
  </div></div>
}
