import {tr,trMessage} from "../i18n"
import {useEffect,useRef,useState} from 'react'
import {loadRestaurantState} from '../utils/dataAccess'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {defaultRestaurantConfig,restaurantAvailability} from '../../electron/restaurantRules.mjs'
import useVisibleViewport from '../hooks/useVisibleViewport'
import CustomerIntakePanel from './restaurant/CustomerIntakePanel'
import TableOrderingPanel from './restaurant/TableOrderingPanel'

const labels={reserved:'已預留',cooking:'製作中',ready:'可取餐',dispatched:'配送中',completed:'已交付',cancelled:'已取消'}
const channels={preorder:'預訂',walkin:'現場',delivery:'外送'}
const dateText=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
const initialForm=()=>({channel:'preorder',day:dateText(),slot:'12:00',customer:'',contact:'',note:'',items:[]})
const grid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12}
function Field({label,children}){return <label style={{display:'flex',flexDirection:'column',gap:5,fontSize:13}}>{tr(label)}{children}</label>}
export default function RestaurantPage({store,session}){
  const [showCreate,setShowCreate]=useState(false),viewport=useVisibleViewport()
  const panel={...modal,top:viewport.top+16,bottom:'auto',maxHeight:Math.max(120,viewport.height-32)}
  const [data,setData]=useState(null),[draft,setDraft]=useState(defaultRestaurantConfig),[form,setForm]=useState(initialForm),[chosen,setChosen]=useState(''),[recipeTarget,setRecipeTarget]=useState(''),[ingredient,setIngredient]=useState(''),[pay,setPay]=useState(null),[cancel,setCancel]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false),[filter,setFilter]=useState('active')
  const busy=useRef(false),dirty=useRef(false),baseline=useRef(''),reloadRef=useRef(null)
  const owner=session.role==='owner',products=store.products
  useEffect(()=>{
    let closed=false,running=false,again=false
    const load=async()=>{if(running){again=true;return}running=true;do{again=false;try{const next=await loadRestaurantState();if(!closed){setData(next);if(!dirty.current){setDraft(next.config);baseline.current=canonicalSignature(next.config)};setPay(p=>p&&next.entries.find(e=>e.id===p.entry.id)?.saleId?null:p);setCancel(c=>c&&next.entries.find(e=>e.id===c.entry.id)?.status==='cancelled'?null:c)}}catch(e){if(!closed)setError(e.message)}}while(again&&!closed);running=false}
    reloadRef.current=load;load();window.addEventListener('pos-data-refreshed',load);window.addEventListener('pos-restaurant-operation',load);const removeOrder=window.electronAPI?.onNewOrder?.(load)
    return()=>{closed=true;window.removeEventListener('pos-data-refreshed',load);window.removeEventListener('pos-restaurant-operation',load);removeOrder?.();reloadRef.current=null}
  },[])
  function editConfig(fn){dirty.current=true;setDraft(fn)}
  async function commit(input,identity=null){
    if(busy.current)return null;busy.current=true;setSaving(true);setError('');setMessage('')
    try{const result=await store.commitRestaurant(input,identity);await reloadRef.current?.();setMessage(input.customerOrderId?'已加入備餐工作單':input.action==='pay'?`已保存收款 ${result.order.id}，找零 NT$ ${result.order.change}`:input.action==='cancel'?`已保存取消 ${result.receipt.id}${result.refund?'，退款 NT$ '+Math.abs(result.refund.total):''}`:'已保存 '+result.receipt.id);return result}
    catch(e){setError(e.message);return null}finally{busy.current=false;setSaving(false)}
  }
  async function configure(){const r=await commit({action:'configure',config:draft,expectedConfig:baseline.current});if(r){dirty.current=false;setDraft(r.config);baseline.current=canonicalSignature(r.config)}}
  async function create(e){e.preventDefault();const r=await commit({action:'create',...form});if(r){setForm(initialForm());setShowCreate(false)}}
  const config=data?.config||defaultRestaurantConfig(),ingredients=new Set(Object.values(config.recipes).flat().map(r=>r.id)),menu=products.filter(p=>!ingredients.has(p.id))
  const list=data?.entries.filter(e=>filter==='all'||!['cancelled','completed'].includes(e.status)).sort((a,b)=>a.day.localeCompare(b.day)||a.slot.localeCompare(b.slot)||(a.pickupNumber||0)-(b.pickupNumber||0))||[]
  return <div className="restaurant-page" style={{padding:16,overflowY:'auto',height:'100%'}}>
    <h2 className="page-title">{tr("預訂出餐")}</h2><p>{tr('接單、備餐、收款，都在這裡。')}</p>
    {error&&<p role="alert" style={{color:'var(--red)',overflowWrap:'anywhere'}}>{trMessage(error)}</p>}
    {message&&<p role="status" style={{color:'var(--green)',overflowWrap:'anywhere'}}>{trMessage(message)}</p>}
    {!data&&<p>{tr("載入正式預訂紀錄中…")}</p>}
    {data&&<CustomerIntakePanel data={data} store={store} commit={commit} reload={()=>reloadRef.current?.()}/>}
    {data&&owner&&<TableOrderingPanel config={config} store={store} settingsDirty={dirty.current} reload={()=>reloadRef.current?.()}/>}
    {owner&&data&&<details className="card" style={{padding:14,marginBottom:16}} open={!config.enabled}>
      <summary>{tr("產能與原料配方設定")}{dirty.current?tr("（尚未儲存）"):''}</summary>
      <p>{tr("設定配方前，先在庫存管理建立原料／包材並填寫單位、成本與實際庫存。未設定配方的品項直接預留成品庫存；有配方的品項按原料可用量接單。")}</p>
      <div style={grid}>
        <Field label={tr("每日最多品項份數")}><input aria-label={tr("每日預訂產能")} className="field" type="number" min="1" value={draft.dailyCapacity} onChange={e=>editConfig(c=>({...c,dailyCapacity:Number(e.target.value)}))}/></Field>
        <Field label={tr("每 15 分鐘最多品項份數")}><input aria-label={tr("時段預訂產能")} className="field" type="number" min="1" value={draft.slotCapacity} onChange={e=>editConfig(c=>({...c,slotCapacity:Number(e.target.value)}))}/></Field>
        <label><input type="checkbox" aria-label={tr("啟用正式預訂")} checked={draft.enabled} onChange={e=>editConfig(c=>({...c,enabled:e.target.checked}))}/>{tr(" 啟用正式預訂出餐")}</label>
      </div>
      <div style={{...grid,marginTop:14}}>
        <Field label={tr("要設定配方的菜單品項")}><select aria-label={tr("配方菜單")} className="field" value={recipeTarget} onChange={e=>setRecipeTarget(e.target.value)}><option value="">{tr("選擇品項")}</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label={tr("使用的原料／包材")}><select aria-label={tr("配方原料")} className="field" value={ingredient} onChange={e=>setIngredient(e.target.value)}><option value="">{tr("選擇原料")}</option>{products.filter(p=>p.id!==recipeTarget).map(p=><option key={p.id} value={p.id}>{p.name}（{p.unit||tr("個")}）</option>)}</select></Field>
        <button className="btn btn-ghost" disabled={!recipeTarget||!ingredient||saving} onClick={()=>editConfig(c=>({...c,recipes:{...c.recipes,[recipeTarget]:[...(c.recipes[recipeTarget]||[]).filter(r=>r.id!==ingredient),{id:ingredient,qty:1}]}}))}>{tr("加入配方原料")}</button>
      </div>
      {Object.entries(draft.recipes).map(([target,rows])=><div key={target} style={{marginTop:12}}><strong>{products.find(p=>p.id===target)?.name||target}</strong>{rows.map(r=><div key={r.id} style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:6}}><span>{products.find(p=>p.id===r.id)?.name||r.id}</span><input className="field" aria-label={tr("每份用量 {0} {1}", {0: target, 1: r.id})} type="number" step="0.001" min="0.001" style={{width:120}} value={r.qty} onChange={e=>editConfig(c=>({...c,recipes:{...c.recipes,[target]:c.recipes[target].map(i=>i.id===r.id?{...i,qty:Number(e.target.value)}:i)}}))}/><span>{products.find(p=>p.id===r.id)?.unit||tr("個")}{tr("／份")}</span><button className="btn btn-ghost" onClick={()=>editConfig(c=>{const recipes={...c.recipes},remaining=recipes[target].filter(i=>i.id!==r.id);if(remaining.length)recipes[target]=remaining;else delete recipes[target];return {...c,recipes}})}>{tr("移除原料")}</button></div>)}</div>)}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:14}}><button className="btn btn-primary" disabled={saving} onClick={configure}>{tr("儲存預訂設定")}</button><button className="btn btn-ghost" disabled={saving} onClick={()=>{dirty.current=false;setDraft(data.config);baseline.current=canonicalSignature(data.config)}}>{tr("捨棄設定修改")}</button></div>
    </details>}
    {data&&!config.enabled&&<p>{tr("老闆確認設定後即可接單。既有預訂仍可出餐、收款與取消。")}</p>}
    {data&&config.enabled&&<button className="btn btn-primary" style={{marginBottom:14}} onClick={()=>setShowCreate(v=>!v)}>{showCreate?tr("收起接單表單"):tr("新增正式訂單")}</button>}
    {data&&config.enabled&&showCreate&&<form onSubmit={create} className="card" style={{padding:14,marginBottom:16}}>
      <h3>{tr("新增正式訂單")}</h3><div style={grid}>
        <Field label={tr("接單方式")}><select aria-label={tr("預訂接單方式")} className="field" value={form.channel} onChange={e=>setForm(f=>({...f,channel:e.target.value}))}>{Object.entries(channels).map(([key,label])=><option key={key} value={key}>{tr(label)}</option>)}</select></Field>
        <Field label={tr("取餐／出發日期")}><input aria-label={tr("預訂日期")} className="field" type="date" required value={form.day} onChange={e=>setForm(f=>({...f,day:e.target.value}))}/></Field>
        <Field label={tr("時段")}><select aria-label={tr("預訂時段")} className="field" value={form.slot} onChange={e=>setForm(f=>({...f,slot:e.target.value}))}>{Array.from({length:96},(_,n)=>`${String(Math.floor(n/4)).padStart(2,'0')}:${String(n%4*15).padStart(2,'0')}`).map(v=><option key={v}>{v}</option>)}</select></Field>
        <Field label={tr("顧客稱呼")}><input aria-label={tr("預訂顧客")} className="field" maxLength={100} value={form.customer} onChange={e=>setForm(f=>({...f,customer:e.target.value}))}/></Field>
        <Field label={tr("電話／聯絡方式（預訂與外送必填）")}><input aria-label={tr("預訂聯絡方式")} className="field" maxLength={100} required={form.channel!=='walkin'} value={form.contact} onChange={e=>setForm(f=>({...f,contact:e.target.value}))}/></Field>
        <Field label={tr("地址／備註（外送必填）")}><input aria-label={tr("預訂備註")} className="field" maxLength={1000} required={form.channel==='delivery'} value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/></Field>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}><select className="field" aria-label={tr("預訂菜單")} style={{flex:1,minWidth:160}} value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">{tr("選擇品項")}</option>{menu.map(p=><option key={p.id} value={p.id}>{p.name} · ${p.price}{tr(" · 可接 ")}{restaurantAvailability(p,config,products)}{tr(" 份")}</option>)}</select><button className="btn btn-ghost" type="button" disabled={!chosen||saving} onClick={()=>{const p=products.find(p=>p.id===chosen);setForm(f=>({...f,items:f.items.some(i=>i.id===p.id)?f.items.map(i=>i.id===p.id?{...i,qty:i.qty+1}:i):[...f.items,{id:p.id,qty:1,price:p.price}]}))}}>{tr("加入訂單")}</button></div>
      {form.items.map(i=><div key={i.id} style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:8}}><span>{products.find(p=>p.id===i.id)?.name||i.id} · ${i.price}</span><input aria-label={tr("預訂份數 {0}", {0: i.id})} className="field" type="number" min="1" step="1" style={{width:100}} value={i.qty} onChange={e=>setForm(f=>({...f,items:f.items.map(r=>r.id===i.id?{...r,qty:Number(e.target.value)}:r)}))}/><button className="btn btn-ghost" type="button" onClick={()=>setForm(f=>({...f,items:f.items.filter(r=>r.id!==i.id)}))}>{tr("移除品項")}</button></div>)}
      <p>{tr("應收 NT$ ")}{form.items.reduce((n,i)=>n+Math.round(i.price*100)*i.qty,0)/100}{tr("。接單先預留；收款另行確認。")}</p>
      <button className="btn btn-primary" type="submit" disabled={saving||!form.items.length}>{saving?tr("保存中…"):tr("保存預訂並預留庫存")}</button>
    </form>}
    <div style={{display:'flex',justifyContent:'space-between',gap:10}}><h3>{tr("出餐工作單（")}{list.length}）</h3><select aria-label={tr("出餐篩選")} className="field" style={{width:150}} value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">{tr("待處理")}</option><option value="all">{tr("全部歷史")}</option></select></div>
    {!list.length&&data&&<p>{tr("沒有符合條件的正式預訂。")}</p>}
    {list.map(e=>{
      const status={reserved:'cooking',cooking:'ready',ready:e.channel==='delivery'?'dispatched':'completed',dispatched:'completed'}[e.status]
      const nextAction={cooking:'開始製作',ready:'餐點好了',dispatched:'出發配送',completed:e.channel==='delivery'?'完成交付':'交給客人'}[status]
      return <article className="card" key={e.id} data-restaurant-id={e.id} style={{padding:14,marginBottom:12,overflowWrap:'anywhere'}}>
        <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:10}}><h3 style={{fontSize:22,marginBottom:4}}>{e.tableNum?tr('桌號 {0}',{0:e.tableNum}):e.customer||tr(channels[e.channel])}</h3><strong>NT$ {e.total}</strong></div>
        <strong>{!e.customerOrderId&&<>{e.day} {e.slot} · </>}{tr('取餐號 {0}',{0:e.pickupNumber?String(e.pickupNumber).padStart(3,'0'):e.id})}</strong><p>{e.items.map(i=>`${i.name} × ${i.qty}`).join('、')}</p><p data-kitchen-status={e.status}>{tr(labels[e.status])} · {e.saleId?tr("已收款"):tr("未收款")}{e.contact?' · '+e.contact:''}</p>{e.note&&<p>{e.note}</p>}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
          {status&&<button className="btn btn-primary" data-kitchen-action={status} aria-label={tr(labels[status])} style={{minHeight:48,flexBasis:'100%'}} disabled={saving||status==='completed'&&!e.saleId} onClick={()=>commit({action:'advance',entryId:e.id,expectedVersion:e.version,status})}>{tr(nextAction)}</button>}
          {!e.saleId&&e.status!=='cancelled'&&<button className="btn btn-ghost" data-kitchen-pay aria-label={tr("確認此單收款")} style={{minHeight:48,flex:1}} disabled={saving||!store.openShift} onClick={()=>setPay({entry:e,paid:String(e.total),method:'cash'})}>{tr('登記收款')}</button>}
          {e.status!=='cancelled'&&(!e.saleId||owner)&&<button className="btn btn-ghost" data-kitchen-cancel aria-label={e.saleId?tr("取消並全額退款"):tr("取消預訂")} style={{minHeight:48,flex:1}} disabled={saving} onClick={()=>setCancel({entry:e,reason:''})}>{e.saleId?tr('取消並退款'):tr('取消這單')}</button>}
        </div>
        {status==='completed'&&!e.saleId&&<p>{tr('先登記收款，再交給客人')}</p>}
        <details style={{marginTop:12}}><summary>{tr('原單資料')}</summary><p>{e.day} {e.slot} · {tr(channels[e.channel])}</p><small>{tr("單號 ")}{e.id}{tr(" · 版本 ")}{e.version}{e.saleId?tr(" · 收款 {0}", {0: e.saleId}):''}{e.refundId?tr(" · 退款 {0}", {0: e.refundId}):''}</small></details>
        {!e.saleId&&e.status!=='cancelled'&&!store.openShift&&<p>{tr("請先到班別交班開班，再登記收款。")}</p>}
      </article>
    })}
    {pay&&<form className="card" onSubmit={async e=>{e.preventDefault();const r=await commit({action:'pay',entryId:pay.entry.id,expectedVersion:pay.entry.version,shiftId:store.openShift?.id||'',payMethod:pay.method,paid:Number(pay.paid)});if(r)setPay(null)}} style={panel}>
      <h3>{tr("此單收款 NT$ ")}{pay.entry.total}</h3><p>{tr("請先核對款項；保存中與未確認時勿再次收款。")}</p><Field label={tr("付款方式")}><select aria-label={tr("預訂付款方式")} className="field" value={pay.method} onChange={e=>setPay(p=>({...p,method:e.target.value}))}><option value="cash">{tr("現金")}</option><option value="card">{tr("刷卡／轉帳（非現金）")}</option></select></Field><Field label={tr("實收金額")}><input aria-label={tr("預訂實收")} className="field" type="number" min="0" step="0.01" required value={pay.paid} onChange={e=>setPay(p=>({...p,paid:e.target.value}))}/></Field><p>{tr("找零 NT$ ")}{pay.method==='cash'?Math.max(0,Number(pay.paid)-pay.entry.total):0}</p><div style={{display:'flex',gap:10}}><button className="btn btn-primary" disabled={saving} type="submit">{tr("保存此單收款")}</button><button className="btn btn-ghost" type="button" disabled={saving} onClick={()=>setPay(null)}>{tr("返回工作單")}</button></div>
    </form>}
    {cancel&&<form className="card" onSubmit={async e=>{e.preventDefault();const r=await commit({action:'cancel',entryId:cancel.entry.id,expectedVersion:cancel.entry.version,shiftId:store.openShift?.id||'',reason:cancel.reason});if(r)setCancel(null)}} style={panel}><h3>{tr("取消")}{cancel.entry.saleId?tr("並全額退款 NT$ {0}", {0: cancel.entry.total}):tr("預訂")}</h3><p>{cancel.entry.startedAt?tr("已製作的原料不回補，記入損耗並保留產能占用。"):tr("未製作的庫存與產能會釋放。")}</p><Field label={tr("取消原因")}><input className="field" aria-label={tr("預訂取消原因")} required maxLength={1000} value={cancel.reason} onChange={e=>setCancel(c=>({...c,reason:e.target.value}))}/></Field><div style={{display:'flex',gap:10,marginTop:12}}><button className="btn btn-danger" disabled={saving||cancel.entry.saleId&&!store.openShift} type="submit">{tr("保存取消")}{cancel.entry.saleId?tr("與退款"):''}</button><button className="btn btn-ghost" type="button" disabled={saving} onClick={()=>setCancel(null)}>{tr("返回工作單")}</button></div></form>}
  </div>
}
const modal={position:'fixed',zIndex:220,inset:'auto 16px 16px',margin:'0 auto',maxWidth:500,maxHeight:'calc(100dvh - 32px)',overflowY:'auto',padding:20,boxShadow:'0 0 0 200vmax rgba(0,0,0,.45)'}
