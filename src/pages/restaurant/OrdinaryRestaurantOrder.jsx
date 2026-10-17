import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../../i18n'
import {getAgentContext,loadPrivateDraftContext,loadRestaurantAgentPreview,lookupPrivateDraftOriginal} from '../../utils/dataAccess'
import {AGENT_PROTOCOL,agentCommand} from '../../../electron/agentDraftRules.mjs'
import {reviewedOrdinaryRestaurantDraft} from '../../../electron/ordinaryRestaurantAgent.mjs'
import {readPendingFinancial} from '../../utils/financialCommand'
import {privateDraftDigest} from '../../../electron/privateDrafts.mjs'
import {verifyQuickOriginal} from '../../utils/quickDraftRecovery'
import {validOrdinaryOrderDraft} from '../../utils/restaurantDraftShapes.mjs'
import useWorkspaceDraft from '../../hooks/useWorkspaceDraft'
import WorkspaceDraftNotice from '../../components/WorkspaceDraftNotice'
import {restaurantAvailability} from '../../../electron/restaurantRules.mjs'

const channels={preorder:'預訂',walkin:'現場',delivery:'外送'}
const grid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12},button={minHeight:48},field={minHeight:48,fontSize:18}
const blank=data=>({channel:'preorder',day:data.today||new Date().toLocaleDateString('en-CA'),slot:'12:00',customer:'',contact:'',note:'',items:[]})
const identity=(data,context=null)=>{const storeId=data.storeId||context?.storeId||'';return {id:crypto.randomUUID(),issuedAt:new Date().toISOString(),storeId,catalogueRevision:context?.storeId===storeId?context.catalogueRevision:''}}
const priceText=value=>'NT$ '+value.toLocaleString('zh-TW',{maximumFractionDigits:2})
function Field({label,children}){return <label style={{display:'flex',flexDirection:'column',gap:5,fontSize:16}}>{tr(label)}{children}</label>}
export default function OrdinaryRestaurantOrder({data,session,store,reload,active,onResume,onComplete}){
 const [form,setForm]=useState(()=>blank(data)),[chosen,setChosen]=useState(''),[meta,setMeta]=useState(()=>identity(data)),[modified,setModified]=useState(false),[context,setContext]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(null),[pendingError,setPendingError]=useState('')
 const sequence=useRef(0),lock=useRef(false),mounted=useRef(true),latest=useRef(null);latest.current={data,session,context}
 const workspace=useWorkspaceDraft({kind:'ordinary-order',session,state:{form,chosen,meta,modified},hasContent:modified,validate:validOrdinaryOrderDraft,onRestore:restore,onOriginal:originalCompleted})
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++}},[])
 useEffect(()=>{let alive=true;const ticket=++sequence.current;setContext(null);getAgentContext(session).then(next=>{if(alive&&ticket===sequence.current){setContext(next);setMeta(old=>old.catalogueRevision?old:{...old,storeId:next.storeId,catalogueRevision:next.catalogueRevision})}}).catch(e=>{if(alive&&ticket===sequence.current)setError(e.message)});return()=>{alive=false}},[data.storeId,data.epoch,session.userId,session.role])
 useEffect(()=>{try{setPending(readPendingFinancial());setPendingError('')}catch(e){setPendingError(e.message)}},[store.financialState?.phase,store.financialState?.id])
 const ownPending=pending?.kind==='restaurant'&&pending.request.id==='agent-'+meta.id&&pending.request.agentDraft?.protocol===AGENT_PROTOCOL&&pending.request.action==='create',financialPending=!!pending||['saving','uncertain'].includes(store.financialState?.phase),blocked=busy||workspace.blocked||financialPending||!!pendingError||!context
 async function restore(value,metadata){const ticket=++sequence.current;if(metadata?.isCurrent&&!metadata.isCurrent())return;setContext(null);setForm(blank(latest.current.data));setChosen('');setModified(false);setError('');setMessage('');if(!metadata?.context)return;const fresh=await getAgentContext(latest.current.session);if(ticket!==sequence.current||!mounted.current||metadata.isCurrent&&!metadata.isCurrent())return;if(fresh.storeId!==metadata.context.storeId)throw Error('店面或帳號已變更，請保留原輸入核對。');setContext(fresh);setForm(value?.form||blank(latest.current.data));setChosen(value?.chosen||'');setMeta(value?.meta||identity({...latest.current.data,storeId:metadata.context.storeId},fresh));setModified(value?.modified||false);if(value?.modified)onResume?.()}
 function finish(){sequence.current++;workspace.complete();setForm(blank(latest.current.data));setChosen('');setMeta(identity(latest.current.data,latest.current.context));setModified(false);setError('');setMessage('已加入備餐工作單');onComplete?.()}
 async function originalCompleted(original,_state,completion){
  const ticket=sequence.current;if(completion?.isCurrent&&!completion.isCurrent())return
  const verified=verifyQuickOriginal(original);if(verified.kind!=='restaurant'||verified.request.agentDraft?.protocol!==AGENT_PROTOCOL)throw Error('原單資料需要核對')
  const saved=readPendingFinancial();if(saved?.request.id===original.id){if(privateDraftDigest(saved.request)!==original.digest)throw Error('原單資料需要核對');await store.retryFinancial()}else await reload?.()
  if(!mounted.current||ticket!==sequence.current||completion?.isCurrent&&!completion.isCurrent())return;finish()
 }
 function edit(fn){workspace.begin();sequence.current++;setModified(true);setMessage('');setError('');setForm(fn)}
 function select(value){workspace.begin();sequence.current++;setModified(true);setMessage('');setError('');setChosen(value)}
 function rawDraft(){
  if(!meta.catalogueRevision||!form.items.length)throw Error('請選擇 1 至 100 個品項')
  const items=form.items.map(row=>{if(!/^[1-9]\d{0,5}$/.test(row.qty)||Number(row.qty)>100000)throw Error('銷售與預訂須為整數份數，售價由店內資料決定');return {productId:row.id,qty:Number(row.qty)}})
  return {protocol:AGENT_PROTOCOL,...meta,kind:'restaurant',items,channel:form.channel,day:form.day,slot:form.slot,customer:form.customer,contact:form.contact,note:form.note}
 }
 async function accepted(result,authority,ticket){
  const proof=result.originalProof;if(result.original?.id!=='agent-'+meta.id||proof?.id!==result.original.id||typeof proof.digest!=='string')throw Error('原單資料需要核對')
  const original=await lookupPrivateDraftOriginal({context:authority,id:proof.id,digest:proof.digest,family:'quick-restaurant'},session);if(ticket!==sequence.current||!mounted.current)return
  workspace.assertScope(authority);await originalCompleted(original,null,{isCurrent:()=>mounted.current&&ticket===sequence.current})
 }
 async function review(refresh=false){
  if(lock.current||financialPending||workspace.blocked)return;lock.current=true;setBusy(true);setError('');setMessage('');const ticket=sequence.current
  try{
   const authority=await loadPrivateDraftContext(session);if(ticket!==sequence.current||!mounted.current)return;workspace.assertScope(authority)
   let source=rawDraft(),result
   try{result=await loadRestaurantAgentPreview({draft:source,...(refresh?{refresh:true}:{})},session)}catch(e){if(!refresh||!e.message.includes('草稿已過期'))throw e;source={...source,issuedAt:new Date().toISOString()};result=await loadRestaurantAgentPreview({draft:source,refresh:true},session)}
   if(ticket!==sequence.current||!mounted.current)return;workspace.assertScope(authority)
   if(result?.status==='accepted'){await accepted(result,authority,ticket);return}
   const fresh=await getAgentContext(session);if(ticket!==sequence.current||!mounted.current)return
   const reviewed=reviewedOrdinaryRestaurantDraft(refresh?result.draft:source,fresh,result,Date.now(),refresh)
   workspace.assertScope(reviewed.ordinaryReview.scope)
   if(refresh){setMeta({id:reviewed.draft.id,issuedAt:reviewed.draft.issuedAt,storeId:reviewed.draft.storeId,catalogueRevision:reviewed.draft.catalogueRevision});setForm(current=>({...current,items:current.items.map(row=>({...row,name:reviewed.items.find(item=>item.id===row.id).name,unit:reviewed.items.find(item=>item.id===row.id).unit,price:reviewed.items.find(item=>item.id===row.id).price}))}));setContext(fresh);return}
   if(reviewed.items.some(row=>form.items.find(item=>item.id===row.id)?.price!==row.price))throw Error('店內品項或價格已更新，請重新整理草稿')
   if(!reviewed.availability.available)throw Error('原料可用量不足，請調整餐點。')
   const command=agentCommand(reviewed);await store.commitRestaurant({...command.input,draftContext:authority},command.identity,pending=>workspace.remember(pending.request))
   if(ticket===sequence.current&&mounted.current){finish();await reload?.()}
  }catch(e){if(ticket===sequence.current&&mounted.current){setError(e.message);try{if(!readPendingFinancial())workspace.uncommitted()}catch{}}}finally{lock.current=false;if(mounted.current)setBusy(false)}
 }
 async function retry(){if(lock.current)return;lock.current=true;setBusy(true);setError('');const ticket=sequence.current;try{const result=await store.retryFinancial();if(ticket===sequence.current&&mounted.current&&result?.receipt?.id==='agent-'+meta.id){finish();await reload?.()}}catch(e){if(ticket===sequence.current&&mounted.current)setError(e.message)}finally{lock.current=false;if(mounted.current)setBusy(false)}}
 async function discard(){if(blocked)return;workspace.complete();try{await restore(null,{context:workspace.scope?.context})}catch(e){setError(e.message)}}
 const ingredients=new Set(Object.values(data.config.recipes).flat().map(row=>row.id)),menu=store.products.filter(row=>!ingredients.has(row.id)&&!data.config.menu?.offers.some(offer=>offer.productId===row.id)),countsValid=form.items.every(row=>/^[1-9]\d{0,5}$/.test(row.qty)&&Number(row.qty)<=100000),totalCents=countsValid?form.items.reduce((sum,row)=>sum+BigInt(Math.round(row.price*100))*BigInt(row.qty),0n):null,total=totalCents!==null&&totalCents<=100000000000n?Number(totalCents)/100:null
 return <section data-ordinary-order>
  <WorkspaceDraftNotice draft={workspace}/>
  {message&&<p role="status" data-ordinary-done>{tr(message)}</p>}
  {ownPending&&<div className="card" data-ordinary-pending style={{padding:14,marginBottom:12}}><p>{tr('上次接單尚未確認，請沿用原編號核對。')}</p><button type="button" className="btn btn-primary" style={button} data-ordinary-retry disabled={busy} onClick={retry}>{tr('核對上次接單')}</button></div>}
  {pendingError&&<p role="alert">{trMessage(pendingError)}</p>}
  {active&&<form onSubmit={event=>{event.preventDefault();review()}} className="card" data-ordinary-form style={{padding:14,marginBottom:16}}>
   <h3>{tr('新增正式訂單')}</h3>{error&&<p role="alert">{trMessage(error)}</p>}{financialPending&&!ownPending&&<p>{tr('請先核對上一筆異動')}</p>}
   <fieldset disabled={blocked} style={{border:0,padding:0,minWidth:0}}>
    <div style={grid}>
     <Field label="接單方式"><select aria-label={tr('預訂接單方式')} className="field" style={field} value={form.channel} onChange={e=>edit(f=>({...f,channel:e.target.value}))}>{Object.entries(channels).map(([key,label])=><option key={key} value={key}>{tr(label)}</option>)}</select></Field>
     <Field label="取餐／出發日期"><input aria-label={tr('預訂日期')} className="field" style={field} type="date" required value={form.day} onChange={e=>edit(f=>({...f,day:e.target.value}))}/></Field>
     <Field label="時段"><select aria-label={tr('預訂時段')} className="field" style={field} value={form.slot} onChange={e=>edit(f=>({...f,slot:e.target.value}))}>{Array.from({length:96},(_,n)=>`${String(Math.floor(n/4)).padStart(2,'0')}:${String(n%4*15).padStart(2,'0')}`).map(value=><option key={value}>{value}</option>)}</select></Field>
     <Field label="顧客稱呼"><input aria-label={tr('預訂顧客')} className="field" style={field} maxLength={100} value={form.customer} onChange={e=>edit(f=>({...f,customer:e.target.value}))}/></Field>
     <Field label="電話／聯絡方式（預訂與外送必填）"><input aria-label={tr('預訂聯絡方式')} className="field" style={field} maxLength={100} required={form.channel!=='walkin'} value={form.contact} onChange={e=>edit(f=>({...f,contact:e.target.value}))}/></Field>
     <Field label="地址／備註（外送必填）"><input aria-label={tr('預訂備註')} className="field" style={field} maxLength={1000} required={form.channel==='delivery'} value={form.note} onChange={e=>edit(f=>({...f,note:e.target.value}))}/></Field>
    </div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}><select className="field" aria-label={tr('預訂菜單')} style={{...field,flex:1,minWidth:160}} value={chosen} onChange={e=>select(e.target.value)}><option value="">{tr('選擇品項')}</option>{menu.map(row=><option key={row.id} value={row.id}>{row.name} · ${row.price}{tr(' · 可接 ')}{restaurantAvailability(row,data.config,store.products)}{tr(' 份')}</option>)}</select><button className="btn btn-ghost" style={button} type="button" disabled={!chosen} onClick={()=>{const product=store.products.find(row=>row.id===chosen);if(product)edit(f=>({...f,items:f.items.some(row=>row.id===product.id)?f.items.map(row=>row.id===product.id?{...row,qty:String(Number(row.qty)+1)}:row):[...f.items,{id:product.id,name:product.name,unit:product.unit||'個',qty:'1',price:product.price}]}))}}>{tr('加入訂單')}</button></div>
    {form.items.map(row=><div key={row.id} style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:8}}><span>{row.name} · {priceText(row.price)}</span><input aria-label={tr('預訂份數 {0}',{0:row.id})} className="field" type="number" min="1" step="1" style={{...field,width:100}} value={row.qty} onChange={e=>edit(f=>({...f,items:f.items.map(item=>item.id===row.id?{...item,qty:e.target.value}:item)}))}/><button className="btn btn-ghost" style={button} type="button" onClick={()=>edit(f=>({...f,items:f.items.filter(item=>item.id!==row.id)}))}>{tr('移除品項')}</button></div>)}
    <p>{tr('應收 NT$ ')}{total===null?'—':total}{tr('。接單先預留；收款另行確認。')}</p>
    <button className="btn btn-primary" style={button} type="submit" data-ordinary-save disabled={!form.items.length||!data.config.enabled}>{tr('保存預訂並預留庫存')}</button><button className="btn btn-ghost" style={button} type="button" data-ordinary-recheck disabled={!form.items.length} onClick={()=>review(true)}>{tr('保留輸入，重新核對')}</button>{modified&&<button className="btn btn-ghost" style={button} type="button" data-ordinary-discard onClick={discard}>{tr('放棄這張草稿')}</button>}
   </fieldset>
  </form>}
 </section>
}
