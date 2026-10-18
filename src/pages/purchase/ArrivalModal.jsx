import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../../i18n'
import {loadLotState,loadPurchases} from '../../utils/dataAccess'
import {readPendingFinancial} from '../../utils/financialCommand'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import useReceiptDraft from '../../hooks/useReceiptDraft'
import {receiptLotDraftKey} from '../../utils/receiptLotDraftReceipt.mjs'
import {emptyReceiptDraft,beginReceiptDraft,newReceiptBatch,receiptDraftCommand,receiptAgentHandoff,readReceiptAgent} from '../../utils/receiptLotDraft.mjs'
import {ReceiveModal} from './PurchaseList'
import '../../styles/arrival.css'

export default function ArrivalModal(props){
 const [state,setState]=useState(null),[error,setError]=useState('')
 useEffect(()=>{let alive=true;loadLotState(props.session).then(value=>{if(alive)setState(value)}).catch(cause=>{if(alive)setError(cause.message)});return()=>{alive=false}},[props.po.id,props.session.userId])
 if(!state)return <div className="arrival-overlay"><section className="arrival-modal" role="dialog" aria-modal="true" aria-label={tr('確認到貨')}><p role={error?'alert':'status'}>{trMessage(error||'正在核對庫存…')}</p><button className="btn" onClick={props.onClose}>{tr('關閉')}</button></section></div>
 return state.active?<ReceiptForm {...props} state={state} setState={setState}/>:<ReceiveModal po={props.po} products={props.store.products} saving={props.saving} error={props.error} onConfirm={props.onLegacy} onClose={props.onClose}/>
}

