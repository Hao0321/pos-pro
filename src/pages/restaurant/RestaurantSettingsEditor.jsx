import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage} from '../../i18n'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import {privateDraftDigest} from '../../../electron/privateDrafts.mjs'
import {loadPrivateDraftContext} from '../../utils/dataAccess'
import {readPendingFinancial} from '../../utils/financialCommand'
import useWorkspaceDraft from '../../hooks/useWorkspaceDraft'
import WorkspaceDraftNotice from '../../components/WorkspaceDraftNotice'
import useVisibleViewport from '../../hooks/useVisibleViewport'
import {restaurantSettingsDraft,validRestaurantSettingsDraft,compileRestaurantSettingsDraft,rebaseRestaurantSettingsDraft,assertRestaurantSettingsOriginal} from '../../utils/restaurantSettingsDraft.mjs'

const empty=()=>({draft:null,baseline:'',recipeTarget:'',ingredient:'',open:false,setupProposal:false})
const button={minHeight:48,fontSize:18,whiteSpace:'normal'},field={minHeight:48,fontSize:18},grid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:12}
function Field({label,children}){return <label style={{display:'flex',flexDirection:'column',gap:6,fontSize:16}}>{tr(label)}{children}</label>}

export default function RestaurantSettingsEditor({data,products,session,store,reload,menuEditing=false,onEditing}){
 const [editor,setEditor]=useState(()=>({...empty(),open:!data.config.enabled})),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(null),[pendingError,setPendingError]=useState(''),[conflict,setConflict]=useState(null)
 const locked=useRef(false),alive=useRef(true),latest=useRef(null),recovery=useRef(null),viewport=useVisibleViewport();latest.current={data,products,session,editor}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;onEditing?.(false)}},[])
 function current(context,metadata){const scope=latest.current.workspace?.scope?.context;return alive.current&&(!metadata?.isCurrent||metadata.isCurrent())&&latest.current.session.userId===context?.userId&&latest.current.session.role===context?.role&&!!scope&&privateDraftDigest(scope)===privateDraftDigest(context)}
 async function restore(value,metadata){
  if(metadata.context){await reload?.();if(!current(metadata.context,metadata))return;const context=await loadPrivateDraftContext(latest.current.session);if(!current(metadata.context,metadata))return;if(privateDraftDigest(context)!==privateDraftDigest(metadata.context))throw Error('店面或帳號已變更，請保留原輸入核對。')}
  setEditor(value?{...value,open:true}:empty());setConflict(null);setError('');setMessage('')
 }
 async function original(result,_state,metadata){
  const request=assertRestaurantSettingsOriginal(result,metadata.context),old=readPendingFinancial()
  if(old?.request.id===result.id){if(privateDraftDigest(old.request)!==result.digest)throw Error('原單資料需要核對');await store.retryFinancial()}
  if(!current(metadata.context,metadata))return
  const next=await reload?.();if(!current(metadata.context,metadata))return
  setEditor(empty());setConflict(null);setError('');setMessage(canonicalSignature((next||latest.current.data).config)===canonicalSignature(request.config)?'設定已保存。':'原設定已保存，目前設定另有更新。')
 }
 const workspace=useWorkspaceDraft({kind:'restaurant-settings',session,state:editor,hasContent:!!editor.draft,validate:validRestaurantSettingsDraft,onRestore:restore,onOriginal:original})
 latest.current.workspace=workspace
 const ownPending=pending?.kind==='restaurant'&&pending.request.action==='configure'&&pending.request.id===workspace.originalId
 const blocked=busy||!!pending||!!pendingError||workspace.blocked||menuEditing
 const stale=!!editor.draft&&editor.baseline!==canonicalSignature(data.config)
 const visible=editor.draft||restaurantSettingsDraft(data.config,data.fundsSetup?.newStore===true)
 useEffect(()=>{
  if(!ownPending)return
  const previous=document.activeElement,controls=()=>[...recovery.current?.querySelectorAll('button:not(:disabled)')||[]].filter(node=>node.getClientRects().length)
  ;(controls()[0]||recovery.current)?.focus()
  function keys(event){if(event.key!=='Tab'||!recovery.current)return;const nodes=controls(),first=nodes[0],last=nodes.at(-1);if(!first){event.preventDefault();return}if(!recovery.current.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus()}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
  window.addEventListener('keydown',keys,true);return()=>{window.removeEventListener('keydown',keys,true);if(previous?.isConnected)previous.focus()}
 },[ownPending,busy])
 useEffect(()=>{onEditing?.(!menuEditing&&!!editor.draft)},[!!editor.draft,menuEditing])
 function readPending(){try{setPending(readPendingFinancial());setPendingError('')}catch(cause){setPendingError(cause.message)}}
 useEffect(()=>{readPending()},[store.financialState?.phase,store.financialState?.id])
 function edit(update,extra={}){workspace.begin();setEditor(old=>{const config=latest.current.data.config;return {...old,draft:update(old.draft||restaurantSettingsDraft(config,latest.current.data.fundsSetup?.newStore===true)),baseline:old.draft?old.baseline:canonicalSignature(config),setupProposal:old.draft?old.setupProposal:latest.current.data.fundsSetup?.newStore===true,...extra}});setConflict(null);setError('');setMessage('')}
 function reconcile(choices=null){
  try{
   if(choices&&conflict.source!==canonicalSignature(latest.current.data.config))throw Error('店內設定又更新了，請再核對一次。')
   const next=rebaseRestaurantSettingsDraft(editor,latest.current.data.config,choices||{})
   if(next.conflicts.length){setConflict({source:canonicalSignature(latest.current.data.config),choices:{},rows:next.conflicts});return}
   setEditor(old=>({...old,draft:next.draft,baseline:next.baseline,setupProposal:old.setupProposal&&latest.current.data.fundsSetup?.newStore===true}));setConflict(null);setError('')
  }catch(cause){setError(cause.message)}
 }
 async function save(retry=false){
  if(locked.current||pendingError||(!retry&&(blocked||stale)))return
  locked.current=true;setBusy(true);setError('');setMessage('')
  const actor={...session},operationScope=workspace.scope?.key;let context
  try{
   context=await loadPrivateDraftContext(actor);if(!current(context))return;workspace.assertScope(context)
   if(retry){if(!ownPending)throw Error('請先核對上一筆異動')}
   const snapshot=editor.draft?editor:{...editor,draft:visible,baseline:canonicalSignature(data.config),setupProposal:data.fundsSetup?.newStore===true}
   if(!retry){const fresh=await reload?.();if(!current(context))return;if(!fresh||snapshot.baseline!==canonicalSignature(fresh.config))throw Error('店內設定已更新，這裡保留你的修改。')}
   const source=retry?readPendingFinancial()?.request:{action:'configure',config:compileRestaurantSettingsDraft(snapshot,latest.current.products),expectedConfig:snapshot.baseline,storeId:context.storeId,epoch:context.epoch,...(snapshot.setupProposal?{fundsSetupProposal:true}:{})}
   if(!source||source.action!=='configure')throw Error('請先核對上一筆異動')
   if(!retry&&!editor.draft)setEditor(snapshot)
   const result=retry?await store.retryFinancial():await store.commitRestaurant(source,workspace.identity(),saved=>{if(!current(context))throw Error('店面或帳號已變更，請保留原輸入核對。');workspace.assertScope(context);workspace.remember(saved.request)})
   if(!current(context))return;workspace.assertScope(context)
   const request=result?.receipt&&JSON.parse(result.receipt.signature)
   assertRestaurantSettingsOriginal({protocol:'pos-private-draft-original/v1',status:'matched',id:request?.id,digest:request&&privateDraftDigest(request),action:'configure',result},context)
   workspace.complete();await reload?.();if(!current(context))return
   setEditor(empty());setConflict(null);setMessage(canonicalSignature(result.config)===canonicalSignature(source.config)?'設定已保存。':'原設定已保存，目前設定另有更新。')
  }catch(cause){if(alive.current&&latest.current.workspace?.scope?.key===operationScope){setError(cause.message);try{if(!readPendingFinancial())workspace.uncommitted()}catch{}}}finally{locked.current=false;if(alive.current){setBusy(false);readPending()}}
 }
 function discard(){try{workspace.complete();setEditor({...empty(),open:true});setConflict(null);setError('');setMessage('')}catch(cause){setError(cause.message)}}
 const name=id=>products.find(row=>row.id===id)?.name||id
 function conflictLabel(path){return path[0]==='recipes'?[name(path[1]),path[2]?name(path[2]):tr('配方')].join(' · '):tr({enabled:'啟用正式預訂',dailyCapacity:'每日最多品項份數',slotCapacity:'每 15 分鐘最多品項份數',fundsEnabled:'可以先收訂金、分次收款'}[path[0]])}
 function conflictValue(value,path){if(value===undefined)return tr('移除');if(typeof value==='boolean')return tr(value?'開啟':'關閉');if(value&&typeof value==='object')return Object.entries(value).map(([id,qty])=>name(id)+' '+qty).join('、');return String(value)+(path.length===3?' '+(products.find(row=>row.id===path[2])?.unit||tr('個')):'')}
 return <section data-settings-editor>
  <WorkspaceDraftNotice draft={workspace}/>
  {message&&<p role="status" data-settings-done>{tr(message)}</p>}
  {error&&!stale&&<p role="alert" style={{overflowWrap:'anywhere'}}>{trMessage(error)}</p>}
  {pendingError&&<p role="alert">{trMessage(pendingError)}</p>}
  {ownPending&&createPortal(<div style={{position:'fixed',inset:0,zIndex:300,background:'rgba(0,0,0,.45)'}}><section ref={recovery} tabIndex={-1} className="card" data-settings-pending role="dialog" aria-modal="true" aria-labelledby="settings-recovery-title" style={{position:'fixed',left:16,right:16,top:viewport.top+16,margin:'0 auto',maxWidth:480,maxHeight:Math.max(120,viewport.height-32),padding:18,overflowY:'auto',overflowWrap:'anywhere'}}><h3 id="settings-recovery-title">{tr('核對上次設定')}</h3><p>{tr('上次設定尚未確認，請沿用原編號核對。')}</p><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button type="button" className="btn btn-primary" style={button} data-settings-retry disabled={busy} onClick={()=>save(true)}>{busy?tr('保存中…'):tr('核對上次設定')}</button><button type="button" className="btn btn-ghost" style={button} data-settings-recovery-home disabled={busy} onClick={()=>store.setView('dashboard')}>{tr('回首頁核對原單')}</button><button type="button" className="btn btn-ghost" style={button} disabled={busy} onClick={()=>store.setView('recovery')}>{tr('資料復原')}</button></div>{error&&<p role="alert">{trMessage(error)}</p>}</section></div>,document.body)}
  {!!pending&&!ownPending&&<p>{tr('請先核對上一筆異動')}</p>}
  <details className="card" data-settings-details open={editor.open} onToggle={event=>{const open=event.currentTarget.open;setEditor(old=>old.open===open?old:{...old,open})}} style={{padding:14,marginBottom:16}}>
   <summary style={{minHeight:48,fontSize:18}}>{tr('產能與原料配方設定')}{editor.draft?tr('（尚未儲存）'):''}</summary>
   {menuEditing&&<p>{tr('請先保存或關閉菜單設定。')}</p>}
   <fieldset disabled={blocked} data-settings-form style={{border:0,padding:0,margin:0,minWidth:0}}>
    {stale&&<div role="alert" data-settings-stale><p>{tr('店內設定已更新，這裡保留你的修改。')}</p><button type="button" className="btn btn-ghost" style={button} data-settings-draft-rebase onClick={()=>reconcile()}>{tr('保留輸入，重新核對')}</button></div>}
    {conflict&&<div data-settings-conflicts><p>{tr('同一項設定有兩個版本，請選擇要保留的值。')}</p>{conflict.rows.map(row=><div key={row.key} className="card" style={{padding:12,marginBottom:12,overflowWrap:'anywhere'}} data-settings-conflict={row.key}><strong>{conflictLabel(row.path)}</strong><p>{tr('我填的')}：{conflictValue(row.local,row.path)}</p><p>{tr('店內最新')}：{conflictValue(row.remote,row.path)}</p><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{['local','remote'].map(choice=><button key={choice} type="button" className="btn btn-ghost" style={button} data-settings-choice={choice} aria-pressed={conflict.choices[row.key]===choice} onClick={()=>setConflict(old=>({...old,choices:{...old.choices,[row.key]:choice}}))}>{tr(choice==='local'?'保留我填的':'用店內最新')}</button>)}</div></div>)}<button type="button" className="btn btn-primary" style={button} data-settings-apply-choices disabled={conflict.rows.some(row=>!conflict.choices[row.key])} onClick={()=>reconcile(conflict.choices)}>{tr('套用選擇，再核對')}</button></div>}
    <div style={grid}>
     <Field label="每日最多品項份數"><input aria-label={tr('每日預訂產能')} className="field" style={field} inputMode="numeric" maxLength={32} value={visible.dailyCapacity} onChange={event=>edit(value=>({...value,dailyCapacity:event.target.value}))}/></Field>
     <Field label="每 15 分鐘最多品項份數"><input aria-label={tr('時段預訂產能')} className="field" style={field} inputMode="numeric" maxLength={32} value={visible.slotCapacity} onChange={event=>edit(value=>({...value,slotCapacity:event.target.value}))}/></Field>
     <label style={{display:'flex',gap:10,alignItems:'center',minHeight:48,fontSize:18}}><input type="checkbox" aria-label={tr('啟用正式預訂')} checked={visible.enabled} onChange={event=>edit(value=>({...value,enabled:event.target.checked}))}/>{tr('啟用正式預訂出餐')}</label>
     <label style={{display:'flex',gap:10,alignItems:'center',minHeight:48,fontSize:18}}><input data-funds-enable type="checkbox" aria-label={tr('可以先收訂金、分次收款')} checked={visible.fundsEnabled} onChange={event=>edit(value=>({...value,fundsEnabled:event.target.checked}),{setupProposal:false})}/>{tr('可以先收訂金、分次收款')}</label>
    </div>
    <p>{tr('只影響新訂單，舊單保留原來的方式。')}</p>
    <details><summary>{tr('配方怎麼填？')}</summary><p>{tr('設定配方前，先在庫存管理建立原料／包材並填寫單位、成本與實際庫存。未設定配方的品項直接預留成品庫存；有配方的品項按原料可用量接單。')}</p></details>
    <div style={{...grid,marginTop:14}}>
     <Field label="要設定配方的菜單品項"><select aria-label={tr('配方菜單')} className="field" style={field} value={editor.recipeTarget} onChange={event=>edit(value=>value,{recipeTarget:event.target.value,ingredient:''})}><option value="">{tr('選擇品項')}</option>{products.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
     <Field label="使用的原料／包材"><select aria-label={tr('配方原料')} className="field" style={field} value={editor.ingredient} onChange={event=>edit(value=>value,{ingredient:event.target.value})}><option value="">{tr('選擇原料')}</option>{products.filter(row=>row.id!==editor.recipeTarget).map(row=><option key={row.id} value={row.id}>{row.name}（{row.unit||tr('個')}）</option>)}</select></Field>
     <button type="button" className="btn btn-ghost" style={button} disabled={!editor.recipeTarget||!editor.ingredient} onClick={()=>edit(value=>({...value,recipes:{...value.recipes,[editor.recipeTarget]:[...(value.recipes[editor.recipeTarget]||[]).filter(row=>row.id!==editor.ingredient),{id:editor.ingredient,qty:'1'}]}}))}>{tr('加入配方原料')}</button>
    </div>
    {Object.entries(visible.recipes).map(([target,rows])=><div key={target} style={{marginTop:14}}><strong>{name(target)}</strong>{rows.map(row=><div key={row.id} style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:8}}><span>{name(row.id)}</span><input className="field" aria-label={tr('每份用量 {0} {1}',{0:target,1:row.id})} inputMode="decimal" maxLength={32} style={{...field,width:120}} value={row.qty} onChange={event=>edit(value=>({...value,recipes:{...value.recipes,[target]:value.recipes[target].map(item=>item.id===row.id?{...item,qty:event.target.value}:item)}}))}/><span>{products.find(item=>item.id===row.id)?.unit||tr('個')}{tr('／份')}</span><button type="button" className="btn btn-ghost" style={button} onClick={()=>edit(value=>{const recipes={...value.recipes},remaining=recipes[target].filter(item=>item.id!==row.id);if(remaining.length)recipes[target]=remaining;else delete recipes[target];return {...value,recipes}})}>{tr('移除原料')}</button></div>)}</div>)}
    <button type="button" className="btn btn-primary" style={{...button,marginTop:14}} data-settings-save disabled={stale||!!conflict} onClick={()=>save()}>{busy?tr('保存中…'):tr('儲存預訂設定')}</button>
   </fieldset>
   {!!editor.draft&&<button type="button" className="btn btn-ghost" style={{...button,marginTop:12}} data-settings-discard disabled={busy||!!pending||workspace.blocked} onClick={discard}>{tr('捨棄設定修改')}</button>}
  </details>
 </section>
}
