import {useEffect,useMemo,useRef,useState} from 'react'
import useWorkspaceDraft from './useWorkspaceDraft'
import {loadPrivateDraftContext,loadShifts,loadOrders,loadCashLog,loadTopups} from '../utils/dataAccess'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {shiftCountBasis} from '../../electron/shiftCountDraft.mjs'
import {validShiftCountDraft,newShiftCountDraft,savedShiftCount} from '../utils/shiftCountDraft'
import {countedCash} from '../utils/cashCount.mjs'

export default function useShiftCountDraft({session,activeKind,openingCash,closingCash,closeNote,onResume,onReset,onSaved,onFacts}){
 const [cached,setCached]=useState(null),[stale,setStale]=useState(false),[retryAllowed,setRetryAllowed]=useState(false),[message,setMessage]=useState(''),latest=useRef(null),completed=useRef(null),submitted=useRef(null)
 const active=!!cached&&activeKind===cached.kind,cash=active?(activeKind==='open'?openingCash:closingCash):null,note=active&&activeKind==='close'?closeNote:cached?.note,inactive=active?null:cached
 const state=useMemo(()=>active?{kind:cached.kind,target:cached.target,basis:cached.basis,cash,note:note||'',submission:cached.submission}:inactive,[active,inactive,cached?.kind,cached?.target,cached?.basis,cached?.submission,cash,note])
 latest.current={session,state,activeKind,onResume,onReset,onSaved,onFacts}
 useEffect(()=>{if(active)setCached(state)},[active,state])
 async function inspect(value){const[context,shifts,orders,cashLog,topups]=await Promise.all([loadPrivateDraftContext(latest.current.session),loadShifts(),value.kind==='close'?loadOrders([]):[],value.kind==='close'?loadCashLog(value.target):[],value.kind==='close'?loadTopups():[]]);if(![shifts,orders,cashLog,topups].every(Array.isArray))throw Error('班別／現金流水回覆不完整');return {context,book:{shifts,orders,cashLog,topups}}}
 const workspace=useWorkspaceDraft({kind:'shift-count',session,state,hasContent:!!state,validate:validShiftCountDraft,
  onRestore:(value,metadata)=>{submitted.current=value?.submission?value:null;setCached(value);setRetryAllowed(false);setStale(false);if(metadata.changed){completed.current=null;latest.current.onReset()}else if(value&&latest.current.activeKind)latest.current.onResume(value)},
  findOriginal:async(value,metadata)=>{if(!value.submission)return null;const facts=await inspect(value);if(privateDraftDigest(facts.context)!==privateDraftDigest(metadata.context))throw Error('店面或帳號已變更，請保留原輸入核對。');const row=savedShiftCount(value,facts.book.shifts);return row?{kind:value.kind,row}:null},
  onOriginal:async(result,source,metadata)=>{await latest.current.onSaved(result.kind,result.row,metadata);if(!metadata.isCurrent())return;completed.current=source.submission.id;submitted.current=null;setCached(null);setRetryAllowed(false);setStale(false);setMessage('')}
 })
 function scope(context){workspace.assertScope(context);if(privateDraftDigest(context)!==privateDraftDigest(workspace.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')}
 function accept(facts){scope(facts.context);latest.current.onFacts?.(facts.book)}
 async function finish(value,row){const originalContext=workspace.scope.context,isCurrent=()=>{try{workspace.assertScope(originalContext);return true}catch{return false}};if(!isCurrent())return false;await latest.current.onSaved(value.kind,row,{isCurrent});if(!isCurrent())return false;completed.current=value.submission.id;submitted.current=null;workspace.complete();setCached(null);setRetryAllowed(false);setStale(false);setMessage('');return true}
 async function resume(){
  if(workspace.blocked||!cached)return false
  const value=cached,facts=await inspect(value);accept(facts);const row=savedShiftCount(value,facts.book.shifts)
  if(row)return finish(value,row)
  let changed=false;try{changed=shiftCountBasis(value.kind,facts.book,value.target)!==value.basis}catch{changed=true}
  setStale(changed);setRetryAllowed(false);setMessage(changed?'班別或現金已變動，請重新點算。':'已接回上次點算，請核對抽屜現金。');latest.current.onResume(value);return true
 }
 async function start(kind,target=''){
  if(workspace.blocked)return false
  if(cached){if(cached.kind!==kind||kind==='close'&&cached.target!==target){setMessage('還有上次未完成的點算，請先接回核對。');return false}return resume()}
  const facts=await inspect({kind,target});accept(facts);const value=newShiftCountDraft(kind,target,shiftCountBasis(kind,facts.book,target));workspace.begin();setCached(value);setStale(false);setRetryAllowed(false);setMessage('');latest.current.onResume(value);return true
 }
 async function prepare(kind){
  const value=submitted.current||latest.current.state;if(workspace.blocked||!value||value.kind!==kind)throw Error('請先等草稿核對完成')
  if(value.submission&&!retryAllowed)throw Error('上次點算的保存結果還沒確認，請先核對原班別。')
  const total=countedCash(value.cash);if(!total.valid)throw Error('請先數好現金，再確認開班。')
  const facts=await inspect(value);accept(facts);const saved=savedShiftCount(value,facts.book.shifts);if(saved){await finish(value,saved);return {alreadySaved:true}}
  if(shiftCountBasis(kind,facts.book,value.target)!==value.basis){setStale(true);throw Error('班別或現金已變動，請重新點算。')}
  workspace.persist();const candidate={...value,submission:value.submission||{id:kind==='open'?'S'+crypto.randomUUID():value.target,time:new Date().toISOString(),amount:total.amount,note:value.note,cashier:latest.current.session.username||'',cashierId:latest.current.session.userId}};completed.current=null
  await workspace.adopt(candidate)
  if(completed.current===candidate.submission.id)return {alreadySaved:true}
  accept(facts);submitted.current=candidate;setRetryAllowed(false);return {id:candidate.submission.id,time:candidate.submission.time,cashier:candidate.submission.cashier,amount:candidate.submission.amount,note:candidate.submission.note,draftContext:facts.context,draftBasis:candidate.basis}
 }
 async function lookup(){const value=submitted.current||latest.current.state;if(!value?.submission)throw Error('上次點算的保存結果還沒確認，請先核對原班別。');const facts=await inspect(value);accept(facts);const row=savedShiftCount(value,facts.book.shifts);if(row)return finish(value,row);if(shiftCountBasis(value.kind,facts.book,value.target)!==value.basis){setStale(true);throw Error('班別或現金已變動，請重新點算。')}setRetryAllowed(true);setMessage('尚未找到保存結果，請再確認原點算。');return false}
 async function confirm(){const value=submitted.current||latest.current.state;if(!value?.submission)throw Error('保存尚未確認，請核對原紀錄。');const facts=await inspect(value);accept(facts);const row=savedShiftCount(value,facts.book.shifts);if(!row)throw Error('保存尚未確認，請核對原紀錄。');return finish(value,row)}
 async function recount(){const value=submitted.current||latest.current.state;if(workspace.blocked||!value||value.submission)return;const facts=await inspect(value);accept(facts);const target=value.kind==='close'?facts.book.shifts.find(row=>row.status==='open')?.id||'':'';const next=newShiftCountDraft(value.kind,target,shiftCountBasis(value.kind,facts.book,target));await workspace.adopt(next);setStale(false);setRetryAllowed(false);setMessage('');latest.current.onResume(next)}
 async function rejected(){const value=submitted.current||latest.current.state;if(!value?.submission)return;await workspace.adopt({...value,submission:null});setRetryAllowed(false);setStale(true);setMessage('班別或現金已變動，請重新點算。')}
 function discard(){if(workspace.blocked||(submitted.current||latest.current.state)?.submission)return;workspace.complete();setCached(null);setStale(false);setMessage('');latest.current.onReset()}
 return {workspace:{...workspace,notice:'',canReset:false},ready:workspace.ready,blocked:workspace.blocked,resumable:!!cached,pending:!!state?.submission,retryAllowed,stale,message,start,resume,prepare,lookup,confirm,recount,rejected,discard,canDiscard:!!state&&!state.submission,locked:workspace.blocked||stale||!!state?.submission}
}
