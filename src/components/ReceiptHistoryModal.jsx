import {useEffect,useId,useMemo,useRef,useState} from 'react'
import {X} from 'lucide-react'
import {tr,getLocale} from '../i18n'
import {originalPosReceipts} from '../utils/receiptHistory.mjs'
import ReceiptPrintControl from './ReceiptPrintControl'
import './ReceiptPrint.css'

export default function ReceiptHistoryModal({orders,onClose}){
  const [query,setQuery]=useState(''),[limit,setLimit]=useState(8),[selected,setSelected]=useState(null)
  const dialog=useRef(null),search=useRef(null),titleId=useId()
  const results=useMemo(()=>originalPosReceipts(orders,query),[orders,query])
  const original=originalPosReceipts(orders).find(row=>row.id===selected)
  useEffect(()=>{
    const previous=document.activeElement
    search.current?.focus()
    return()=>{if(previous?.isConnected)previous.focus()}
  },[])
  useEffect(()=>{
    // Confirmation buttons disappear after sending. Escape and the focus trap
    // must still work when the browser has moved focus back to the document.
    window.addEventListener('keydown',keys,true)
    return()=>window.removeEventListener('keydown',keys,true)
  },[onClose])
  function keys(event){
    if(!['Escape','Tab','F1','F2','F3'].includes(event.key))return
    event.stopPropagation()
    if(event.key==='Escape'){event.preventDefault();onClose();return}
    if(event.key!=='Tab'){event.preventDefault();return}
    const controls=[...dialog.current.querySelectorAll('button,input,[tabindex="0"],summary')].filter(node=>!node.disabled&&node.getClientRects().length)
    if(!controls.length)return
    const first=controls[0],last=controls.at(-1)
    if(!dialog.current.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus()}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
  const money=value=>'NT$ '+value.toLocaleString(getLocale(),{maximumFractionDigits:2})
  return <div className="receipt-history-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section ref={dialog} className="receipt-history" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><h2 id={titleId}>{tr('找收據')}</h2><button className="btn btn-ghost" aria-label={tr('關閉收據查詢')} onClick={onClose}><X size={20}/></button></header>
      <input ref={search} className="field" data-receipt-search aria-label={tr('輸入單號或商品')} placeholder={tr('輸入單號或商品')} value={query} onChange={event=>{setQuery(event.target.value);setLimit(8);setSelected(null)}}/>
      {selected?(original?<article data-receipt-original={original.id}>
        <button className="btn btn-ghost" onClick={()=>{setSelected(null);search.current?.focus()}}>{tr('返回收據清單')}</button>
        <p className="receipt-original-id">{original.id}</p>
        <p>{new Date(original.time).toLocaleString(getLocale())}</p>
        <strong className="receipt-total">{money(original.total)}</strong>
        <p>{tr(original.status==='refunded'?'已退款':'結帳完成')}</p>
        <details><summary>{tr('收據商品明細')}</summary>{original.items.map((item,index)=><p key={index}>{item.name} × {item.qty}</p>)}</details>
        <ReceiptPrintControl key={original.id} orderId={original.id} reviewFirst/>
      </article>:<p role="alert">{tr('找不到這張原單')}</p>):<div className="receipt-history-list">
        {results.slice(0,limit).map(row=><article key={row.id} data-receipt-history={row.id}>
          <div><strong>{row.items.map(item=>item.name).join('、')}</strong><p>{new Date(row.time).toLocaleString(getLocale())}</p><p className="receipt-original-id">{row.id}</p><span>{money(row.total)}{row.status==='refunded'?' · '+tr('已退款'):''}</span></div>
          <button className="btn btn-ghost" data-receipt-open={row.id} onClick={()=>setSelected(row.id)}>{tr('查看收據')}</button>
        </article>)}
        {!results.length&&<p role="status">{tr('找不到這張原單')}</p>}
        {results.length>limit&&<button className="btn btn-ghost" onClick={()=>setLimit(value=>value+8)}>{tr('載入更多')}</button>}
      </div>}
    </section>
  </div>
}
