import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../../i18n'
import {getReservationAvailability} from '../../utils/dataAccess'
import useReservationDraft,{reservationDraftFields} from '../../hooks/useReservationDraft'
import {readPendingFinancial} from '../../utils/financialCommand'

const empty=date=>({id:'reservation-'+crypto.randomUUID(),action:'book',date,slot:'',partySize:'2',name:'',contact:'',note:''})
export default function ReservationForm({state,session,store,onClose,onSaved}){
 const [form,setForm]=useState(()=>empty(state.today)),[availability,setAvailability]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),locked=useRef(false)
 const draft=useReservationDraft({kind:'reservation',session,value:form,hasContent:!!(form.name||form.contact||form.note||form.slot),onRestore:value=>setForm(value||empty(state.today)),onSaved:result=>{onSaved(result);setForm(empty(state.today))}})
 useEffect(()=>{let alive=true;setAvailability(null);setLoading(true);const timer=setTimeout(()=>{getReservationAvailability({date:form.date,partySize:Number(form.partySize),online:false},session).then(value=>{if(alive)setAvailability(value)}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)})},180);return()=>{alive=false;clearTimeout(timer)}},[form.date,form.partySize,state.revision,session.userId])
 const field=(key,value)=>{draft.begin();setError('');setForm(old=>({...old,[key]:value,...(['date','partySize'].includes(key)?{slot:''}:{})}))},pending=!!readPendingFinancial(),disabled=busy||draft.blocked||pending
 async function save(event){
  event.preventDefault();if(locked.current)return;locked.current=true;setBusy(true);setError('')
  try{
   draft.persist();const scope=draft.scope?.context;draft.assertScope(state)
   const fields=reservationDraftFields(form),input={protocol:'pos-reservation/v1',storeId:scope.storeId,epoch:scope.epoch,expectedRevision:state.revision,action:form.action,reviewed:true,...fields}
   const result=await store.commitReservation(input,{id:form.id,time:state.now});draft.complete();onSaved(result);onClose()
  }catch(e){setError(e.message)}finally{locked.current=false;setBusy(false)}
 }
 return <form className="reservation-form card" onSubmit={save} data-reservation-form>
  <div className="reservation-title"><h2>{tr('新增訂位')}</h2><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{tr('關閉')}</button></div>
  {(error||draft.error||draft.warning)&&<p role="alert">{trMessage(error||draft.error||draft.warning)}</p>}
  {draft.waiting&&<p role="status">{tr('另一個視窗正在編輯，請回到原視窗。')}</p>}
  <div className="reservation-fields"><label>{tr('訂位日期')}<input className="field" data-reservation-date type="date" min={state.today} value={form.date} disabled={disabled} onChange={e=>field('date',e.target.value)} required/></label><label>{tr('訂位人數')}<input className="field" data-reservation-party type="number" min="1" max="100" value={form.partySize} disabled={disabled} onChange={e=>field('partySize',e.target.value)} required/></label></div>
  <fieldset disabled={disabled} className="reservation-mode"><legend>{tr('這次要登記')}</legend>{['book','waitlist'].map(action=><label key={action}><input type="radio" name="reservation-mode" checked={form.action===action} onChange={()=>field('action',action)}/>{tr(action==='book'?'保留桌位':'加入候位')}</label>)}</fieldset>
  <p className="reservation-caption">{tr('選時間，系統自動找合適桌位。')}</p>
  {form.action==='book'?<div className="reservation-slots" aria-busy={loading}>{availability?.slots.map(row=><button type="button" data-reservation-slot={row.slot} className={'btn '+(form.slot===row.slot?'btn-primary':'btn-ghost')} disabled={disabled} aria-pressed={form.slot===row.slot} key={row.slot} onClick={()=>field('slot',row.slot)}>{row.slot}</button>)}{!loading&&availability&&!availability.slots.length&&<p>{tr('這天沒有可訂桌位，換一天或加入候位。')}</p>}{loading&&<p role="status">{tr('正在找空桌…')}</p>}</div>:<label>{tr('希望用餐時間')}<input className="field" type="time" step={state.config.slotMinutes*60} value={form.slot} disabled={disabled} onChange={e=>field('slot',e.target.value)} required/></label>}
  <div className="reservation-fields"><label>{tr('訂位姓名')}<input className="field" data-reservation-name value={form.name} maxLength={100} autoComplete="name" disabled={disabled} onChange={e=>field('name',e.target.value)} required/></label><label>{tr('聯絡電話或方式')}<input className="field" data-reservation-contact value={form.contact} maxLength={100} autoComplete="tel" disabled={disabled} onChange={e=>field('contact',e.target.value)}/></label></div>
  <details><summary>{tr('加個訂位備註')}</summary><textarea className="field" value={form.note} maxLength={1000} disabled={disabled} onChange={e=>field('note',e.target.value)}/></details>
  {form.slot&&<p className="reservation-review">{tr('{0}，{1}，{2} 位',{0:form.date,1:form.slot,2:form.partySize})}</p>}
  <button className="btn btn-primary" data-reservation-save disabled={disabled||!form.slot||!form.name.trim()}>{busy?tr('保存中…'):tr(form.action==='waitlist'?'確認加入候位':'確認訂位')}</button>
 </form>
}
