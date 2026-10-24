import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage} from '../../i18n'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import {compileMenuEditor,menuEditorDraft,menuEditorOffer} from '../../utils/restaurantMenuEditor.mjs'
import {loadRestaurantMenuSetupPreview,loadPrivateDraftContext,loadProducts,loadRestaurantState} from '../../utils/dataAccess'
import {readPendingFinancial} from '../../utils/financialCommand'
import MenuOfferEditor from './MenuOfferEditor'
import MenuSelectionPreview from './MenuSelectionPreview'
import useVisibleViewport from '../../hooks/useVisibleViewport'
import useWorkspaceDraft from '../../hooks/useWorkspaceDraft'
import WorkspaceDraftNotice from '../../components/WorkspaceDraftNotice'
import {validOwnerMenuDraft} from '../../utils/restaurantDraftShapes.mjs'
import {prepareRestaurantCommand} from '../../utils/restaurantCommand.mjs'
import {privateDraftDigest} from '../../../electron/privateDrafts.mjs'
import {planMenuEditorMerge,menuDraftUnitBasis,menuDraftResolution,menuDraftInputDigest} from '../../utils/menuDraftMerge.mjs'
import MenuConflictChoices from './MenuConflictChoices'
import './RestaurantMenuEditor.css'

const money=cents=>'NT$ '+cents/100
export default function RestaurantMenuEditor({data,products:providedProducts,session,store,reload,settingsDirty=false,onEditing}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(null),[chosen,setChosen]=useState(''),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(null),[pendingError,setPendingError]=useState(''),[discard,setDiscard]=useState(false)
 const [sourceProducts,setSourceProducts]=useState(null),[reconcile,setReconcile]=useState(null),[conflict,setConflict]=useState(null)
 const products=sourceProducts||providedProducts,lock=useRef(false),generation=useRef(0),alive=useRef(true),baseline=useRef(''),basis=useRef(null),root=useRef(null),recovery=useRef(null),conflictHeading=useRef(null),viewport=useVisibleViewport(),latest=useRef(null)
 const state={draft,baseline:baseline.current,basis:basis.current,reconcile,open,chosen};latest.current={data,products,session,state}
 const workspace=useWorkspaceDraft({kind:'menu-setup',session,state,hasContent:!!draft,validate:validOwnerMenuDraft,onRestore:value=>{generation.current++;lock.current=false;setBusy(false);setDraft(value?.draft??null);baseline.current=value?.baseline??'';basis.current=value?.basis??null;setReconcile(value?.reconcile??null);setConflict(null);setSourceProducts(null);setOpen(value?.open??false);setChosen(value?.chosen??'');setPreview(null);setDiscard(false);setError('');onEditing?.(value?.open??false)},onOriginal:async(result,_state,completion)=>{if(result.action!=='configure')throw Error('原單資料需要核對');const original=readPendingFinancial();if(original?.request.id===result.id){if(privateDraftDigest(original.request)!==result.digest)throw Error('原單資料需要核對');await store.retryFinancial()}if(completion?.isCurrent&&!completion.isCurrent())return;finish('菜單已保存，可以開始點餐。');await reload?.()}})
 latest.current.workspace=workspace
 const pendingMenu=pending?.kind==='restaurant'&&pending.request.action==='configure'&&pending.request.menuSetupReview?.protocol==='pos-restaurant-menu-setup-review/v1',blocked=busy||!!pending||!!pendingError||workspace.blocked
 function readPending(){try{setPending(readPendingFinancial());setPendingError('')}catch(cause){setPendingError(cause.message)}}
 useEffect(()=>{readPending()},[store.financialState?.phase,store.financialState?.id])
 useEffect(()=>{
  if(!pendingMenu)return
  const previous=document.activeElement,controls=()=>[...recovery.current?.querySelectorAll('button:not(:disabled),summary')||[]].filter(node=>node.getClientRects().length)
  controls()[0]?.focus()
  function keys(event){if(event.key!=='Tab'||!recovery.current)return;const nodes=controls(),first=nodes[0],last=nodes.at(-1);if(!first)return;if(!recovery.current.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus()}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
  window.addEventListener('keydown',keys,true);return()=>{window.removeEventListener('keydown',keys,true);if(previous?.isConnected)previous.focus()}
 },[pendingMenu])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;onEditing?.(false)}},[])
 useEffect(()=>{if(open&&!preview)root.current?.querySelector('[data-menu-product]')?.focus()},[open])
 useEffect(()=>{if(workspace.ready&&reconcile&&!conflict&&!busy&&!pending&&!pendingError)rebase('restore')},[workspace.ready,workspace.scope?.key,reconcile?.localDigest,reconcile?.remoteDigest])
 useEffect(()=>{if(conflict)conflictHeading.current?.focus()},[conflict?.plan.remoteDigest,conflict?.plan.localDigest])
 function current(context,ticket){const live=latest.current;return alive.current&&ticket===generation.current&&live.session.userId===context.userId&&live.session.role===context.role&&!!live.workspace.scope&&privateDraftDigest(live.workspace.scope.context)===privateDraftDigest(context)}
 function guard(context,ticket){if(!alive.current||ticket!==generation.current)return false;if(!current(context,ticket))throw Error('店面或帳號已變更，請保留原輸入核對。');return true}
 async function freshSource(actor,ticket){
  const context=await loadPrivateDraftContext(actor);if(!guard(context,ticket))return null;latest.current.workspace.assertScope(context)
  const [next,items]=await Promise.all([reload?.()||loadRestaurantState(),loadProducts([])]);if(!guard(context,ticket))return null
  const after=await loadPrivateDraftContext(actor);if(!guard(context,ticket))return null
  if(!next||privateDraftDigest(context)!==privateDraftDigest(after))throw Error('店面或帳號已變更，請保留原輸入核對。')
  return {context,data:next,products:items}
 }
 function start(){try{workspace.begin();if(!draft){setDraft(menuEditorDraft(data.config.menu,products));baseline.current=canonicalSignature(data.config.menu??null);basis.current=menuDraftUnitBasis(data.config.menu,products);setReconcile(null);setConflict(null)}setOpen(true);onEditing?.(true);setError('');setMessage('')}catch(cause){setError(cause.message)}}
 function edit(next){generation.current++;workspace.begin();setDraft(next);setReconcile(null);setConflict(null);setPreview(null);setError('');setDiscard(false)}
 function finish(message){generation.current++;lock.current=false;setBusy(false);setDraft(null);setPreview(null);setOpen(false);setChosen('');setReconcile(null);setConflict(null);setSourceProducts(null);basis.current=null;setDiscard(false);onEditing?.(false);setMessage(message)}
 async function rebase(mode='open'){
  if(lock.current||blocked||!draft)return;const ticket=++generation.current,actor={...session},input=state;lock.current=ticket;setBusy(true);setError('')
  try{
   const source=await freshSource(actor,ticket);if(!source||!current(source.context,ticket)||menuDraftInputDigest(latest.current.state)!==menuDraftInputDigest(input))return
   const plan=planMenuEditorMerge(input,source.data.config.menu,source.products),resolution=menuDraftResolution(plan,input.reconcile),changed=!!input.reconcile&&(resolution.localDigest!==input.reconcile.localDigest||resolution.remoteDigest!==input.reconcile.remoteDigest)
   setSourceProducts(source.products);setPreview(null)
   if(changed)setMessage('店內菜單又更新了，請再選一次。')
   if(plan.conflicts.length&&(mode!=='apply'||changed||plan.conflicts.some(row=>!row.choice))){setReconcile(resolution);setConflict({plan,products:source.products,remote:menuEditorDraft(source.data.config.menu,source.products)});return}
   if(mode==='restore'){setReconcile(null);setConflict(null);return}
   baseline.current=plan.baseline;basis.current=plan.basis;setDraft(plan.draft);setReconcile(null);setConflict(null);setError('');setMessage('')
  }catch(cause){if(alive.current&&ticket===generation.current)setError(cause.message)}finally{if(lock.current===ticket)lock.current=false;if(alive.current&&ticket===generation.current)setBusy(false)}
 }
 function chooseConflict(key,choice){setReconcile(old=>({...old,choices:[...old.choices.filter(row=>row.key!==key),{key,choice}]}))}
 async function review(){
  if(lock.current||blocked||reconcile)return;const ticket=++generation.current,actor={...session},input=state;lock.current=ticket;setBusy(true);setError('');setMessage('')
  try{const source=await freshSource(actor,ticket);if(!source)return
   if(input.baseline!==canonicalSignature(source.data.config.menu??null))throw Error('店內菜單已更新，這裡保留你的修改。')
   const menu=compileMenuEditor(input.draft,source.products),result=await loadRestaurantMenuSetupPreview({menu,expectedMenu:input.baseline},actor)
   if(!guard(source.context,ticket))return
   if(result?.protocol!=='pos-restaurant-menu-setup-preview/v1'||canonicalSignature(result.config.menu)!==canonicalSignature(menu))throw Error('菜單預覽內容不符，請保留輸入重新核對。')
   workspace.assertScope(result.menuSetupReview.scope)
   setSourceProducts(source.products);setPreview(result);root.current?.scrollIntoView?.({block:'start'})
  }catch(cause){if(alive.current&&ticket===generation.current)setError(cause.message)}finally{if(lock.current===ticket)lock.current=false;if(alive.current&&ticket===generation.current){setBusy(false);readPending()}}
 }
 async function save(retry=false){
  if(lock.current||pendingError||(!retry&&blocked))return;const ticket=++generation.current,actor={...session};lock.current=ticket;setBusy(true);setError('');setMessage('')
  try{const context=await loadPrivateDraftContext(actor);if(!guard(context,ticket))return;workspace.assertScope(context)
   const source=retry?readPendingFinancial()?.request:{action:'configure',config:preview.config,expectedConfig:preview.expectedConfig,menuSetupReview:preview.menuSetupReview,draftContext:structuredClone(workspace.assertScope(preview.menuSetupReview.scope)),...(preview.fundsSetupProposal?{fundsSetupProposal:true}:{})}
   if(retry&&(!source||source.menuSetupReview?.protocol!=='pos-restaurant-menu-setup-review/v1'))throw Error('請先核對上一筆異動')
   const identity=retry?null:{id:workspace.documentId(),time:source.menuSetupReview.issuedAt}
   if(!retry){const prepared=prepareRestaurantCommand(source,{identity});workspace.remember({...prepared.input,id:identity.id,time:identity.time})}
   const result=retry?await store.retryFinancial():await store.commitRestaurant(source,identity)
   if(!guard(context,ticket))return
   if(!result?.success||result.receipt?.action!=='configure')throw Error('菜單保存結果尚未確認，請保留原編號核對。')
   const same=canonicalSignature(result.config.menu??null)===canonicalSignature(source.config.menu)
   workspace.complete();await reload?.();finish(same?'菜單已保存，可以開始點餐。':'原設定已保存，目前菜單另有更新。')
  }catch(cause){if(alive.current&&ticket===generation.current){setError(cause.message);try{if(!readPendingFinancial())workspace.uncommitted()}catch{}}}finally{if(lock.current===ticket)lock.current=false;if(alive.current&&ticket===generation.current){setBusy(false);readPending()}}
 }
 async function trySelection(selection){
  if(lock.current||blocked||reconcile)return;const ticket=++generation.current,actor={...session},input=state;lock.current=ticket;setBusy(true);setError('');setPreview(current=>({...current,selection:null}))
  try{const source=await freshSource(actor,ticket);if(!source)return
   if(input.baseline!==canonicalSignature(source.data.config.menu??null))throw Error('店內菜單已更新，這裡保留你的修改。')
   const menu=compileMenuEditor(input.draft,source.products),result=await loadRestaurantMenuSetupPreview({menu,expectedMenu:input.baseline,selection:[selection]},actor)
   if(!guard(source.context,ticket))return
   if(result?.protocol!=='pos-restaurant-menu-setup-preview/v1'||canonicalSignature(result.config.menu)!==canonicalSignature(menu)||!result.selection)throw Error('菜單預覽內容不符，請保留輸入重新核對。')
   workspace.assertScope(result.menuSetupReview.scope)
   setSourceProducts(source.products);setPreview(result)
  }catch(cause){if(alive.current&&ticket===generation.current)setError(cause.message)}finally{if(lock.current===ticket)lock.current=false;if(alive.current&&ticket===generation.current){setBusy(false);readPending()}}
 }
 function clear(){workspace.complete();finish('');setError('')}
 function copy(offer){const next=structuredClone(offer),ids=new Map(next.variants.map(row=>[row.id,'size-'+crypto.randomUUID()]));next.id='meal-'+crypto.randomUUID();next.name=offer.name+' · '+tr('套餐');next.defaultVariantId=ids.get(next.defaultVariantId);for(const variant of next.variants)variant.id=ids.get(variant.id);edit({...draft,offers:[...draft.offers,next]})}
 return <section ref={root} className="card menu-editor" data-menu-setup>
  <WorkspaceDraftNotice draft={workspace}/>
  <div className="menu-editor-heading"><h3>{tr('菜單與加料')}</h3>{!open&&!pendingMenu&&<button type="button" className="btn btn-ghost" data-menu-editor-open disabled={settingsDirty||blocked} onClick={start}>{tr(draft?'繼續菜單設定':'設定菜單')}</button>}</div>
  {error&&<p role="alert">{trMessage(error)}</p>}{pendingError&&<p role="alert">{trMessage(pendingError)}</p>}{message&&<p role="status" data-menu-setup-message>{tr(message)}</p>}
  {settingsDirty&&<p>{tr('請先儲存出餐設定')}</p>}
  {pendingMenu&&createPortal(<div className="menu-setup-recovery-overlay"><section ref={recovery} className="card menu-editor menu-setup-recovery" role="dialog" aria-modal="true" aria-labelledby="menu-setup-recovery-title" data-menu-setup-pending style={{top:viewport.top+16,maxHeight:Math.max(120,viewport.height-32)}}><h3 id="menu-setup-recovery-title">{tr('核對上次菜單保存')}</h3><p>{tr('上次菜單保存尚未確認，請沿用原編號核對。')}</p><div className="menu-editor-actions"><button type="button" className="btn btn-primary" data-menu-setup-retry disabled={busy} onClick={()=>save(true)}>{busy?tr('核對中…'):tr('核對上次菜單保存')}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>store.setView('recovery')}>{tr('資料復原')}</button></div><details><summary>{tr('原單資料')}</summary><code>{pending.request.id}</code>{error&&<p role="alert">{trMessage(error)}</p>}</details></section></div>,document.body)}
  {pending&&!pendingMenu&&<p>{tr('請先核對上一筆異動')}</p>}
  {open&&draft&&!pendingMenu&&<fieldset disabled={blocked||settingsDirty}>
   {(baseline.current!==canonicalSignature(data.config.menu??null)||reconcile)&&<div role="alert"><p>{tr('店內菜單已更新，這裡保留你的修改。')}</p><button type="button" className="btn btn-ghost" data-menu-draft-rebase onClick={()=>rebase()}>{tr('保留輸入，重新核對')}</button></div>}
   {conflict&&reconcile&&<MenuConflictChoices {...{conflict,draft,basis:basis.current,resolution:reconcile,busy}} headingRef={conflictHeading} onChoice={chooseConflict} onAll={policy=>setReconcile(old=>({...old,policy,choices:[]}))} onApply={()=>rebase('apply')}/>}
   {!preview?<div data-menu-edit-step>
    <p className="menu-editor-step">{tr('先選餐點，再看價格與用量。')}</p>
    <div className="menu-editor-actions"><select className="field" data-menu-product aria-label={tr('要賣哪個商品')} value={chosen} onChange={event=>setChosen(event.target.value)}><option value="">{tr('選擇商品')}</option>{products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}</select><button type="button" className="btn btn-ghost" data-menu-add-offer disabled={!chosen||draft.offers.length>=100} onClick={()=>{const product=products.find(row=>row.id===chosen);edit({...draft,offers:[...draft.offers,menuEditorOffer(product,tr('正常份'))]});setChosen('')}}>{tr('加入餐點')}</button></div>
    {!products.length&&<p>{tr('先在商品庫存建立要賣的商品。')}</p>}
    {draft.offers.map(offer=><MenuOfferEditor key={offer.id} offer={offer} products={products} recipes={data.config.recipes} onError={setError} onChange={next=>edit({...draft,offers:draft.offers.map(row=>row.id===offer.id?next:row)})} onRemove={()=>edit({...draft,offers:draft.offers.filter(row=>row.id!==offer.id)})} onCopy={()=>copy(offer)}/>)}
    <div className="menu-editor-actions"><button type="button" className="btn btn-primary" data-menu-setup-review disabled={!draft.offers.length||busy||!!reconcile} onClick={review}>{busy?tr('核對中…'):tr('下一步：核對菜單')}</button><button type="button" className="btn btn-ghost" data-menu-check-latest onClick={()=>rebase()}>{tr('核對店內最新')}</button></div>
   </div>:<div data-menu-review-step>
    <h4>{tr('確認後開放這份菜單')}</h4>
    {preview.config.menu.offers.map(offer=><article className="menu-editor-review" data-menu-reviewed-offer={offer.id} key={offer.id}><h4>{offer.name}</h4>{preview.examples.filter(row=>row.offerId===offer.id).map(example=><div key={example.variantId} data-menu-reviewed-variant={example.variantId}><p><strong>{offer.variants.find(row=>row.id===example.variantId).name}</strong><strong>{money(example.priceCents)}</strong></p><details><summary>{tr('範例用量與參考成本')}</summary><p>{example.name}</p><p>{tr('參考成本')}：{money(example.referenceCostCents)}</p><ul>{example.resources.map(row=><li key={row.id}>{row.name} · {row.qty} {products.find(product=>product.id===row.id)?.unit||''}</li>)}</ul>{!example.available&&<p>{tr('目前原料不足，可先保存菜單，補貨後再接單。')}</p>}</details></div>)}</article>)}
    <p>{tr('只影響新訂單，舊單保留原來的方式。')}</p>
    <MenuSelectionPreview menu={preview.config.menu} onTry={trySelection} result={preview.selection} busy={busy}/>
    <div className="menu-editor-actions"><button type="button" className="btn btn-ghost" data-menu-setup-back onClick={()=>setPreview(null)}>{tr('返回修改')}</button>{error&&<button type="button" className="btn btn-ghost" data-menu-setup-refresh onClick={review}>{tr('重新預覽')}</button>}<button type="button" className="btn btn-primary" data-menu-setup-save disabled={!!error} onClick={()=>save()}>{busy?tr('保存中…'):tr('保存並啟用菜單')}</button></div>
   </div>}
   <div className="menu-editor-actions"><button type="button" className="btn btn-ghost" data-menu-setup-close onClick={()=>{setOpen(false);onEditing?.(false)}}>{tr('收起設定')}</button><button type="button" className="btn btn-ghost" data-menu-setup-discard onClick={()=>setDiscard(true)}>{tr('捨棄修改')}</button></div>
   {discard&&<div role="alert"><p>{tr('要捨棄這次菜單修改嗎？')}</p><div className="menu-editor-actions"><button type="button" className="btn btn-ghost" onClick={()=>setDiscard(false)}>{tr('保留輸入')}</button><button type="button" className="btn btn-ghost" data-menu-setup-confirm-discard onClick={clear}>{tr('捨棄這次修改')}</button></div></div>}
  </fieldset>}
 </section>
}
