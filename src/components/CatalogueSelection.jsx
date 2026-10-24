import {useState} from 'react'
import {tr,trMessage} from '../i18n'
import {catalogueSelectionPreview,catalogueQuantity} from '../utils/catalogueSelection.mjs'
import '../styles/catalogue-selection.css'
const money=value=>value.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
export default function CatalogueSelection({selection,disabled,onQuantity,onReview}){
 const [query,setQuery]=useState(''),[error,setError]=useState('');let preview=null,issue=''
 try{preview=catalogueSelectionPreview(selection)}catch(problem){issue=problem.message}
 const search=query.trim().normalize('NFKC').toLowerCase(),matches=selection.catalogue.items.filter(row=>[row.name,row.sku].some(text=>text.normalize('NFKC').toLowerCase().includes(search)))
 function change(sku,value){setError('');onQuantity(sku,value)}
 function step(sku,delta){const raw=catalogueQuantity(selection,sku).trim();if(raw&&!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(raw)){setError('請先核對這個數量，原輸入會保留。');return}const units=Math.round(Number(raw||0)*1000)+delta*1000;if(!Number.isSafeInteger(units)||units>1000000000000){setError('目錄數量或金額超過上限。');return}change(sku,String(Math.max(0,units)/1000))}
 return <section className="catalogue-selection card" data-catalogue-selection aria-label={tr('依目錄選品')}>
  <h3>{tr('選要買的品項')}</h3><p data-catalogue-sender>{selection.catalogue.sender.name}</p><p className="catalogue-reference">{tr('這是公開參考價，實際價格請與供應商核對。')}</p>
  <fieldset disabled={disabled}>
   {selection.catalogue.items.length>6&&<label>{tr('找目錄品項')}<input className="field" type="search" data-catalogue-search value={query} onChange={event=>setQuery(event.target.value)}/></label>}
   <div className="catalogue-items">{matches.slice(0,24).map(row=><div className="catalogue-item" key={row.sku} data-catalogue-item={row.sku}>
    <div><strong>{row.name}</strong><span>{tr('參考價 NT$ {0}／{1}',{0:money(row.unitPrice),1:row.unit})}</span></div>
    <div className="catalogue-quantity"><button type="button" className="btn btn-ghost" data-catalogue-minus={row.sku} aria-label={tr('減少 {0} 的數量',{0:row.name})} onClick={()=>step(row.sku,-1)}>−</button><label>{tr('數量（{0}）',{0:row.unit})}<input className="field" data-catalogue-qty={row.sku} aria-label={tr('目錄數量 {0}',{0:row.name})} inputMode="decimal" maxLength={2000} value={catalogueQuantity(selection,row.sku)} placeholder="0" onChange={event=>change(row.sku,event.target.value)}/></label><button type="button" className="btn btn-ghost" data-catalogue-plus={row.sku} aria-label={tr('增加 {0} 的數量',{0:row.name})} onClick={()=>step(row.sku,1)}>+</button></div>
   </div>)}</div>
   {!matches.length&&<p role="status">{tr('找不到品項，試試名稱或代碼。')}</p>}{matches.length>24&&<p>{tr('先顯示前 24 項；搜尋名稱或代碼可找到其他品項。')}</p>}
  </fieldset>
  {(error||issue)&&<p role="alert">{trMessage(error||issue)}</p>}
  {preview&&<p className="catalogue-total" data-catalogue-total>{tr('已選 {0} 項，參考合計 NT$ {1}',{0:preview.count,1:money(preview.total)})}</p>}
  <button type="button" className="btn btn-primary" data-catalogue-review disabled={disabled||!preview||!preview.count||preview.count>100} onClick={onReview}>{tr('下一步，核對採購')}</button>
  <p className="catalogue-reference">{tr('下一步只準備草稿；尚未送給供應商、收貨或付款。')}</p>
 </section>
}
