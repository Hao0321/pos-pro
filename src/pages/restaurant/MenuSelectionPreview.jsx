import {useEffect,useState} from 'react'
import {tr} from '../../i18n'
import {canonicalSignature} from '../../../electron/operationRules.mjs'

export function menuSelectionDefaults(offer){return {offerId:offer.id,variantId:offer.defaultVariantId,qty:1,selections:offer.groups.map(group=>({groupId:group.id,choices:structuredClone(group.defaults)}))}}
export default function MenuSelectionPreview({menu,onTry,result,busy=false}){
 const [selection,setSelection]=useState(()=>menuSelectionDefaults(menu.offers[0])),signature=canonicalSignature(menu)
 useEffect(()=>setSelection(menuSelectionDefaults(menu.offers.find(row=>row.id===selection.offerId)||menu.offers[0])),[signature])
 const offer=menu.offers.find(row=>row.id===selection.offerId)||menu.offers[0]
 function update(next){setSelection(next);onTry(next)}
 function choice(group,choice,qty){const current=selection.selections.find(row=>row.groupId===group.id),rows=group.min===1&&group.max===1?[{id:choice.id,qty:1}]:[...current.choices.filter(row=>row.id!==choice.id),...(qty?[{id:choice.id,qty}]:[])];update({...selection,selections:selection.selections.map(row=>row.groupId===group.id?{...row,choices:rows}:row)})}
 return <details data-menu-try-panel><summary>{tr('試點看看')}</summary>
  <fieldset disabled={busy}>
   <label>{tr('餐點')}<select className="field" data-menu-try-offer value={offer.id} onChange={event=>update(menuSelectionDefaults(menu.offers.find(row=>row.id===event.target.value)))}>{menu.offers.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
   {offer.variants.length>1&&<label>{tr('份量')}<select className="field" data-menu-try-variant value={selection.variantId} onChange={event=>update({...selection,variantId:event.target.value})}>{offer.variants.map(row=><option key={row.id} value={row.id}>{row.name} · NT$ {row.price}</option>)}</select></label>}
   {offer.groups.map(group=><div key={group.id} data-menu-try-group={group.id}><strong>{group.name}</strong>{group.choices.map(option=>{const count=selection.selections.find(row=>row.groupId===group.id)?.choices.find(row=>row.id===option.id)?.qty||0,total=selection.selections.find(row=>row.groupId===group.id)?.choices.reduce((sum,row)=>sum+row.qty,0)||0;return <div key={option.id} className="menu-try-choice"><span>{option.name}{option.priceDelta?' · '+(option.priceDelta>0?'+':'')+'NT$ '+option.priceDelta:''}</span>{group.min===1&&group.max===1?<button type="button" className="btn btn-ghost" data-menu-try-choice={option.id} aria-pressed={count===1} onClick={()=>choice(group,option,1)}>{tr(count?'已選':'選擇')}</button>:<div className="menu-editor-actions"><button type="button" className="btn btn-ghost" data-menu-try-minus={option.id} disabled={!count} aria-label={tr('減少 {0}',{0:option.name})} onClick={()=>choice(group,option,count-1)}>−</button><span>{count}</span><button type="button" className="btn btn-ghost" data-menu-try-plus={option.id} disabled={count>=option.max||total>=group.max} aria-label={tr('增加 {0}',{0:option.name})} onClick={()=>choice(group,option,count+1)}>+</button></div>}</div>})}</div>)}
   <div className="menu-try-choice"><strong>{tr('份數')}</strong><div className="menu-editor-actions"><button type="button" className="btn btn-ghost" data-menu-try-qty-minus aria-label={tr('減少份數')} disabled={selection.qty<=1} onClick={()=>update({...selection,qty:selection.qty-1})}>−</button><span>{selection.qty}</span><button type="button" className="btn btn-ghost" data-menu-try-qty-plus aria-label={tr('增加份數')} disabled={selection.qty>=100000} onClick={()=>update({...selection,qty:selection.qty+1})}>+</button></div></div>
   <button type="button" className="btn btn-ghost" data-menu-try-recheck onClick={()=>onTry(selection)}>{busy?tr('核對中…'):tr('核對這份選擇')}</button>
  </fieldset>
  {result&&<div role="status" data-menu-try-result data-menu-try-total={result.totalCents}><strong>{tr('這份選擇合計 {0}',{0:'NT$ '+result.totalCents/100})}</strong><p>{tr('參考成本')}：NT$ {result.referenceCostCents/100}</p><ul>{result.resources.map(row=><li key={row.id} data-menu-try-resource={row.id}>{row.name} · {row.qty} {row.unit}</li>)}</ul></div>}
 </details>
}
