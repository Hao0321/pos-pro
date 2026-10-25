import {useEffect,useRef,useState} from 'react'
import {tr,trMessage,getLocale} from '../i18n'
import {X,Pause} from 'lucide-react'
import '../styles/held-cart.css'

export default function HeldOrdersModal({heldOrders,members,onRecall,onRemove,onClose,hasCart=false}){
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[cancelling,setCancelling]=useState(''),running=useRef(false),box=useRef(null),closeRef=useRef(onClose)
 closeRef.current=onClose
 useEffect(()=>{const previous=document.activeElement;box.current?.querySelector('button')?.focus();return()=>previous?.focus?.()},[])
 async function perform(row,remove=false){
  if(running.current)return;running.current=true;setBusy(row.id);setError('')
  try{await (remove?onRemove(row.id):onRecall(row));setCancelling('');if(!remove)onClose()}
  catch(e){setError(e.message||'掛單結果尚未確認，請查詢原編號。')}
  finally{running.current=false;setBusy('')}
 }
 function keydown(e){
  if(e.key==='Escape'&&!running.current){e.preventDefault();closeRef.current();return}
  if(e.key!=='Tab')return
  const nodes=[...box.current.querySelectorAll('button:not(:disabled),summary,[tabindex="0"]')].filter(node=>node.getClientRects().length),first=nodes[0],last=nodes.at(-1)
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
 }
 return <div className="held-cart-overlay" onClick={e=>{if(e.target===e.currentTarget&&!running.current)onClose()}}>
  <section className="held-cart-dialog" ref={box} role="dialog" aria-modal="true" aria-labelledby="held-cart-title" onKeyDown={keydown} data-held-dialog>
   <header><div><span className="held-cart-eyebrow"><Pause size={16}/>{tr('暫放的訂單')}</span><h2 id="held-cart-title">{tr('選一張，接著結帳')}</h2></div><button className="btn btn-ghost" aria-label={tr('關閉掛單列表')} disabled={!!busy} onClick={onClose}><X size={20}/></button></header>
   {hasCart&&<p className="held-cart-hint">{tr('現在的購物車會先掛單，不會被蓋掉。')}</p>}
   {error&&<p role="alert" className="held-cart-error">{trMessage(error)}</p>}
   <div className="held-cart-list">
    {!heldOrders.length&&<p className="held-cart-empty">{tr('沒有掛單')}</p>}
    {heldOrders.map(row=>{
     const cart=Array.isArray(row.cart)?row.cart:[],member=members.find(m=>m.id===row.memberId),cents=cart.reduce((sum,item)=>sum+Math.round(item.price*item.qty*100+1e-7),0)-Math.round((row.manualDiscount||0)*100)
     return <article className="held-cart-row" key={row.id} data-held-row={row.id}>
      <div className="held-cart-row-title"><h3>{row.label||tr('未命名掛單')}</h3><strong>{new Intl.NumberFormat(getLocale(),{style:'currency',currency:'TWD',maximumFractionDigits:2}).format(Math.max(0,cents)/100)}</strong></div>
      <p className="held-cart-meta">{new Date(row.createdAt).toLocaleString(getLocale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}{member?' · '+member.name:''}</p>
      <p className="held-cart-items">{cart.map(item=>`${item.name} × ${item.qty}`).join(' · ')||tr('掛單資料需要核對，原購物車仍保留。')}</p>
      <button className="btn btn-primary held-cart-recall" data-held-recall={row.id} disabled={!!busy} onClick={()=>perform(row)}>{tr(busy===row.id?'正在核對…':hasCart?'先暫放，再取回':'取回這張單')}</button>
      <details className="held-cart-more" open={cancelling===row.id||undefined}><summary>{tr('其他操作')}</summary>
       {cancelling===row.id?<div><p>{tr('確定取消這張掛單？')}</p><div className="held-cart-actions"><button className="btn btn-ghost" disabled={!!busy} onClick={()=>setCancelling('')}>{tr('保留掛單')}</button><button className="btn btn-ghost held-cart-danger" data-held-confirm-remove={row.id} disabled={!!busy} onClick={()=>perform(row,true)}>{tr('確認取消掛單')}</button></div></div>:<button className="btn btn-ghost held-cart-danger" data-held-remove={row.id} disabled={!!busy} onClick={()=>setCancelling(row.id)}>{tr('取消這張掛單')}</button>}
      </details>
     </article>
    })}
   </div>
  </section>
 </div>
}
