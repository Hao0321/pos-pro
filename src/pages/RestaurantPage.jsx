import {tr,trMessage} from "../i18n"
import {useEffect,useRef,useState} from 'react'
import {loadRestaurantState} from '../utils/dataAccess'
import {defaultRestaurantConfig} from '../../electron/restaurantRules.mjs'
import useVisibleViewport from '../hooks/useVisibleViewport'
import CustomerIntakePanel from './restaurant/CustomerIntakePanel'
import TableOrderingPanel from './restaurant/TableOrderingPanel'
import useKitchenPrinting from '../hooks/useKitchenPrinting'
import KitchenPrintPanel from './restaurant/KitchenPrintPanel'
import KitchenPrintStatus from './restaurant/KitchenPrintStatus'
import useRestaurantFundsForms from '../hooks/useRestaurantFundsForms'
import RestaurantFundsForm,{RestaurantFundsNotice} from './restaurant/RestaurantFundsForm'
import {restaurantFundingView,fundsAmountText} from '../utils/restaurantFundsView.mjs'
import RestaurantMenuEditor from './restaurant/RestaurantMenuEditor'
import RestaurantMenuOrder from './restaurant/RestaurantMenuOrder'
import OrdinaryRestaurantOrder from './restaurant/OrdinaryRestaurantOrder'
import RestaurantSettingsEditor from './restaurant/RestaurantSettingsEditor'

