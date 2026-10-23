import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {tr,trMessage} from '../../i18n'
import {loadRestaurantMenuQuote} from '../../utils/dataAccess'
import {readPendingFinancial} from '../../utils/financialCommand'
import {canonicalSignature} from '../../../electron/operationRules.mjs'
import {quoteRestaurantMenu,validateRestaurantMenuQuote,restaurantMenuLineSummary} from '../../../electron/restaurantMenu.mjs'
import {menuSelectionDefaults} from './MenuSelectionPreview'
import useVisibleViewport from '../../hooks/useVisibleViewport'
import useWorkspaceDraft from '../../hooks/useWorkspaceDraft'
import WorkspaceDraftNotice from '../../components/WorkspaceDraftNotice'
import {validStaffMenuDraft} from '../../utils/restaurantDraftShapes.mjs'
import {privateDraftDigest} from '../../../electron/privateDrafts.mjs'
import {publicRestaurantMenu} from '../../../electron/restaurantCustomerMenu.mjs'
import {prepareRestaurantCommand} from '../../utils/restaurantCommand.mjs'
import './RestaurantMenuEditor.css'
import {validDiningDraft,diningForm,diningPending} from '../../utils/reservationDiningDraft.mjs'
import DiningMemberSelect from '../reservations/DiningMemberSelect'
import ReservationDepositAmounts from '../reservations/ReservationDepositAmounts'

