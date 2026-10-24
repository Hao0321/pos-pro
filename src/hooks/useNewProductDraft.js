import {useEffect,useMemo,useRef,useState} from 'react'
import useWorkspaceDraft from './useWorkspaceDraft'
import {loadPrivateDraftContext,loadProducts} from '../utils/dataAccess'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {emptyNewProduct,validNewProductDraft,savedNewProduct} from '../utils/newProductDraft.mjs'

export default function useNewProductDraft({session,editing,form,guided,pricing,onResume,onReset,onSaved}){
 const [cached,setCached]=useState(null),[message,setMessage]=useState(''),[pricingVersion,touchPricing]=useState(0),latest=useRef(null)
 const active=editing==='new',proof=pricing.current,inactiveCache=active?null:cached
 const state=useMemo(()=>active?{form,guided:!!guided,pricing:proof?{unit:proof.unit,signature:proof.signature,stale:!!proof.stale}:null}:inactiveCache,[active,form,guided,proof?.unit,proof?.signature,proof?.stale,inactiveCache,pricingVersion])
 latest.current={session,editing,form,onResume,onReset,onSaved,state}
 useEffect(()=>{if(active)setCached(state)},[active,state])
 // A draft contains raw inputs only. An existing exact ID is checked through
 // product reads; it is never replayed as a second create during restoration.
 const workspace=useWorkspaceDraft({kind:'product-new',session,state,hasContent:!!state,validate:validNewProductDraft,
  onRestore:(value,metadata)=>{setCached(value);if(metadata.changed&&latest.current.editing==='new')latest.current.onReset();if(value&&latest.current.editing==='new')latest.current.onResume(value,{restored:true})},
  findOriginal:async value=>{const product=savedNewProduct(await loadProducts(),value.form,latest.current.session.role);return product?{product}:null},
  onOriginal:(result,_source,metadata)=>{if(!metadata.isCurrent())return;setCached(null);setMessage('已找到先前保存的商品，沒有重複新增。');if(latest.current.editing==='new'&&latest.current.form._creationId===result.product.id)latest.current.onSaved()}
 })
 function start(seed={},forceGuided=false){
  if(workspace.blocked)return false
  workspace.begin();const value=cached||{form:emptyNewProduct(seed),guided:forceGuided,pricing:null};setMessage(cached?'已接回未完成的商品，原輸入會保留。':'');setCached(value);latest.current.onResume({...value,guided:value.guided||forceGuided},{restored:!!cached});return true
 }
 async function beforeSave(){
  if(workspace.blocked)throw Error('請先等草稿核對完成')
  const context=await loadPrivateDraftContext(latest.current.session)
  workspace.assertScope(context);if(privateDraftDigest(context)!==privateDraftDigest(workspace.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')
  workspace.persist();const product=savedNewProduct(await loadProducts(),latest.current.form,latest.current.session.role);workspace.assertScope(context);return {context,product}
 }
 function complete(){workspace.complete();setCached(null)}
 function discard(){if(workspace.blocked)return;complete();setMessage('已清除這次未完成輸入，正式商品不受影響。');latest.current.onReset()}
 return {workspace,ready:workspace.ready,blocked:workspace.blocked,resumable:!!cached,start,resume:()=>start(),discard,complete,beforeSave,message,pricingChanged:()=>touchPricing(n=>n+1)}
}
