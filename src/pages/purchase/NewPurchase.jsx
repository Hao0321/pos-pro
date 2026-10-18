import {useEffect,useMemo,useRef,useState,lazy,Suspense} from 'react'
import {tr,trMessage} from '../../i18n'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import {decimalUnits} from '../../../electron/decimalUnits.mjs'
import {loadProducts} from '../../utils/dataAccess'
import {computeSalesVelocity,suggestReorderQty} from '../../utils/analytics'
import {readPendingFinancial} from '../../utils/financialCommand'
import useArchivedDraft from '../../hooks/useArchivedDraft'
import {emptyPurchaseDraft,beginPurchaseDraft,validPurchaseDraft,purchaseDraftKey,purchaseChoices,purchaseRow,previousPurchaseRow,purchaseDraftPreview,purchaseDraftCommand,purchaseDraftSignature,purchaseAgentHandoff,readPurchaseAgent} from '../../utils/purchaseDraft.mjs'
import {purchaseDraftAcknowledged} from '../../utils/purchaseDraftReceipt.mjs'
import {PurchasePicker,PurchaseItemCard,PurchaseReview,purchaseMoney} from './PurchaseComposerParts'
import '../../styles/arrival.css'
import '../../styles/purchase-composer.css'

export const BarcodeScannerModal=lazy(()=>import('../../components/BarcodeScannerModal'))
const options={empty:emptyPurchaseDraft,valid:validPurchaseDraft,maxLength:4000000,message:'採購草稿讀不到，請保留原輸入',prefix:'pos-purchase-unit-draft:',fileName:'purchase-draft.json',archiveName:'purchase-draft'}
export function NewPurchase({products,suppliers,purchases,orders=[],store,session,onSave}){
 const scopeOf=state=>state&&session?.role==='owner'?{storeId:state.storeId,epoch:state.epoch,userId:session.userId,role:session.role}:null
 const scope=scopeOf(store?.supplierState),key=scope?purchaseDraftKey(scope.storeId,scope.userId,scope.role):null,draft=useArchivedDraft(key,options),form=draft.form
 const [override,setOverride]=useState(null),[review,setReview]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[handoffText,setHandoffText]=useState(''),[busy,setBusy]=useState(false),[changed,setChanged]=useState(false),[camera,setCamera]=useState(false),gate=useRef(false),heading=useRef(null)
 const data=override||{products,suppliers},supplier=data.suppliers.find(row=>row.id===form.supplierId),choices=useMemo(()=>purchaseChoices(data,form.supplierId),[data.products,data.suppliers,form.supplierId]),velocity=useMemo(()=>computeSalesVelocity(orders,30),[orders])
 let pending=null,pendingError='';try{pending=readPendingFinancial()}catch(cause){pendingError=cause.message}
 const original=form.attempted||!!pending&&pending.request.id===form.command?.identity.id,stale=changed||!!form.scope&&canonicalSignature(form.scope)!==canonicalSignature(scope),locked=busy||!draft.status.ready||!!draft.status.error||!!pending||!!pendingError||original
 let preview=null;try{if(scope)preview=purchaseDraftPreview(form,scope,data)}catch{}
 useEffect(()=>{let alive=true;store?.refreshSuppliers?.().catch(cause=>{if(alive)setError(cause.message)});return()=>{alive=false}},[])
 useEffect(()=>{if(draft.status.ready&&scope&&!form.scope)draft.setForm(beginPurchaseDraft(scope))},[draft.status.ready,form.scope,scope?.storeId,scope?.epoch])
 useEffect(()=>{heading.current?.focus({preventScroll:true})},[!!review])
 useEffect(()=>{const done=event=>{const current=draft.current().form;if(purchaseDraftAcknowledged(current,event.detail)){draft.close(beginPurchaseDraft(current.scope),true);setReview(null)}};window.addEventListener('pos-inventory-operation',done);return()=>window.removeEventListener('pos-inventory-operation',done)},[key])
 function change(update){if(locked)return;setError('');setMessage('');setHandoffText('');setReview(null);draft.setForm(old=>({...update(old),command:null,attempted:false}))}
 function suggestion(product){const daily=velocity.get(product.id)||0;if(daily>0)return Math.max(1,suggestReorderQty(product,daily,14).suggested);return Number(product.reorderLevel)>0?Math.max(1,Number(product.reorderLevel)*2-Number(product.stock||0)):1}
 function seed(choice){
  let row=purchaseRow(choice),previous=null;try{previous=previousPurchaseRow(choice,purchases,form.supplierId)}catch{}
  if(previous)row=previous
  const product=data.products.find(item=>item.id===choice.productId),base=suggestion(product||{id:'',stock:0}),reference=choice.reference?.cost??(!choice.catalogId?product?.cost:null)
  if(!row.unitPrice&&typeof reference==='number'&&reference>0&&Number.isFinite(reference)&&Math.round(reference*100)/100===reference&&(row.mode==='base'&&(!choice.purchasedUnit||choice.purchasedUnit===row.unit)))row={...row,unitPrice:String(reference)}
  let quantity=String(base)
  if(row.mode==='pack')try{const need=BigInt(decimalUnits(String(base),3,1e12,'invalid')),factor=BigInt(decimalUnits(row.baseQuantityPerUnit,3,1e12,'invalid'));if(!factor)throw Error();quantity=String((need+factor-1n)/factor)}catch{quantity=''}
  return {...row,quantity}
 }
 function add(choiceKey){const choice=choices.find(row=>row.key===choiceKey);if(!choice)return;if(form.items.some(row=>row.key===choiceKey)){setMessage('商品已在單內，請直接改數量');return}change(old=>({...old,items:[...old.items,seed(choice)]}));setMessage('建議量與參考進價已帶入，請核對原單。')}
 function reorder(){const rows=choices.filter(row=>!row.catalogId&&data.products.some(p=>p.id===row.productId&&Number(p.reorderLevel)>0&&Number(p.stock)<=Number(p.reorderLevel))&&!form.items.some(item=>item.key===row.key));if(!rows.length){setMessage('目前沒有需要補貨的商品');return}change(old=>({...old,items:[...old.items,...rows.map(seed)]}));setMessage('建議量與參考進價已帶入，請核對原單。')}
 function archiveChange(update){if(locked)return;try{draft.keepAndReset({...update(draft.current().form),command:null,attempted:false});setError('');setReview(null);setMessage('舊輸入已保留，請核對新單位的數量與價格。')}catch(cause){setError(cause.message)}}
 function rowUpdate(index,field,value){
  if(field==='mode'){archiveChange(old=>({...old,items:old.items.map((row,i)=>i===index?{...row,mode:value,quantity:'',unitPrice:'',purchasedUnit:value==='pack'?(row.purchasedUnit||''):'',...(!row.productId&&value==='pack'?{unit:''}:{})}:row)}));return}
  change(old=>({...old,items:old.items.map((row,i)=>i===index?{...row,[field]:value}:row)}))
 }
 async function fresh(){const state=await store.refreshSuppliers(),nextScope=scopeOf(state),next={products:await loadProducts([]),suppliers:state.suppliers};return {scope:nextScope,data:next,state}}
 async function inspect(){
  if(gate.current||locked)return;gate.current=true;setBusy(true);setError('')
  try{const next=await fresh(),value=purchaseDraftPreview(draft.current().form,next.scope,next.data);draft.save();setReview({...next,preview:value})}catch(cause){setError(cause.message);if(cause.message.includes('已變更'))setChanged(true)}finally{gate.current=false;setBusy(false)}
 }
 async function restart(){if(gate.current||locked)return;gate.current=true;setBusy(true);try{const next=await fresh();draft.keepAndReset(beginPurchaseDraft(next.scope));setOverride(next.data);setChanged(false);setReview(null);setError('')}catch(cause){setError(cause.message)}finally{gate.current=false;setBusy(false)}}
 async function save(){
  if(gate.current||!draft.status.ready||draft.status.error||pendingError||pending&&pending.request.id!==form.command?.identity.id||!original&&!review)return
  gate.current=true;setBusy(true);setError('');let submitted=null,dispatched=false
  try{const current=draft.current().form,command=original?current.command:purchaseDraftCommand(current,review.scope,review.data,review.state);if(!command)throw Error('請先核對上一筆操作')
   submitted={...current,command,attempted:true};draft.setForm(submitted);draft.save()
   const prepare=pending=>{const {id,time,...input}=pending.request,next={...draft.current().form,command:{identity:{id,time},input,draftSignature:purchaseDraftSignature(current)},attempted:true};submitted=next;draft.setForm(next);draft.save()}
   dispatched=true;const result=pending?await store.retryFinancial():await onSave(command.input.purchase,{kind:command.input.kind,input:command.input,identity:command.identity,prepare})
   if(!purchaseDraftAcknowledged(submitted,result))throw Error('採購保存回覆需要核對，請保留原編號')
   if(draft.current().form.id===submitted.id)draft.close(beginPurchaseDraft(submitted.scope),true);setReview(null);setMessage('採購已保存，可在進貨單查看。')
  }catch(cause){setError(cause.message);if(!dispatched||cause.notCommitted){draft.setForm(old=>({...old,command:null,attempted:false}));try{draft.save()}catch{}setReview(null)}}finally{gate.current=false;setBusy(false)}
 }
 function supplierChange(value){if(form.items.length){archiveChange(()=>({...beginPurchaseDraft(scope),supplierId:value}));return}change(old=>({...old,supplierId:value}))}
 return <div className="purchase-composer" data-purchase-composer>
  {(error||draft.status.error||pendingError)&&<p role="alert" className="arrival-error">{trMessage(error||draft.status.error||pendingError)}</p>}
  {message&&<p role="status">{trMessage(message)}</p>}
  {!draft.status.ready&&<p role="status">{tr(draft.status.waiting?'草稿正在另一個視窗使用':'正在核對採購資料…')}</p>}
  {stale&&!original&&<div><p role="alert">{tr('商品或供應商資料已變更，請保留原輸入重新核對')}</p><button className="btn" data-purchase-reset disabled={locked} onClick={restart}>{tr('保留舊稿，重新填')}</button></div>}
  {original?<section className="purchase-item"><h3>{tr('先核對原採購')}</h3><p>{tr('沿用原編號，不會再建一張。')}</p><code>{form.command?.identity.id}</code><button className="btn btn-primary" data-purchase-original disabled={busy||!!pending&&pending.request.id!==form.command?.identity.id} onClick={save}>{tr('核對原採購')}</button></section>:<fieldset disabled={locked||stale}>
   <div className="purchase-fields"><label>{tr('供應商 *')}<select className="field" aria-label={tr('採購供應商')} value={form.supplierId} onChange={event=>supplierChange(event.target.value)}><option value="">{tr('— 選擇供應商 —')}</option>{data.suppliers.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>{tr('叫貨日期')}<input className="field" aria-label={tr('採購日期')} type="date" value={form.date} onChange={event=>change(old=>({...old,date:event.target.value}))}/></label></div>
   {supplier&&<details><summary>{tr('供應商資料')}</summary><p>{supplier.contact} · {supplier.payTerms}</p><p>{supplier.note}</p></details>}
   <PurchasePicker choices={choices} products={data.products} items={form.items} supplierId={form.supplierId} onAdd={add} onReorder={reorder} onScan={()=>setCamera(true)}/>
   {form.items.map((row,index)=><PurchaseItemCard key={row.key} row={row} index={index} form={form} scope={scope} data={data} choices={choices} purchases={purchases} onUpdate={(field,value)=>rowUpdate(index,field,value)} onRemove={()=>change(old=>({...old,items:old.items.filter((_,i)=>i!==index)}))} onPrevious={previous=>archiveChange(old=>({...old,items:old.items.map((item,i)=>i===index?{...previous,quantity:item.mode===previous.mode&&item.purchasedUnit===previous.purchasedUnit?item.quantity:''}:item)}))}/>)}
   <p className="purchase-total">{tr('總計')} {preview?purchaseMoney(preview.total):'—'}</p><label>{tr('備註')}<textarea className="field" maxLength={2000} value={form.note} onChange={event=>change(old=>({...old,note:event.target.value}))}/></label>
   <button className="btn btn-primary" data-purchase-inspect disabled={!form.supplierId||!form.items.length} onClick={inspect}>{tr('建立進貨單')}</button>
   <details><summary>{tr('讓 Agent 幫忙填')}</summary><button className="btn" disabled={!form.supplierId} onClick={async()=>{try{const text=JSON.stringify(purchaseAgentHandoff(form,scope,data),null,2);setHandoffText(text);try{await navigator.clipboard.writeText(text);setMessage('已複製給 Agent')}catch{setMessage('請複製下方內容給 Agent')}}catch(cause){setError(cause.message)}}}>{tr('複製給 Agent')}</button>{handoffText&&<label>{tr('給 Agent 的內容')}<textarea className="field" data-purchase-handoff readOnly value={handoffText} onFocus={event=>event.target.select()}/></label>}<label>{tr('貼上採購草稿')}<textarea className="field" data-purchase-agent maxLength={250000} value={form.agentText} onChange={event=>change(old=>({...old,agentText:event.target.value}))}/></label><button className="btn" data-purchase-agent-fill onClick={()=>{try{change(old=>readPurchaseAgent(old.agentText,old,scope,data))}catch(cause){setError(cause.message)}}}>{tr('填入草稿')}</button></details>
  </fieldset>}
  <details><summary>{tr('保留原輸入')}</summary><button className="btn" onClick={draft.download}>{tr('下載草稿')}</button></details>
  {draft.archives.length>0&&<details data-purchase-archives><summary>{tr('已保留的舊稿')} ({draft.archives.length})</summary>{draft.archives.map((archive,index)=><button className="btn" key={archive} onClick={()=>{try{draft.downloadArchive(archive)}catch(cause){setError(cause.message)}}}>{tr('下載舊稿 {0}',{0:index+1})}</button>)}</details>}
  {review&&<PurchaseReview preview={review.preview} supplier={review.data.suppliers.find(row=>row.id===form.supplierId)} busy={busy} heading={heading} onConfirm={save} onBack={()=>setReview(null)}/>}
  {camera&&<Suspense fallback={null}><BarcodeScannerModal title={tr('掃條碼加入進貨單')} mode="continuous" onScan={code=>{const product=data.products.find(row=>row.barcode===code),choice=choices.find(row=>!row.catalogId&&row.productId===product?.id);if(choice)add(choice.key);else setMessage('條碼查無商品')}} onClose={()=>setCamera(false)}/></Suspense>}
 </div>
}
