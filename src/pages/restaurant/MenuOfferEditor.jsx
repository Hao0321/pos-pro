import {tr} from '../../i18n'
import {menuEditorGroup,expandMenuEditorComponents} from '../../utils/restaurantMenuEditor.mjs'
import MenuComponentRows from './MenuComponentRows'
import MenuGroupEditor from './MenuGroupEditor'

export default function MenuOfferEditor({offer,products,recipes,onChange,onRemove,onCopy,onError}){
 const changeVariant=(id,fn)=>onChange({...offer,variants:offer.variants.map(row=>row.id===id?fn(row):row)})
 const ids=new Set(offer.variants.flatMap(variant=>variant.components.flatMap(row=>(recipes[row.id]||[{id:row.id}]).map(part=>part.id))))
 for(const group of offer.groups)for(const choice of group.choices)for(const id of choice.omit)ids.add(id)
 const resources=products.filter(product=>ids.has(product.id))
 function addVariant(){const id='size-'+crypto.randomUUID(),source=offer.variants.find(row=>row.id===offer.defaultVariantId)||offer.variants[0];onChange({...offer,variants:[...offer.variants,{...structuredClone(source),id,name:tr('新份量')}]})}
 return <details className="menu-editor-offer" data-menu-offer={offer.id} open>
  <summary>{offer.name}</summary>
  <label>{tr('餐點名稱')}<input className="field" data-menu-offer-name maxLength={120} value={offer.name} onChange={event=>onChange({...offer,name:event.target.value})}/></label>
  {offer.variants.map(variant=><details className="menu-editor-variant" data-menu-variant-editor={variant.id} key={variant.id} open>
   <summary>{variant.name}</summary>
   <div className="menu-editor-two"><label>{tr('份量名稱')}<input className="field" data-menu-variant-name maxLength={40} value={variant.name} onChange={event=>changeVariant(variant.id,row=>({...row,name:event.target.value}))}/></label><label>{tr('售價')}<input className="field" data-menu-variant-price inputMode="decimal" value={variant.price} onChange={event=>changeVariant(variant.id,row=>({...row,price:event.target.value}))}/></label></div>
   {offer.variants.length>1&&<label className="menu-editor-check"><input type="radio" data-menu-variant-default name={'default-'+offer.id} checked={offer.defaultVariantId===variant.id} onChange={()=>onChange({...offer,defaultVariantId:variant.id})}/>{tr('預設份量')}</label>}
   <details data-menu-variant-ingredients><summary>{tr('每份用哪些商品與原料')}</summary>
    <button type="button" className="btn btn-ghost" data-menu-expand-recipe onClick={()=>{try{changeVariant(variant.id,row=>({...row,components:expandMenuEditorComponents(row.components,products,recipes)}))}catch(error){onError(error.message)}}}>{tr('展開現有配方')}</button>
    <MenuComponentRows rows={variant.components} products={products} onError={onError} onChange={components=>changeVariant(variant.id,row=>({...row,components}))}/>
    <label>{tr('占用幾份產能')}<input className="field" data-menu-variant-capacity inputMode="numeric" value={variant.capacity} onChange={event=>changeVariant(variant.id,row=>({...row,capacity:event.target.value}))}/></label>
   </details>
   {offer.variants.length>1&&<button className="btn btn-ghost" type="button" data-menu-variant-remove onClick={()=>onChange({...offer,defaultVariantId:offer.defaultVariantId===variant.id?offer.variants.find(row=>row.id!==variant.id).id:offer.defaultVariantId,variants:offer.variants.filter(row=>row.id!==variant.id)})}>{tr('移除此份量')}</button>}
  </details>)}
  <div className="menu-editor-actions"><button type="button" className="btn btn-ghost" data-menu-add-variant disabled={offer.variants.length>=20} onClick={addVariant}>{tr('新增大小份')}</button><button type="button" className="btn btn-ghost" data-menu-add-group disabled={offer.groups.length>=8} onClick={()=>onChange({...offer,groups:[...offer.groups,menuEditorGroup(tr('加料'))]})}>{tr('新增加料或選擇')}</button></div>
  {offer.groups.map(group=><MenuGroupEditor key={group.id} group={group} products={products} resources={resources} onError={onError} onChange={next=>onChange({...offer,groups:offer.groups.map(row=>row.id===group.id?next:row)})} onRemove={()=>onChange({...offer,groups:offer.groups.filter(row=>row.id!==group.id)})}/>)}
  <details><summary>{tr('更多餐點設定')}</summary><div className="menu-editor-actions"><button className="btn btn-ghost" type="button" data-menu-copy-offer onClick={onCopy}>{tr('複製成套餐')}</button><button className="btn btn-ghost" type="button" data-menu-offer-remove onClick={onRemove}>{tr('移除此餐點')}</button></div></details>
 </details>
}
