import {useRef,useState} from 'react'
import useWorkspaceDraft from './useWorkspaceDraft'
import {loadPrivateDraftContext,loadProducts,lookupWasteEntry} from '../utils/dataAccess'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {wasteEntryBasis} from '../../electron/wasteEntryDraft.mjs'
import {newWasteEntryDraft,validWasteEntryDraft,wasteEntryRequest} from '../utils/wasteEntryDraft'
export default function useWasteEntryDraft({session,saveRequest,onSaved,onReset}){
 const [value,setValue]=useState(null),[current,setCurrent]=useState(null),[changed,setChanged]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[retryAllowed,setRetryAllowed]=useState(false),latest=useRef(null),gate=useRef(false),completed=useRef(null)
 latest.current={value,session,saveRequest,onSaved,onReset};function put(next){latest.current.value=next;setValue(next)}
 async function inspect(){const[context,products]=await Promise.all([loadPrivateDraftContext(latest.current.session),loadProducts([])]);if(!Array.isArray(products))throw Error('商品與單位需要核對。');return {context,products}}
 async function original(saved,context){return lookupWasteEntry(wasteEntryRequest(saved,context),latest.current.session)}
 const workspace=useWorkspaceDraft({kind:'waste-entry',session,state:value,hasContent:!!value,validate:validWasteEntryDraft,
  onRestore:(saved,metadata)=>{put(saved);setCurrent(null);setChanged(false);setRetryAllowed(false);if(metadata.changed)latest.current.onReset()},
  findOriginal:async(saved,metadata)=>{if(!saved.submission)return null;const facts=await inspect();if(privateDraftDigest(facts.context)!==privateDraftDigest(metadata.context))throw Error('店面或帳號已變更，請保留原輸入核對。');const proof=await original(saved,facts.context);return proof.status==='matched'?proof:null},
  onOriginal:(proof,saved,metadata)=>finish(saved,proof,metadata,false)
 })
 function scope(context){workspace.assertScope(context);if(privateDraftDigest(context)!==privateDraftDigest(workspace.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')}
 function review(saved,facts){const row=facts.products.find(row=>row.id===saved.product?.id)||null;setCurrent(row);const stale=!!saved.product&&(!row||privateDraftDigest(wasteEntryBasis(row))!==privateDraftDigest(saved.product));setChanged(stale);return stale}
 async function finish(saved,proof,metadata=null,clear=true){const context=metadata?.context||workspace.scope?.context,isCurrent=metadata?.isCurrent||(()=>{try{scope(context);return true}catch{return false}});if(!isCurrent())return false;await latest.current.onSaved(wasteEntryRequest(saved,context),proof.result,{isCurrent});if(!isCurrent())return false;completed.current=saved.submission.id;if(clear)workspace.complete();put(null);setCurrent(null);setChanged(false);setRetryAllowed(false);setMessage('原編號損耗已確認保存，請勿再次記錄。');return true}
 async function task(work){if(gate.current)return false;gate.current=true;setBusy(true);try{return await work()}finally{gate.current=false;setBusy(false)}}
 async function resumeInner(){if(workspace.blocked||!latest.current.value)return false;const saved=latest.current.value,facts=await inspect();scope(facts.context);if(saved.submission){const proof=await original(saved,facts.context);scope(facts.context);if(proof.status==='matched')return finish(saved,proof)}review(saved,facts);setMessage('');return true}
 const resume=()=>task(resumeInner)
 async function start(product=null){return task(async()=>{if(workspace.blocked)throw Error('請先等草稿核對完成');const old=latest.current.value;if(old){if(product&&old.product?.id!==product.id){setMessage('還有另一份未完成的損耗，請先接回核對。');return false}return resumeInner()}const facts=await inspect();scope(facts.context);const row=product?facts.products.find(row=>row.id===product.id):null;if(product&&!row)throw Error('找不到原商品，請保留這筆損耗核對。');workspace.begin();const next={...newWasteEntryDraft(row),quantity:row?'1':''};put(next);review(next,facts);setMessage('');return true})}
 async function selectProduct(id){return task(async()=>{const saved=latest.current.value;if(!saved||saved.submission||workspace.blocked)return;const facts=await inspect();scope(facts.context);const row=id?facts.products.find(row=>row.id===id):null;if(id&&!row)throw Error('找不到原商品，請保留這筆損耗核對。');put({...saved,product:row?wasteEntryBasis(row):null});setCurrent(row);setChanged(false);setMessage('')})}
 function field(key,text){if(gate.current||workspace.blocked||latest.current.value?.submission)return;put({...latest.current.value,[key]:text});setMessage('')}
 async function save(){return task(async()=>{
  if(workspace.blocked||!latest.current.value)throw Error('請先等草稿核對完成');const saved=latest.current.value,facts=await inspect();scope(facts.context)
  if(saved.submission){const proof=await original(saved,facts.context);scope(facts.context);if(proof.status==='matched')return finish(saved,proof);if(!retryAllowed)throw Error('請先核對原損耗。')}
  if(review(saved,facts)&&!saved.submission)return false
  const candidate={...saved,submission:saved.submission||{id:'waste-entry-'+crypto.randomUUID(),time:new Date().toISOString(),cashier:latest.current.session.username||''}},request=wasteEntryRequest(candidate,facts.context)
  if(!saved.submission){workspace.persist();completed.current=null;await workspace.adopt(candidate);if(completed.current===candidate.submission.id)return true;scope(facts.context);put(candidate)}setRetryAllowed(false)
  try{await latest.current.saveRequest(request);scope(facts.context);const proof=await original(candidate,facts.context);scope(facts.context);if(proof.status!=='matched')throw Error('損耗紀錄讀不到，請保留原編號。');return finish(candidate,proof)}catch(error){if(error.notCommitted){scope(facts.context);const next={...candidate,submission:null};await workspace.adopt(next);put(next);const after=await inspect();scope(after.context);review(next,after)}throw error}
 })}
 async function checkOriginal(){return task(async()=>{const saved=latest.current.value;if(!saved?.submission)throw Error('請先核對原損耗。');const facts=await inspect();scope(facts.context);const proof=await original(saved,facts.context);scope(facts.context);if(proof.status==='matched')return finish(saved,proof);setRetryAllowed(true);setMessage('尚未找到原損耗，請用原編號再核對，勿另記一筆。');return false})}
 async function rebind(){return task(async()=>{const saved=latest.current.value;if(!saved||saved.submission||workspace.blocked)return;const facts=await inspect();scope(facts.context);const row=facts.products.find(row=>row.id===saved.product?.id);if(!row)throw Error('找不到原商品，請保留這筆損耗核對。');const next={...saved,product:wasteEntryBasis(row)};await workspace.adopt(next);put(next);review(next,facts);setMessage('商品與單位已核對，請再確認數量。')})}
 function close(){workspace.persist()}
 function discard(){if(busy||workspace.blocked||latest.current.value?.submission)return false;workspace.complete();put(null);setCurrent(null);setChanged(false);setMessage('已放棄這份未保存輸入。');return true}
 return {value,current,changed,message,workspace,busy,retryAllowed,pending:!!value?.submission,ready:workspace.ready,blocked:workspace.blocked,start,resume,selectProduct,field,save,checkOriginal,rebind,close,discard}
}
