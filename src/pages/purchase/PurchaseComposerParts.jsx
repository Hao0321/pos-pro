import {useState} from 'react'
import {tr} from '../../i18n'
import {purchaseDraftPreview,previousPurchaseRow} from '../../utils/purchaseDraft.mjs'
export const purchaseMoney=value=>'NT$ '+value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})

export function PurchasePicker({choices,products,items,onAdd,onScan,onReorder,supplierId}){
 const [selected,setSelected]=useState(''),[category,setCategory]=useState('all'),categories=[...new Set(products.map(row=>row.category||'未分類'))]
 const available=choices.filter(row=>!items.some(item=>item.key===row.key)&&(category==='all'||(products.find(p=>p.id===row.productId)?.category||'未分類')===category))
 return <section className="purchase-picker">
  <label>{tr('加入商品')}<select className="field" aria-label={tr('採購商品')} value={selected} disabled={!supplierId} onChange={event=>setSelected(event.target.value)}><option value="">{tr(supplierId?'選擇商品':'請先選供應商')}</option>{available.map(row=><option key={row.key} value={row.key} data-product-id={row.productId} data-catalog-id={row.catalogId}>{row.catalogId?'📋 ':''}{row.name} · {row.unit}</option>)}</select></label>
  <div className="purchase-inline"><button className="btn btn-primary" disabled={!selected} onClick={()=>{onAdd(selected);setSelected('')}}>{tr('加入')}</button><button className="btn" disabled={!supplierId} onClick={onScan}>{tr('掃條碼')}</button></div>
  <details><summary>{tr('分類與補貨')}</summary><label>{tr('分類篩選')}<select className="field" value={category} onChange={event=>setCategory(event.target.value)}><option value="all">{tr('全部')}</option>{categories.map(value=><option key={value} value={value}>{value}</option>)}</select></label><button className="btn" disabled={!supplierId} onClick={onReorder}>{tr('一鍵帶入低庫存補貨清單')}</button></details>
 </section>
}
export function PurchaseItemCard({row,index,form,scope,data,choices,purchases,onUpdate,onRemove,onPrevious}){
 const choice=choices.find(item=>item.key===row.key);let result=null,previous=null
 try{result=purchaseDraftPreview({...form,command:null,attempted:false,items:[row]},scope,data).review[0]}catch{}
 try{if(choice)previous=previousPurchaseRow(choice,purchases,form.supplierId)}catch{}
 const unit=row.mode==='pack'?row.purchasedUnit:row.unit
 return <article className="purchase-item" data-purchase-item={index}>
  <header><h3>{row.name}</h3><button className="btn" aria-label={tr('移除 {0}',{0:row.name})} onClick={onRemove}>×</button></header>
  <label className="purchase-check"><input type="checkbox" data-purchase-packed={index} checked={row.mode==='pack'} onChange={event=>onUpdate('mode',event.target.checked?'pack':'base')}/>{tr('用箱／袋進貨')}</label>
  {row.mode==='pack'&&<div className="purchase-fields"><label>{tr('進貨單位')}<input className="field" data-purchase-unit={index} maxLength={32} value={row.purchasedUnit} onChange={event=>onUpdate('purchasedUnit',event.target.value)}/></label>{!row.productId&&<label>{tr('庫存單位')}<input className="field" data-purchase-base-unit={index} maxLength={32} value={row.unit} onChange={event=>onUpdate('unit',event.target.value)}/></label>}<label>{tr('每 {0} 含多少 {1}？',{0:unit||tr('箱／袋'),1:row.unit||tr('基本單位')})}<input className="field" data-purchase-factor={index} inputMode="decimal" maxLength={32} value={row.baseQuantityPerUnit} onChange={event=>onUpdate('baseQuantityPerUnit',event.target.value)}/></label></div>}
  <div className="purchase-fields"><label>{tr('數量')} · {unit||'—'}<input className="field" aria-label={tr('訂購數量 {0}',{0:row.name})} data-purchase-quantity={index} inputMode="decimal" maxLength={32} value={row.quantity} onChange={event=>onUpdate('quantity',event.target.value)}/></label><label>{tr('原單單價')} · {unit||'—'}<input className="field" aria-label={tr('採購單價 {0}',{0:row.name})} data-purchase-price={index} inputMode="decimal" maxLength={32} value={row.unitPrice} onChange={event=>onUpdate('unitPrice',event.target.value)}/></label></div>
  <small>{tr('請與供應商原單核對。')}</small>
  {result?<div className="purchase-result" data-purchase-result={index}><span>{tr('換成 {0} {1}',{0:result.quantity,1:result.unit})}</span><strong>{purchaseMoney(result.amount)}</strong></div>:<p className="purchase-hint">{tr('填完就自動換算')}</p>}
  {previous&&<button className="btn" data-purchase-previous={index} onClick={()=>onPrevious(previous)}>{tr('用上次的包裝與原價')}</button>}
 </article>
}
export function PurchaseReview({preview,supplier,onConfirm,onBack,busy,heading}){
 function keydown(event){if(event.key==='Escape'&&!busy){onBack();return}if(event.key!=='Tab')return;const buttons=[...event.currentTarget.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);if(!buttons.length){event.preventDefault();return}if(event.shiftKey&&(document.activeElement===first||!buttons.includes(document.activeElement))){event.preventDefault();last.focus()}else if(!event.shiftKey&&(document.activeElement===last||!buttons.includes(document.activeElement))){event.preventDefault();first.focus()}}
 return <div className="arrival-overlay"><section className="arrival-modal purchase-review" role="dialog" aria-modal="true" aria-labelledby="purchase-review-heading" onKeyDown={keydown}>
  <h2 id="purchase-review-heading" tabIndex={-1} ref={heading}>{tr('確認送出叫貨單')}</h2><p>{supplier?.name} · {preview.purchase.date}</p>
  {preview.review.map(row=><article key={row.key}><strong>{row.name}</strong><p>{row.costBasis.purchasedQuantity} {row.costBasis.purchasedUnit} · {tr('換成 {0} {1}',{0:row.quantity,1:row.unit})}</p><strong>{purchaseMoney(row.amount)}</strong></article>)}
  <p className="purchase-total">{tr('原單合計 {0}',{0:purchaseMoney(preview.total)})}</p><p>{tr('建立後不會先加庫存，貨到了再確認。')}</p>
  <button className="btn btn-primary" data-purchase-confirm disabled={busy} onClick={onConfirm}>{tr(busy?'保存中…':'確定送出')}</button><button className="btn" disabled={busy} onClick={onBack}>{tr('再檢查')}</button>
 </section></div>
}