const labels={reserved:'已預留',cooking:'製作中',ready:'可取餐',dispatched:'配送中',completed:'已交付',cancelled:'已取消'}
const channels={preorder:'預訂',walkin:'現場',delivery:'外送'}
function Field({label,children}){return <label style={{display:'flex',flexDirection:'column',gap:5,fontSize:13}}>{tr(label)}{children}</label>}
export default function RestaurantPage({store,session}){
  const reloadRef=useRef(null)
  const printing=useKitchenPrinting(session,()=>reloadRef.current?.())
  const [showCreate,setShowCreate]=useState(false),viewport=useVisibleViewport()
  const [menuEditing,setMenuEditing]=useState(false),[settingsEditing,setSettingsEditing]=useState(false)
  const [orderMode,setOrderMode]=useState('menu')
  const panel={...modal,top:viewport.top+16,bottom:'auto',maxHeight:Math.max(120,viewport.height-32)}
  const [data,setData]=useState(null),[pay,setPay]=useState(null),[cancel,setCancel]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false),[filter,setFilter]=useState('active')
  const busy=useRef(false)
  const owner=session.role==='owner',products=store.products
  function acceptState(next){setData(next)}
  const funds=useRestaurantFundsForms({data,session,store,onState:acceptState,onResult:result=>setMessage(result.receipt.action==='funds-receive'?'已保存這次收款':result.receipt.action==='funds-refund'?'已保存這次退款':'已保存取消與款項')})
  useEffect(()=>{
    let closed=false,running=null,again=false
    const load=()=>{
      if(closed)return Promise.resolve(null)
      if(running){again=true;return running}
      running=(async()=>{
        let result=null
        do{again=false;try{const next=await loadRestaurantState();result=next;if(!closed){acceptState(next);setPay(p=>p&&next.entries.find(e=>e.id===p.entry.id)?.saleId?null:p);setCancel(c=>c&&next.entries.find(e=>e.id===c.entry.id)?.status==='cancelled'?null:c)}}catch(e){result=null;if(!closed)setError(e.message)}}while(again&&!closed)
        return closed?null:result
      })().finally(()=>{running=null})
      return running
    }
    reloadRef.current=load;load();window.addEventListener('pos-data-refreshed',load);window.addEventListener('pos-restaurant-operation',load);const removeOrder=window.electronAPI?.onNewOrder?.(load)
    return()=>{closed=true;window.removeEventListener('pos-data-refreshed',load);window.removeEventListener('pos-restaurant-operation',load);removeOrder?.();reloadRef.current=null}
  },[])
  async function commit(input,identity=null){
    if(busy.current)return null;busy.current=true;setSaving(true);setError('');setMessage('')
    try{const result=await store.commitRestaurant(input,identity);await reloadRef.current?.();setMessage(input.customerOrderId?'已加入備餐工作單':input.action==='pay'?`已保存收款 ${result.order.id}，找零 NT$ ${result.order.change}`:input.action==='cancel'?`已保存取消 ${result.receipt.id}${result.refund?'，退款 NT$ '+Math.abs(result.refund.total):''}`:'已保存 '+result.receipt.id);return result}
    catch(e){setError(e.message);return null}finally{busy.current=false;setSaving(false)}
  }
  const config=data?.config||defaultRestaurantConfig()
  const list=data?.entries.filter(e=>filter==='all'||!['cancelled','completed'].includes(e.status)).sort((a,b)=>a.day.localeCompare(b.day)||a.slot.localeCompare(b.slot)||(a.pickupNumber||0)-(b.pickupNumber||0))||[]
  return <div className="restaurant-page" style={{padding:16,overflowY:'auto',height:'100%'}}>
    <h2 className="page-title">{tr("預訂出餐")}</h2><p>{tr('接單、備餐、收款，都在這裡。')}</p>
    {error&&<p role="alert" style={{color:'var(--red)',overflowWrap:'anywhere'}}>{trMessage(error)}</p>}
    {message&&<p role="status" style={{color:'var(--green)',overflowWrap:'anywhere'}}>{trMessage(message)}</p>}
    <RestaurantFundsNotice controller={funds}/>
    {!data&&<p>{tr("載入正式預訂紀錄中…")}</p>}
    {data&&<CustomerIntakePanel data={data} store={store} session={session} commit={commit} reload={()=>reloadRef.current?.()}/>}
    {data&&owner&&<RestaurantMenuEditor data={data} products={products} session={session} store={store} settingsDirty={settingsEditing} onEditing={setMenuEditing} reload={()=>reloadRef.current?.()}/>}
    {data&&owner&&<TableOrderingPanel config={config} store={store} settingsDirty={settingsEditing||menuEditing} reload={()=>reloadRef.current?.()}/>}
    {data&&<KitchenPrintPanel printing={printing} store={store} session={session} entries={data.entries} settingsDirty={settingsEditing||menuEditing}/>}
    {owner&&data&&<RestaurantSettingsEditor key={session.userId+':'+session.role} data={data} products={products} session={session} store={store} menuEditing={menuEditing} onEditing={setSettingsEditing} reload={()=>reloadRef.current?.()}/>}
    {data&&!config.enabled&&<p>{tr("老闆確認設定後即可接單。既有預訂仍可出餐、收款與取消。")}</p>}
    {data&&config.enabled&&<button className="btn btn-primary" data-restaurant-create style={{marginBottom:14,minHeight:48}} onClick={()=>setShowCreate(v=>!v)}>{showCreate?tr("收起接單表單"):tr("新增正式訂單")}</button>}
    {data&&config.enabled&&config.menu&&showCreate&&<div className="menu-editor-actions" data-staff-modes><button type="button" className="btn btn-ghost" data-staff-mode="menu" style={{minHeight:48}} aria-pressed={orderMode==='menu'} onClick={()=>setOrderMode('menu')}>{tr('菜單餐點')}</button><button type="button" className="btn btn-ghost" data-staff-mode="ordinary" style={{minHeight:48}} aria-pressed={orderMode==='ordinary'} onClick={()=>setOrderMode('ordinary')}>{tr('其他商品')}</button></div>}
    {data&&<RestaurantMenuOrder data={data} session={session} store={store} active={config.enabled&&showCreate&&orderMode==='menu'} reload={()=>reloadRef.current?.()} onResume={()=>{setShowCreate(true);setOrderMode('menu')}} onComplete={()=>setShowCreate(false)}/>}
    {data&&<OrdinaryRestaurantOrder data={data} session={session} store={store} reload={()=>reloadRef.current?.()} active={showCreate&&(!config.menu||orderMode==='ordinary')} onResume={()=>{setShowCreate(true);setOrderMode('ordinary')}} onComplete={()=>setShowCreate(false)}/>}
    <div style={{display:'flex',justifyContent:'space-between',gap:10}}><h3>{tr("出餐工作單（")}{list.length}）</h3><select aria-label={tr("出餐篩選")} className="field" style={{width:150}} value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">{tr("待處理")}</option><option value="all">{tr("全部歷史")}</option></select></div>
    {!list.length&&data&&<p>{tr("沒有符合條件的正式預訂。")}</p>}
    {list.map(e=>{
      const funding=restaurantFundingView(e,session.role),money=cents=>'NT$ '+fundsAmountText(cents)
      const status={reserved:'cooking',cooking:'ready',ready:e.channel==='delivery'?'dispatched':'completed',dispatched:'completed'}[e.status]
      const nextAction={cooking:'開始製作',ready:'餐點好了',dispatched:'出發配送',completed:e.channel==='delivery'?'完成交付':'交給客人'}[status]
      return <article className="card" key={e.id} data-restaurant-id={e.id} style={{padding:14,marginBottom:12,overflowWrap:'anywhere'}}>
        <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:10}}><h3 style={{fontSize:22,marginBottom:4}}>{e.tableNum?tr('桌號 {0}',{0:e.tableNum}):e.customer||tr(channels[e.channel])}</h3><strong>NT$ {e.total}</strong></div>
        <strong>{!e.customerOrderId&&<>{e.day} {e.slot} · </>}{tr('取餐號 {0}',{0:e.pickupNumber?String(e.pickupNumber).padStart(3,'0'):e.id})}</strong><p>{e.items.map(i=>`${i.name} × ${i.qty}`).join('、')}</p><p data-kitchen-status={e.status}>{tr(labels[e.status])} · {funding.funded?<span data-restaurant-funding data-funds-due={funding.dueCents} data-funds-retained={funding.retainedCents}>{e.status==='cancelled'?funding.summary.refundedCents?tr('已退回 {0}',{0:money(funding.summary.refundedCents)}):tr('不需收款'):!funding.totalCents?tr('不需收款'):funding.dueCents?tr('已收 {0}，還差 {1}',{0:money(funding.retainedCents),1:money(funding.dueCents)}):tr('款項已收齊')}</span>:e.saleId?tr("已收款"):tr("未收款")}{e.contact?' · '+e.contact:''}</p>{e.note&&<p>{e.note}</p>}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
          {status&&<button className="btn btn-primary" data-kitchen-action={status} aria-label={tr(labels[status])} style={{minHeight:48,flexBasis:'100%'}} disabled={saving||funds.busy||status==='completed'&&!funding.canComplete} onClick={()=>commit({action:'advance',entryId:e.id,expectedVersion:e.version,status})}>{tr(nextAction)}</button>}
          {funding.canReceive&&<button className="btn btn-ghost" data-kitchen-pay aria-label={tr("確認此單收款")} style={{minHeight:48,flex:1}} disabled={saving||funds.busy||!store.openShift} onClick={()=>funding.funded?funds.open(e,'receive'):setPay({entry:e,paid:String(e.total),method:'cash'})}>{tr(funding.funded?funding.retainedCents?'收剩餘款項':'收款':'登記收款')}</button>}
          {funding.canCancel&&<button className="btn btn-ghost" data-kitchen-cancel aria-label={funding.funded?tr('取消餐點'):e.saleId?tr("取消並全額退款"):tr("取消預訂")} style={{minHeight:48,flex:1}} disabled={saving||funds.busy} onClick={()=>funding.funded?funds.open(e,'cancel'):setCancel({entry:e,reason:''})}>{tr(funding.funded?'取消餐點':e.saleId?'取消並退款':'取消這單')}</button>}
        </div>
        {status==='completed'&&!funding.canComplete&&<p>{tr('先登記收款，再交給客人')}</p>}
        <details style={{marginTop:12}}><summary>{tr('原單資料')}</summary><p>{e.day} {e.slot} · {tr(channels[e.channel])}</p><small>{tr("單號 ")}{e.id}{tr(" · 版本 ")}{e.version}{e.saleId?tr(" · 收款 {0}", {0: e.saleId}):''}{e.refundId?tr(" · 退款 {0}", {0: e.refundId}):''}</small>{funding.canRefund&&<p><button className="btn btn-ghost" data-funds-open-refund style={{minHeight:48}} disabled={saving||funds.busy} onClick={()=>funds.open(e,'refund')}>{tr('只退回款項')}</button></p>}</details>
        <KitchenPrintStatus printing={printing} entry={e}/>
        {funding.canReceive&&!store.openShift&&<p>{tr("請先到班別交班開班，再登記收款。")}</p>}
      </article>
    })}
    <RestaurantFundsForm controller={funds} data={data} session={session} shiftId={store.openShift?.id||''}/>
    {pay&&<form className="card" onSubmit={async e=>{e.preventDefault();const r=await commit({action:'pay',entryId:pay.entry.id,expectedVersion:pay.entry.version,shiftId:store.openShift?.id||'',payMethod:pay.method,paid:Number(pay.paid)});if(r)setPay(null)}} style={panel}>
      <h3>{tr("此單收款 NT$ ")}{pay.entry.total}</h3><p>{tr("請先核對款項；保存中與未確認時勿再次收款。")}</p><Field label={tr("付款方式")}><select aria-label={tr("預訂付款方式")} className="field" value={pay.method} onChange={e=>setPay(p=>({...p,method:e.target.value}))}><option value="cash">{tr("現金")}</option><option value="card">{tr("刷卡／轉帳（非現金）")}</option></select></Field><Field label={tr("實收金額")}><input aria-label={tr("預訂實收")} className="field" type="number" min="0" step="0.01" required value={pay.paid} onChange={e=>setPay(p=>({...p,paid:e.target.value}))}/></Field><p>{tr("找零 NT$ ")}{pay.method==='cash'?Math.max(0,Number(pay.paid)-pay.entry.total):0}</p><div style={{display:'flex',gap:10}}><button className="btn btn-primary" disabled={saving} type="submit">{tr("保存此單收款")}</button><button className="btn btn-ghost" type="button" disabled={saving} onClick={()=>setPay(null)}>{tr("返回工作單")}</button></div>
    </form>}
    {cancel&&<form className="card" onSubmit={async e=>{e.preventDefault();const r=await commit({action:'cancel',entryId:cancel.entry.id,expectedVersion:cancel.entry.version,shiftId:store.openShift?.id||'',reason:cancel.reason});if(r)setCancel(null)}} style={panel}><h3>{tr("取消")}{cancel.entry.saleId?tr("並全額退款 NT$ {0}", {0: cancel.entry.total}):tr("預訂")}</h3><p>{cancel.entry.startedAt?tr("已製作的原料不回補，記入損耗並保留產能占用。"):tr("未製作的庫存與產能會釋放。")}</p><Field label={tr("取消原因")}><input className="field" aria-label={tr("預訂取消原因")} required maxLength={1000} value={cancel.reason} onChange={e=>setCancel(c=>({...c,reason:e.target.value}))}/></Field><div style={{display:'flex',gap:10,marginTop:12}}><button className="btn btn-danger" disabled={saving||cancel.entry.saleId&&!store.openShift} type="submit">{tr("保存取消")}{cancel.entry.saleId?tr("與退款"):''}</button><button className="btn btn-ghost" type="button" disabled={saving} onClick={()=>setCancel(null)}>{tr("返回工作單")}</button></div></form>}
  </div>
}
const modal={position:'fixed',zIndex:220,inset:'auto 16px 16px',margin:'0 auto',maxWidth:500,maxHeight:'calc(100dvh - 32px)',overflowY:'auto',padding:20,boxShadow:'0 0 0 200vmax rgba(0,0,0,.45)'}
