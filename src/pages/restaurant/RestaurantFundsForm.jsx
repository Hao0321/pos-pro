import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage} from '../../i18n'
import useVisibleViewport from '../../hooks/useVisibleViewport'
import {previewRestaurantFundsForm,fundsAmountText} from '../../utils/restaurantFundsView.mjs'

const reasons={customer:'客人改單',soldout:'餐點售完',other:'其他原因'},control={minHeight:48},buttons={display:'flex',gap:10,flexWrap:'wrap',marginTop:12}
const money=value=>'NT$ '+fundsAmountText(value)
function downloadInput(controller){try{const text=controller.exportText(),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='POS-保留收款輸入.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch{controller.reportError('輸入檔案尚未下載，請保留畫面。')}}
export function RestaurantFundsNotice({controller}){
 if(controller.form&&!controller.visible)return <button className="btn btn-primary" data-funds-resume style={{...control,marginBottom:12}} onClick={controller.resume}>{tr('繼續上次輸入')}</button>
 if(controller.draftError&&!controller.form)return <section><p role="alert">{trMessage(controller.draftError)}</p><div style={buttons}><button type="button" className="btn btn-ghost" style={control} onClick={controller.read}>{tr('重新核對保留輸入')}</button><button type="button" className="btn btn-ghost" style={control} onClick={()=>downloadInput(controller)}>{tr('下載保留輸入')}</button></div></section>
 return null
}
export function fundsFormReason(form){return form.fields.reasonKey==='other'?form.fields.reasonDetail.trim():tr(reasons[form.fields.reasonKey]||'客人改單')}
export default function RestaurantFundsForm({controller,data,session,shiftId=''}){
 const viewport=useVisibleViewport(),dialog=useRef(null),current=useRef(controller),[confirmed,setConfirmed]=useState(false);current.current=controller
 const {form,visible,busy,writing,draftError,error,errorDetail,pending,pendingError}=controller
 useEffect(()=>setConfirmed(false),[form])
 useEffect(()=>{
  if(!visible||!form)return
  const previous=document.activeElement,controls=()=>[...dialog.current?.querySelectorAll('input,select,textarea,button')||[]].filter(node=>!node.disabled&&node.getClientRects().length)
  const initial=dialog.current?.querySelector('[data-funds-initial]');(initial&&!initial.disabled?initial:controls()[0])?.focus()
  const keys=event=>{
   if(!dialog.current||!['Tab','Escape','F1','F2','F3'].includes(event.key))return
   event.stopPropagation()
   if(event.key==='Escape'){event.preventDefault();current.current.close();return}
   if(event.key!=='Tab'){event.preventDefault();return}
   const nodes=controls(),first=nodes[0],last=nodes.at(-1);if(!first)return
   if(!dialog.current.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus()}
   else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
  window.addEventListener('keydown',keys,true)
  return()=>{window.removeEventListener('keydown',keys,true);if(previous?.isConnected)previous.focus()}
 },[visible,form?.formId])
 if(!visible||!form)return null
 const locked=busy||!!form.operation||!!pending||!!pendingError,fields=form.fields,entry=data?.entries.find(row=>row.id===form.review.entryId),reason=fundsFormReason(form)
 let preview=null,issue=''
 if(!form.operation)try{preview=previewRestaurantFundsForm(entry,form,{state:data,actor:session,shiftId,reason})}catch(error){issue=error.message}
 const stale=!form.operation&&(!entry||entry.version!==form.review.entryVersion),needsShift=preview?.needsShift&&!shiftId
 const refundByMethod=preview?['cash','card'].map(method=>({method,amount:preview.event.refunds.filter(row=>row.method===method).reduce((sum,row)=>sum+row.amountCents,0)})).filter(row=>row.amount):[]
 const title=form.mode==='receive'?'收款':form.mode==='refund'?'退回款項':'取消餐點'
 const changeAmount=raw=>controller.edit({amount:raw,...(!fields.customPaid?{paid:raw}:{})})
 const exportInput=()=>downloadInput(controller)
 return createPortal(<div style={{position:'fixed',inset:0,zIndex:230,background:'rgba(0,0,0,.45)'}}>
  <form ref={dialog} role="dialog" aria-modal="true" aria-label={tr(title)} data-restaurant-funds-form={form.mode} data-funds-entry={form.review.entryId} className="card" style={{position:'fixed',left:16,right:16,top:viewport.top+16,maxHeight:Math.max(120,viewport.height-32),overflowY:'auto',maxWidth:480,margin:'0 auto',padding:20,overflowWrap:'anywhere'}} onSubmit={event=>{event.preventDefault();if(confirmed&&preview&&!locked&&!writing&&!draftError&&!needsShift)controller.submit(reason)}}>
   <h3>{tr(title)}</h3><p>{tr('取餐號 {0}',{0:String(form.review.pickupNumber).padStart(3,'0')})}{form.review.customer?' · '+form.review.customer:''}</p>
   {form.operation?<p role="status">{tr('上次輸入已保留，請核對原紀錄。')}</p>:<p>{tr('已收 {0}，還差 {1}',{0:money(form.review.retainedCents),1:money(form.review.dueCents)})}</p>}
   {form.mode==='receive'&&<>
    <label style={field}>{tr('這次收多少')}<input data-funds-initial data-funds-amount aria-label={tr('這次收多少')} className="field" style={control} inputMode="decimal" value={fields.amount} maxLength={32} disabled={locked} onChange={event=>changeAmount(event.target.value)}/></label>
    <div style={buttons}><button type="button" className="btn btn-ghost" style={control} disabled={locked} onClick={()=>changeAmount(fundsAmountText(form.review.dueCents))}>{tr('收齊剩餘款項')}</button></div>
    <label style={field}>{tr('付款方式')}<select data-funds-method aria-label={tr('付款方式')} className="field" style={control} value={fields.method} disabled={locked} onChange={event=>controller.edit({method:event.target.value})}><option value="cash">{tr('現金')}</option><option value="card">{tr('刷卡／轉帳（非現金）')}</option></select></label>
    {fields.method==='cash'&&<label style={check}><input type="checkbox" data-funds-change checked={fields.customPaid} disabled={locked} onChange={event=>controller.edit({customPaid:event.target.checked,...(!fields.customPaid?{paid:fields.amount}:{})})}/>{tr('客人多給了，需要找零')}</label>}
    {fields.method==='cash'&&fields.customPaid&&<label style={field}>{tr('客人給了多少')}<input data-funds-paid aria-label={tr('客人給了多少')} className="field" style={control} inputMode="decimal" maxLength={32} value={fields.paid} disabled={locked} onChange={event=>controller.edit({paid:event.target.value})}/></label>}
   </>}
   {form.mode==='refund'&&<label style={field}>{tr('這次退多少')}<input data-funds-initial data-funds-amount aria-label={tr('這次退多少')} className="field" style={control} inputMode="decimal" maxLength={32} value={fields.amount} disabled={locked} onChange={event=>controller.edit({amount:event.target.value})}/></label>}
   {form.mode==='cancel'&&<>
    <label style={check}><input data-funds-initial data-funds-cancel-all type="checkbox" checked={fields.all} disabled={locked} onChange={event=>controller.edit({all:event.target.checked})}/>{tr('整張取消')}</label>
    {form.review.items.map(item=><div key={item.id} style={{margin:'10px 0'}}><strong>{item.name} × {item.qty}</strong>{!fields.all&&<label style={field}>{tr('取消幾份')}<input data-funds-cancel-qty={item.id} aria-label={tr('取消幾份 {0}',{0:item.name})} className="field" style={control} inputMode="numeric" maxLength={16} value={fields.quantities.find(row=>row.id===item.id)?.qty??''} disabled={locked} onChange={event=>controller.edit({quantities:fields.quantities.map(row=>row.id===item.id?{...row,qty:event.target.value}:row)})}/></label>}</div>)}
    <p>{tr(form.review.prepared?'已開始製作，食材會計入損耗。':'未製作的庫存會釋放。')}</p>
   </>}
   {form.mode!=='receive'&&<>
    <label style={field}>{tr('原因')}<select data-funds-reason className="field" style={control} aria-label={tr('原因')} value={fields.reasonKey} disabled={locked} onChange={event=>controller.edit({reasonKey:event.target.value})}>{Object.entries(reasons).map(([key,label])=><option value={key} key={key}>{tr(label)}</option>)}</select></label>
    {fields.reasonKey==='other'&&<label style={field}>{tr('其他原因')}<input data-funds-reason-detail aria-label={tr('其他原因')} className="field" style={control} maxLength={1000} value={fields.reasonDetail} disabled={locked} onChange={event=>controller.edit({reasonDetail:event.target.value})}/></label>}
   </>}
   {preview&&<section data-funds-preview style={{marginTop:12}}>
    {form.mode==='receive'?<>{fields.method==='cash'&&fields.customPaid&&<p>{tr('找給客人 {0}',{0:money(preview.event.changeCents)})}</p>}<p>{tr('收完還差 {0}',{0:money(preview.summary.dueCents)})}</p></>:<><p>{tr('這次退回 {0}',{0:money(preview.event.amountCents)})}</p>{refundByMethod.map(row=><p key={row.method}>{tr(row.method==='cash'?'現金退回 {0}':'刷卡／轉帳退回 {0}',{0:money(row.amount)})}</p>)}<p>{tr('處理後還差 {0}',{0:money(preview.summary.dueCents)})}</p></>}
   </section>}
   {issue&&<p data-funds-preview-error role="status">{trMessage(issue)}</p>}
   {stale&&!locked&&<button className="btn btn-ghost" type="button" data-funds-refresh style={control} onClick={controller.refresh}>{tr('核對最新工作單')}</button>}
   {needsShift&&<p>{tr('請先到班別交班開班，再登記收款。')}</p>}
   {(error||draftError||pendingError)&&<p role="alert">{trMessage(draftError||pendingError||error)}</p>}
   {error&&errorDetail&&!draftError&&!pendingError&&<details><summary>{tr('查看原因')}</summary><p>{trMessage(errorDetail)}</p></details>}
   {pending&&!form.operation&&<p>{tr('上一筆異動結果尚未確認。請先核對原單。')}</p>}
   {draftError&&<div style={buttons}>{!form.operation&&<button className="btn btn-ghost" type="button" style={control} onClick={controller.retrySave}>{tr('重試保存輸入')}</button>}<button className="btn btn-ghost" type="button" style={control} onClick={exportInput}>{tr('下載保留輸入')}</button></div>}
   {form.operation?<button className="btn btn-primary" data-funds-recover type="button" style={{...control,width:'100%',marginTop:12}} disabled={busy||writing||!!pendingError} onClick={controller.recover}>{tr('核對原紀錄')}</button>:<>
    <label style={check}><input data-funds-confirm type="checkbox" checked={confirmed} disabled={locked||writing||!preview||!!draftError||needsShift} onChange={event=>setConfirmed(event.target.checked)}/>{tr(form.mode==='receive'?'我已收到這筆款項':preview?.event.amountCents?'我已核對並退回上述款項':'我已核對取消餐點')}</label>
    <button className="btn btn-primary" data-funds-submit type="submit" style={{...control,width:'100%'}} disabled={!confirmed||!preview||locked||writing||!!draftError||needsShift}>{tr(form.mode==='receive'?'保存這次收款':form.mode==='refund'?'保存這次退款':'確認取消')}</button>
   </>}
   <div style={buttons}><button className="btn btn-ghost" type="button" data-funds-close disabled={busy||writing||!!draftError} style={control} onClick={controller.close}>{tr('返回工作單')}</button>{!form.operation&&!pending&&!pendingError&&<button className="btn btn-ghost" type="button" data-funds-discard disabled={busy||writing} style={control} onClick={controller.discard}>{tr('清除此輸入')}</button>}</div>
   {form.operation&&<details style={{marginTop:12}}><summary>{tr('原單資料')}</summary><small>{form.operation.id}</small></details>}
  </form>
 </div>,document.body)
}
const field={display:'flex',flexDirection:'column',gap:6,marginTop:12},check={display:'flex',alignItems:'center',gap:10,minHeight:48,marginTop:8}
