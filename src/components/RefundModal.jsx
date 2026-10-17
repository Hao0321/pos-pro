import {useEffect,useMemo,useRef,useState} from 'react'
import {X} from 'lucide-react'
import {tr,trMessage,getLocale} from '../i18n'
import {loadRefundContext,previewRefund} from '../utils/dataAccess'
import {readPendingFinancial} from '../utils/financialCommand'
import {refundDraftKey,readRefundDraft,saveRefundDraft,clearRefundDraft,parseRefundQuantity} from '../utils/refundDraft'
import {REFUND_PREVIEW,assertRefundReviewShape} from '../../electron/refundReview.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import './RefundModal.css'

export default function RefundModal({order,onClose,onRefund,session,priorRefunds=[],products=[],retryFinancial,onRecovery,loadContext=loadRefundContext,requestPreview=previewRefund}){
  const [quantities,setQuantities]=useState({}),[reason,setReason]=useState(''),[context,setContext]=useState(null),[preview,setPreview]=useState(null),[confirmed,setConfirmed]=useState(false)
  const [busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[draftError,setDraftError]=useState(''),[corrupt,setCorrupt]=useState(null),[retry,setRetry]=useState(0),[all,setAll]=useState(false),[pending,setPending]=useState(null)
  const draft=useRef({key:null,raw:null}),finished=useRef(false),gate=useRef(false),formRef=useRef(null)
  useEffect(()=>{
    let active=true;setReady(false);setError('')
    ;(async()=>{try{
      const current=readPendingFinancial()
      if(current&&current.kind!=='refund'||current?.kind==='refund'&&current.request.refundOf!==order.id)throw Error('上一筆異動結果尚未確認。請先核對原單。')
      const ctx=await loadContext(session);if(!active)return
      if(!ctx?.storeId||!ctx.epoch)throw Error('店面資料尚未準備好，請重新開啟退貨')
      const key=refundDraftKey(ctx,session,order.id);draft.current={key,raw:null};setContext(ctx)
      if(current){try{const saved=readRefundDraft(key);if(saved.value?.preview?.review&&canonicalSignature(saved.value.preview.review)===canonicalSignature(current.request.review))draft.current.raw=saved.raw}catch{};setPending(current);setPreview(current.request.review?{input:current.request,review:current.request.review}:null);setQuantities(Object.fromEntries(current.request.items.map(row=>[row.id,String(row.qty)])));setReason(current.request.reason||'');setReady(true);return}
      try{const saved=readRefundDraft(key);draft.current.raw=saved.raw;setQuantities(saved.value?.quantities||{});setReason(saved.value?.reason||'');setPreview(null);setCorrupt(null);setDraftError('')}
      catch(e){setCorrupt(e.draftRaw??'');setDraftError(e.message)}
      setReady(true)
    }catch(e){if(active)setError(e.message)}})()
    return()=>{active=false}
  },[order.id,session?.userId,session?.role,loadContext])
  useEffect(()=>{
    if(!ready||!draft.current.key||pending||corrupt!==null||finished.current)return
    try{draft.current.raw=saveRefundDraft(draft.current.key,{quantities,reason,preview});setDraftError('')}
    catch{setDraftError('退貨草稿尚未保存，請重試')}
  },[quantities,reason,preview,ready,pending,corrupt,retry])
  useEffect(()=>{formRef.current?.querySelector('button')?.focus({preventScroll:true})},[])
  const rows=useMemo(()=>order.items.map(row=>{
    const returned=priorRefunds.reduce((sum,refund)=>sum+(refund.items||[]).filter(item=>item.id===row.id).reduce((n,item)=>n+Math.round(Math.abs(item.qty)*1000),0),0),remaining=Math.max(0,Math.round(row.qty*1000)-returned)
    const raw=quantities[row.id]??'';let qty=0,issue=''
    try{qty=parseRefundQuantity(raw,remaining)}catch(e){issue=e.message}
    return {...row,unit:preview?.rows?.find(item=>item.id===row.id)?.unit||products.find(item=>item.id===row.id)?.unit||'',raw,remaining,qty,issue}
  }),[order.items,priorRefunds,quantities,products,preview])
  const valid=rows.some(row=>row.qty>0)&&!rows.some(row=>row.issue),locked=busy||!!pending||!ready||corrupt!==null
  const money=cents=>'NT$ '+(cents/100).toLocaleString(getLocale(),{minimumFractionDigits:2,maximumFractionDigits:2})
  function change(id,raw){setQuantities(old=>({...old,[id]:raw}));setPreview(null);setConfirmed(false);setError('')}
  function readPending(){try{const value=readPendingFinancial();if(value?.kind==='refund'&&value.request.refundOf===order.id){setPending(value);return value}}catch(e){setError(e.message)}return null}
  async function showPreview(){
    if(!valid||locked||gate.current)return;gate.current=true;setBusy(true);setError('')
    try{
      const ctx=await loadContext(session);setContext(ctx)
      if(!ctx.openShift)throw Error('請先開班，再核對退款')
      const input={refundOf:order.id,items:rows.filter(row=>row.qty>0).map(row=>({id:row.id,qty:row.qty})).sort((a,b)=>a.id.localeCompare(b.id)),reason,cashier:session.username,shiftId:ctx.openShift.id}
      const result=await requestPreview(input,session)
      if(result?.protocol!==REFUND_PREVIEW||result.success!==true||canonicalSignature(result.input)!==canonicalSignature(input)||result.review?.storeId!==ctx.storeId||result.review?.epoch!==ctx.epoch)throw Error('退款預覽不完整，請重新核對')
      assertRefundReviewShape(result.review);setPreview(result);setConfirmed(false)
    }catch(e){setError(e.message);setPreview(null)}finally{gate.current=false;setBusy(false)}
  }
  async function submit(){
    if(gate.current||!preview||!confirmed||locked||draftError)return;gate.current=true;setBusy(true);setError('')
    try{
      const result=await onRefund(order,preview.input.items,{reason:preview.input.reason,cashier:preview.input.cashier,shiftId:preview.input.shiftId,review:preview.review})
      if(!result)throw Error('退款回覆不完整，請保留原編號核對')
      finished.current=true;try{clearRefundDraft(draft.current.key,draft.current.raw)}catch{}
      onClose()
    }catch(e){setError(e.message);const original=readPending();if(!original&&e.notCommitted){setPreview(null);setConfirmed(false)}}finally{gate.current=false;setBusy(false)}
  }
  async function recover(){
    if(gate.current||!retryFinancial)return;gate.current=true;setBusy(true);setError('')
    try{const result=await retryFinancial();if(!result)throw Error('退款回覆不完整，請保留原編號核對');finished.current=true;try{clearRefundDraft(draft.current.key,draft.current.raw)}catch{};setPending(null);onClose()}
    catch(e){setError(e.message);if(e.notCommitted){setPending(null);setPreview(null);setConfirmed(false)}else readPending()}
    finally{gate.current=false;setBusy(false)}
  }
  function close(){if(!busy&&!pending&&!readPending())onClose()}
  useEffect(()=>{
    const keydown=event=>{
      if(event.key==='Escape'){event.preventDefault();close()}
      if(event.key==='Tab'){
        const controls=[...formRef.current.querySelectorAll('button,input,summary')].filter(row=>!row.disabled&&row.getClientRects().length),first=controls[0],last=controls.at(-1)
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
      }
    }
    const node=formRef.current;node.addEventListener('keydown',keydown);return()=>node.removeEventListener('keydown',keydown)
  },[busy,pending])
  function download(){const value=JSON.stringify({protocol:'pos-refund-support-draft/v1',orderId:order.id,quantities,reason,preview,pending,originalRaw:corrupt},null,2),url=URL.createObjectURL(new Blob([value],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='refund-draft.json';a.click();URL.revokeObjectURL(url)}
  const summary=preview?.review?.summary
  return <>
    <div className="refund-overlay" onClick={close}/>
    <section className="refund-modal" role="dialog" aria-modal="true" aria-labelledby="refund-title" ref={formRef}>
      <header><h2 id="refund-title">{tr('退貨、退款')}</h2><button aria-label={tr('關閉')} onClick={close} disabled={busy||!!pending}><X size={22}/></button></header>
      <div className="refund-body">
        <p className="refund-subtle">{order.id} · {new Date(order.time).toLocaleString(getLocale())}</p>
        {!ready&&!error&&<p role="status">{tr('正在讀取退貨資料…')}</p>}
        {pending?<><p>{tr('上次退貨需要核對，請沿用原單。')}</p><p className="refund-subtle">{pending.request.id}</p>{pending.request.items.map(row=><p key={row.id}>{order.items.find(item=>item.id===row.id)?.name||row.id} × {row.qty}</p>)}</>:<p>{tr(preview?'2 看退款':'1 填退回數量')}</p>}
        {!pending&&(all?rows:rows.slice(0,4)).map(row=><div className="refund-item" key={row.id}>
          <div className="refund-item-name">{row.name}</div><div className="refund-subtle">{tr('還可退 {0}',{0:row.remaining/1000})}{row.unit?' '+row.unit:''}</div>
          <div className="refund-qty"><input className="field" type="text" inputMode="decimal" data-refund-qty={row.id} aria-label={tr('退回數量：{0}',{0:row.name})} value={row.raw} maxLength={64} onChange={e=>change(row.id,e.target.value)} disabled={locked||row.remaining===0} aria-invalid={!!row.issue}/><button className="btn" onClick={()=>change(row.id,String(row.remaining/1000))} disabled={locked||row.remaining===0}>{tr('全退')}</button><button className="btn" onClick={()=>change(row.id,'')} disabled={locked||row.remaining===0}>{tr('清空')}</button></div>
          {row.issue&&<p role="alert" className="refund-error">{trMessage(row.issue)}</p>}
        </div>)}
        {!pending&&rows.length>4&&<button className="btn" onClick={()=>setAll(value=>!value)}>{tr(all?'收起其他商品':'其他商品 {0} 項',{0:rows.length-4})}</button>}
        {!pending&&<details><summary>{tr('填原因（選填）')}</summary><input className="field" value={reason} maxLength={1000} aria-label={tr('退貨原因（選填）')} onChange={e=>{setReason(e.target.value);setPreview(null);setConfirmed(false)}} disabled={locked}/></details>}
        {summary&&<div className="refund-total" data-refund-summary><span>{tr('這次退回')}</span><strong>{money(summary.totalReturnedCents)}</strong>{[['cashCents','退現金'],['cardCents','退原刷卡款'],['balanceCents','退回儲值']].filter(([key])=>summary[key]>0).map(([key,label])=><div className="refund-tender" key={key}><span>{tr(label)}</span><b>{money(summary[key])}</b></div>)}
          {summary.pointsDelta!==0&&<div className="refund-tender"><span>{tr('點數調整')}</span><b>{summary.pointsDelta>0?'+':''}{summary.pointsDelta}</b></div>}
          {summary.cardCents>0&&<p>{tr('刷卡退款請到原刷卡工具完成；這裡保存退貨紀錄。')}</p>}
          <details><summary>{tr('查看分攤明細')}</summary>{[['subtotalCents','退貨小計'],['discountCents','沖回折抵'],['manualDiscountCents','沖回手動折讓']].map(([key,label])=><div className="refund-tender" key={key}><span>{tr(label)}</span><span>{money(summary[key])}</span></div>)}</details>
        </div>}
        {draftError&&<div role="alert" className="refund-error"><p>{trMessage(draftError)}</p><button className="btn" onClick={()=>{if(corrupt===null)setRetry(n=>n+1);else{try{readRefundDraft(draft.current.key);setCorrupt(null);setDraftError('')}catch(e){setDraftError(e.message)}}}} disabled={busy}>{tr('重試保存草稿')}</button><button className="btn" onClick={download}>{tr('下載草稿')}</button></div>}
        {error&&<p role="alert" className="refund-error">{trMessage(error)}</p>}
        {pending?<><button className="btn btn-primary refund-primary" onClick={recover} disabled={busy||!retryFinancial}>{tr(busy?'處理中...':'核對上次退貨')}</button>{onRecovery&&<button className="btn refund-primary" onClick={onRecovery} disabled={busy}>{tr('資料復原')}</button>}</>:preview?<><label className="refund-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>{tr('金額與退款方式都對')}</label><button className="btn btn-primary refund-primary" onClick={submit} disabled={!confirmed||locked||!!draftError}>{tr(busy?'處理中...':'3 確認退貨')}</button></>:<button className="btn btn-primary refund-primary" onClick={showPreview} disabled={!valid||locked||!!draftError}>{tr(busy?'處理中...':'看退款')}</button>}
      </div>
    </section>
  </>
}
