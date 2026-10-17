import {useRef,useState} from 'react'
import {tr,trMessage,getLocale} from '../../i18n'
import {updateOrderStatus,loadCustomerIntakeContext} from '../../utils/dataAccess'
import {makeCustomerIntake,customerOrderSnapshot} from '../../../electron/tableOrdering.mjs'

export default function CustomerIntakePanel({data,store,session,commit,reload}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(''),lock=useRef(false)
 const pending=(data.customerOrders||[]).filter(o=>o.status==='pending'&&!o.restaurantId&&!data.entries.some(e=>e.customerOrderId===o.id)).sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id))
 async function accept(order){if(lock.current)return;lock.current=true;setBusy(order.id);setError('');try{const context=await loadCustomerIntakeContext(order.id,session);if(context.protocol!=='pos-customer-intake-context/v1'||context.order?.id!==order.id||typeof context.now!=='string'||!Number.isFinite(Date.parse(context.now))||typeof context.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(context.day)||typeof context.slot!=='string'||!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(context.slot))throw Error('接單時間需要重新核對');if(context.entryId){await reload?.();return}if(customerOrderSnapshot(context.order)!==customerOrderSnapshot(order))throw Error('顧客原單內容已變更，請重新核對');const input={...makeCustomerIntake(order,new Date(context.now)),day:context.day,slot:context.slot,...(order.customerMenu?{menuReview:context.menuReview}:{})},identity={id:'restaurant-'+crypto.randomUUID(),time:context.now},result=await commit(input,identity);if(result){await reload?.();requestAnimationFrame(()=>document.querySelector('[data-restaurant-id="'+CSS.escape(result.entry.id)+'"]')?.scrollIntoView({block:'nearest'}))}}catch(e){setError(e.message)}finally{lock.current=false;setBusy('')}}
 async function reject(order){if(lock.current)return;lock.current=true;setBusy(order.id);setError('');try{const r=await updateOrderStatus(order.id,'rejected');if(r?.success!==true)throw Error('原訂單進度尚未確認');await reload?.()}catch(e){setError(e.message)}finally{lock.current=false;setBusy('')}}
 return <section data-customer-intake className="customer-intake">
  <h3>{tr('新點餐')}{pending.length>0?' · '+pending.length:''}</h3>
  {error&&<p role="alert">{trMessage(error)}</p>}
  {pending.length===0?<p className="text-dim">{tr('目前沒有待處理的訂單')}</p>:pending.map(order=><article key={order.id} data-customer-order={order.id} className="card" style={{padding:16,marginBottom:12}}>
   <div style={{display:'flex',gap:10,justifyContent:'space-between',alignItems:'center'}}><strong style={{fontSize:22}}>{order.tableNum?tr('桌號 {0}',{0:order.tableNum}):tr('現場點餐')}</strong><strong>{tr('應收 NT$ {0}',{0:order.total})}</strong></div>
   <p>{tr('未收款')} · {new Date(order.time).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'})}</p>
   <ul style={{paddingInlineStart:20}}>{order.items.map(i=><li key={i.id}>{i.name} × {i.qty}</li>)}</ul>
   {order.note&&<p style={{overflowWrap:'anywhere'}}>{order.note}</p>}
   {!data.config.enabled&&<p>{tr('請先由老闆啟用出餐，再接單備餐')}</p>}
   <div style={{display:'flex',gap:10}}><button className="btn btn-primary" data-intake-accept disabled={!!busy||!data.config.enabled||store.financialState?.phase&&store.financialState.phase!=='idle'} style={{minHeight:48,flex:1}} onClick={()=>accept(order)}>{busy===order.id?tr('核對中…'):tr('接單備餐')}</button><button className="btn btn-ghost" disabled={!!busy} style={{minHeight:48}} onClick={()=>reject(order)}>{tr('拒絕')}</button></div>
   <details style={{marginTop:10}}><summary>{tr('原訂單編號')}</summary><code style={{overflowWrap:'anywhere'}}>{order.id}</code></details>
  </article>)}
 </section>
}
