import {customerQuoteTotal} from './orderJournal.mjs'
import {assertPublicSelections,menuCanonical} from './menuProtocol.mjs'
export const GUEST_DRAFT_DB='pos_guest_workspace_v1',GUEST_STAGE_PREFIX='pos_guest_cart_stage_v1:'
export const isGuestId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export const isGuestScope=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const invalid=()=>Error('這份點餐草稿需要核對，原資料已保留。')
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw invalid()}
const text=(value,max)=>{if(typeof value!=='string'||value.length>max)throw invalid()}
const integer=(value,min=1)=>{if(!Number.isSafeInteger(value)||value<min)throw invalid()}
export function newGuestId(){const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')}
export function assertGuestState(state){
 exact(state,['mode','menuRevision','cart','picker','customerName','tableNum','note','formOpen','cartOpen','search','category'])
 if(!['ordinary','menu'].includes(state.mode)||!isGuestScope(state.menuRevision)||!Array.isArray(state.cart)||state.cart.length>100||typeof state.formOpen!=='boolean'||typeof state.cartOpen!=='boolean')throw invalid()
 for(const [key,max]of [['customerName',100],['tableNum',40],['note',500],['search',500]])text(state[key],max)
 if(state.category!==null)text(state.category,500)
 const ids=new Set()
 for(const row of state.cart){
  exact(row,state.mode==='menu'?['id','name','price','qty','unit','offerId','selection']:['id','name','price','qty','unit']);text(row.id,500);text(row.name,500);text(row.unit,100);if(!row.id||!row.name||ids.has(row.id))throw invalid();ids.add(row.id)
  if(state.mode==='menu'){assertPublicSelections([row.selection]);if(row.offerId!==row.selection.offerId||row.qty!==row.selection.qty)throw invalid()}
 }
 customerQuoteTotal(state.cart,{allowZero:state.mode==='menu'})
 if(state.picker!==null){if(state.mode!=='menu')throw invalid();assertPublicSelections([state.picker])}
 if(JSON.stringify(state).length>262144)throw invalid()
 return state
}
export function guestIntent(state){assertGuestState(state);return menuCanonical({mode:state.mode,cart:state.cart,picker:state.picker,customerName:state.customerName,tableNum:state.tableNum,note:state.note})}
export function assertGuestProof(proof){exact(proof,['scopeId','documentId','signature']);if(!isGuestScope(proof.scopeId)||!isGuestId(proof.documentId)||typeof proof.signature!=='string'||!proof.signature||proof.signature.length>262144)throw invalid();return proof}
export function assertGuestRecord(record,scopeId){
 exact(record,['version','scopeId','documentId','revision','writer','state','signature']);if(record.version!==1||!isGuestScope(record.scopeId)||scopeId!==undefined&&record.scopeId!==scopeId||!isGuestId(record.documentId))throw invalid();integer(record.revision)
 exact(record.writer,['owner','fence','op']);if(!isGuestId(record.writer.owner))throw invalid();integer(record.writer.fence);integer(record.writer.op)
 if(record.signature!==guestIntent(record.state))throw invalid();return record
}
export function assertGuestStage(stage,scopeId){
 exact(stage,['version','scopeId','documentId','owner','fence','op','detached','state','signature']);if(stage.version!==1||!isGuestScope(stage.scopeId)||scopeId!==undefined&&stage.scopeId!==scopeId||!isGuestId(stage.documentId)||!isGuestId(stage.owner)||typeof stage.detached!=='boolean')throw invalid();integer(stage.fence);integer(stage.op)
 if(stage.signature!==guestIntent(stage.state))throw invalid();return stage
}
export function guestRecordFromStage(stage,previous){assertGuestStage(stage);if(previous)assertGuestRecord(previous,stage.scopeId);return assertGuestRecord({version:1,scopeId:stage.scopeId,documentId:stage.documentId,revision:(previous?.revision||0)+1,writer:{owner:stage.owner,fence:stage.fence,op:stage.op},state:structuredClone(stage.state),signature:stage.signature},stage.scopeId)}
export const guestStageKey=(scopeId,owner)=>GUEST_STAGE_PREFIX+scopeId+':'+owner
export function safeGuestSource(value){const seen=new WeakSet();return JSON.stringify(value,(_key,child)=>{if(child&&typeof child==='object'){if(seen.has(child))return '[circular]';seen.add(child)}return child})}