const money=cents=>'NT$ '+(cents/100).toFixed(2).replace(/\.00$/,'')
const blank=data=>{const now=new Date();return {channel:'walkin',day:data.today||`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`,slot:'12:00',customer:'',contact:'',note:''}}
const scope=(data,session)=>canonicalSignature({storeId:data.storeId||'',epoch:data.epoch||'',costMode:data.costMode||'',userId:session.userId,username:session.username,role:session.role})
function checkPreview(value,items,data,session){
 if(value?.protocol!=='pos-restaurant-menu-preview/v1'||!value.menuReview?.configurationId)throw Error('餐點報價與原選擇不同，請重新核對。')
 const quote=validateRestaurantMenuQuote(value.menuReview.quote)
 const selected=quoteRestaurantMenu({...quote.scope,now:quote.issuedAt,menu:quote.source.menu,products:quote.source.products.map(row=>({...row,stock:0})),config:{recipes:quote.source.recipes}},items).quote
 if(selected.signature!==quote.signature||typeof value.availability?.available!=='boolean')throw Error('餐點報價與原選擇不同，請重新核對。')
 if(canonicalSignature(quote.scope)!==canonicalSignature({storeId:data.storeId,epoch:data.epoch,costMode:data.costMode})||!['owner','staff'].includes(session.role))throw Error('店面或帳號已變更，請保留原輸入核對。')
 return value
}
export default function RestaurantMenuOrder({data,session,store,reload,active,onComplete,onResume,dining=null}){
 const [diningSource,setDiningSource]=useState(()=>dining?structuredClone(dining.source):null)
 const menu=data.config.menu,viewport=useVisibleViewport(),[selection,setSelection]=useState(null),[cart,setCart]=useState([]),[preview,setPreview]=useState(null),[step,setStep]=useState('edit'),[form,setForm]=useState(()=>dining?diningForm(dining.source,data.now):blank(data)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(null),[pendingError,setPendingError]=useState('')
 const lock=useRef(false),root=useRef(null),recovery=useRef(null),sequence=useRef(0),latest=useRef({data,session});latest.current={data,session}
 const menuRevision=privateDraftDigest(menu?publicRestaurantMenu(data.config,store.products):null),[draftRevision,setDraftRevision]=useState(menuRevision),[cartLabels,setCartLabels]=useState([]),[selectionLabel,setSelectionLabel]=useState('')
 const workspace=useWorkspaceDraft({kind:dining?'reservation-menu-order:'+dining.source.bookingId:'menu-order',session,state:{cart,labels:cartLabels,selection,selectionLabel,form,menuRevision:draftRevision,...(dining?{dining:diningSource}:{})},hasContent:!!cart.length||!!selection||Object.entries(form).some(([key,value])=>['customer','contact','note'].includes(key)&&value),validate:(value,context)=>dining?validDiningDraft(value,context,validStaffMenuDraft,dining.source.bookingId):validStaffMenuDraft(value),onRestore:value=>{if(dining)setDiningSource(value?.dining||structuredClone(dining.source));setCart(value?.cart??[]);setCartLabels(value?.labels??[]);setSelection(value?.selection??null);setSelectionLabel(value?.selectionLabel??'');setForm(value?.form??(dining?diningForm(dining.source,latest.current.data.now):blank(latest.current.data)));setDraftRevision(value?.menuRevision??menuRevision);setPreview(null);setStep('edit');setError('');origin.current=scope(latest.current.data,latest.current.session);if(value&&(value.cart.length||value.selection))onResume?.()},onOriginal:async(result,_state,completion)=>{if(result.action!=='create')throw Error('原單資料需要核對');const original=diningPending(readPendingFinancial(),dining?.source.bookingId);if(original?.request.id===result.id){if(privateDraftDigest(original.request)!==result.digest)throw Error('原單資料需要核對');await store.retryFinancial()}if(completion?.isCurrent&&!completion.isCurrent())return;workspace.complete();finish(result.entryId);await reload?.()},enabled:!!menu})
 const context=scope(data,session),source=canonicalSignature({menu:menu??null,recipes:data.config.recipes,products:store.products.map(({id,name,price,cost,unit})=>({id,name,price,cost,unit:unit||''}))})
 const origin=useRef(context);if(!cart.length&&!selection)origin.current=context
 const displaced=origin.current!==context
 const pendingMenu=!dining&&pending?.kind==='restaurant'&&pending.request.action==='create'&&!pending.request.customerOrderId&&pending.request.menuProtocol==='pos-restaurant-menu/v1',blocked=busy||!!pending||!!pendingError||displaced||workspace.blocked
 function readPending(){try{setPending(diningPending(readPendingFinancial(),dining?.source.bookingId));setPendingError('')}catch(cause){setPendingError(cause.message)}}
 useEffect(()=>{readPending()},[store.financialState?.phase,store.financialState?.id])
 useEffect(()=>{sequence.current++;setPreview(null);setStep('edit')},[context,source])
 useEffect(()=>()=>{sequence.current++},[])
 useEffect(()=>{
  if(!pendingMenu)return
  const previous=document.activeElement,controls=()=>[...recovery.current?.querySelectorAll('button:not(:disabled),summary')||[]].filter(node=>node.getClientRects().length)
  controls()[0]?.focus()
  function keys(event){if(event.key!=='Tab')return;const nodes=controls(),first=nodes[0],last=nodes.at(-1);if(!first)return;if(!recovery.current?.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus()}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
  window.addEventListener('keydown',keys,true);return()=>{window.removeEventListener('keydown',keys,true);if(previous?.isConnected)previous.focus()}
 },[pendingMenu])
 function editSelection(value){workspace.begin();sequence.current++;setSelection(value);try{setSelectionLabel(restaurantMenuLineSummary(value,publicRestaurantMenu(data.config,store.products)).name)}catch{setSelectionLabel(menu?.offers.find(row=>row.id===value.offerId)?.name||selectionLabel)}setError('')}
 function choice(group,option,count){const selected=selection.selections.find(row=>row.groupId===group.id)||{groupId:group.id,choices:[]},choices=group.min===1&&group.max===1?[{id:option.id,qty:1}]:[...selected.choices.filter(row=>row.id!==option.id),...(count?[{id:option.id,qty:count}]:[])];editSelection({...selection,selections:[...selection.selections.filter(row=>row.groupId!==group.id),{groupId:group.id,choices}]})}
 function finish(entryId){setCart([]);setCartLabels([]);setSelection(null);setSelectionLabel('');setPreview(null);setStep('edit');setForm(dining?diningForm(dining.source,latest.current.data.now):blank(latest.current.data));setMessage('已接單，請到工作單開始備餐。');onComplete?.(entryId)}
 async function quote(items,review=false){
  if(lock.current||blocked)return;lock.current=true;setBusy(true);setError('');setMessage('');const ticket=++sequence.current,expected=context
  try{const result=checkPreview(await loadRestaurantMenuQuote({items},session),items,data,session)
   workspace.assertScope(result.menuReview.quote.scope)
   if(ticket!==sequence.current||scope(latest.current.data,latest.current.session)!==expected)throw Error('店面或帳號已變更，請保留原輸入核對。')
   setCart(result.menuReview.quote.input);setCartLabels(result.menuReview.quote.items.map(row=>row.name));setDraftRevision(menuRevision);setPreview(result);setStep(review?'review':'edit');if(!review){setSelection(null);setSelectionLabel('')}
   if(!result.availability.available)setError('原料可用量不足，請調整餐點。')
   if(review)root.current?.scrollIntoView?.({block:'start'})
  }catch(cause){setError(cause.message);setPreview(null);setStep('edit')}finally{lock.current=false;setBusy(false);readPending()}
 }
 function remove(index){sequence.current++;setCart(rows=>rows.filter((_,i)=>i!==index));setCartLabels(rows=>rows.filter((_,i)=>i!==index));setPreview(null);setError('');setStep('edit')}
 async function save(retry=false){
  if(lock.current||pendingError||(!retry&&blocked))return;lock.current=true;setBusy(true);setError('');setMessage('')
  try{
   if(retry){const original=readPendingFinancial();if(original?.kind!=='restaurant'||original.request.action!=='create'||original.request.customerOrderId||original.request.menuProtocol!=='pos-restaurant-menu/v1')throw Error('請先核對上一筆異動')}
   else if(step!=='review'||!preview?.availability.available||scope(latest.current.data,latest.current.session)!==context)throw Error('請重新核對餐點與總額')
   const identity=retry?null:{id:workspace.documentId(),time:preview.menuReview.quote.issuedAt},source=retry?null:{action:'create',...form,...preview.menuReview.quote.scope,fundsProtocol:'pos-restaurant-funds/v1',menuProtocol:'pos-restaurant-menu/v1',menuReview:preview.menuReview,draftContext:structuredClone(workspace.assertScope(preview.menuReview.quote.scope))}
   let child=null
   if(!retry){const prepared=prepareRestaurantCommand(source,{state:data,identity});child={...prepared.input,id:identity.id,time:identity.time};if(dining)child=await dining.prepareRequest(child,diningSource);workspace.remember(child)}
   const command=child?Object.fromEntries(Object.entries(child).filter(([key])=>!['id','time'].includes(key))):null
   const result=retry?await store.retryFinancial():await store.commitRestaurant(command,identity)
   if(!result?.success||result.receipt?.action!=='create'||!result.entry?.menu)throw Error('保存結果尚未確認，請保留原編號核對。')
   workspace.complete();finish(result.entry.id);await reload?.()
  }catch(cause){setError(cause.message);if(!readPendingFinancialSafe()){workspace.uncommitted();setPreview(null);setStep('edit')}}finally{lock.current=false;setBusy(false);readPending()}
 }
 const offer=menu?.offers.find(row=>row.id===selection?.offerId),quoteValue=preview?.menuReview.quote,invalidSelection=!!selection&&(!offer||!offer.variants.some(row=>row.id===selection.variantId)||selection.selections.some(group=>!offer.groups.some(row=>row.id===group.groupId&&group.choices.every(choice=>row.choices.some(option=>option.id===choice.id)))))
 return <>
  <WorkspaceDraftNotice draft={workspace}/>
  {message&&<p role="status" data-staff-menu-message>{tr(message)}</p>}
  {pendingMenu&&createPortal(<div className="menu-setup-recovery-overlay"><section ref={recovery} className="card menu-editor menu-setup-recovery" role="dialog" aria-modal="true" aria-labelledby="staff-menu-recovery-title" data-staff-menu-pending style={{top:viewport.top+16,maxHeight:Math.max(120,viewport.height-32)}}><h3 id="staff-menu-recovery-title">{tr('核對上次接單')}</h3><p>{tr('上次接單尚未確認，請沿用原編號核對。')}</p><button type="button" className="btn btn-primary" data-staff-menu-retry disabled={busy} onClick={()=>save(true)}>{busy?tr('核對中…'):tr('核對上次接單')}</button><button type="button" className="btn btn-ghost" data-staff-menu-recover-elsewhere disabled={busy} onClick={()=>store.setView(session.role==='owner'?'recovery':'dashboard')}>{tr(session.role==='owner'?'資料復原':'回首頁核對原單')}</button><details><summary>{tr('原單資料')}</summary><code>{pending.request.id}</code>{error&&<p role="alert">{trMessage(error)}</p>}</details></section></div>,document.body)}
  {active&&menu&&<section ref={root} className="card menu-editor staff-menu-order" data-staff-menu>
   <h3>{tr(dining?'這一桌的餐點':'新增正式訂單')}</h3>{dining&&<p data-reservation-dining-source>{diningSource.customer.name} · {diningSource.tableNames.join(' + ')}</p>}{error&&<p role="alert" data-staff-menu-error>{trMessage(error)}</p>}{displaced&&<p role="alert">{tr('店面或帳號已變更，請保留原輸入核對。')}</p>}{pendingError&&<p role="alert">{trMessage(pendingError)}</p>}{pending&&!pendingMenu&&<p>{tr('請先核對上一筆異動')}</p>}
   <form onSubmit={event=>{event.preventDefault();if(step==='review')save();else quote(cart,true)}}>
    <fieldset disabled={blocked}>
     {step==='edit'?<>
      {draftRevision!==menuRevision&&(cart.length||selection)&&<p role="status">{tr('菜單已更新，請核對餐點與總額。')}</p>}
      {invalidSelection&&<div role="alert"><p>{selectionLabel} · {tr('這道餐點已調整，先前選擇仍保留。')}</p>{offer&&<button type="button" className="btn btn-ghost" data-staff-draft-reselect onClick={()=>editSelection(menuSelectionDefaults(offer))}>{tr('重新選擇這道餐點')}</button>}</div>}
      <div className="staff-menu-offers">{menu.offers.map(row=><button type="button" className="btn btn-ghost" data-staff-offer={row.id} aria-pressed={selection?.offerId===row.id} key={row.id} onClick={()=>editSelection(menuSelectionDefaults(row))}>{row.name}<span>{money(Math.round(row.variants.find(variant=>variant.id===row.defaultVariantId).price*100))}</span></button>)}</div>
      {offer&&!invalidSelection&&<div className="menu-editor-offer" data-staff-choices><h4>{offer.name}</h4><div className="menu-editor-actions">{offer.variants.map(row=><button type="button" className="btn btn-ghost" data-staff-variant={row.id} aria-pressed={selection.variantId===row.id} key={row.id} onClick={()=>editSelection({...selection,variantId:row.id})}>{row.name} · {money(Math.round(row.price*100))}</button>)}</div>
       {offer.groups.map(group=><div data-staff-group={group.id} key={group.id}><strong>{group.name}</strong>{group.min>0&&<small>{tr('至少選 {0} 份',{0:group.min})}</small>}{group.choices.map(option=>{const choices=selection.selections.find(row=>row.groupId===group.id)?.choices||[],count=choices.find(row=>row.id===option.id)?.qty||0,total=choices.reduce((sum,row)=>sum+row.qty,0);return <div className="menu-try-choice" key={option.id}><span>{option.name}{option.priceDelta?' · '+(option.priceDelta>0?'+':'')+money(Math.round(option.priceDelta*100)):''}</span>{group.min===1&&group.max===1?<button type="button" className="btn btn-ghost" data-staff-choice={option.id} aria-pressed={!!count} onClick={()=>choice(group,option,1)}>{tr(count?'已選':'選擇')}</button>:<div className="menu-editor-actions"><button type="button" className="btn btn-ghost" data-staff-minus={option.id} aria-label={tr('減少 {0}',{0:option.name})} disabled={!count} onClick={()=>choice(group,option,count-1)}>−</button><span>{count}</span><button type="button" className="btn btn-ghost" data-staff-plus={option.id} aria-label={tr('增加 {0}',{0:option.name})} disabled={count>=option.max||total>=group.max} onClick={()=>choice(group,option,count+1)}>+</button></div>}</div>})}</div>)}
       <div className="menu-try-choice"><strong>{tr('份數')}</strong><div className="menu-editor-actions"><button type="button" className="btn btn-ghost" data-staff-qty-minus aria-label={tr('減少份數')} disabled={selection.qty<=1} onClick={()=>editSelection({...selection,qty:selection.qty-1})}>−</button><span>{selection.qty}</span><button type="button" className="btn btn-ghost" data-staff-qty-plus aria-label={tr('增加份數')} disabled={selection.qty>=100000} onClick={()=>editSelection({...selection,qty:selection.qty+1})}>+</button></div></div>
       <button type="button" className="btn btn-primary" data-staff-add onClick={()=>quote([...cart,selection])}>{tr('加入訂單')}</button>
      </div>}
      {!!cart.length&&<div data-staff-cart>{cart.map((item,index)=>{const row=quoteValue?.items[index],selectedOffer=menu.offers.find(offer=>offer.id===item.offerId);return <div className="menu-editor-review" data-staff-line={index} key={index}><p><strong>{row?.name||cartLabels[index]||selectedOffer?.name||item.offerId}</strong><span>× {item.qty}</span></p>{!row&&<small>{[selectedOffer?.variants.find(variant=>variant.id===item.variantId)?.name,...item.selections.flatMap(group=>group.choices.map(choice=>selectedOffer?.groups.find(row=>row.id===group.groupId)?.choices.find(row=>row.id===choice.id)?.name))].filter(Boolean).join(' · ')}</small>}<button type="button" className="btn btn-ghost" data-staff-remove={index} onClick={()=>remove(index)}>{tr('移除品項')}</button></div>})}</div>}
     </>:<div data-staff-review>{quoteValue.items.map(item=><div key={item.id} className="menu-editor-review"><p><strong>{item.name} × {item.qty}</strong><span>{money(Math.round(item.price*100)*item.qty)}</span></p></div>)}</div>}
     {quoteValue&&<p className="staff-menu-total" data-staff-total={quoteValue.totalCents}>{tr('合計')} <strong>{money(quoteValue.totalCents)}</strong></p>}
     {dining&&quoteValue&&<ReservationDepositAmounts source={diningSource} totalCents={quoteValue.totalCents}/>}
     {dining&&<button type="button" className="btn btn-ghost" data-reservation-dining-recheck onClick={async()=>{try{setDiningSource(await dining.refreshSource(diningSource));setError('')}catch(error){setError(error.message)}}}>{tr('重新核對桌位')}</button>}
     {dining&&<DiningMemberSelect source={diningSource} members={dining.members} locked={!!dining.source.memberId} onChange={memberId=>{workspace.begin();setDiningSource(old=>({...old,memberId}))}}/>}
     {step==='review'&&!dining&&<div className="menu-editor-two">
      <label>{tr('接單方式')}<select className="field" data-staff-channel value={form.channel} onChange={event=>setForm({...form,channel:event.target.value})}>{Object.entries({walkin:'現場',preorder:'預訂',delivery:'外送'}).map(([value,label])=><option key={value} value={value}>{tr(label)}</option>)}</select></label>
      <label>{tr('取餐／出發日期')}<input className="field" data-staff-day type="date" required value={form.day} onChange={event=>setForm({...form,day:event.target.value})}/></label>
      <label>{tr('時段')}<select className="field" data-staff-slot value={form.slot} onChange={event=>setForm({...form,slot:event.target.value})}>{Array.from({length:96},(_,n)=>`${String(Math.floor(n/4)).padStart(2,'0')}:${String(n%4*15).padStart(2,'0')}`).map(value=><option key={value}>{value}</option>)}</select></label>
      <label>{tr('顧客稱呼')}<input className="field" data-staff-customer maxLength={100} value={form.customer} onChange={event=>setForm({...form,customer:event.target.value})}/></label>
      <label>{tr('電話／聯絡方式（預訂與外送必填）')}<input className="field" data-staff-contact maxLength={100} required={form.channel!=='walkin'} value={form.contact} onChange={event=>setForm({...form,contact:event.target.value})}/></label>
      <label>{tr('地址／備註（外送必填）')}<input className="field" data-staff-note maxLength={1000} required={form.channel==='delivery'} value={form.note} onChange={event=>setForm({...form,note:event.target.value})}/></label>
     </div>}
     {step==='review'&&dining&&<label>{tr('餐點備註')}<input className="field" data-staff-note maxLength={1000} value={form.note} onChange={event=>setForm({...form,note:event.target.value})}/></label>}
     <div className="menu-editor-actions">{step==='review'&&<button type="button" className="btn btn-ghost" data-staff-back onClick={()=>setStep('edit')}>{tr('返回修改')}</button>}<button className="btn btn-primary" data-staff-next={step} type="submit" disabled={!cart.length||step==='review'&&!preview?.availability.available}>{busy?tr('核對中…'):tr(step==='review'?'確認接單並預留':'下一步：確認餐點')}</button></div>
     {step==='review'&&<small>{tr('接單先預留，收款另行確認。')}</small>}
    </fieldset>
   </form>
  </section>}
 </>
}
function readPendingFinancialSafe(){try{return readPendingFinancial()}catch{return true}}
