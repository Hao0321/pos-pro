import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex} from '@noble/hashes/utils.js'
import {canonicalSignature} from './operationRules.mjs'
import {purchaseImportId} from './quickPurchaseOriginal.mjs'

export const PRIVATE_DRAFT_CONTEXT='pos-private-draft-context/v1'
export const PRIVATE_QUICK_FEATURE='private-quick-drafts-v1'
export function usesPrivateQuickDrafts(restaurantOperations=[],audits=[]){return [...restaurantOperations,...audits.filter(row=>row.action==='INVENTORY_OPERATION').map(row=>typeof row.detail==='string'?JSON.parse(row.detail):row.detail)].some(row=>{if(typeof row?.signature!=='string')return false;const request=JSON.parse(row.signature);return !!request.draftContext&&typeof request.id==='string'&&request.id.startsWith('agent-')})}
const invalid=()=>Error('草稿資料需要核對，原內容仍保留。')
export function draftObject(value,keys,required=keys){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw invalid()}
const identifier=value=>{if(typeof value!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(value))throw invalid()}
export function assertPrivateDraftContext(value){draftObject(value,['protocol','storeId','epoch','userId','role']);if(value.protocol!==PRIVATE_DRAFT_CONTEXT||!['owner','staff'].includes(value.role))throw invalid();for(const key of ['storeId','epoch','userId'])identifier(value[key]);return value}
export function privateDraftContext(storeId,epoch,actor,users){
 if(!actor||!['owner','staff'].includes(actor.role)||!users.some(row=>row.id===actor.userId&&row.username===actor.username&&row.role===actor.role))throw Error('請先登入，或重新驗證身份')
 return assertPrivateDraftContext({protocol:PRIVATE_DRAFT_CONTEXT,storeId,epoch,userId:actor.userId,role:actor.role})
}
export const privateDraftDigest=value=>bytesToHex(sha256(new TextEncoder().encode(canonicalSignature(value))))
export function privateDraftMappingInput(input,current){if(!Object.hasOwn(input||{},'draftContext'))return input;assertPrivateDraftContext(input.draftContext);if(privateDraftDigest(input.draftContext)!==privateDraftDigest(current))throw Error('店面或帳號已變更，請保留原輸入核對。');const {draftContext,...body}=input;return body}
export function assertPrivateDraftCaller(request,actor){
 if(!Object.hasOwn(request||{},'draftContext'))return null
 const context=assertPrivateDraftContext(request.draftContext)
 if(!actor||actor.userId!==context.userId||actor.role!==context.role)throw Error('店面或帳號已變更，請保留原輸入核對。')
 return context
}
export function assertPrivateDraftOperation(request,{data=null,actor=null,receiptActor=null}={}){
 if(!Object.hasOwn(request||{},'draftContext'))return null
 const context=assertPrivateDraftContext(request.draftContext),agent=request.agentDraft,agentSource=agent&&request.action==='create'&&request.id==='agent-'+agent.id&&agent.kind==='restaurant'&&agent.storeId===context.storeId&&['pos-document-draft/v1','pos-restaurant-agent-draft/v1'].includes(agent.protocol)
 const scope=request.action==='configure'?request.menuSetupReview?.scope:request.action==='create'&&request.menuProtocol==='pos-restaurant-menu/v1'?request.menuReview?.quote?.scope:agentSource?request.ordinaryReview?.scope:null
 if(request.kind!=='restaurant'||!(agentSource||/^draft-[-a-f0-9]{36}$/.test(request.id||'')&&!agent&&!request.ordinaryReview)||request.customerOrderId||!scope||scope.storeId!==context.storeId||scope.epoch!==context.epoch)throw Error('草稿資料需要核對，原內容仍保留。')
 if(actor)assertPrivateDraftCaller(request,actor)
 if(!data&&!actor&&!receiptActor||receiptActor&&(receiptActor.userId!==context.userId||receiptActor.role!==context.role))throw Error('原單資料需要核對')
 if(data&&privateDraftDigest(privateDraftContext(data.storeId,data.epoch,actor,data.users))!==privateDraftDigest(context))throw Error('店面或帳號已變更，請保留原輸入核對。')
 return context
}
export function assertPrivateQuickPurchase(request,{scope=null,actor=null,receiptActor=null}={}){
 if(!Object.hasOwn(request||{},'draftContext'))return null
 const context=assertPrivateDraftContext(request.draftContext),supplier=request.supplierContext
 if(request.kind!=='purchase-create'||context.role!=='owner'||!/^agent-[A-Za-z0-9_-]{8,80}$/.test(request.id||'')||request.purchase?.id!=='PO-'+request.id||!supplier||supplier.storeId!==context.storeId||supplier.epoch!==context.epoch)throw invalid()
 if(actor)assertPrivateDraftCaller(request,actor)
 if(scope&&(context.storeId!==scope.storeId||context.epoch!==scope.epoch))throw Error('店面或帳號已變更，請保留原輸入核對。')
 if(receiptActor&&(receiptActor.userId!==context.userId||receiptActor.role!==context.role))throw Error('原單資料需要核對')
 return context
}
export function assertDraftLookup(input,current){
 if(input?.family==='waste-entry'){
  draftObject(input,['context','id','digest','family','document']);assertPrivateDraftContext(input.context)
  if(!/^waste-entry-[-a-f0-9]{36}$/.test(input.id)||typeof input.digest!=='string'||!/^[a-f0-9]{64}$/.test(input.digest)||privateDraftDigest(input.context)!==privateDraftDigest(current)||privateDraftDigest(input.document)!==input.digest)throw invalid()
  return
 }

 if(input?.family==='quick-purchase-import'){
  draftObject(input,['context','id','family','document']);assertPrivateDraftContext(input.context)
  if(current.role!=='owner')throw Error('權限不足')
  if(canonicalSignature(input.context)!==canonicalSignature(current))throw Error('店面或帳號已變更，請保留原輸入核對。')
  if(input.id!==purchaseImportId(input.document,current.storeId))throw Error('原單資料需要核對')
  return
 }
 draftObject(input,['context','id','digest','family'],['context','id','digest']);assertPrivateDraftContext(input.context);identifier(input.id)
 if(input.family==='loyalty-program'){if(current.role!=='owner'||!/^loyalty-program-[-a-f0-9]{36}$/.test(input.id))throw Error('權限不足')}else if(input.family==='member-profile'){if(!/^member-profile-[-a-f0-9]{36}$/.test(input.id))throw Error('權限不足')}else if(Object.hasOwn(input,'family')&&(input.family==='product-edit'?!/^product-edit-[-a-f0-9]{36}$/.test(input.id):!['quick-purchase','quick-restaurant'].includes(input.family)||!/^agent-[A-Za-z0-9_-]{8,80}$/.test(input.id)||input.family==='quick-purchase'&&current.role!=='owner'))throw Error('權限不足')
 if(typeof input.digest!=='string'||!/^[a-f0-9]{64}$/.test(input.digest)||canonicalSignature(input.context)!==canonicalSignature(current))throw Error('店面或帳號已變更，請保留原輸入核對。')
}
export function privateQuickOriginal(input,receipt,sourceActor,actor){
 if(!receipt)return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}
 const request=JSON.parse(receipt.signature),purchase=input.family==='quick-purchase',scope=purchase?request.supplierContext:request.menuReview?.quote?.scope||request.ordinaryReview?.scope||request
 if(sourceActor?.userId!==actor.userId||sourceActor?.role!==actor.role)throw Error('權限不足')
 if(request.id!==input.id||receipt.id!==input.id||request.kind!==(purchase?'purchase-create':'restaurant')||!purchase&&request.action!=='create'||scope.storeId!==input.context.storeId||privateDraftDigest(request)!==input.digest)throw Error('原編號已用於不同內容，請保留原單核對。')
 if(purchase)assertPrivateQuickPurchase(request,{receiptActor:sourceActor});else assertPrivateDraftOperation(request,{receiptActor:sourceActor})
 return {protocol:'pos-private-draft-original/v1',status:'matched',id:input.id,digest:input.digest,action:purchase?'purchase-create':'create',entryId:receipt.entityId||receipt.purchaseId||''}
}
export function privateDraftOriginal(input,receipt,actor){
 if(!receipt)return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}
 if(receipt.actor?.userId!==actor.userId)throw Error('權限不足')
 if(receipt.id!==input.id||!['create','configure'].includes(receipt.action)||privateDraftDigest(JSON.parse(receipt.signature))!==input.digest)throw Error('原編號已用於不同內容，請保留原單核對。')
 return {protocol:'pos-private-draft-original/v1',status:'matched',id:receipt.id,digest:input.digest,action:receipt.action,entryId:receipt.entityId||''}
}
