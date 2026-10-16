import {useEffect,useRef,useState} from 'react'
import {loadRestaurantState} from '../utils/dataAccess'
import {browserStorage} from '../utils/browserStorage'
import {readPendingFinancial} from '../utils/financialCommand'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {assertRestaurantFundsResult} from '../../electron/restaurantFundsResult.mjs'
import {restaurantFundsFormScope,restaurantFundsFormKey,createRestaurantFundsForm,readRestaurantFundsForm,saveRestaurantFundsForm,clearRestaurantFundsForm,withRestaurantFundsFormLock} from '../utils/restaurantFundsDraft'
import {restaurantFundsReview,previewRestaurantFundsForm} from '../utils/restaurantFundsView.mjs'

const pendingState=()=>{try{return {pending:readPendingFinancial(),pendingError:''}}catch(error){return {pending:null,pendingError:error.message}}}
export default function useRestaurantFundsForms({data,session,store,onState,onResult}){
 const [form,setForm]=useState(null),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[writing,setWriting]=useState(false),[error,setError]=useState(''),[errorDetail,setErrorDetail]=useState(''),[draftError,setDraftError]=useState('')
 const record=useRef({key:null,raw:null,value:null}),gate=useRef(false),latest=useRef(null),completed=useRef(null),queue=useRef(Promise.resolve()),writeCount=useRef(0),editSerial=useRef(0),draftIssue=useRef('')
 latest.current={data,session,store,onState,onResult}
 let key=null;try{if(data?.storeId&&data.epoch)key=restaurantFundsFormKey(restaurantFundsFormScope(data,session))}catch{}
 function markDraft(message){draftIssue.current=message;setDraftError(message)}
 function read(){
  if(!key)return
  try{const saved=readRestaurantFundsForm(key,restaurantFundsFormScope(latest.current.data,latest.current.session));record.current={key,...saved};setForm(saved.value);setVisible(!!saved.value);markDraft('');setError('');setErrorDetail('')}
  catch(error){record.current={key,raw:undefined,value:null};setForm(null);markDraft(error.message)}
 }
 useEffect(()=>{record.current={key,raw:null,value:null};setForm(null);setVisible(false);setError('');setErrorDetail('');markDraft('');if(key)read()},[key])
 function enqueue(work){
  const expectedKey=record.current.key;writeCount.current++;setWriting(true)
  const task=queue.current.catch(()=>{}).then(()=>withRestaurantFundsFormLock(expectedKey,()=>{if(record.current.key!==expectedKey)throw Error('店面或帳號已變更，請保留原輸入核對。');return work()}))
  queue.current=task.catch(()=>{});return task.finally(()=>{writeCount.current--;setWriting(writeCount.current>0)})
 }
 async function persist(value,preserveOnFailure=true){
  const serial=++editSerial.current
  if(preserveOnFailure){record.current={...record.current,value};setForm(value)}
  try{return await enqueue(()=>{
   const current=record.current;if(current.value&&current.value.formId!==value.formId)throw Error('另一個視窗已更新輸入，請重新核對。')
   const raw=saveRestaurantFundsForm(current.key,value,current.raw);record.current={...current,raw,value:serial===editSerial.current?value:current.value}
   if(serial===editSerial.current){setForm(value);markDraft('')}return true
  })}catch(error){markDraft(error.message||'輸入尚未保存，請保留畫面並重試。');return false}
 }
 async function acknowledge(result,operation){
  if(completed.current===operation.id)return
  const request={...operation.input,id:operation.id,time:operation.time}
  if(result?.success!==true||result.receipt?.id!==operation.id||result.receipt.signature!==canonicalSignature(request))throw Error('預訂款項回覆尚未確認，請保留原編號核對。')
  assertRestaurantFundsResult(request,result)
  return enqueue(()=>{
   if(completed.current===operation.id)return
   const current=record.current
   if(current.value?.operation?.id!==operation.id||canonicalSignature(current.value.operation)!==canonicalSignature(operation))return
   let retained={raw:null,value:null};const raw=browserStorage.getItem(current.key)
   if(raw!==null){
    if(raw===current.raw)clearRestaurantFundsForm(current.key,current.raw)
    else{
     const saved=readRestaurantFundsForm(current.key,current.value.scope)
     if(saved.value?.formId===current.value.formId&&canonicalSignature(saved.value.operation)===canonicalSignature(operation))clearRestaurantFundsForm(current.key,saved.raw)
     else retained=saved
    }
   }
   // A verified old result completes only its old form. Another window may
   // already be entering a different order; keep that newer record untouched.
   record.current={key:current.key,...retained};completed.current=operation.id;setForm(retained.value);setVisible(false);markDraft('');setError('');setErrorDetail('');latest.current.onResult?.(result)
  })
 }
 useEffect(()=>{
  const received=event=>{const operation=record.current.value?.operation;if(operation&&event.detail?.receipt?.id===operation.id)acknowledge(event.detail,operation).catch(error=>setError(error.message))}
  const storage=event=>{if(event.key===record.current.key&&event.newValue!==record.current.raw)markDraft('另一個視窗已更新輸入，請重新核對。')}
  window.addEventListener('pos-restaurant-operation',received);window.addEventListener('storage',storage)
  return()=>{window.removeEventListener('pos-restaurant-operation',received);window.removeEventListener('storage',storage)}
 },[key])
 function open(entry,mode){
  if(gate.current||!key)return
  setError('');setErrorDetail('')
  if(record.current.raw===undefined){markDraft('保留的收款輸入需要核對，請勿覆蓋。');return}
  if(record.current.value){setVisible(true);return}
  try{
   const saved=readRestaurantFundsForm(key,restaurantFundsFormScope(data,session))
   if(saved.value){record.current={key,...saved};setForm(saved.value);setVisible(true);return}
   record.current={key,...saved};const created=createRestaurantFundsForm(entry,mode,restaurantFundsFormScope(data,session));persist(created);setVisible(true)
  }catch(error){markDraft(error.message)}
 }
 function edit(fields){
  const value=record.current.value,journal=pendingState()
  if(gate.current||!value||value.operation||journal.pending||journal.pendingError)return
  persist({...value,fields:{...value.fields,...fields}});setError('');setErrorDetail('')
 }
 async function run(work){
  if(gate.current)return;gate.current=true;setBusy(true);setError('');setErrorDetail('')
  try{return await work()}catch(error){if(error.notCommitted===true){setError('這次未保存，輸入已保留。');setErrorDetail(String(error.message).slice(0,1000))}else setError(error.message);return null}finally{gate.current=false;setBusy(false)}
 }
 async function knownRejection(error,operation){
  if(error.notCommitted===true&&error.operationId===operation?.id&&record.current.value?.operation?.id===operation.id){
   await persist({...record.current.value,operation:null},false)
   try{const context=latest.current,fresh=await loadRestaurantState();if(restaurantFundsFormKey(restaurantFundsFormScope(fresh,context.session))===record.current.key)context.onState?.(fresh)}catch{}
  }
 }
 async function submit(reason){if(writeCount.current)return null;return run(async()=>{
  await queue.current;const original=record.current.value;if(!original||original.operation||draftIssue.current)throw Error('請先核對保留的輸入。')
  const journal=pendingState();if(journal.pendingError)throw Error(journal.pendingError);if(journal.pending)throw Error('上一筆異動結果尚未確認。請先核對原單。')
  const context=latest.current,fresh=await loadRestaurantState()
  if(record.current.value!==original||latest.current.session.userId!==context.session.userId||latest.current.session.role!==context.session.role||restaurantFundsFormKey(restaurantFundsFormScope(fresh,context.session))!==record.current.key)throw Error('店面或帳號已變更，請保留原輸入核對。')
  context.onState?.(fresh)
  const entry=fresh.entries.find(row=>row.id===original.review.entryId),preview=previewRestaurantFundsForm(entry,original,{state:fresh,actor:context.session,shiftId:context.store.openShift?.id||'',reason})
  if(preview.needsShift&&!context.store.openShift?.id)throw Error('請先到班別交班開班，再登記收款。')
  const operation={id:'restaurant-'+crypto.randomUUID(),time:fresh.now,input:preview.input},staged={...original,operation}
  if(!await persist(staged,false))throw Error('輸入尚未保存，請保留畫面並重試。')
  try{const result=await context.store.commitRestaurant(operation.input,{id:operation.id,time:operation.time});await acknowledge(result,operation);return result}
  catch(error){await knownRejection(error,operation);throw error}
 })}
 async function recover(){if(writeCount.current)return null;return run(async()=>{
  await queue.current;const original=record.current.value,operation=original?.operation;if(!operation)throw Error('請先核對保留的輸入。')
  const journal=pendingState();if(journal.pendingError)throw Error(journal.pendingError)
  if(journal.pending&&(journal.pending.kind!=='restaurant'||canonicalSignature(journal.pending.request)!==canonicalSignature({...operation.input,id:operation.id,time:operation.time})))throw Error('上一筆異動結果尚未確認。請先核對原單。')
  try{const result=await (journal.pending?latest.current.store.retryFinancial():latest.current.store.commitRestaurant(operation.input,{id:operation.id,time:operation.time}));await acknowledge(result,operation);return result}
  catch(error){await knownRejection(error,operation);throw error}
 })}
 async function refresh(){if(writeCount.current)return null;return run(async()=>{
  await queue.current;const original=record.current.value;if(!original||original.operation||pendingState().pending)throw Error('請先核對原紀錄。')
  const context=latest.current,fresh=await loadRestaurantState()
  if(record.current.value!==original||latest.current.session.userId!==context.session.userId||latest.current.session.role!==context.session.role||restaurantFundsFormKey(restaurantFundsFormScope(fresh,context.session))!==record.current.key)throw Error('店面或帳號已變更，請保留原輸入核對。')
  const entry=fresh.entries.find(row=>row.id===original.review.entryId);if(!entry?.funds||entry.status==='cancelled')throw Error('餐點已結束，請核對正式原單')
  const review=restaurantFundsReview(entry),fields=original.mode==='cancel'?{...original.fields,quantities:review.items.map(item=>({id:item.id,qty:original.fields.quantities.find(row=>row.id===item.id)?.qty||'0'}))}:original.fields
  context.onState?.(fresh);await persist({...original,review,fields})
 })}
 async function discard(){
  const current=record.current,journal=pendingState();if(gate.current||writeCount.current||!current.value||current.value.operation||journal.pending||journal.pendingError)return
  try{await enqueue(()=>{
   if(record.current.value!==current.value)throw Error('另一個視窗已更新輸入，請重新核對。')
   // Discarding this tab's unsaved conflict must preserve another tab's value.
   const raw=browserStorage.getItem(current.key)
   if(raw===current.raw)clearRestaurantFundsForm(current.key,current.raw)
   const saved=readRestaurantFundsForm(current.key,current.value.scope)
   record.current={key:current.key,...saved};setForm(saved.value);setVisible(false);setError('');setErrorDetail('');markDraft('')
  })}catch(error){markDraft(error.message)}
 }
 const journal=pendingState()
 return {form,visible,busy,writing,error,errorDetail,draftError,...journal,open,edit,submit,recover,refresh,discard,read:()=>{if(!gate.current&&!writeCount.current)read()},reportError:setError,exportText:()=>record.current.value?JSON.stringify(record.current.value,null,2):browserStorage.getItem(record.current.key)||'',close:()=>{if(!gate.current&&!writeCount.current&&!draftIssue.current)setVisible(false)},resume:()=>setVisible(true),retrySave:()=>record.current.value&&persist(record.current.value)}
}
