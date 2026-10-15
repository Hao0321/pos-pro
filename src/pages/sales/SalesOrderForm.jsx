import {useState} from 'react'
import {tr,getLocale} from '../../i18n'
import {productReference,quoteTotal} from '../../../electron/businessExchange.mjs'
import {party} from '../../../electron/businessExchange.mjs'
import {quantityValue,moneyValue} from '../../../electron/operationRules.mjs'
import {validateSalesDay} from '../../../electron/salesRules.mjs'

export const salesMoney=value=>'NT$ '+Number(value).toLocaleString(getLocale(),{minimumFractionDigits:2,maximumFractionDigits:2})
export function salesDraftInput(form){
  const customer=party(form.customer);validateSalesDay(form.date)
  if(!form.items.length)throw Error('請先選擇銷售商品')
  const items=form.items.map(row=>{
    if(!row.qty.trim()||!row.unitPrice.trim())throw Error('請填寫數量與議定單價')
    const qty=quantityValue(Number(row.qty),'訂購數量',.001),unitPrice=moneyValue(Number(row.unitPrice),'議定單價')
    return {productId:row.productId,qty,unitPrice,expectedProduct:row.expectedProduct}
  })
  if(!form.confirmed)throw Error('請先確認客戶已同意商品、數量與價格')
  return {customer,date:form.date,items,note:form.note,...(form.quoteRef?{quoteRef:form.quoteRef}:{})}
}
export default function SalesOrderForm({form,setForm,products,documents,quotes,onQuote,onSave,onHide,onDiscard,busy,error}){
  const [query,setQuery]=useState('')
  const update=(key,value)=>setForm(previous=>({...previous,[key]:value,confirmed:false}))
  const changeRow=(index,key,value)=>update('items',form.items.map((row,i)=>i===index?{...row,[key]:value}:row))
  const known=[...new Map(documents.map(doc=>[doc.customer.id,doc.customer])).values()]
  const latest=[...new Map(quotes.map(quote=>[quote.id,quote])).values()].filter(quote=>!documents.some(doc=>doc.sourceQuote?.id===quote.id))
  function add(product){if(!form.items.some(row=>row.productId===product.id)&&form.items.length<100)update('items',[...form.items,{productId:product.id,qty:'1',unitPrice:String(product.price),expectedProduct:productReference(product)}])}
  function next(){
    if(form.step===1){party(form.customer);validateSalesDay(form.date)}
    if(form.step===2)salesDraftInput({...form,confirmed:true})
    setForm(previous=>({...previous,step:Math.min(3,previous.step+1)}))
  }
  let total=null;try{total=quoteTotal(form.items.map(row=>({qty:Number(row.qty),unitPrice:Number(row.unitPrice)})))}catch{}
  return <section className="card sales-create" aria-label={tr('新增銷售單')}>
    <div className="sales-heading"><h2>{tr('新增銷售單')}</h2><button className="btn btn-ghost" type="button" onClick={onHide} disabled={busy}>{tr('先收起草稿')}</button></div>
    <ol className="sales-steps">{['給誰','賣什麼','確認接單'].map((label,i)=><li key={label} aria-current={form.step===i+1?'step':undefined}><span>{i+1}</span>{tr(label)}</li>)}</ol>
    {form.quoteRef&&<p className="sales-note">{tr('已帶入本店報價第 {0} 版，商品與議定條件會沿用原報價。',{0:form.quoteRef.revision})} <span className="sales-id">{form.quoteRef.id}</span></p>}
    <form onSubmit={event=>{event.preventDefault();if(form.step<3){try{next()}catch(e){onSave(null,e)}}else onSave(form)}}>
      <fieldset disabled={busy}>
        {form.step===1&&<div className="sales-fields">
          {!form.quoteRef&&latest.length>0&&<label>{tr('已有報價？直接帶入')}<select className="field" value="" onChange={e=>onQuote(latest.find(q=>q.id===e.target.value))}><option value="">{tr('選擇客戶已同意的報價')}</option>{latest.map(q=><option key={q.id} value={q.id}>{q.recipient.name} · {salesMoney(q.total)}</option>)}</select></label>}
          {!form.quoteRef&&known.length>0&&<label>{tr('曾經往來的客戶')}<select className="field" value="" onChange={e=>{const customer=known.find(c=>c.id===e.target.value);if(customer)update('customer',customer)}}><option value="">{tr('選擇客戶，或在下方填新客戶')}</option>{known.map(c=><option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}</select></label>}
          <label>{tr('客戶名稱')}<input className="field" data-sales-customer value={form.customer.name} maxLength={100} readOnly={!!form.quoteRef} onChange={e=>update('customer',{...form.customer,name:e.target.value})} autoComplete="organization" required/></label>
          <label>{tr('訂單日期')}<input className="field" data-sales-date type="date" value={form.date} onChange={e=>update('date',e.target.value)} required/></label>
          <details><summary>{tr('客戶代碼（已自動產生，可自行修改）')}</summary><label>{tr('客戶代碼')}<input className="field" value={form.customer.id} maxLength={128} readOnly={!!form.quoteRef} onChange={e=>update('customer',{...form.customer,id:e.target.value})}/></label></details>
        </div>}
        {form.step===2&&<>
          {!form.quoteRef&&<><label className="sales-search">{tr('找商品')}<input className="field" value={query} onChange={e=>setQuery(e.target.value)} placeholder={tr('輸入商品名稱或代碼')}/></label><div className="sales-products">{products.filter(p=>(p.name+' '+p.id).toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,20).map(p=><button key={p.id} type="button" className="btn btn-ghost" disabled={form.items.some(row=>row.productId===p.id)} onClick={()=>add(p)}><strong>{p.name}</strong><span>{salesMoney(p.price)} / {p.unit||'個'}</span></button>)}</div></>}
          {!form.items.length&&<p>{tr('先點選要賣的商品，再填數量。')}</p>}
          <div className="sales-lines">{form.items.map((row,index)=><div key={row.productId} className="sales-line"><div><strong>{row.expectedProduct.name}</strong><p>{tr('單位：{0}',{0:row.expectedProduct.unit})}</p></div><label>{tr('訂購數量')}<input className="field" data-sales-qty type="number" inputMode="decimal" min="0.001" step="0.001" value={row.qty} readOnly={!!form.quoteRef} onChange={e=>changeRow(index,'qty',e.target.value)} required/></label><label>{tr('議定單價')}<input className="field" data-sales-price type="number" inputMode="decimal" min="0" step="0.01" value={row.unitPrice} readOnly={!!form.quoteRef} onChange={e=>changeRow(index,'unitPrice',e.target.value)} required/></label>{!form.quoteRef&&<button className="btn btn-ghost" type="button" onClick={()=>update('items',form.items.filter((_,i)=>i!==index))}>{tr('移除')}</button>}</div>)}</div>
        </>}
        {form.step===3&&<div className="sales-review">
          <h3>{form.customer.name}</h3><p>{form.date} · <span className="sales-id">{form.customer.id}</span></p>
          {form.items.map(row=><p key={row.productId}><strong>{row.expectedProduct.name}</strong> · {row.qty} {row.expectedProduct.unit} × {salesMoney(Number(row.unitPrice))}</p>)}
          <label>{tr('備註')}<textarea className="field" data-sales-note value={form.note} maxLength={1000} onChange={e=>update('note',e.target.value)} rows={3}/></label>
          <p className="sales-note">{tr('這一步只記接單，不扣庫存、不收款，也尚未保留庫存。')}</p>
          <label className="sales-check"><input type="checkbox" data-sales-agreed checked={form.confirmed} onChange={e=>setForm(previous=>({...previous,confirmed:e.target.checked}))} required/>{tr('客戶已同意商品、數量與價格')}</label>
        </div>}
        <strong className="sales-total">{tr('合計')} {total===null?'—':salesMoney(total)}</strong>
        {error&&<p role="alert">{error}</p>}
        <div className="sales-actions">{form.step>1&&<button className="btn btn-ghost" type="button" onClick={()=>setForm(previous=>({...previous,step:previous.step-1}))}>{tr('上一步')}</button>}<button className="btn btn-primary" data-sales-submit type="submit">{busy?tr('保存中…'):form.step===3?tr('確認接單'):tr('下一步')}</button></div>
      </fieldset>
    </form>
    <details className="sales-more"><summary>{tr('草稿選項')}</summary><button className="btn btn-ghost" disabled={busy} onClick={onDiscard}>{tr('放棄這張未保存草稿')}</button></details>
  </section>
}
