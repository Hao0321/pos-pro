import {tr} from '../../i18n'
import {menuEditorComponent,menuEditorUnits,changeMenuEditorUnit} from '../../utils/restaurantMenuEditor.mjs'

const unitName=(unit,product)=>unit==='stock'?product.unit||tr('原庫存單位'):unit==='twJin'?tr('台斤（600g）'):unit==='cnJin'?tr('市斤（500g）'):unit
export default function MenuComponentRows({rows,products,onChange,onError,signed=false}){
 function update(index,next){onChange(rows.map((row,i)=>i===index?next:row))}
 return <div className="menu-component-rows">
  {rows.map((row,index)=>{const product=products.find(p=>p.id===row.id);return <div className="menu-component-row" key={index} data-menu-component={row.id}>
   <label>{tr('商品或原料')}<select className="field" data-menu-component-product value={row.id} onChange={event=>update(index,menuEditorComponent(products.find(p=>p.id===event.target.value)))}>{!product&&<option value={row.id}>{tr('已不存在的商品')} · {row.id}</option>}{products.filter(p=>p.id===row.id||!rows.some(other=>other.id===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <div className="menu-component-quantity"><label>{tr('每份用量')}<input className="field" data-menu-component-quantity inputMode="decimal" value={row.quantity} onChange={event=>update(index,{...row,quantity:event.target.value})}/></label><label>{tr('單位')}<select className="field" data-menu-component-unit value={row.unit} onChange={event=>{try{update(index,changeMenuEditorUnit(row,event.target.value,product))}catch(error){onError(error.message)}}}>{menuEditorUnits(product||{}).map(unit=><option key={unit} value={unit}>{unitName(unit,product||{})}</option>)}</select></label><button type="button" className="btn btn-ghost" data-menu-component-remove aria-label={tr('移除 {0}',{0:product?.name||row.id})} onClick={()=>onChange(rows.filter((_,i)=>i!==index))}>×</button></div>
  </div>})}
  <select className="field" data-menu-component-add aria-label={tr('加入商品或原料')} value="" onChange={event=>{const product=products.find(row=>row.id===event.target.value);if(product)onChange([...rows,menuEditorComponent(product)])}}><option value="">{tr('加入商品或原料')}</option>{products.filter(p=>!rows.some(row=>row.id===p.id)).map(product=><option key={product.id} value={product.id}>{product.name}</option>)}</select>
  {signed&&<small>{tr('減少原料可填負數，例如 -50 g。')}</small>}
 </div>
}
