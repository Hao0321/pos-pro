import {useEffect,useMemo,useRef,useState} from 'react'
import useWorkspaceDraft from './useWorkspaceDraft'
import {loadPrivateDraftContext,loadProducts,lookupPrivateDraftOriginal} from '../utils/dataAccess'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {productEditRequest,productEditValues} from '../../electron/productEditDraft.mjs'
import {newProductEditDraft,validProductEditDraft,hasProductEditInput,productEditInput,productEditReview,rebaseProductEdit} from '../utils/productEditDraft'
export default function useProductEditDraft({session,editing,form,guided,pricing,onResume,onReset,onSaved}){
 const [cached,setCached]=useState(null),[review,setReview]=useState(null),[retryAllowed,setRetryAllowed]=useState(false),[message,setMessage]=useState(''),[pricingVersion,touchPricing]=useState(0),latest=useRef(null),submitted=useRef(null),completed=useRef(null)
 const active=!!cached&&editing===cached.productId,proof=pricing.current,inactive=active?null:cached
 const state=useMemo(()=>active?{...cached,form,guided:!!guided,pricing:proof?{unit:proof.unit,signature:proof.signature,stale:!!proof.stale}:null}:inactive,[active,inactive,cached?.productId,cached?.base,cached?.submission,form,guided,proof?.unit,proof?.signature,proof?.stale,pricingVersion])
 latest.current={session,state,editing,onResume,onReset,onSaved}
 useEffect(()=>{if(active)setCached(state)},[active,state])
 async function inspect(){const[context,rows]=await Promise.all([loadPrivateDraftContext(latest.current.session),loadProducts()]);if(!Array.isArray(rows))throw Error('商品保存紀錄需要核對，請保留原輸入。');return {context,rows}}
 const workspace=useWorkspaceDraft({kind:'product-edit',session,state,hasContent:hasProductEditInput(state),validate:validProductEditDraft,
  onRestore:(value,metadata)=>{submitted.current=value?.submission?value:null;setCached(value);setReview(null);setRetryAllowed(false);if(metadata.changed){completed.current=null;latest.current.onReset()}else if(value&&latest.current.editing===value.productId)latest.current.onResume(value,{restored:true})},
  findOriginal:async(value,metadata)=>{if(!value.submission)return null;const facts=await inspect();if(privateDraftDigest(facts.context)!==privateDraftDigest(metadata.context))throw Error('店面或帳號已變更，請保留原輸入核對。');const result=await lookup(value,facts.context);return result.status==='matched'?{result}:null},
  onOriginal:async(result,source,metadata)=>{await latest.current.onSaved(result.result,metadata);if(!metadata.isCurrent())return;completed.current=source.submission.id;submitted.current=null;setCached(null);setReview(null);setRetryAllowed(false);setMessage('先前修改已保存，已讀取最新商品。')}
 })
 function scope(context){workspace.assertScope(context);if(privateDraftDigest(context)!==privateDraftDigest(workspace.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')}
 async function lookup(value,context){const request=productEditRequest(value.productId,productEditInput(value,context),context),input={context,family:'product-edit',id:request.id,digest:privateDraftDigest(request)},result=await lookupPrivateDraftOriginal(input,latest.current.session);if(result?.protocol!=='pos-private-draft-original/v1'||result.id!==input.id||!['missing','matched'].includes(result.status)||result.status==='matched'&&(result.action!=='update'||result.digest!==input.digest||result.entryId!==value.productId))throw Error('商品保存紀錄需要核對，請保留原輸入。');return result}
 function inspectReview(value,row){const found=productEditReview(value,row);if(found.conflicts.length)setMessage('');setReview(found);return found}
 async function finish(value,result){const context=workspace.scope.context,isCurrent=()=>{try{workspace.assertScope(context);return true}catch{return false}};if(!isCurrent())return false;await latest.current.onSaved(result,{isCurrent});if(!isCurrent())return false;completed.current=value.submission.id;submitted.current=null;workspace.complete();setCached(null);setReview(null);setRetryAllowed(false);setMessage('先前修改已保存，已讀取最新商品。');return true}
 async function resume(){
  if(workspace.blocked||!cached)return false;const value=submitted.current||latest.current.state||cached,facts=await inspect();scope(facts.context)
  if(value.submission){const result=await lookup(value,facts.context);scope(facts.context);if(result.status==='matched')return finish(value,result)}
  try{inspectReview(value,facts.rows.find(row=>row.id===value.productId))}catch{setReview(null)}setRetryAllowed(false);latest.current.onResume(value,{restored:true});return true
 }
 async function start(product,guided=false){
  if(workspace.blocked)return false;const old=submitted.current||latest.current.state||cached
  if(hasProductEditInput(old)){if(old.productId!==product.id){setMessage('還有上次未完成的商品修改，請先接回核對。');return false}return resume()}
  const facts=await inspect();scope(facts.context);const newer=submitted.current||latest.current.state;if(newer!==old&&hasProductEditInput(newer)){if(newer.productId!==product.id)setMessage('還有上次未完成的商品修改，請先接回核對。');return false}const row=facts.rows.find(value=>value.id===product.id);if(!row)throw Error('找不到原商品，原輸入仍保留。');const value=newProductEditDraft(row,guided);workspace.begin();setCached(value);setReview(null);setMessage('');latest.current.onResume(value,{restored:false});return true
 }
 async function prepare(){
  const value=submitted.current||latest.current.state;if(workspace.blocked||!value)throw Error('請先等草稿核對完成');if(value.submission&&!retryAllowed)throw Error('請先核對這次商品保存結果。')
  const facts=await inspect();scope(facts.context)
  if(value.submission){const result=await lookup(value,facts.context);scope(facts.context);if(result.status==='matched'){await finish(value,result);return {alreadySaved:true}}}
  if(inspectReview(value,facts.rows.find(row=>row.id===value.productId)).conflicts.length)throw Error('商品已更新，請先核對差異。')
  const candidate={...value,submission:value.submission||{id:'product-edit-'+crypto.randomUUID(),time:new Date().toISOString()}},data=productEditInput(candidate,facts.context)
  workspace.persist();completed.current=null;await workspace.adopt(candidate);if(completed.current===candidate.submission.id)return {alreadySaved:true};scope(facts.context);submitted.current=candidate;setRetryAllowed(false);return {productId:candidate.productId,data}
 }
 async function checkOriginal(){const value=submitted.current||latest.current.state;if(!value?.submission)throw Error('請先核對這次商品保存結果。');const facts=await inspect();scope(facts.context);const result=await lookup(value,facts.context);scope(facts.context);if(result.status==='matched')return finish(value,result);setRetryAllowed(true);setMessage('尚未找到這次修改，請再次確認原內容。');return false}
 async function confirm(){const value=submitted.current||latest.current.state;if(!value?.submission)throw Error('請先核對這次商品保存結果。');const facts=await inspect();scope(facts.context);const result=await lookup(value,facts.context);scope(facts.context);if(result.status!=='matched')throw Error('商品保存紀錄需要核對，請保留原輸入。');return finish(value,result)}
 async function rejected(){const value=submitted.current||latest.current.state;if(!value?.submission)return;const next={...value,submission:null};await workspace.adopt(next);setRetryAllowed(false);const facts=await inspect();scope(facts.context);inspectReview(next,facts.rows.find(row=>row.id===next.productId))}
 async function resolve(choice){
  const value=submitted.current||latest.current.state;if(workspace.blocked||!value||value.submission||!review?.conflicts.length)return
  const facts=await inspect();scope(facts.context);const row=facts.rows.find(row=>row.id===value.productId);if(!row)throw Error('找不到原商品，原輸入仍保留。');const current=productEditValues(row)
  if(review.conflicts.some(key=>current[key]!==review.current[key])){inspectReview(value,row);throw Error('資料又更新了，請再核對差異。')}
  const next=rebaseProductEdit(value,row,choice);await workspace.adopt(next);setReview(null);setMessage('已接回核對後的內容，按儲存才會更新。');latest.current.onResume(next,{restored:true})
 }
 function discard(){if(workspace.blocked||(submitted.current||latest.current.state)?.submission)return;workspace.complete();setCached(null);setReview(null);setMessage('');latest.current.onReset()}
 return {workspace:{...workspace,notice:'',canReset:false},ready:workspace.ready,blocked:workspace.blocked,resumable:hasProductEditInput(state),pending:!!state?.submission,locked:workspace.blocked||!!state?.submission||!!review?.conflicts.length,retryAllowed,review,form:state?.form,message,start,resume,prepare,lookup:checkOriginal,confirm,rejected,resolve,discard,canDiscard:hasProductEditInput(state)&&!state.submission,pricingChanged:()=>touchPricing(n=>n+1)}
}
