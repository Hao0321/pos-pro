import {useId} from 'react'
import {tr,getLocale} from '../i18n'
import {CASH_DENOMINATIONS,cashQuantity,countedCash} from '../utils/cashCount.mjs'
import '../styles/cash-count.css'

export const cashText=amount=>new Intl.NumberFormat(getLocale(),{maximumFractionDigits:2}).format(amount)
export function CashCountSummary({value}){
 const total=countedCash(value)
 return <div className="cash-count-total" data-cash-count-total aria-live="polite">{total.valid?<>{tr('現金合計')} <strong>NT$ {cashText(total.amount)}</strong></>:total.reason==='empty'?tr('請先填實際數好的現金。'):<span role="alert">{tr(total.reason==='quantity'?'數量請填 0 或正整數。':'請填有效金額，最多兩位小數。')}</span>}</div>
}
export default function CashCountInput({value,onChange,label,disabled=false}){
 const id=useId()
 function count(amount,raw){onChange({...value,counts:{...value.counts,[amount]:raw}})}
 function adjust(amount,delta){const quantity=cashQuantity(value.counts[amount]??'');if(quantity!==null&&quantity+delta>=0)count(amount,String(quantity+delta))}
 function row(item){const amount=String(item.amount),quantity=cashQuantity(value.counts[amount]??'');return <div className="cash-count-row" key={amount} data-cash-denomination={amount}>
  <label htmlFor={id+'-'+amount}>NT$ {cashText(item.amount)}</label>
  <button type="button" className="btn btn-ghost" data-cash-decrease={amount} aria-label={tr('減少 {0} 元的數量',{0:cashText(item.amount)})} disabled={disabled||quantity===null||quantity===0} onClick={()=>adjust(amount,-1)}>−</button>
  <input id={id+'-'+amount} className="field" data-cash-quantity={amount} aria-label={tr('{0} 元的數量',{0:cashText(item.amount)})} type="text" inputMode="numeric" maxLength={12} value={value.counts[amount]??''} placeholder="0" disabled={disabled} onChange={e=>count(amount,e.target.value)}/>
  <button type="button" className="btn btn-ghost" data-cash-increase={amount} aria-label={tr('增加 {0} 元的數量',{0:cashText(item.amount)})} disabled={disabled||quantity===null||quantity>=1e9} onClick={()=>adjust(amount,1)}>+</button>
 </div>}
 return <fieldset className="cash-count-input" disabled={disabled} data-cash-count-mode={value.mode}>
  <legend>{tr(label)}</legend>
  <div className="cash-count-modes">{[['manual','直接填總額'],['count','幫我數現金']].map(([mode,title])=><button className={'btn '+(value.mode===mode?'btn-primary':'btn-ghost')} type="button" key={mode} data-cash-mode={mode} aria-pressed={value.mode===mode} onClick={()=>onChange({...value,mode})}>{tr(title)}</button>)}</div>
  {value.mode==='manual'?<input className="field cash-count-manual" type="text" inputMode="decimal" maxLength={32} aria-label={tr(label)} data-cash-manual value={value.manual} placeholder={tr('填數好的總額')} onChange={e=>onChange({...value,manual:e.target.value})}/>:<>
   <p className="cash-count-hint">{tr('填有的面額，系統幫你加總。')}</p>
   {CASH_DENOMINATIONS.filter(item=>!item.extra).map(row)}
   <details className="cash-count-other"><summary>{tr('其他面額')}</summary>{CASH_DENOMINATIONS.filter(item=>item.extra).map(row)}</details>
  </>}
  <button className="btn btn-ghost cash-count-zero" type="button" data-cash-zero onClick={()=>onChange({...value,mode:'manual',manual:'0'})}>{tr('沒有現金（0 元）')}</button>
 </fieldset>
}
