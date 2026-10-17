import {tr} from '../../i18n'
import {menuEditorChoice} from '../../utils/restaurantMenuEditor.mjs'
import MenuComponentRows from './MenuComponentRows'

export default function MenuGroupEditor({group,products,resources,onChange,onRemove,onError}){
 const changeChoice=(id,fn)=>onChange({...group,choices:group.choices.map(row=>row.id===id?fn(row):row)})
 function blank(){onChange({...group,choices:[...group.choices,{id:'choice-'+crypto.randomUUID(),name:tr('新選項'),priceDelta:'0',max:'1',components:[],omit:[]}]})}
 return <details className="menu-editor-group" data-menu-group={group.id} open>
  <summary>{group.name||tr('加料與選擇')}</summary>
  <label>{tr('這一組叫什麼')}<input className="field" data-menu-group-name maxLength={60} value={group.name} onChange={event=>onChange({...group,name:event.target.value})}/></label>
  <div className="menu-editor-two"><label>{tr('至少選幾份')}<input className="field" data-menu-group-min inputMode="numeric" value={group.min} onChange={event=>onChange({...group,min:event.target.value})}/></label><label>{tr('最多選幾份')}<input className="field" data-menu-group-max inputMode="numeric" value={group.max} onChange={event=>onChange({...group,max:event.target.value})}/></label></div>
  {group.choices.map(choice=><details className="menu-editor-choice" data-menu-choice-editor={choice.id} key={choice.id} open>
   <summary>{choice.name||tr('新選項')}</summary>
   <label>{tr('選項名稱')}<input className="field" data-menu-choice-name maxLength={40} value={choice.name} onChange={event=>changeChoice(choice.id,row=>({...row,name:event.target.value}))}/></label>
   <div className="menu-editor-two"><label>{tr('加減價')}<input className="field" data-menu-choice-price inputMode="decimal" value={choice.priceDelta} onChange={event=>changeChoice(choice.id,row=>({...row,priceDelta:event.target.value}))}/></label><label>{tr('每個選項最多幾份')}<input className="field" data-menu-choice-max inputMode="numeric" value={choice.max} onChange={event=>changeChoice(choice.id,row=>({...row,max:event.target.value}))}/></label></div>
   <label className="menu-editor-check"><input type="checkbox" data-menu-choice-default checked={group.defaults.some(row=>row.id===choice.id)} onChange={event=>onChange({...group,defaults:event.target.checked?[...(group.max==='1'?[]:group.defaults),{id:choice.id,qty:'1'}]:group.defaults.filter(row=>row.id!==choice.id)})}/>{tr('預先選好')}</label>
   {group.defaults.some(row=>row.id===choice.id)&&<label>{tr('預先選幾份')}<input className="field" data-menu-choice-default-qty inputMode="numeric" value={group.defaults.find(row=>row.id===choice.id).qty} onChange={event=>onChange({...group,defaults:group.defaults.map(row=>row.id===choice.id?{...row,qty:event.target.value}:row)})}/></label>}
   <details><summary>{tr('原料增減')}</summary><MenuComponentRows rows={choice.components} products={products} signed onError={onError} onChange={components=>changeChoice(choice.id,row=>({...row,components}))}/></details>
   {!!resources.length&&<details><summary>{tr('不使用的原料')}</summary>{resources.map(product=><label key={product.id} className="menu-editor-check"><input type="checkbox" data-menu-choice-omit={product.id} checked={choice.omit.includes(product.id)} onChange={event=>changeChoice(choice.id,row=>({...row,omit:event.target.checked?[...row.omit,product.id]:row.omit.filter(id=>id!==product.id)}))}/>{product.name}</label>)}</details>}
   <button className="btn btn-ghost" type="button" data-menu-choice-remove onClick={()=>onChange({...group,choices:group.choices.filter(row=>row.id!==choice.id),defaults:group.defaults.filter(row=>row.id!==choice.id)})}>{tr('移除此選項')}</button>
  </details>)}
  <div className="menu-editor-actions"><button type="button" className="btn btn-ghost" data-menu-choice-blank onClick={blank}>{tr('新增選項')}</button><select className="field" data-menu-choice-from-product aria-label={tr('用商品建立選項')} value="" onChange={event=>{const product=products.find(row=>row.id===event.target.value);if(product)onChange({...group,choices:[...group.choices,menuEditorChoice(product)]})}}><option value="">{tr('用商品建立選項')}</option>{products.map(product=><option value={product.id} key={product.id}>{product.name}</option>)}</select></div>
  <button type="button" className="btn btn-ghost" data-menu-group-remove onClick={onRemove}>{tr('移除這一組')}</button>
 </details>
}
