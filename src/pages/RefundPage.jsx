import {useEffect,useMemo,useState} from 'react'
import {tr,trMessage,getLocale} from '../i18n'
import {loadRefundContext} from '../utils/dataAccess'
import {readPendingFinancial} from '../utils/financialCommand'
import RefundModal from '../components/RefundModal'
import './RefundPage.css'

export function refundableOrders(orders,query=''){
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return orders.filter(row=>!row.refundOf&&(!row.source||row.source==='pos')&&['completed','refunded'].includes(row.status)&&terms.every(term=>(row.id+' '+row.time+' '+(row.items||[]).map(item=>item.name).join(' ')).toLocaleLowerCase().includes(term))).sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||a.id.localeCompare(b.id))
}
export default function RefundPage({store,session}){
  const [query,setQuery]=useState(''),[limit,setLimit]=useState(12),[selected,setSelected]=useState(null),[context,setContext]=useState(null),[error,setError]=useState(''),[pending,setPending]=useState(null)
  useEffect(()=>{let active=true;loadRefundContext(session).then(value=>{if(active)setContext(value)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[session.userId,session.role])
  useEffect(()=>{try{const value=readPendingFinancial();setPending(value?.kind==='refund'?value:null);if(value?.kind==='refund')setSelected(value.request.refundOf)}catch(e){setError(e.message)}},[store.financialState?.phase,store.financialState?.id])
  const results=useMemo(()=>refundableOrders(store.orders,query),[store.orders,query]),order=store.orders.find(row=>row.id===selected)
  return <div className="refund-page">
    <header><div><h1>{tr('退貨、退款')}</h1><p>{tr('找到原單，再填退回數量。')}</p></div><button className="btn" onClick={()=>store.setView('dashboard')}>{tr('首頁')}</button></header>
    {error&&<p role="alert">{trMessage(error)}</p>}
    {pending&&!order&&<div role="alert"><p>{tr('原單尚未找到，請保留上次退貨紀錄。')}</p><button className="btn" onClick={()=>store.setView('recovery')}>{tr('資料復原')}</button></div>}
    <input className="field" aria-label={tr('找原單：單號或商品')} placeholder={tr('找原單：單號或商品')} value={query} onChange={e=>{setQuery(e.target.value);setLimit(12)}}/>
    <div className="refund-orders">{results.slice(0,limit).map(row=>{
      const restaurant=context?.restaurantSaleIds.includes(row.id),done=row.status==='refunded'
      return <article key={row.id}><div><strong>{row.items.map(item=>item.name).join('、')}</strong><p>{row.id}</p><p>{new Date(row.time).toLocaleString(getLocale())} · NT$ {row.total.toLocaleString(getLocale())}</p></div>
        <button className="btn" disabled={!context||!!pending&&pending.request.refundOf!==row.id||done&&!restaurant&&pending?.request.refundOf!==row.id} onClick={()=>restaurant?store.setView('restaurant'):setSelected(row.id)}>{tr(restaurant?'到預訂出餐取消':done&&pending?.request.refundOf!==row.id?'已退完':'退貨')}</button></article>
    })}</div>
    {results.length===0&&<p>{tr('找不到這張原單')}</p>}
    {results.length>limit&&<button className="btn" onClick={()=>setLimit(n=>n+12)}>{tr('載入更多')}</button>}
    {order&&<RefundModal key={order.id} order={order} session={session} products={store.products} priorRefunds={store.orders.filter(row=>row.refundOf===order.id)} onRefund={store.refund} retryFinancial={store.retryFinancial} onRecovery={()=>store.setView('recovery')} onClose={()=>{setSelected(null);setPending(null)}}/>}
  </div>
}
