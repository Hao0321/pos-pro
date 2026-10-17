import {useEffect,useRef,useState} from 'react'
import {tr,trMessage,getLocale} from '../i18n'
import {loadStockHistory} from '../utils/dataAccess'
import {newStockHistoryQuery,STOCK_HISTORY_PAGE_SIZE,assertStockHistoryResult} from '../../electron/stockHistory.mjs'
import {historyQuantity,historyMoney} from '../utils/stockHistoryDisplay.mjs'
import {RECORD_KEY} from '../utils/browserStorage'
import './StockHistoryPage.css'

const stages={available:'可賣',reserved:'已預留',consumed:'已售／耗用',wasted:'已損耗',supplierReturned:'已退供應商'}
const kinds={open:'核對期初',price:'補確認成本',checkout:'售出',refundOrder:'原單退回',addWaste:'損耗',addProduct:'新增庫存',receive:'進貨',stocktake:'盤點','purchase-return':'退供應商','applyRestaurantOperation:create':'預留','applyRestaurantOperation:advance':'出餐狀態更新','applyRestaurantOperation:pay':'預訂收款','applyRestaurantOperation:cancel':'取消預訂','applySalesOperation:deliver':'交付客戶','applySalesOperation:return':'客戶退回'}
const quantity=units=>historyQuantity(units,getLocale())
const money=cents=>historyMoney(cents,getLocale())
const cost=row=>row.complete?money(row.valueCents):tr('成本待確認')
const time=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(getLocale()):tr('時間待核對')
function States({product}){return <dl className="history-states">{Object.entries(stages).map(([key,label])=><div key={key}><dt>{tr(label)}</dt><dd>{quantity(product.states[key].quantityUnits)} <small>{product.unit}</small></dd></div>)}</dl>}
function Costs({original,current}){return <dl className="history-costs"><div><dt>{tr('當時成本')}</dt><dd>{cost(original)}</dd></div>{(!original.complete||original.valueCents!==current.valueCents)&&<div><dt>{tr('後來確認的成本')}</dt><dd>{cost(current)}</dd></div>}</dl>}
export default function StockHistoryPage({store,session}){
 const [query,setQuery]=useState(newStockHistoryQuery),[search,setSearch]=useState(''),[data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),request=useRef(0),root=useRef(null),changes=useRef(0)
 useEffect(()=>{const changed=()=>{changes.current++},storage=event=>{if(event.key===RECORD_KEY)changed()};window.addEventListener('pos-data-refreshed',changed);window.addEventListener('storage',storage);return()=>{window.removeEventListener('pos-data-refreshed',changed);window.removeEventListener('storage',storage)}},[])
 useEffect(()=>{let active=true;const id=++request.current,version=changes.current;setLoading(true);setError('');loadStockHistory(query,session).then(value=>{assertStockHistoryResult(value,query);if(active&&id===request.current){if(version!==changes.current)throw Error('庫存紀錄已更新，請重新核對');setData(value)}}).catch(problem=>{if(active&&id===request.current)setError(problem.message)}).finally(()=>{if(active&&id===request.current)setLoading(false)});return()=>{active=false}},[query,session.userId,session.role])
 useEffect(()=>{if(data&&!loading&&!error&&root.current)root.current.scrollTop=0},[data,loading,error])
 useEffect(()=>{
  if(!data||loading||error)return
  let active=true,running=false,again=false
  const refresh=async()=>{if(running){again=true;return}running=true;do{again=false;try{const input={...query,context:data.context};assertStockHistoryResult(await loadStockHistory(input,session),input)}catch(problem){if(active)setError(problem.message)}}while(active&&again);running=false}
  const storage=event=>{if(event.key===RECORD_KEY)refresh()}
  window.addEventListener('pos-data-refreshed',refresh);window.addEventListener('storage',storage)
  return()=>{active=false;window.removeEventListener('pos-data-refreshed',refresh);window.removeEventListener('storage',storage)}
 },[data?.context.historyId,query,session.userId,session.role,loading,error])
 function change(patch){setQuery({...query,context:data.context,cursor:0,...patch})}
 function showSource(sourceId){change({sourceId})}
 const reference=data?.status==='reference-only-not-activated',events=data&&data.mode!=='products',busy=loading||!!error
 return <section ref={root} className="stock-history" data-stock-history aria-busy={loading}>
  <header><h1>{tr('庫存去哪了')}</h1><p>{tr('選商品，看剩多少、用在哪裡。')}</p></header>
  {loading&&<p role="status">{tr('正在核對庫存紀錄…')}</p>}
  {error&&<div className="history-error" role="alert"><p>{trMessage(error)}</p><button className="btn btn-primary" onClick={()=>setQuery({...query,context:null,cursor:0})}>{tr('重新核對')}</button><button className="btn" onClick={()=>setQuery(newStockHistoryQuery())}>{tr('重新選商品')}</button><button className="btn btn-ghost" onClick={()=>store.setView('recovery')}>{tr('找回資料')}</button></div>}
  {!error&&reference&&<div className="history-reference"><h2>{tr('目前使用參考成本')}</h2><p>{tr('成本帳還沒啟用，這裡不補造以前的進出紀錄。')}</p><button className="btn btn-primary" onClick={()=>store.setView('inventory')}>{tr('看目前商品庫存')}</button>{store.stockSetupEnabled&&<button className="btn" onClick={()=>store.setView('stocksetup')}>{tr('核對庫存成本')}</button>}</div>}
  {!error&&data&&!reference&&<fieldset disabled={loading} className="history-content">
   {data.mode==='products'?<><form className="history-search" onSubmit={event=>{event.preventDefault();setQuery({...newStockHistoryQuery(),search})}}><label>{tr('找商品')}<input type="search" aria-label={tr('找商品')} value={search} onChange={event=>setSearch(event.target.value)} placeholder={tr('輸入名稱或條碼')}/></label><button className="btn btn-primary" type="submit">{tr('搜尋')}</button></form>
    <div className="history-products">{data.rows.map(product=><button type="button" key={product.id} className="history-product card" data-history-product={product.id} onClick={()=>change({productId:product.id,sourceId:null})}><strong>{product.name}</strong><span>{tr('可賣 {0} {1}',{0:quantity(product.states.available.quantityUnits),1:product.unit})}</span><span>{tr('預留 {0} {1}',{0:quantity(product.states.reserved.quantityUnits),1:product.unit})}</span><small>{tr('看用在哪裡')} →</small></button>)}</div></>:<>
    <div className="history-back"><button className="btn" onClick={()=>setQuery({...newStockHistoryQuery(),search:query.search})}>{tr('換個商品')}</button>{data.source&&<button className="btn" onClick={()=>change({sourceId:null})}>{tr('看商品全部紀錄')}</button>}</div>
    <div className="history-product-heading"><h2>{data.product.name}</h2>{!data.source&&<><States product={data.product}/><details><summary>{tr('還在店內的成本')}</summary><p>{cost(data.product.heldCost)}</p></details></>}</div>
    {data.source&&<aside className="card history-source" data-history-source><h2>{tr('這批貨的來源')}</h2><p className="history-big">{tr('這批原有 {0} {1}',{0:quantity(data.source.quantityUnits),1:data.source.unit})}</p><Costs original={{complete:data.source.originalValueCents!==null,valueCents:data.source.originalValueCents}} current={{complete:data.source.valueCents!==null,valueCents:data.source.valueCents}}/>
     <States product={{...data.product,states:data.source.states}}/>
     <details><summary>{tr('來源與確認時間')}</summary><p>{tr('首次保存：{0}',{0:time(data.source.origin.time)})}</p><p>{tr('原操作：{0}',{0:data.source.origin.operationId})}</p>{data.source.confirmation&&<p>{tr('成本確認：{0}',{0:time(data.source.confirmation.time)})}</p>}<code>{data.source.id}</code></details>
     <details><summary>{tr('這批現在在哪裡')}</summary>{data.source.positions.map((position,index)=><p key={index}>{tr(stages[position.owner.stage])}：{quantity(position.quantityUnits)} {data.source.unit} · {cost(position)}</p>)}</details>
    </aside>}
    <div className="history-events">{data.rows.map(entry=><article className="card history-event" data-history-event={entry.eventId} key={entry.eventId}><header><h3>{tr(kinds[entry.kind]||'庫存狀態更新')}</h3><time dateTime={entry.time}>{time(entry.time)}</time></header>
     {!entry.parts.length&&<p>{tr('本次數量沒有變動')}</p>}{entry.parts.map((part,index)=><div className="history-part" key={index}>{part.kind==='price'?<p>{tr('只補成本，數量不重算。')}</p>:<p className="history-movement"><span>{part.kind==='opening'?tr('期初核對數量'):part.from?tr(stages[part.from]):tr('進入這間店')}</span><span aria-hidden="true"> → </span><span>{tr(stages[part.to])}</span><strong>{quantity(part.quantityUnits)} {data.product.unit}</strong></p>}<details><summary>{tr('看這筆成本')}</summary><Costs original={part.original} current={part.current}/></details>
      {!data.source&&[...new Set([...part.segments.map(segment=>segment.sourceId),...(part.sourceId?[part.sourceId]:[])])].map((sourceId,index)=><button className="btn btn-ghost history-source-button" data-history-source-button={sourceId} key={sourceId} onClick={()=>showSource(sourceId)}>{tr('看這批來源 {0}',{0:index+1})} →</button>)}
     </div>)}
     <details className="history-record-details"><summary>{tr('原單與成本分錄')}</summary><dl><div><dt>{tr('原操作')}</dt><dd>{entry.operationId}</dd></div><div><dt>{tr('操作者')}</dt><dd>{entry.actor.username}</dd></div>{entry.documentId&&<div><dt>{tr('原單')}</dt><dd>{entry.documentId}</dd></div>}<div><dt>{tr('保存順序')}</dt><dd>{entry.sequence}</dd></div></dl><p>{tr('這次成本分錄')}</p>{entry.journals.map((journal,index)=><div key={index}><p>{trMessage(journal.description)}</p>{journal.lines.map((line,n)=><div className="history-journal" key={n}><code>{line.account}</code><span>{tr('借方')} {money(line.debitCents)}</span><span>{tr('貸方')} {money(line.creditCents)}</span></div>)}</div>)}</details>
    </article>)}</div>
   </>}
   {!data.rows.length&&<p role="status">{tr('目前沒有符合的紀錄')}</p>}
   <nav className="history-pagination" aria-label={tr('庫存紀錄分頁')}><p>{tr('顯示 {0}–{1}，共 {2} 筆',{0:data.rows.length?data.cursor+1:0,1:data.cursor+data.rows.length,2:data.total})}</p><div><button className="btn" disabled={busy||data.cursor===0} onClick={()=>change({cursor:Math.max(0,data.cursor-STOCK_HISTORY_PAGE_SIZE)})}>{tr('上一頁')}</button><button className="btn" disabled={busy||data.nextCursor===null} onClick={()=>change({cursor:data.nextCursor})}>{tr('下一頁')}</button>{events&&data.total>STOCK_HISTORY_PAGE_SIZE&&<button className="btn btn-ghost" onClick={()=>change({cursor:Math.floor((data.total-1)/STOCK_HISTORY_PAGE_SIZE)*STOCK_HISTORY_PAGE_SIZE})}>{tr('最早紀錄')}</button>}</div></nav>
  </fieldset>}
 </section>
}
