import {useEffect,useRef,useState} from 'react'
import {tr} from '../../i18n'
import {salesSummary,salesRemaining,salesQuantity,salesAmount,activeSalesRefunds} from '../../../electron/salesRules.mjs'
import {salesMoney} from './SalesOrderForm'

export const salesActionTitle=action=>tr({deliver:'這批貨已交給客戶',pay:'記錄客戶已付款',return:'記錄客戶退貨',allowance:'給客戶折讓',refund:'記錄已退回多收款','pay-reverse':'更正原收款','refund-reverse':'更正原退款',close:'結束剩餘訂購'}[action]||'銷售操作')
export default function SalesOperationForm({document:doc,target,store,busy,onSave,onCancel,error}){
  const summary=salesSummary(doc),delivery=doc.deliveries.find(row=>row.id===target.deliveryId)
  const payment=doc.payments.find(row=>row.id===target.paymentId),refund=doc.refunds.find(row=>row.id===target.refundId)
  const remaining=delivery?salesRemaining(doc,delivery):[],claim=target.deliveryId?summary.claims.find(row=>row.delivery.id===target.deliveryId):payment?summary.claims.find(row=>row.delivery.id===payment.deliveryId):null
  const refunded=payment?activeSalesRefunds(doc).filter(row=>row.paymentId===payment.id).reduce((n,row)=>n+row.amount,0):0
  const maxRefund=payment?Math.max(0,Math.round(Math.min(claim.credit,payment.amount-refunded)*100)/100):0
  const [quantities,setQuantities]=useState(()=>target.action==='deliver'?summary.pending.map(String):remaining.map(row=>String(salesQuantity(row.quantity))))
  const [amounts,setAmounts]=useState(()=>doc.items.map(()=>'')),[amount,setAmount]=useState(()=>String(target.action==='refund'?maxRefund:claim?.owed??''))
  const [date,setDate]=useState(store.sales.today),[dueDate,setDueDate]=useState(store.sales.today),[method,setMethod]=useState(store.openShift?'cash':'bank')
  const [reason,setReason]=useState(''),[reference,setReference]=useState(''),[restock,setRestock]=useState(''),[confirmed,setConfirmed]=useState(false)
  const heading=useRef(null),stale=doc.revision!==target.revision
  useEffect(()=>{heading.current?.focus();heading.current?.scrollIntoView({block:'start'})},[])
  function submit(event){
    event.preventDefault()
    const input={action:target.action,orderId:doc.id,expectedRevision:target.revision,date}
    if(target.action==='deliver')Object.assign(input,{quantities:quantities.map(Number),dueDate,handedOver:confirmed})
    if(target.action==='pay')Object.assign(input,{deliveryId:target.deliveryId,amount:Number(amount),method,shiftId:store.openShift?.id||'',reference})
    if(target.action==='return')Object.assign(input,{deliveryId:target.deliveryId,quantities:quantities.map(Number),restock:restock==='yes',reason})
    if(target.action==='allowance')Object.assign(input,{deliveryId:target.deliveryId,amounts:amounts.map(Number),reason})
    if(target.action==='refund')Object.assign(input,{paymentId:target.paymentId,amount:Number(amount),reason,shiftId:store.openShift?.id||''})
    if(target.action==='pay-reverse')Object.assign(input,{paymentId:target.paymentId,reason,shiftId:store.openShift?.id||''})
    if(target.action==='refund-reverse')Object.assign(input,{refundId:target.refundId,reason,shiftId:store.openShift?.id||''})
    if(target.action==='close')Object.assign(input,{reason})
    onSave(input)
  }
  return <section className="card sales-operation" data-sales-operation={target.action}>
    <h2 tabIndex={-1} ref={heading}>{salesActionTitle(target.action)}</h2><p>{doc.customer.name} · <span className="sales-id">{doc.id}</span></p>
    {stale&&<p role="alert">{tr('這張單已更新，請關閉後重新開啟操作，核對最新金額。')}</p>}
    <form onSubmit={submit}><fieldset disabled={busy||stale}>
      <label>{tr('操作日期')}<input className="field" data-sales-op-date type="date" value={date} onChange={e=>setDate(e.target.value)} max={store.sales.today} min={doc.date} required/></label>
      {['deliver','return'].includes(target.action)&&<div className="sales-lines">{doc.items.map((item,i)=><label key={item.productId} className="sales-quantity"><span><strong>{item.name}</strong><small>{tr('最多 {0} {1}',{0:target.action==='deliver'?summary.pending[i]:salesQuantity(remaining[i].quantity),1:item.unit})}{target.action==='deliver'&&<> · {tr('目前可用 {0}',{0:store.products.find(p=>p.id===item.productId)?.stock??'—'})}</>}</small></span><input className="field" data-sales-op-qty type="number" inputMode="decimal" step="0.001" min="0" max={target.action==='deliver'?summary.pending[i]:salesQuantity(remaining[i].quantity)} value={quantities[i]} onChange={e=>setQuantities(values=>values.map((v,index)=>i===index?e.target.value:v))} required/></label>)}</div>}
      {target.action==='deliver'&&<><label>{tr('約定收款到期日')}<input className="field" data-sales-due type="date" value={dueDate} min={date} onChange={e=>setDueDate(e.target.value)} required/></label><p className="sales-note">{tr('確認後會扣除本次庫存、記錄交付成本與客戶應收。')}</p><label className="sales-check"><input data-sales-handover type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/>{tr('這批貨已依約交給客戶，可以請款')}</label></>}
      {target.action==='return'&&<label>{tr('退回的商品還能賣嗎？')}<select className="field" data-sales-condition value={restock} onChange={e=>setRestock(e.target.value)} required><option value="">{tr('請選擇商品狀況')}</option><option value="yes">{tr('可以，再放回庫存')}</option><option value="no">{tr('不可以，不放回庫存')}</option></select></label>}
      {target.action==='allowance'&&<div className="sales-lines">{doc.items.map((item,i)=><label key={item.productId} className="sales-quantity"><span><strong>{item.name}</strong><small>{tr('尚可折讓 {0}',{0:salesMoney(salesAmount(remaining[i].gross))})}</small></span><input className="field" data-sales-allowance type="number" min="0" step="0.01" max={salesAmount(remaining[i].gross)} inputMode="decimal" value={amounts[i]} onChange={e=>setAmounts(values=>values.map((v,index)=>i===index?e.target.value:v))} placeholder="0"/></label>)}</div>}
      {['pay','refund'].includes(target.action)&&<label>{target.action==='pay'?tr('這次實際收到多少？'):tr('這次實際退回多少？')}<input className="field" data-sales-amount type="number" inputMode="decimal" min="0.01" step="0.01" max={target.action==='pay'?claim.owed:maxRefund} value={amount} onChange={e=>setAmount(e.target.value)} required/><small>{tr('最多 {0}',{0:salesMoney(target.action==='pay'?claim.owed:maxRefund)})}</small></label>}
      {target.action==='pay'&&<><label>{tr('客戶怎麼付款？')}<select className="field" data-sales-method value={method} onChange={e=>setMethod(e.target.value)}><option value="cash">{tr('現金')}</option><option value="bank">{tr('銀行收款')}</option></select></label><label>{tr('收款參考（選填）')}<input className="field" value={reference} onChange={e=>setReference(e.target.value)} maxLength={100}/></label><p className="sales-note">{tr('確認實際收到款項後再保存；這裡不會向客戶或銀行扣款。')}</p></>}
      {['refund','pay-reverse','refund-reverse'].includes(target.action)&&<p className="sales-note">{tr('沿用原款項方式：{0}',{0:(payment||refund).method==='cash'?tr('現金'):tr('銀行收款')})}{target.action!=='refund'&&<> · {salesMoney((payment||refund).amount)}</>}</p>}
      {['return','allowance','refund','pay-reverse','refund-reverse','close'].includes(target.action)&&<label>{tr('原因')}<textarea className="field" data-sales-reason value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} rows={3} required/></label>}
      {target.action==='close'&&<p className="sales-note">{tr('只結束尚未交付的部分；已交貨、應收與退款紀錄都會保留。')}</p>}
      {error&&<p role="alert">{error}</p>}
      <div className="sales-actions"><button type="submit" className="btn btn-primary" data-sales-op-save>{busy?tr('保存中…'):salesActionTitle(target.action)}</button></div>
    </fieldset></form><button className="btn btn-ghost" onClick={onCancel} disabled={busy}>{tr('取消')}</button>
  </section>
}
