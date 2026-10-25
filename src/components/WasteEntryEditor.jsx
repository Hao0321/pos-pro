import {forwardRef,useEffect,useId,useImperativeHandle,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage,getLocale} from '../i18n'
import useWasteEntryDraft from '../hooks/useWasteEntryDraft'
import useVisibleViewport from '../hooks/useVisibleViewport'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import {WASTE_REASONS,wasteEntryQuantity} from '../../electron/wasteEntryDraft.mjs'
import '../styles/waste-entry.css'
export default forwardRef(function WasteEntryEditor({store,session,onBusy},ref){
 const [open,setOpen]=useState(false),[guard,setGuard]=useState(false),[error,setError]=useState(''),panel=useRef(null),trigger=useRef(null),recovered=useRef(null),prefix=useId(),viewport=useVisibleViewport()
 const draft=useWasteEntryDraft({session,onReset:()=>setOpen(false),saveRequest:request=>store.saveWasteEntry(request),onSaved:async(request,result,metadata)=>{await store.confirmWasteEntry(request);if(!metadata.isCurrent())return;await store.reloadFromDB();if(!metadata.isCurrent())return;setOpen(false);setGuard(false);setError('')}})
 const value=draft.value,locked=draft.busy||draft.blocked||draft.pending,notice={...draft.workspace,notice:''},current=draft.current||store.products.find(row=>row.id===value?.product?.id),number=value=>Number(value).toLocaleString(getLocale(),{maximumFractionDigits:3})
 useEffect(()=>{onBusy?.(draft.busy)},[draft.busy,onBusy])
 useEffect(()=>{const id=value?.submission?.id;if(!id||draft.busy||store.financialState?.phase!=='idle'||!store.wasteLog.some(row=>row.id===id)||recovered.current===id)return;recovered.current=id;draft.workspace.recheck()},[value?.submission?.id,draft.busy,store.financialState?.phase,store.wasteLog])
 async function run(work){setError('');try{return await work()}catch(cause){setError(cause.message);return false}}
 useImperativeHandle(ref,()=>({start:product=>run(async()=>{trigger.current=document.activeElement;const ready=await draft.start(product);setGuard(!ready);setOpen(true)})}))
 useEffect(()=>{if(open)(panel.current?.querySelector('select:enabled,input:enabled')||panel.current?.querySelector('button:enabled'))?.focus({preventScroll:true});else if(trigger.current&&document.contains(trigger.current))trigger.current.focus({preventScroll:true})},[open,guard])
 function close(){run(()=>{draft.close();setOpen(false);setGuard(false)})}
 function keyboard(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!draft.busy)close()}if(event.key==='Tab'){const nodes=[...panel.current.querySelectorAll('button,input,select')].filter(node=>node.getClientRects().length&&node.matches(':enabled')),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}}
 let quantity=null,quantityError='';try{if(value?.quantity){quantity=wasteEntryQuantity(value.quantity);if(current&&quantity>current.stock)throw Error('損耗數量超過目前可用庫存，請先核對')}}catch(cause){quantityError=cause.message}
 return <section className="waste-entry-workspace" data-waste-entry-ready={draft.ready}>
  {!open&&<WorkspaceDraftNotice draft={notice}/>}{!open&&value&&<button type="button" className="btn btn-primary" data-waste-entry-resume disabled={!draft.ready||draft.busy} onClick={()=>run(async()=>{trigger.current=document.activeElement;if(await draft.resume()){setGuard(false);setOpen(true)}})}>{tr(draft.pending?'核對原損耗':'接著完成損耗記錄')}</button>}
  {!open&&error&&<p role="alert">{trMessage(error)}</p>}{!open&&draft.message&&<p role="status">{trMessage(draft.message)}</p>}
  {open&&value&&createPortal(<div className="waste-entry-overlay" style={{top:viewport.top,height:viewport.height,bottom:'auto'}}><section ref={panel} className="waste-entry-dialog" role="dialog" aria-modal="true" aria-labelledby={prefix+'-title'} data-waste-entry-dialog onKeyDown={keyboard}>
   <header><h2 id={prefix+'-title'}>{tr('記錄損耗')}</h2><button type="button" className="btn btn-ghost" data-waste-entry-close aria-label={tr('關閉損耗表單')} disabled={draft.busy} onClick={close}>×</button></header><WorkspaceDraftNotice draft={notice}/>
   {guard?<section data-waste-entry-guard><p>{tr('還有另一份未完成的損耗，請先接回核對。')}</p><p>{value.product?.name} · {tr(value.product?.unit||'')}</p><button type="button" className="btn btn-primary" data-waste-entry-guard-resume disabled={draft.busy||draft.blocked} onClick={()=>run(async()=>{if(await draft.resume())setGuard(false)})}>{tr('接回原損耗')}</button></section>:<>
    <p className="waste-entry-hint">{tr('確認已實際耗用或丟棄，再記錄。')}</p>
    <form onSubmit={event=>{event.preventDefault();run(()=>draft.save())}}><fieldset disabled={locked}>
     <label htmlFor={prefix+'-product'}>{tr('商品')}<select id={prefix+'-product'} className="field" data-waste-entry-product value={value.product?.id||''} onChange={event=>run(()=>draft.selectProduct(event.target.value))}><option value="">{tr('— 請選擇 —')}</option>{value.product&&!store.products.some(row=>row.id===value.product.id)&&<option value={value.product.id}>{value.product.name}</option>}{store.products.map(row=><option key={row.id} value={row.id}>{row.name} · {tr(row.unit||'')}</option>)}</select></label>
     <label htmlFor={prefix+'-quantity'}>{tr('數量')}{value.product&&<span className="waste-entry-unit">{tr(value.product.unit)}</span>}<input id={prefix+'-quantity'} className="field" data-waste-entry-quantity inputMode="decimal" autoComplete="off" maxLength={2000} value={value.quantity} onChange={event=>draft.field('quantity',event.target.value)}/></label>
     <label htmlFor={prefix+'-reason'}>{tr('原因')}<select id={prefix+'-reason'} className="field" data-waste-entry-reason value={value.reason} onChange={event=>draft.field('reason',event.target.value)}>{WASTE_REASONS.map(reason=><option key={reason} value={reason}>{tr(reason)}</option>)}</select></label>
    </fieldset>
    {current&&quantity&&!quantityError&&<p className="waste-entry-preview" data-waste-entry-preview>{tr('可用庫存')}<strong>{number(current.stock)} → {number((Math.round(current.stock*1000)-Math.round(quantity*1000))/1000)} {tr(value.product?.unit||'')}</strong></p>}
    {!draft.pending&&draft.changed&&<section className="waste-entry-review" data-waste-entry-changed><p>{tr('商品或單位已更新，請先核對這筆損耗。')}</p>{current&&<><p>{current.name} · {tr(current.unit||'')}</p><button type="button" className="btn btn-ghost" data-waste-entry-rebind disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.rebind())}>{tr('確認商品與單位')}</button></>}</section>}
    {(error||quantityError)&&<p role="alert" data-waste-entry-error>{trMessage(error||quantityError)}</p>}{draft.message&&<p role="status">{trMessage(draft.message)}</p>}
    <div className="waste-entry-actions">{draft.pending?<><button type="button" className="btn btn-primary" data-waste-entry-check disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.checkOriginal())}>{tr('核對原損耗')}</button>{draft.retryAllowed&&<button type="button" className="btn btn-ghost" data-waste-entry-retry disabled={draft.busy||draft.blocked} onClick={()=>run(()=>draft.save())}>{tr('用原編號再核對')}</button>}</>:<><button type="submit" className="btn btn-primary" data-waste-entry-save disabled={locked||!value.product||!quantity||!!quantityError||draft.changed}>{tr('確認記錄')}</button><button type="button" className="btn btn-ghost" data-waste-entry-later disabled={draft.busy} onClick={close}>{tr('稍後再填')}</button></>}</div>
    </form>{!draft.pending&&<button type="button" className="btn btn-ghost waste-entry-discard" data-waste-entry-discard disabled={draft.busy||draft.blocked} onClick={()=>run(()=>{if(draft.discard())setOpen(false)})}>{tr('放棄這份輸入')}</button>}
   </>}
  </section></div>,document.body)}
 </section>
})
