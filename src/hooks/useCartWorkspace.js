import {useEffect,useRef,useState} from 'react'
import {loadPrivateDraftContext,lookupPrivateDraftOriginal,addHeldOrder} from '../utils/dataAccess'
import {workspaceScope,readWorkspaceDraft,writeWorkspaceDraft} from '../utils/workspaceDraft'
import {privateDraftDigest,draftObject} from '../../electron/privateDrafts.mjs'
import {HELD_CART_PROTOCOL,cartSnapshot,snapshotCart,heldCommand,heldDigest,verifyHeldResult,assertCartContext,assertCartProducts} from '../../electron/heldCart.mjs'
import {validatePending} from '../utils/checkoutCoordinator.mjs'

const clone=value=>structuredClone(value)
const empty=(lastCompleted='')=>({cartId:'cart-'+crypto.randomUUID(),cart:[],memberId:'',manualDiscount:0,holdLabel:'',pending:null,checkout:null,lastCompleted})
export function validateCartWorkspace(value){
 draftObject(value,['cartId','cart','memberId','manualDiscount','holdLabel','pending','checkout','lastCompleted'])
 if(!/^cart-[-a-f0-9]{36}$/.test(value.cartId)||typeof value.holdLabel!=='string'||value.holdLabel.length>200||typeof value.lastCompleted!=='string'||value.lastCompleted.length>128)return false
 const snapshot=cartSnapshot({cart:value.cart,memberId:value.memberId,manualDiscount:value.manualDiscount})
 if(value.pending){const command=heldCommand(value.pending);if(command.cartId!==value.cartId||privateDraftDigest(command.current)!==privateDraftDigest(snapshot)||value.checkout)return false}
 if(value.checkout){validatePending(value.checkout);const binding=value.checkout.cartWorkspace;if(!binding||binding.cartId!==value.cartId||privateDraftDigest(binding.snapshot)!==privateDraftDigest(snapshot)||value.pending)return false}
 return true
}

