import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'

export const HELD_CART_PROTOCOL='pos-held-cart/v1'
export const HELD_CART_JOURNAL='heldCartOperationsV1'
const clone=value=>structuredClone(value)
const invalid=()=>Error('掛單資料需要核對，原購物車仍保留。')
const text=(value,max=200)=>{if(typeof value!=='string'||value.length>max)throw invalid();return value}
const id=value=>{if(typeof value!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(value))throw invalid();return value}
const decimal=(value,scale,max=1e9)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max||Math.abs(value*scale-Math.round(value*scale))>1e-6)throw invalid();return value}
export function cartSnapshot(value){
 draftObject(value,['cart','memberId','manualDiscount'])
 if(!Array.isArray(value.cart)||value.cart.length>500)throw invalid()
 const ids=new Set(),cart=value.cart.map(row=>{
  draftObject(row,['id','name','price','qty','unit','category']);id(row.id);text(row.name);text(row.unit,40);text(row.category,100);decimal(row.price,100);decimal(row.qty,1000,1e6)
  if(!row.qty||ids.has(row.id))throw invalid();ids.add(row.id);return clone(row)
 })
 if(value.memberId)id(value.memberId);else if(value.memberId!=='')throw invalid()
 return {cart,memberId:value.memberId,manualDiscount:decimal(value.manualDiscount,100)}
}
export const snapshotCart=(cart,memberId='',manualDiscount=0)=>cartSnapshot({cart:cart.map(row=>({id:row.id,name:row.name,price:row.price,qty:row.qty,unit:row.unit||'',category:row.category||''})),memberId,manualDiscount})
export function heldSnapshot(row){
 if(!row||typeof row!=='object')throw invalid()
 const snapshot=snapshotCart(row.cart,row.memberId||'',row.manualDiscount??0)
 id(row.id);text(row.label||'');text(row.note||'',1000);text(row.cashier||'');if(!snapshot.cart.length||!Number.isFinite(Date.parse(row.createdAt)))throw invalid()
 return {id:row.id,label:row.label||'',...snapshot,note:row.note||'',createdAt:row.createdAt,cashier:row.cashier||''}
}
export const heldDigest=row=>privateDraftDigest(heldSnapshot(row))
export function assertCartContext(actual,expected){assertPrivateDraftContext(actual);assertPrivateDraftContext(expected);if(privateDraftDigest(actual)!==privateDraftDigest(expected))throw Error('店面或帳號已變更，請保留原輸入核對。')}
export function assertCartProducts(snapshot,products,role){
 for(const row of snapshot.cart){const product=products.find(p=>p.id===row.id);if(!product||(product.unit||'')!==row.unit)throw Error('商品或計量單位已變更，請先核對購物車。');if(role==='staff'&&product.price!==row.price)throw Error('商品售價已變更，請由老闆核對原購物車。')}
 if(role==='staff'&&snapshot.manualDiscount)throw Error('整單折讓請由老闆核對。')
}
export function heldCommand(value){
 draftObject(value,['protocol','id','action','time','draftContext','cartId','current','label','heldId','expected'])
 if(value.protocol!==HELD_CART_PROTOCOL||!/^held-op-[-a-f0-9]{36}$/.test(value.id)||!['hold','recall','cancel'].includes(value.action)||!Number.isFinite(Date.parse(value.time)))throw invalid()
 assertPrivateDraftContext(value.draftContext);id(value.cartId);cartSnapshot(value.current);text(value.label);id(value.heldId)
 if(value.action==='hold'){if(!value.current.cart.length||value.expected!==null)throw invalid()}
 else{draftObject(value.expected,['id','digest']);id(value.expected.id);if(!/^[a-f0-9]{64}$/.test(value.expected.digest))throw invalid()}
 return clone(value)
}
function outputFor(request,incoming){return request.action==='hold'?{cart:[],memberId:'',manualDiscount:0}:request.action==='recall'?snapshotCart(incoming.cart,incoming.memberId,incoming.manualDiscount):clone(request.current)}
export function readHeldJournal(raw){
 if(raw==null)return {version:1,entries:[]}
 let journal;try{journal=typeof raw==='string'?JSON.parse(raw):clone(raw);draftObject(journal,['version','entries']);if(journal.version!==1||!Array.isArray(journal.entries))throw invalid();const ids=new Set();for(const row of journal.entries){
  draftObject(row,['id','digest','document','incoming','outgoing','output']);const request=heldCommand(row.document)
  if(ids.has(row.id)||row.id!==request.id||row.digest!==privateDraftDigest(request))throw invalid();ids.add(row.id)
  if((row.incoming!==null)!==(request.action!=='hold')||(row.outgoing!==null)!==(request.action==='hold'||request.action==='recall'&&!!request.current.cart.length))throw invalid()
  if(row.incoming!==null){heldSnapshot(row.incoming);if(row.incoming.id!==request.expected.id||heldDigest(row.incoming)!==request.expected.digest)throw invalid()}
  if(row.outgoing!==null){heldSnapshot(row.outgoing);if(row.outgoing.id!==request.heldId||row.outgoing.label!==request.label||row.outgoing.createdAt!==request.time||privateDraftDigest(snapshotCart(row.outgoing.cart,row.outgoing.memberId,row.outgoing.manualDiscount))!==privateDraftDigest(request.current))throw invalid()}
  cartSnapshot(row.output);if(privateDraftDigest(row.output)!==privateDraftDigest(outputFor(request,row.incoming)))throw invalid()
 }}catch{throw Error('掛單保存紀錄需要核對，請保留原購物車。')}
 return journal
}
export function planHeldCommand(input,context,{heldOrders,products,members},journal,actor){
 const request=heldCommand(input);assertCartContext(request.draftContext,context)
 const existing=journal.entries.find(row=>row.id===request.id)
 if(existing){if(existing.digest!==privateDraftDigest(request))throw Error('原掛單編號內容不同，請保留原購物車。');return {receipt:existing,heldOrders,alreadySaved:true}}
 const retired=new Set(journal.entries.flatMap(row=>[row.outgoing?.id,row.incoming?.id].filter(Boolean)))
 let incoming=null,outgoing=null,next=[...heldOrders]
 if(request.action!=='hold'){
  const row=next.find(row=>row.id===request.expected.id)
  if(!row)throw Error('這張掛單已由其他裝置取回或取消，原購物車仍保留。')
  incoming=heldSnapshot(row);if(heldDigest(incoming)!==request.expected.digest)throw Error('掛單內容已變更，請重新查看。')
  if(request.action==='recall')assertCartProducts(incoming,products,context.role)
 }
 if(request.action==='hold'||request.action==='recall'&&request.current.cart.length){
  if(retired.has(request.heldId)||next.some(row=>row.id===request.heldId))throw Error('掛單編號已使用，請保留原購物車。')
  assertCartProducts(request.current,products,context.role)
  if(request.current.memberId&&!members.some(row=>row.id===request.current.memberId))throw Error('原會員已不存在，請先核對購物車。')
  outgoing={id:request.heldId,label:request.label,...clone(request.current),note:'',createdAt:request.time,cashier:actor.username};next.unshift(outgoing)
 }
 if(incoming)next=next.filter(row=>row.id!==incoming.id)
 const receipt={id:request.id,digest:privateDraftDigest(request),document:request,incoming,outgoing,output:outputFor(request,incoming)}
 return {receipt,heldOrders:next,alreadySaved:false}
}
export function heldResult(receipt,heldOrders,alreadySaved=false){return {protocol:HELD_CART_PROTOCOL,success:true,operationId:receipt.id,digest:receipt.digest,receipt:clone(receipt),heldOrders:clone(heldOrders),alreadySaved}}
export function verifyHeldResult(request,result){
 if(result?.protocol!==HELD_CART_PROTOCOL||result.success!==true||result.operationId!==request.id||result.digest!==privateDraftDigest(request)||!Array.isArray(result.heldOrders))throw Error('掛單結果尚未確認，請查詢原編號。')
 const journal=readHeldJournal({version:1,entries:[result.receipt]});if(journal.entries[0].digest!==result.digest)throw invalid();return clone(result.receipt.output)
}
export function heldOriginal(input,context,journal,heldOrders){
 draftObject(input,['context','id','digest','family','document']);if(input.family!=='held-cart')throw invalid();assertCartContext(input.context,context);const request=heldCommand(input.document);assertCartContext(request.draftContext,context)
 if(input.id!==request.id||input.digest!==privateDraftDigest(request))throw invalid()
 const receipt=journal.entries.find(row=>row.id===input.id);if(!receipt)return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}
 if(receipt.digest!==input.digest)throw invalid();return {protocol:'pos-private-draft-original/v1',status:'matched',id:input.id,digest:input.digest,action:request.action,result:heldResult(receipt,heldOrders,true)}
}
export function assertCheckoutCart(binding,order,context,products,original=false){
 if(binding==null)return
 draftObject(binding,['context','cartId','snapshot']);assertCartContext(binding.context,context);id(binding.cartId);cartSnapshot(binding.snapshot);if(!original)assertCartProducts(binding.snapshot,products,context.role)
 if(binding.snapshot.memberId!==(order.memberId||'')||binding.snapshot.cart.length!==order.items.length||binding.snapshot.cart.some(row=>!order.items.some(item=>item.id===row.id&&item.qty===row.qty&&item.price===row.price)))throw Error('購物車內容已變更，請保留原交易核對。')
}
