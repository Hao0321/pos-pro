import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../../i18n'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import {loadLotState,loadPurchases} from '../../utils/dataAccess'
import {readPendingFinancial} from '../../utils/financialCommand'
import useArchivedDraft from '../../hooks/useArchivedDraft'
import {supplierLotReturnDraftKey} from '../../utils/receiptLotDraftReceipt.mjs'
import {emptySupplierReturnDraft,validSupplierReturnDraft,beginSupplierReturnDraft,mergeSupplierReturnChoices,supplierReturnSources,supplierReturnPreview,supplierReturnCommand,supplierReturnHandoff,readSupplierReturnAgent} from '../../utils/supplierLotReturnDraft.mjs'
import '../../styles/arrival.css'

const money=n=>'NT$ '+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})
const options={empty:emptySupplierReturnDraft,valid:validSupplierReturnDraft,maxLength:1000000,message:'退貨草稿讀不到，請保留原輸入',prefix:'pos-supplier-return-draft:',fileName:'supplier-return-draft.json',archiveName:'supplier-return-draft'}
export default function SupplierLotReturnModal({po:initial,state:initialState,store,session,onClose,onSaved}){
 const [po,setPo]=useState(initial),[state,setState]=useState(initialState),[review,setReview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[changed,setChanged]=useState(false),gate=useRef(false),heading=useRef(null)
 const key=supplierLotReturnDraftKey(state.context.storeId,session.userId,session.role,po.id),draft=useArchivedDraft(key,options),form=draft.form
 let pending=null,pendingError='';try{pending=readPendingFinancial()}catch(cause){pendingError=cause.message}
 const ownPending=pending?.kind==='purchase-return-lots'&&pending.request.id===form.command?.identity.id,original=form.attempted||ownPending,locked=busy||!draft.status.ready||!!draft.status.error||!!pending||!!pendingError||original
 const stale=changed||!!form.purchaseSignature&&(form.purchaseSignature!==canonicalSignature(po)||form.epoch!==state.context.epoch),location=id=>id==='main'?tr('店面'):state.locations.find(row=>row.id===id)?.label||id
 useEffect(()=>{if(draft.status.ready&&!form.purchaseSignature)draft.setForm(beginSupplierReturnDraft(po,state))},[draft.status.ready,form.purchaseSignature])
 useEffect(()=>{heading.current?.focus({preventScroll:true})},[!!review,original])
 function change(update){if(locked)return;setError('');draft.setForm(old=>({...update(old),command:null,attempted:false}))}
 async function inspect(){
  if(gate.current||locked)return;gate.current=true;setBusy(true);setError('')
  try{const [next,purchases,supplierState]=await Promise.all([loadLotState(session),loadPurchases([]),store.refreshSuppliers()]),current=purchases.find(row=>row.id===po.id)
   if(!current||canonicalSignature(current)!==form.purchaseSignature||next.context.epoch!==form.epoch||next.context.storeId!==state.context.storeId){setChanged(true);throw Error('原單或退貨庫存已變更，請保留原輸入重新核對')}
   setState(next);const preview=supplierReturnPreview(form,current,next);draft.setForm(old=>({...old,received:false,creditAccepted:false,command:null}));draft.save();setReview({...preview,po:current,supplierState})
  }catch(cause){setError(cause.message)}finally{gate.current=false;setBusy(false)}
 }
 async function restart(){
  if(gate.current||locked)return;gate.current=true;setBusy(true);setError('')
  try{const [next,purchases]=await Promise.all([loadLotState(session),loadPurchases([])]),current=purchases.find(row=>row.id===po.id)
   if(!next.active||next.context.storeId!==state.context.storeId||!current||!supplierReturnSources(current).length)throw Error('這張單已無可退數量，請先查看原單')
   draft.keepAndReset(beginSupplierReturnDraft(current,next));setPo(current);setState(next);setChanged(false);setReview(null)
  }catch(cause){setError(cause.message)}finally{gate.current=false;setBusy(false)}
 }
 async function save(){
  if(gate.current||!draft.status.ready||draft.status.error||pendingError||pending&&!ownPending||!original&&!review)return;gate.current=true;setBusy(true);setError('')
  try{const command=original?form.command:supplierReturnCommand(form,review.po,state,review.supplierState)
   if(!command)throw Error('請先核對上一筆操作');draft.setForm(old=>({...old,command,attempted:true}));draft.save()
   const result=pending?await store.retryFinancial():await store.commitInventory('purchase-return-lots',command.input,command.identity)
   if(result?.receipt?.id!==command.identity.id||result.receipt.kind!=='purchase-return-lots')throw Error('請先核對上一筆操作')
   draft.close(emptySupplierReturnDraft(),true);onSaved(result)
  }catch(cause){setError(cause.message);if(cause.notCommitted){draft.setForm(old=>({...old,attempted:false,command:null,received:false,creditAccepted:false}));draft.save();setReview(null)}}finally{gate.current=false;setBusy(false)}
 }
 const creditSources=supplierReturnSources(po),creditSource=creditSources.find(row=>row.id===form.invoiceId),choices=mergeSupplierReturnChoices(form,po,state).rows
 return <div className="arrival-overlay"><section className="arrival-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-return-heading" data-supplier-return>
  <header><h2 id="supplier-return-heading" ref={heading} tabIndex={-1}>{tr(original?'核對原退貨':review?'確認這次退貨':'這次退回哪些貨？')}</h2><button className="btn" data-supplier-return-close disabled={busy} onClick={onClose}>{tr('關閉')}</button></header>
  {(error||draft.status.error||pendingError)&&<p role="alert" className="arrival-error">{trMessage(error||draft.status.error||pendingError)}</p>}
  {draft.status.waiting&&<p role="status">{tr('草稿正在另一個視窗使用')}</p>}
  {stale&&!original&&<div data-supplier-return-stale><p role="alert">{tr('原單或退貨庫存已變更，請保留原輸入重新核對')}</p><button className="btn" data-supplier-return-reset disabled={locked} onClick={restart}>{tr('保留舊稿，重新填')}</button></div>}
  {original?<><p>{tr('先核對原編號，不會另外退一次。')}</p><code>{form.command?.identity.id}</code><button className="btn btn-primary arrival-save" data-supplier-return-original disabled={busy||!!pending&&!ownPending||!!draft.status.error} onClick={save}>{tr('核對原退貨')}</button></>:review?<>
   <div data-supplier-return-review>{review.review.map((row,index)=><article key={index}><strong>{row.name}</strong><p>{location(row.locationId)} · {row.code||tr('未標批號')} · {tr(row.kind==='quarantined'?'暫停販售':'可退庫存')}</p><strong>{row.quantityUnits/1000} {row.unit}</strong></article>)}</div>
   <p>{tr('折抵哪張單？')} {creditSource?.id?creditSource.label:tr('尚未請款的貨')}</p><strong style={{fontSize:28}}>{tr('本次折抵 {0}',{0:money(review.amount)})}</strong>
   <label>{tr('退貨單號或確認人')}<input className="field" data-supplier-return-reference maxLength={200} value={form.reference} onChange={e=>change(old=>({...old,reference:e.target.value}))}/></label>
   <label style={{display:'flex',alignItems:'center',gap:12,minHeight:56}}><input style={{width:24,minHeight:24,height:24,flexShrink:0}} type="checkbox" data-supplier-return-confirm checked={form.received&&form.creditAccepted} onChange={e=>change(old=>({...old,received:e.target.checked,creditAccepted:e.target.checked}))}/>{tr('貨已退回，供應商同意折抵 {0}',{0:money(review.amount)})}</label>
   <details><summary>{tr('還在運送，或折抵金額不同？')}</summary><p>{tr('先保留草稿，等供應商確認原單金額再保存。收到退款後另外記錄。')}</p><p>{tr('選到的實物批次不代表原供應商來源；請與供應商核對。')}</p></details>
   <button className="btn btn-primary arrival-save" data-supplier-return-save disabled={busy||!form.received||!form.creditAccepted||!form.reference.trim()} onClick={save}>{tr(busy?'保存中…':'確認，這批已退回')}</button><button className="btn" disabled={busy} onClick={()=>{setReview(null);change(old=>({...old,received:false,creditAccepted:false}))}}>{tr('返回修改')}</button>
  </>:<>
   <fieldset disabled={locked||stale}>
    <label>{tr('折抵哪張單？')}<select className="field" data-supplier-return-invoice value={form.invoiceId} onChange={e=>change(old=>({...old,invoiceId:e.target.value}))}>{creditSources.map(row=><option key={row.id} value={row.id}>{row.id?row.label:tr(row.label)}</option>)}</select></label>
    {po.items.map((item,lineIndex)=><article key={lineIndex}><h3>{item.name}</h3>{choices.map((row,index)=>{if(row.lineIndex!==lineIndex)return null;const fact=state.counting.rows.find(item=>item.key===row.key);return <label key={row.lineIndex+row.key}>{fact?<>{location(fact.locationId)} · {fact.code||tr('未標批號')} · {tr(fact.kind==='quarantined'?'暫停販售':'可退庫存')}</>:tr('這批已無可退數量，請清空這列')}<small>{tr('最多可退 {0} {1}',{0:(fact?.availableUnits||0)/1000,1:item.unit})}</small><input className="field" data-supplier-return-quantity={index} inputMode="decimal" value={row.quantity} onChange={e=>change(old=>({...old,rows:mergeSupplierReturnChoices(old,po,state).rows.map(r=>r.key===row.key&&r.lineIndex===row.lineIndex?{...r,quantity:e.target.value}:r)}))}/></label>})}</article>)}
    {!choices.length&&<p>{tr('目前沒有可退的實物庫存')}</p>}
    <label>{tr('退貨原因')}<select className="field" data-supplier-return-reason value={['品質不符','數量錯誤','協議退貨'].includes(form.reason)?form.reason:form.reason?'其他':''} onChange={e=>change(old=>({...old,reason:e.target.value==='其他'?'其他：':e.target.value}))}><option value="">{tr('請選原因')}</option>{['品質不符','數量錯誤','協議退貨','其他'].map(reason=><option key={reason} value={reason}>{tr(reason)}</option>)}</select></label>
    {form.reason.startsWith('其他')&&<input className="field" data-supplier-return-other value={form.reason} maxLength={500} onChange={e=>change(old=>({...old,reason:e.target.value}))}/>}
   </fieldset>
   <button className="btn btn-primary arrival-save" data-supplier-return-inspect disabled={locked||stale||!choices.length} onClick={inspect}>{tr('看退貨結果')}</button>
   <details><summary>{tr('讓 Agent 幫忙填')}</summary><button className="btn" disabled={locked||stale} onClick={async()=>{try{await navigator.clipboard.writeText(JSON.stringify(supplierReturnHandoff(po,state),null,2))}catch{setError('無法複製，請保留原輸入')}}}>{tr('複製給 Agent')}</button><label>{tr('貼上退貨草稿')}<textarea className="field" data-supplier-return-agent maxLength={65536} value={form.agentText} disabled={locked} onChange={e=>change(old=>({...old,agentText:e.target.value}))}/></label><button className="btn" data-supplier-return-agent-fill disabled={locked||stale} onClick={()=>{try{change(old=>readSupplierReturnAgent(old.agentText,po,state,old))}catch(cause){setError(cause.message)}}}>{tr('填入草稿')}</button></details>
  </>}
  <details><summary>{tr('保留原輸入')}</summary><button className="btn" onClick={draft.download}>{tr('下載草稿')}</button></details>
  {draft.archives.length>0&&<details data-supplier-return-archives><summary>{tr('已保留的舊稿')} ({draft.archives.length})</summary>{draft.archives.map((archive,index)=><button className="btn" key={archive} onClick={()=>{try{draft.downloadArchive(archive)}catch(cause){setError(cause.message)}}}>{tr('下載舊稿 {0}',{0:index+1})}</button>)}</details>}
 </section></div>
}
