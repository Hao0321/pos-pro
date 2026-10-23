import {useEffect,useMemo,useRef,useState} from 'react'
import useWorkspaceDraft from './useWorkspaceDraft'
import {loadPrivateDraftContext,loadShifts,loadCashLog} from '../utils/dataAccess'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {cashMovementShift} from '../../electron/cashMovementDraft.mjs'
import {newCashMovementDraft,validCashMovementDraft,cashMovementRequest,savedCashMovement} from '../utils/cashMovementDraft'

export default function useCashMovementDraft({session,active,type,amount,reason,onResume,onReset,onSaved}){
 const [cached,setCached]=useState(null),[stale,setStale]=useState(false),[retryAllowed,setRetryAllowed]=useState(false),[message,setMessage]=useState(''),latest=useRef(null),submitted=useRef(null),completed=useRef(null)
 const editing=active&&!!cached,inactive=editing?null:cached
 const state=useMemo(()=>editing?{shiftId:cached.shiftId,type,amount,reason,submission:cached.submission}:inactive,[editing,inactive,cached?.shiftId,cached?.submission,type,amount,reason])
 latest.current={session,state,active,onResume,onReset,onSaved}
 useEffect(()=>{if(editing)setCached(state)},[editing,state])
 async function inspect(){const[context,shifts,rows]=await Promise.all([loadPrivateDraftContext(latest.current.session),loadShifts(),loadCashLog()]);if(!Array.isArray(shifts)||!Array.isArray(rows))throw Error('現金流水回覆不完整，請保留原輸入。');return {context,shifts,rows}}
 const workspace=useWorkspaceDraft({kind:'cash-movement',session,state,hasContent:!!state,validate:validCashMovementDraft,
  onRestore:(value,metadata)=>{submitted.current=value?.submission?value:null;setCached(value);setRetryAllowed(false);setStale(false);if(metadata.changed){completed.current=null;latest.current.onReset()}else if(value&&latest.current.active)latest.current.onResume(value)},
  findOriginal:async(value,metadata)=>{if(!value.submission)return null;const facts=await inspect();if(privateDraftDigest(facts.context)!==privateDraftDigest(metadata.context))throw Error('店面或帳號已變更，請保留原輸入核對。');const row=savedCashMovement(value,facts.rows);return row?{row}:null},
  onOriginal:async(result,source,metadata)=>{await latest.current.onSaved(result.row,metadata);if(!metadata.isCurrent())return;completed.current=source.submission.id;submitted.current=null;setCached(null);setRetryAllowed(false);setStale(false);setMessage('')}
 })
 function scope(context){workspace.assertScope(context);if(privateDraftDigest(context)!==privateDraftDigest(workspace.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')}
 async function finish(value,row){const context=workspace.scope.context,isCurrent=()=>{try{workspace.assertScope(context);return true}catch{return false}};if(!isCurrent())return false;await latest.current.onSaved(row,{isCurrent});if(!isCurrent())return false;completed.current=value.submission.id;submitted.current=null;workspace.complete();setCached(null);setRetryAllowed(false);setStale(false);setMessage('');return true}
 async function resume(){if(workspace.blocked||!cached)return false;const value=cached,facts=await inspect();scope(facts.context);const row=savedCashMovement(value,facts.rows);if(row)return finish(value,row);let changed=false;try{cashMovementShift(facts.shifts,value.shiftId)}catch{changed=true}setStale(changed);setRetryAllowed(false);setMessage(changed?'原班次已結束，請核對這筆現金要記在哪一班。':'');latest.current.onResume(value);return true}
 async function start(shiftId){if(workspace.blocked)return false;if(cached)return resume();const facts=await inspect();scope(facts.context);cashMovementShift(facts.shifts,shiftId);const value=newCashMovementDraft(shiftId);workspace.begin();setCached(value);setStale(false);setMessage('');latest.current.onResume(value);return true}
 async function prepare(){
  const value=submitted.current||latest.current.state;if(workspace.blocked||!value)throw Error('請先等草稿核對完成');if(value.submission&&!retryAllowed)throw Error('請先核對原現金紀錄。')
  const facts=await inspect();scope(facts.context);const row=savedCashMovement(value,facts.rows);if(row){await finish(value,row);return {alreadySaved:true}}
  try{cashMovementShift(facts.shifts,value.shiftId)}catch(error){setStale(true);throw error}
  const candidate={...value,submission:value.submission||{id:'cash-'+crypto.randomUUID(),time:new Date().toISOString(),cashier:latest.current.session.username||''}};const request=cashMovementRequest(candidate)
  workspace.persist();completed.current=null;await workspace.adopt(candidate);if(completed.current===candidate.submission.id)return {alreadySaved:true};scope(facts.context);submitted.current=candidate;setRetryAllowed(false);return {request,draftContext:facts.context}
 }
 async function lookup(){const value=submitted.current||latest.current.state;if(!value?.submission)throw Error('請先核對原現金紀錄。');const facts=await inspect();scope(facts.context);const row=savedCashMovement(value,facts.rows);if(row)return finish(value,row);try{cashMovementShift(facts.shifts,value.shiftId)}catch(error){setStale(true);throw error}setRetryAllowed(true);setMessage('尚未找到原紀錄，請再確認這一筆。');return false}
 async function confirm(){const value=submitted.current||latest.current.state;if(!value?.submission)throw Error('請先核對原現金紀錄。');const facts=await inspect();scope(facts.context);const row=savedCashMovement(value,facts.rows);if(!row)throw Error('現金流水回覆不完整，請保留原輸入。');return finish(value,row)}
 async function rejected(){const value=submitted.current||latest.current.state;if(!value?.submission)return;await workspace.adopt({...value,submission:null});setRetryAllowed(false);setStale(true);setMessage('原班次已結束，請核對這筆現金要記在哪一班。')}
 async function rebind(){const value=submitted.current||latest.current.state;if(workspace.blocked||!value||value.submission)return;const facts=await inspect();scope(facts.context);const shiftId=facts.shifts.find(row=>row.status==='open')?.id;cashMovementShift(facts.shifts,shiftId);const next={...value,shiftId};await workspace.adopt(next);setStale(false);setMessage('已改到目前班次，請確認金額與原因。');latest.current.onResume(next)}
 function discard(){if(workspace.blocked||(submitted.current||latest.current.state)?.submission)return;workspace.complete();setCached(null);setStale(false);setMessage('');latest.current.onReset()}
 return {workspace:{...workspace,notice:'',canReset:false},ready:workspace.ready,blocked:workspace.blocked,resumable:!!cached,pending:!!state?.submission,locked:workspace.blocked||stale||!!state?.submission,stale,retryAllowed,message,start,resume,prepare,lookup,confirm,rejected,rebind,discard,canDiscard:!!state&&!state.submission}
}
