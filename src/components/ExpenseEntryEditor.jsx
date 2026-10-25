import {useRef,useState} from 'react'
import {tr,trMessage,getLocale} from '../i18n'
import {ACCOUNTS} from '../../electron/accountingCore.mjs'
import {expenseMoney,expenseDate} from '../../electron/expenseEntry.mjs'
import useExpenseEntryDraft from '../hooks/useExpenseEntryDraft'
import WorkspaceDraftNotice from './WorkspaceDraftNotice'
import '../styles/expense-entry.css'
const presets=[['5202','月租金'],['5203','水電費'],['5201','薪資'],['5205','廣告費'],['5206','雜費']]
const paymentNames={'1101':'現金','1103':'銀行存款','2101':'尚未付款'}
export default function ExpenseEntryEditor({store,session={userId:'',username:'',role:''},stockActive=false,onPurchase}){
 const draft=useExpenseEntryDraft({session,saveRequest:input=>store.saveExpenseEntry(input),onSaved:(input,proof,metadata)=>store.confirmExpenseEntry(input,proof,metadata),getVisibleShift:()=>store.openShift}),{form}=draft.value
 const [error,setError]=useState(''),running=useRef(false),off=draft.workspace.blocked||draft.busy||draft.pending
 let amount=null,valid=false;try{amount=expenseMoney(form.amount);expenseDate(form.date);valid=!!form.description.trim()&&!(stockActive&&form.expenseAccount==='1211')}catch{}
 async function perform(work){if(running.current)return;running.current=true;setError('');try{await work()}catch(e){setError(e.message)}finally{running.current=false}}
 const field=(key,event)=>{draft.field(key,event.target.value);setError('')}
 return <section className="expense-entry" data-expense-entry data-expense-ready={draft.workspace.ready}>
  <header><span className="expense-entry-eyebrow">{tr('日常支出')}</span><h2>{tr('花了多少？用在哪裡？')}</h2></header>
  <WorkspaceDraftNotice draft={{...draft.workspace,notice:draft.workspace.notice?'已接回上次輸入。':''}}/>
  {draft.message&&<p role="status" className="expense-entry-message" data-expense-message>{tr(draft.message)}</p>}
  {error&&<p role="alert" className="expense-entry-error" data-expense-error>{trMessage(error)}</p>}
  <form onSubmit={e=>{e.preventDefault();perform(()=>draft.save(store.openShift&&form.payAccount==='1101'?'drawer':'outside'))}}>
   <fieldset disabled={off}>
    <label htmlFor="expense-amount">{tr('支出金額')}</label><div className="expense-entry-amount"><span>NT$</span><input id="expense-amount" data-expense-amount inputMode="decimal" autoComplete="off" value={form.amount} maxLength={100} placeholder="0.00" onChange={e=>field('amount',e)}/></div>
    <label htmlFor="expense-purpose">{tr('這筆錢用在哪裡？')}</label><input id="expense-purpose" data-expense-description value={form.description} maxLength={500} placeholder={tr('例：清潔用品、水電費')} onChange={e=>field('description',e)}/>
    <details className="expense-entry-details" data-expense-options><summary>{tr('分類、日期與付款')}</summary>
     <div className="expense-entry-presets" aria-label={tr('常用支出')}>
      {presets.map(([account,label])=><button type="button" className={'btn '+(form.expenseAccount===account?'btn-primary':'btn-ghost')} key={account} aria-pressed={form.expenseAccount===account} data-expense-preset={account} onClick={()=>draft.preset(account,tr(label))}>{tr(label)}</button>)}
     </div>
     <div className="expense-entry-options">
      <label htmlFor="expense-date">{tr('日期')}</label><input id="expense-date" type="date" data-expense-date value={form.date} onChange={e=>field('date',e)}/>
      <label htmlFor="expense-payment">{tr('這筆錢怎麼付？')}</label><select id="expense-payment" data-expense-payment value={form.payAccount} onChange={e=>field('payAccount',e)}>{Object.entries(paymentNames).map(([code,name])=><option key={code} value={code}>{tr(name)}</option>)}</select>
      <label htmlFor="expense-category">{tr('支出分類')}</label><select id="expense-category" data-expense-category value={form.expenseAccount} onChange={e=>field('expenseAccount',e)}>{Object.entries(ACCOUNTS).filter(([,row])=>row.type==='expense').map(([code,row])=><option key={code} value={code}>{tr(row.name)}</option>)}{(!stockActive||form.expenseAccount==='1211')&&<option value="1211">{tr('存貨（進貨）')}</option>}</select>
      <label htmlFor="expense-note">{tr('備註（選填）')}</label><textarea id="expense-note" data-expense-note value={form.note} maxLength={1000} rows={2} onChange={e=>field('note',e)}/>
     </div>
    </details>
   </fieldset>
   <div className="expense-entry-preview" aria-live="polite"><strong>{amount===null?'NT$ —':new Intl.NumberFormat(getLocale(),{style:'currency',currency:'TWD',minimumFractionDigits:2}).format(amount)}</strong><span>{tr(paymentNames[form.payAccount])} · {tr(ACCOUNTS[form.expenseAccount]?.name||'存貨')}</span></div>
   {draft.pending?<div className="expense-entry-recovery"><p>{tr('先核對剛才那筆，請勿重新記帳。')}</p><button type="button" className="btn btn-primary" data-expense-check disabled={draft.busy||draft.workspace.blocked} onClick={()=>perform(draft.check)}>{tr(draft.busy?'正在核對…':'核對原支出')}</button>{draft.retryAllowed&&<button type="button" className="btn btn-ghost" data-expense-retry disabled={draft.busy||draft.workspace.blocked} onClick={()=>perform(draft.save)}>{tr('沿用原編號記帳')}</button>}<details><summary>{tr('查看原單資訊')}</summary><code>{draft.value.submission.id}</code></details></div>:store.openShift&&form.payAccount==='1101'?<div className="expense-entry-funding"><button className="btn btn-primary expense-entry-save" data-expense-drawer-save type="submit" disabled={off||!valid}>{tr(draft.busy?'正在記帳…':'從抽屜付出並記帳')}</button><button className="btn btn-ghost expense-entry-save" data-expense-save type="button" disabled={off||!valid} onClick={()=>perform(()=>draft.save('outside'))}>{tr('用抽屜以外的錢付，僅記費用')}</button></div>:<button className="btn btn-primary expense-entry-save" data-expense-save type="submit" disabled={off||!valid}>{tr(draft.busy?'正在記帳…':'記好這筆支出')}</button>}
  </form>
  <p className="expense-entry-footnote">{tr('只記錄已發生的支出，不會替你付款。')}</p>
  {stockActive&&form.expenseAccount==='1211'&&<p role="alert">{tr('進貨請到進貨管理，數量與成本會一起保存')}</p>}
  <details className="expense-entry-details"><summary>{tr('其他操作')}</summary><div className="expense-entry-secondary"><button className="btn btn-ghost" type="button" onClick={onPurchase}>{tr('進貨請到進貨管理，數量與成本會一起保存')}</button><button className="btn btn-ghost" data-expense-discard disabled={off} type="button" onClick={()=>{draft.discard();setError('')}}>{tr('放棄這份未保存輸入')}</button></div></details>
 </section>
}
