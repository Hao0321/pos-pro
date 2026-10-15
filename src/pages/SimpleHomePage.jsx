import {useState} from 'react'
import {ArrowRight,Search,ShoppingCart,Sparkles,ClipboardList,Truck,Clock,Package} from 'lucide-react'
import {workspaceTasks,workspaceReminders} from '../utils/workspaceTasks'
import {isElectron,isSharedStore} from '../utils/dataAccess'

const icons={sale:ShoppingCart,quick:Sparkles,restaurant:ClipboardList,purchase:Truck,shifts:Clock,inventory:Package}
export default function SimpleHomePage({store,session}){
  const [query,setQuery]=useState(''),[showAll,setShowAll]=useState(false)
  const tasks=workspaceTasks(session,query),visible=query||showAll?tasks:tasks.filter(t=>icons[t.id]),reminders=workspaceReminders(store,session)
  return <div className="easy-home"><div className="easy-home-inner">
    <header><p className="easy-eyebrow">所有店家・全部功能免費</p><h1>現在要做什麼？</h1><p>選一件事，跟著畫面就能完成。</p></header>
    <div className="easy-summary" aria-label="今天的店面狀態"><span>{store.openShift?'營業中':'尚未開班'}</span><span>今天 {store.todayOrders.length} 筆</span><strong>NT$ {store.todayRevenue.toLocaleString('zh-TW')}</strong></div>
    {reminders.length>0&&<section className="easy-reminders" aria-label="接著處理"><h2>接著處理</h2>{reminders.map(r=><button key={r.id} className="easy-reminder" onClick={()=>store.setView(r.view)}><span><strong>{r.title}</strong><small>{r.detail}</small></span><ArrowRight size={22} aria-hidden="true"/></button>)}</section>}
    <label className="easy-search"><Search size={22} aria-hidden="true"/><input type="search" aria-label="找想做的事" placeholder="找功能，例如：退款、備份、手機" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="easy-task-grid" aria-label="日常工作">{visible.map(t=>{const Icon=icons[t.id]||ArrowRight;return <button key={t.id} className={'easy-task'+(t.id==='quick'?' easy-task-primary':'')} onClick={()=>store.setView(t.view)}><Icon size={30} aria-hidden="true"/><strong>{t.title}</strong><span>{t.detail}</span></button>})}</div>
    {!visible.length&&<p role="status">找不到「{query}」。可以試「進貨」「收款」「設定」。</p>}
    {!query&&<button className="btn btn-ghost easy-more" aria-expanded={showAll} onClick={()=>setShowAll(v=>!v)}>{showAll?'只看常用工作':'查看全部工作'}</button>}
    <section className="easy-help"><h2>第一次使用</h2><ol><li>在「商品、庫存」新增商品與實際數量。</li><li>在「開始營業、收攤」確認零用金、開班。</li><li>選「賣東西、收款」，或用「幫我建單」。</li></ol><button className="btn btn-ghost" onClick={()=>store.setView('readiness')}>帶我做營業前檢查</button></section>
    <p className="easy-connection">{isSharedStore?'這台裝置已連到店面電腦，共用訂單與庫存。':isElectron?'要讓手機一起用，搜尋「手機」完成配對。':'這台瀏覽器目前獨立保存。要共用電腦資料，請用桌面版產生的手機配對網址。'}</p>
  </div></div>
}
