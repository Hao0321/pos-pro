import {useEffect,useState} from 'react'
import {tr} from '../../i18n'

export default function QuickPurchaseFacts({draft,context,question,onChange}){
 const missing=question?.field==='supplier'||question?.field==='date'
 const [editing,setEditing]=useState(missing)
 useEffect(()=>{if(missing)setEditing(true)},[missing])
 const supplier=context.suppliers.find(row=>row.id===draft.supplierId)
 return <div className="quick-purchase-facts">
  <p data-quick-purchase-summary><strong>{supplier?.name||tr('請選供應商')}</strong><span>{draft.date||tr('叫貨日期')}</span></p>
  <details data-quick-purchase-edit open={editing} onToggle={event=>setEditing(event.currentTarget.open)}>
   <summary>{tr('修改供應商與日期')}</summary>
   <label>{tr('向誰叫貨？')}<select data-quick-field="supplier" aria-label={tr('叫貨供應商')} className="field" value={draft.supplierId||''} onChange={event=>onChange('supplierId',event.target.value)}><option value="">{tr('請選供應商')}</option>{context.suppliers.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
   <label>{tr('叫貨日期')}<input data-quick-field="date" aria-label={tr('快速採購日期')} className="field" type="date" value={draft.date||''} onChange={event=>onChange('date',event.target.value)}/></label>
  </details>
 </div>
}