function ReceiptForm({po,state,setState,store,session,suppliers,onClose,onSaved,onSourceUpdated}){
 const key=receiptLotDraftKey(state.context.storeId,session.userId,session.role,po.id)
 const draft=useReceiptDraft(key),form=draft.form
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState(null),[changedSource,setChangedSource]=useState(false),gate=useRef(false),heading=useRef(null)
 let pending=null,pendingError='';try{pending=readPendingFinancial()}catch(cause){pendingError=cause.message}
 const stale=changedSource||form.purchaseSignature&&form.purchaseSignature!==canonicalSignature(po)||form.epoch&&form.epoch!==state.context.epoch
 const locked=busy||!draft.status.ready||!!draft.status.error||!!pending||!!pendingError||form.attempted
 useEffect(()=>{if(draft.status.ready&&!form.purchaseSignature)draft.setForm(beginReceiptDraft(po,state.context))},[draft.status.ready,form.purchaseSignature])
 useEffect(()=>{heading.current?.focus({preventScroll:true})},[!!review,form.attempted])
 function change(update){if(locked)return;setReview(null);setError('');draft.setForm(old=>({...update(old),command:null,attempted:false}))}
 function batch(line,index,field,value){change(old=>({...old,rows:old.rows.map((row,i)=>i===line?{...row,batches:row.batches.map((b,j)=>j===index?{...b,[field]:value}:b)}:row)}))}
 function fill(){change(old=>({...old,rows:old.rows.map((row,index)=>row.batches.length>1?row:{...row,batches:[{...row.batches[0],quantity:String(Math.max(0,Math.round(po.items[index].qty*1000)-Math.round((po.items[index].received||0)*1000))/1000)}]})}));if(form.rows.some(row=>row.batches.length>1))setError('分批資料已保留，請逐批核對數量')}
 async function inspect(){
  if(gate.current||locked)return;gate.current=true;setBusy(true);setError('')
  try{const [next,purchases,supplierState]=await Promise.all([loadLotState(session),loadPurchases([]),store.refreshSuppliers()]);const current=purchases.find(row=>row.id===po.id);if(!current||canonicalSignature(current)!==form.purchaseSignature||next.context.epoch!==form.epoch){setChangedSource(true);throw Error('原進貨單或店面已變更，請先核對原收貨')}const command=receiptDraftCommand(form,current,next,suppliers,supplierState);draft.setForm(old=>({...old,command:{identity:command.identity,input:command.input}}));draft.save();setState(next);setReview(command.review)}catch(cause){setError(cause.message)}finally{gate.current=false;setBusy(false)}
 }
 async function restart(){
  if(gate.current||locked)return;gate.current=true;setBusy(true);setError('')
  try{const [next,purchases]=await Promise.all([loadLotState(session),loadPurchases([])]),current=purchases.find(row=>row.id===po.id);if(next.context.storeId!==state.context.storeId||!next.active)throw Error('店面已變更，請保留原輸入重新開啟');if(!current||!['ordered','partial'].includes(current.status))throw Error('這張單已到齊或取消，請先查看原單');draft.keepAndReset(beginReceiptDraft(current,next.context));setState(next);onSourceUpdated(current);setChangedSource(false);setReview(null)}catch(cause){setError(cause.message)}finally{gate.current=false;setBusy(false)}
 }
 async function viewSource(){if(gate.current)return;gate.current=true;setBusy(true);try{const current=(await loadPurchases([])).find(row=>row.id===po.id);if(!current)throw Error('這張單已到齊或取消，請先查看原單');onSourceUpdated(current,{close:true})}catch(cause){setError(cause.message)}finally{gate.current=false;setBusy(false)}}
 async function save(){
  if(gate.current||!draft.status.ready||!form.command||!!draft.status.error)return;gate.current=true;setBusy(true);setError('')
  try{
   draft.setForm(old=>({...old,attempted:true}));draft.save()
   const result=pending?await store.retryFinancial():await store.commitInventory('receive-lots',form.command.input,form.command.identity)
   if(result?.receipt?.id!==form.command.identity.id||result.receipt.kind!=='receive-lots')throw Error('請先核對上一筆操作')
   draft.close(emptyReceiptDraft(),true);onSaved(result)
  }catch(cause){setError(cause.message);if(cause.notCommitted){draft.setForm(old=>({...old,attempted:false,command:null}));draft.save();setReview(null)}}finally{gate.current=false;setBusy(false)}
 }
 const ownPending=pending?.kind==='receive-lots'&&pending.request.id===form.command?.identity.id
 const original=form.attempted||ownPending
 const location=id=>id==='main'?tr('店面'):state.locations.find(row=>row.id===id)?.label||id
 return <div className="arrival-overlay"><section className="arrival-modal" role="dialog" aria-modal="true" aria-labelledby="arrival-heading" data-arrival>
  <header><h2 id="arrival-heading" ref={heading} tabIndex={-1}>{tr(original?'核對原收貨':review?'到貨後會放這裡':'這次收到多少？')}</h2><button className="btn" data-arrival-close disabled={busy} onClick={onClose}>{tr('關閉')}</button></header>
  {(error||draft.status.error||pendingError)&&<p role="alert" className="arrival-error">{trMessage(error||draft.status.error||pendingError)}</p>}
  {draft.status.waiting&&<p role="status">{tr('草稿正在另一個視窗使用')}</p>}
  {(stale&&!original)&&<div data-arrival-stale><p role="alert">{tr('原進貨單或店面已變更，請先核對原收貨')}</p><button className="btn" disabled={busy} onClick={viewSource}>{tr('查看原單')}</button><button className="btn" data-arrival-reset disabled={locked} onClick={restart}>{tr('保留舊稿，重新填')}</button></div>}
  {original?<><p>{tr('保留同一筆收貨編號，先核對原結果。')}</p><code>{form.command?.identity.id}</code><button className="btn btn-primary arrival-save" data-arrival-original disabled={busy||!!pending&&!ownPending||!!draft.status.error} onClick={save}>{tr('核對原收貨')}</button></>:review?<>
   <div data-arrival-review>{review.filter(row=>row.available+row.backroom+row.held>0).map((row,index)=><article key={index}><strong>{row.name}</strong><dl>{[['available','店內可賣'],['backroom','放後倉'],['held','暫停販售']].map(([kind,label])=><div key={kind}><dt>{tr(label)}</dt><dd>{row[kind]/1000} {row.unit}</dd></div>)}</dl></article>)}</div>
   <p>{tr('不清楚效期或已過期的貨，先暫停販售。')}</p><button className="btn btn-primary arrival-save" data-arrival-save disabled={busy} onClick={()=>save()}>{tr(busy?'保存中…':'確認，收好這批貨')}</button><button className="btn" disabled={busy} onClick={()=>{setReview(null);draft.setForm(old=>({...old,command:null}))}}>{tr('返回修改')}</button>
  </>:<>
   <button className="btn" data-arrival-fill disabled={locked||!!stale} onClick={fill}>{tr('照單填入')}</button>
   <fieldset disabled={locked||!!stale}>
    {form.rows.map((row,line)=>{const item=po.items[line];if(!item)return null;const linked=item.productId||suppliers.find(s=>s.id===po.supplierId)?.catalog?.find(c=>c.id===item.catalogId)?.productId,required=state.products.find(p=>p.id===linked)?.required;return <article key={line}>
     <h3>{item.name}</h3><small>{tr('尚未收到 {0} {1}',{0:Math.max(0,Math.round(item.qty*1000)-Math.round((item.received||0)*1000))/1000,1:item.unit})}</small>
     {row.batches.map((b,index)=><div className="arrival-batch" key={index}>
      <label>{tr('本次到貨量')} ({item.unit})<input className="field" data-arrival-quantity={`${line}-${index}`} inputMode="decimal" value={b.quantity} onChange={e=>batch(line,index,'quantity',e.target.value)} /></label>
      <label>{tr('效期')}<select className="field" data-arrival-expiry-mode={`${line}-${index}`} value={b.expiryMode} onChange={e=>batch(line,index,'expiryMode',e.target.value)}><option value="unknown">{tr('不清楚')}</option><option value="dated">{tr('有日期')}</option>{!required&&<option value="none">{tr('不用日期')}</option>}</select></label>
      {b.expiryMode==='dated'&&<label>{tr('有效日期')}<input className="field" data-arrival-date={`${line}-${index}`} type="date" value={b.expiryDate} onChange={e=>batch(line,index,'expiryDate',e.target.value)}/></label>}
      <details><summary>{tr('批號與存放地點')}</summary><label>{tr('批號')}<input className="field" maxLength={128} value={b.code} onChange={e=>batch(line,index,'code',e.target.value)}/></label><label>{tr('存放地點')}<select className="field" data-arrival-location={`${line}-${index}`} value={b.locationId} onChange={e=>batch(line,index,'locationId',e.target.value)}>{state.locations.map(loc=><option key={loc.id} value={loc.id}>{location(loc.id)}</option>)}</select></label></details>
      {row.batches.length>1&&<button className="btn" onClick={()=>change(old=>({...old,rows:old.rows.map((r,i)=>i===line?{...r,batches:r.batches.filter((_,j)=>j!==index)}:r)}))}>{tr('移除這一批')}</button>}
     </div>)}
     <button className="btn" data-arrival-split={line} disabled={row.batches.length>=100} onClick={()=>change(old=>({...old,rows:old.rows.map((r,i)=>i===line?{...r,batches:[...r.batches,newReceiptBatch()]}:r)}))}>{tr('分成不同批次')}</button>
     {!linked&&<label>{tr('新商品售價')}<input className="field" data-arrival-price={line} inputMode="decimal" value={row.price} onChange={e=>change(old=>({...old,rows:old.rows.map((r,i)=>i===line?{...r,price:e.target.value}:r)}))}/></label>}
    </article>})}
   </fieldset>
   <button className="btn btn-primary arrival-save" data-arrival-inspect disabled={locked||!!stale} onClick={inspect}>{tr('看收貨結果')}</button>
   <details><summary>{tr('讓 Agent 幫忙填')}</summary><button className="btn" disabled={locked||!!stale} onClick={async()=>{try{await navigator.clipboard.writeText(JSON.stringify(receiptAgentHandoff(po,state),null,2))}catch{setError('無法複製，請保留原輸入')}}}>{tr('複製給 Agent')}</button><label>{tr('貼上到貨草稿')}<textarea className="field" data-arrival-agent value={form.agentText} maxLength={65536} disabled={locked} onChange={e=>change(old=>({...old,agentText:e.target.value}))}/></label><button className="btn" disabled={locked||!!stale} onClick={()=>{try{change(old=>readReceiptAgent(old.agentText,po,state,old))}catch(cause){setError(cause.message)}}}>{tr('填入草稿')}</button></details>
  </>}
  <details><summary>{tr('保留原輸入')}</summary><button className="btn" onClick={draft.download}>{tr('下載草稿')}</button></details>
  {draft.archives.length>0&&<details data-arrival-archives><summary>{tr('已保留的舊稿')} ({draft.archives.length})</summary>{draft.archives.map((archive,index)=><button className="btn" key={archive} onClick={()=>{try{draft.downloadArchive(archive)}catch(cause){setError(cause.message)}}}>{tr('下載舊稿 {0}',{0:index+1})}</button>)}</details>}
 </section></div>
}
