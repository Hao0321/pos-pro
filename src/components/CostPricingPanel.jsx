import {useEffect,useMemo,useState} from 'react'
import {tr,trMessage,getLocale} from '../i18n'
import {tryCostPricing,previewPortionCost,validateCostStep,rationalDecimal} from '../../electron/costPricing.mjs'
import {centsDecimal,formatMoneyCents} from '../../electron/journalAmounts.mjs'
import {newCostLine,newCostDraft,readCostDraft,writeCostDraft} from '../utils/costPricingDraft'
import './CostPricingPanel.css'

const UNITS=[['g','g'],['kg','kg'],['mg','mg'],['mL','mL'],['L','L'],['piece','個'],['twJin','台斤（600g）'],['cnJin','市斤（500g）']]
const decimalMoney=value=>{const number=rationalDecimal({numerator:value.numerator,denominator:(BigInt(value.denominator)*100n).toString()},4);return (number.approximate?'≈ ':'')+number.text}
export default function CostPricingPanel({unit,cacheKey,onApply,currentInputRef,onDraftEdited}){
 const [draft,setDraft]=useState(()=>newCostDraft(unit)),[readKey,setReadKey]=useState(null),[step,setStep]=useState(0),[stepError,setStepError]=useState(''),[cacheError,setCacheError]=useState(''),[cacheBlocked,setCacheBlocked]=useState(false),[reviewedKey,setReviewedKey]=useState(null),[appliedKey,setAppliedKey]=useState(null)
 useEffect(()=>{
  try{const saved=readCostDraft(localStorage,cacheKey,unit);setDraft(saved);setStep(tryCostPricing({...saved,outputUnit:unit}).ok?2:0);setCacheError('');setCacheBlocked(false)}catch{setCacheError('試算草稿讀不到，請保留原檔並重新核對');setCacheBlocked(true)}
  setReadKey({key:cacheKey});setReviewedKey(null);setStepError('')
 },[cacheKey])
 const loaded=readKey!==null&&readKey.key===cacheKey,input=useMemo(()=>({...draft,outputUnit:unit}),[draft,unit]),calculation=useMemo(()=>tryCostPricing(input),[input]),preview=useMemo(()=>previewPortionCost(input),[input]),result=calculation.result,reviewKey=JSON.stringify(input),reviewed=reviewedKey===reviewKey,applied=appliedKey===reviewKey
 if(currentInputRef)currentInputRef.current=reviewKey
 useEffect(()=>setReviewedKey(null),[unit])
 useEffect(()=>{if(!loaded||cacheBlocked)return;try{writeCostDraft(localStorage,cacheKey,input);setCacheError('')}catch{setCacheError('試算草稿尚未保存，請先下載計算紀錄')}},[input,loaded,cacheKey,cacheBlocked])
 const edit=update=>{setReviewedKey(null);setAppliedKey(null);setStepError('');onDraftEdited?.();setDraft(update)},change=(key,value)=>edit(old=>({...old,[key]:value})),lineChange=(id,key,value)=>edit(old=>({...old,lines:old.lines.map(row=>row.id===id?{...row,[key]:value}:row)}))
 function go(next){for(let index=0;index<next;index++){const checked=validateCostStep(input,index);if(!checked.ok){setStep(index);setStepError(checked.error);return}}setStepError('');setStep(next)}
 function download(){const record={kind:'pos-cost-pricing-record/v1',createdAt:new Date().toISOString(),input,result:result||null,scope:'user-entered planning costs; not an inventory or financial transaction'},url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='cost-pricing.json';anchor.click();URL.revokeObjectURL(url)}
 return <section className="cost-pricing" aria-label={tr('自動算成本與售價')}>
  <p className="cost-pricing-unit">{tr('1 份＝1 {0}',{0:unit})}</p>
  <nav className="cost-pricing-steps" aria-label={tr('試算步驟')}>{['買多少','用多少','看結果'].map((label,index)=><button key={label} type="button" data-cost-step={index} aria-current={step===index?'step':undefined} onClick={()=>go(index)} disabled={!loaded}>{index+1}．{tr(label)}</button>)}</nav>
  {cacheError&&<div role="alert">{trMessage(cacheError)}{cacheBlocked&&<button type="button" className="btn btn-ghost" onClick={()=>{setCacheBlocked(false);edit(newCostDraft(unit));setCacheError('');setStep(0)}}>{tr('重新建立試算草稿')}</button>}</div>}
  <fieldset disabled={!loaded}>
   {step===0&&<>
    {draft.lines.map(row=><div className="cost-pricing-line" key={row.id}>
     <label className="cost-pricing-wide">{tr('食材或包材名稱')}<input className="field" maxLength={100} value={row.label} onChange={event=>lineChange(row.id,'label',event.target.value)}/></label>
     <NumberField label={tr('這批總價（NT$）')} value={row.packagePrice} onChange={value=>lineChange(row.id,'packagePrice',value)}/>
     <div className="cost-pricing-amount"><NumberField label={tr('每包內容量')} value={row.packageQuantity} onChange={value=>lineChange(row.id,'packageQuantity',value)}/><UnitSelect label={tr('購入單位')} value={row.packageUnit} onChange={value=>{lineChange(row.id,'packageUnit',value);if(!row.portionQuantity)lineChange(row.id,'portionUnit',value)}}/></div>
     <details className="cost-pricing-wide"><summary>{tr('共 {0} 包・可用 {1}%',{0:row.packCount,1:row.usablePercent})}</summary><div className="cost-pricing-grid"><NumberField label={tr('這批有幾包')} value={row.packCount} onChange={value=>lineChange(row.id,'packCount',value)}/><NumberField label={tr('可使用比例（%）')} value={row.usablePercent} onChange={value=>lineChange(row.id,'usablePercent',value)}/></div><p>{tr('預設 1 包、全部可用。去皮、烹煮損耗請依實測比例填寫。')}</p></details>
     {draft.lines.length>1&&<button type="button" className="btn btn-ghost cost-pricing-wide" onClick={()=>edit(old=>({...old,lines:old.lines.filter(line=>line.id!==row.id)}))}>{tr('移除這項成本')}</button>}
    </div>)}
    <button type="button" className="btn btn-ghost" disabled={draft.lines.length>=100} onClick={()=>edit(old=>({...old,lines:[...old.lines,newCostLine()]}))}>{tr('＋ 加食材或包材')}</button>
   </>}
   {step===1&&draft.lines.map(row=><div className="cost-pricing-line" key={row.id}><strong className="cost-pricing-wide">{row.label}</strong><div className="cost-pricing-amount cost-pricing-wide"><NumberField label={tr('每份用量')} value={row.portionQuantity} onChange={value=>lineChange(row.id,'portionQuantity',value)}/><UnitSelect label={tr('用量單位')} value={row.portionUnit} onChange={value=>lineChange(row.id,'portionUnit',value)}/></div></div>)}
   {step===2&&<>
    <NumberField label={tr('每賣 100 元，想留下幾元')} value={draft.targetMargin} onChange={value=>change('targetMargin',value)}/>
    <div className="cost-pricing-results" role="status"><div>{tr('每份成本')}<strong data-cost-total>{preview.ok?'NT$ '+formatMoneyCents(preview.result.referenceCostCents,getLocale()):'—'}</strong></div><div>{tr('建議售價')}<strong data-cost-price>{result?'NT$ '+formatMoneyCents(result.suggestedPriceCents,getLocale()):'—'}</strong></div></div>
    {!result&&<p role="status">{draft.targetMargin===''?tr('填想留下的金額，就會顯示建議售價。'):trMessage(calculation.error)}</p>}
    <details><summary>{tr('其他成本 {0} 元・抽成 {1}%・每單費 {2} 元',{0:draft.otherCost,1:draft.feePercent,2:draft.orderFee})}</summary><div className="cost-pricing-grid"><NumberField label={tr('每份其他成本（NT$）')} value={draft.otherCost} onChange={value=>change('otherCost',value)}/><NumberField label={tr('平台抽成（%）')} value={draft.feePercent} onChange={value=>change('feePercent',value)}/><NumberField label={tr('每單固定費用（NT$）')} value={draft.orderFee} onChange={value=>change('orderFee',value)}/><NumberField label={tr('每單預計幾份')} value={draft.portionsPerOrder} onChange={value=>change('portionsPerOrder',value)}/></div></details>
    <details><summary>{tr('湊整：每 {0} 元',{0:draft.roundTo})}</summary><label>{tr('售價向上湊整')}<select className="field" value={draft.roundTo} onChange={event=>change('roundTo',event.target.value)}>{['0.01','1','5','10'].map(value=><option key={value} value={value}>{tr('每 {0} 元',{0:value})}</option>)}</select></label></details>
    <p>{tr('只計已填成本；未填的租金、人工、稅與運費未計入。')}</p>
    {result&&<><label className="cost-pricing-review"><input type="checkbox" checked={reviewed} onChange={event=>setReviewedKey(event.target.checked?reviewKey:null)}/>{tr('我已核對數字')}</label><button type="button" className="btn btn-primary" disabled={!reviewed} onClick={()=>{onApply({cost:centsDecimal(result.referenceCostCents),price:centsDecimal(result.suggestedPriceCents)},reviewKey);setAppliedKey(reviewKey)}}>{tr('帶入商品')}</button>{applied&&<p role="status">{tr('已帶入，下方按「儲存」就好。')}</p>}</>}
   </>}
   {stepError&&<p role="alert">{trMessage(stepError)}</p>}
   {step<2&&<button type="button" className="btn btn-primary" data-cost-next onClick={()=>go(step+1)}>{tr('下一步')}</button>}
   {step>0&&<button type="button" className="btn btn-ghost" data-cost-back onClick={()=>go(step-1)}>{tr('上一步')}</button>}
  </fieldset>
  <details className="cost-pricing-details"><summary>{tr('看明細')}</summary>
   {preview.ok&&preview.result.lines.map(line=><p key={line.id}>{line.label}：NT$ {decimalMoney(line.costCents)}</p>)}
   <p>{tr('總價 × 每份用量 ÷ 可用總量')}</p>
   {result&&<p>{tr('每份固定費：NT$ {0}；抽成：NT$ {1}',{0:decimalMoney(result.fixedFeePerPortionCents),1:formatMoneyCents(result.variableFeeCents,getLocale())})}</p>}
   <p>{tr('食材、包材與其他成本加總後，成本向上取到分；售價依已列費用與毛利目標向上湊整，抽成保守向上取到分。')}</p>
   <p>{tr('這是依輸入資料做的售價試算，不是已發生的庫存成本。請以原單核對價格與用量。')}</p>
   <button type="button" className="btn btn-ghost" onClick={download}>{tr('下載計算紀錄')}</button>
   <p>{tr('試算草稿只留在這個裝置；帶入並儲存商品後，成本與售價才會同步到同店裝置。')}</p>
  </details>
 </section>
}
function NumberField({label,value,onChange}){return <label>{label}<input className="field" inputMode="decimal" maxLength={24} value={value} onChange={event=>onChange(event.target.value.trim())}/></label>}
function UnitSelect({label,value,onChange}){return <label>{label}<select className="field" value={value} onChange={event=>onChange(event.target.value)}>{UNITS.map(([code,name])=><option key={code} value={code}>{tr(name)}</option>)}</select></label>}