// One durable working cart per device, store generation and signed-in actor.
// Every edit is saved synchronously before React adopts it. Empty carts are
// tombstones so an older page cannot bring a completed cart back on pageshow.
export default function useCartWorkspace({session,enabled,members,onHeldOrders}){
 const [value,setValue]=useState(empty),[status,setStatus]=useState({ready:false,settled:false,waiting:false,error:'',notice:'',saving:false})
 const runtime=useRef(null),latest=useRef(null),sequence=useRef(0),busy=useRef(false),auto=useRef(''),mounted=useRef(false),startRef=useRef(null)
 latest.current={session,members,onHeldOrders,value}
 function actor(){return latest.current.session}
 function scopeGuard(){const current=runtime.current;if(!current?.ready||current.scope.context.userId!==actor()?.userId||current.scope.context.role!==actor()?.role)throw Error('請先等購物車核對完成，原內容仍保留。');return current}
 function guard(){const current=scopeGuard();if(busy.current||current.value.pending||current.value.checkout)throw Error('請先核對上次結果，原購物車仍保留。');return current}
 function write(next){
  const current=scopeGuard(),saved=writeWorkspaceDraft(localStorage,current.scope,{documentId:current.documentId,state:next,original:null},current.raw,validateCartWorkspace)
  current.raw=saved.raw;current.value=saved.value.state;latest.current.value=current.value;if(mounted.current)setValue(current.value);return current.value
 }
 function edit(patch){const current=guard();return write({...current.value,...patch})}
 function setCart(next){const current=guard(),cart=typeof next==='function'?next(clone(current.value.cart)):next;return edit(snapshotCart(cart,current.value.memberId,current.value.manualDiscount))}
 function release(){const current=runtime.current;if(current){current.ready=false;current.controller.abort();current.release?.();runtime.current=null}}
 useEffect(()=>{
  mounted.current=true;let alive=true
  async function start(force=false){
   const ticket=++sequence.current
   try{
    const who={...actor()},context=await loadPrivateDraftContext(who);if(!alive||ticket!==sequence.current)return
    if(actor()?.userId!==who.userId||actor()?.role!==who.role)return
    const scope=workspaceScope(context,'working-cart')
    if(!force&&runtime.current?.ready&&runtime.current.scope.key===scope.key)return
    release();auto.current='';setStatus(old=>({...old,ready:false,settled:false,waiting:false,error:'',notice:''}));setValue(empty())
    const current={scope,controller:new AbortController(),ready:false,raw:null,value:null,documentId:'draft-'+crypto.randomUUID(),release:null};runtime.current=current
    if(!navigator.locks?.request)throw Error('這個瀏覽器無法安全保留購物車，請使用店面程式或 HTTPS 共用店面。')
    const timer=setTimeout(()=>{if(alive&&runtime.current===current&&!current.ready)setStatus(old=>({...old,waiting:true,settled:true}))},200)
    navigator.locks.request('pos-workspace:'+scope.key,{mode:'exclusive',signal:current.controller.signal},async()=>{
     clearTimeout(timer);if(!alive||runtime.current!==current)return
     try{
      current.raw=localStorage.getItem(scope.key);const saved=readWorkspaceDraft(localStorage,scope,validateCartWorkspace)
      current.raw=saved.raw;current.documentId=saved.value?.documentId||current.documentId;current.value=saved.value?.state||empty();current.ready=true
      if(!saved.value)write(current.value);else setValue(current.value)
      setStatus({ready:true,settled:true,waiting:false,error:'',saving:false,notice:saved.value?.state.cart.length?'已接回原購物車。':''})
      await new Promise(resolve=>{current.release=resolve;if(current.controller.signal.aborted)resolve()})
     }catch(error){if(alive&&runtime.current===current){current.ready=false;setStatus(old=>({...old,ready:false,settled:true,waiting:false,error:error.message}))}}
    }).catch(error=>{if(error.name!=='AbortError'&&alive&&runtime.current===current)setStatus(old=>({...old,ready:false,settled:true,waiting:false,error:error.message}))}).finally(()=>clearTimeout(timer))
   }catch(error){if(alive&&ticket===sequence.current)setStatus(old=>({...old,ready:false,settled:true,waiting:false,error:error.message}))}
  }
  startRef.current=start;if(enabled)start()
  const hide=()=>{sequence.current++;release()},show=()=>{if(enabled)start()},refresh=()=>{if(enabled&&!busy.current)start()}
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);window.addEventListener('focus',refresh);window.addEventListener('pos-data-refreshed',refresh)
  return()=>{alive=false;mounted.current=false;sequence.current++;release();window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);window.removeEventListener('focus',refresh);window.removeEventListener('pos-data-refreshed',refresh)}
 },[enabled,session?.userId,session?.role])
 async function accept(request,result){
  const snapshot=verifyHeldResult(request,result),current=scopeGuard(),who={...actor()},context=await loadPrivateDraftContext(who)
  if(runtime.current!==current)throw Error('店面或帳號已變更，請保留原輸入核對。');assertCartContext(context,current.scope.context)
  if(current.value.pending?.id!==request.id)throw Error('原掛單編號需要核對。')
  const next=request.action==='cancel'?{...current.value,pending:null}:{...empty(current.value.lastCompleted),...snapshot}
  write(next);latest.current.onHeldOrders(result.heldOrders);setStatus(old=>({...old,error:'',notice:request.action==='recall'?'已取回原掛單。':request.action==='cancel'?'已取消掛單。':'已掛單，購物車已保留。'}));return result.receipt
 }
 async function send(request){
  const result=await addHeldOrder(request,actor())
  if(result?.protocol===HELD_CART_PROTOCOL&&result.success===false&&result.committed===false&&result.operationId===request.id&&result.digest===privateDraftDigest(request)){
   const current=scopeGuard();if(current.value.pending?.id===request.id)write({...current.value,pending:null});throw Error(result.error||'這次沒有保存，原購物車仍保留。')
  }
  return accept(request,result)
 }
 async function perform(action,row=null,label=''){
  const current=guard();if(action==='hold'&&!current.value.cart.length)return null
  const request={protocol:HELD_CART_PROTOCOL,id:'held-op-'+crypto.randomUUID(),action,time:new Date().toISOString(),draftContext:current.scope.context,cartId:current.value.cartId,current:cartSnapshot({cart:current.value.cart,memberId:current.value.memberId,manualDiscount:current.value.manualDiscount}),label,heldId:'held-'+crypto.randomUUID(),expected:row?{id:row.id,digest:heldDigest(row)}:null}
  heldCommand(request);write({...current.value,pending:request,holdLabel:label});busy.current=true;setStatus(old=>({...old,saving:true,error:'',notice:''}))
  try{return await send(request)}catch(error){setStatus(old=>({...old,error:error.message}));throw error}finally{busy.current=false;setStatus(old=>({...old,saving:false}))}
 }
 async function recover(retry=false){
  const current=scopeGuard(),request=current.value.pending;if(!request||busy.current)return null
  busy.current=true;setStatus(old=>({...old,saving:true,error:''}))
  try{
   const result=await lookupPrivateDraftOriginal({family:'held-cart',context:current.scope.context,id:request.id,digest:privateDraftDigest(request),document:request},actor())
   if(result?.protocol!=='pos-private-draft-original/v1'||result.id!==request.id||!['matched','missing'].includes(result.status))throw Error('掛單結果尚未確認，請查詢原編號。')
   if(result.status==='matched')return await accept(request,result.result)
   if(retry)return await send(request)
   setStatus(old=>({...old,notice:'還沒找到保存結果，可沿用原編號繼續。'}));return null
  }catch(error){setStatus(old=>({...old,error:error.message}));throw error}finally{busy.current=false;setStatus(old=>({...old,saving:false}))}
 }
 useEffect(()=>{if(status.ready&&value.pending&&auto.current!==value.pending.id){auto.current=value.pending.id;recover().catch(()=>{})}},[status.ready,value.pending?.id])
 function freezeCheckout(envelope){
  const current=guard(),cartWorkspace={context:current.scope.context,cartId:current.value.cartId,snapshot:cartSnapshot({cart:current.value.cart,memberId:current.value.memberId,manualDiscount:current.value.manualDiscount})},saved={...clone(envelope),cartWorkspace}
  write({...current.value,checkout:saved});return saved
 }
 function acceptCheckout(result,saved){
  const current=scopeGuard(),binding=saved?.cartWorkspace
  if(!binding)return // A legacy pending sale must not erase a different cart.
  assertCartContext(binding.context,current.scope.context)
  if(current.value.lastCompleted===result.orderId)return
  if(current.value.checkout?.plan.order.id!==result.orderId||binding.cartId!==current.value.cartId)throw Error('原購物車需要核對，請保留交易紀錄。')
  write(empty(result.orderId))
 }
 function releaseCheckout(id){const current=scopeGuard();if(current.value.checkout?.plan.order.id===id)write({...current.value,checkout:null})}
 function download(){const current=runtime.current;if(!current?.raw)return;const url=URL.createObjectURL(new Blob([current.raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='POS-原購物車.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const member=value.memberId?(members.find(row=>row.id===value.memberId)||{id:value.memberId,name:'會員需要核對'}):null
 return {...status,value,cart:value.cart,activeMember:member,manualDiscount:value.manualDiscount,pending:value.pending,blocked:!status.ready||!!value.pending||!!value.checkout||status.saving,
  guard,setCart,setActiveMember:member=>edit({memberId:member?.id||''}),setManualDiscount:manualDiscount=>edit({manualDiscount}),setHoldLabel:holdLabel=>edit({holdLabel}),clear:()=>{guard();write(empty(value.lastCompleted))},replace:snapshot=>{guard();write({...empty(value.lastCompleted),...snapshotCart(snapshot.cart,snapshot.memberId,snapshot.manualDiscount)})},
  hold:label=>perform('hold',null,label),recall:row=>perform('recall',row),remove:row=>perform('cancel',row),recover,freezeCheckout,acceptCheckout,releaseCheckout,checkout:()=>runtime.current?.value.checkout||null,assertProducts:products=>{const current=guard();assertCartProducts(current.value,products,current.scope.context.role)},download,recheck:()=>startRef.current?.(true),rawAvailable:!!runtime.current?.raw}
}
