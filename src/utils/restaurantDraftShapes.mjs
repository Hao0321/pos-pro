import {draftObject} from '../../electron/privateDrafts.mjs'
import {assertRestaurantAgentItems} from '../../electron/restaurantAgentDraft.mjs'
import {validQuickDraftState} from './quickDraftCache.js'
import {moneyValue} from '../../electron/operationRules.mjs'
const invalid=()=>Error('草稿資料需要核對，原內容仍保留。')
const text=(value,max=500)=>{if(typeof value!=='string'||value.length>max)throw invalid()}
const array=(value,max)=>{if(!Array.isArray(value)||value.length>max)throw invalid();return value}
const keys=(value,fields,required=fields)=>draftObject(value,fields,required)
function component(row){keys(row,['id','quantity','unit','qty'],['id','quantity','unit']);text(row.id,128);text(row.quantity,60);text(row.unit,30);if(Object.hasOwn(row,'qty')&&(typeof row.qty!=='number'||!Number.isFinite(row.qty)))throw invalid()}
function menu(value){
 keys(value,['protocol','offers']);if(value.protocol!=='pos-restaurant-menu/v1')throw invalid()
 for(const offer of array(value.offers,100)){
  keys(offer,['id','productId','name','defaultVariantId','variants','groups']);for(const key of ['id','productId','name','defaultVariantId'])text(offer[key],128)
  for(const variant of array(offer.variants,20)){keys(variant,['id','name','price','capacity','components']);for(const key of ['id','name','price','capacity'])text(variant[key],128);for(const row of array(variant.components,100))component(row)}
  for(const group of array(offer.groups,8)){
   keys(group,['id','name','min','max','defaults','choices']);for(const key of ['id','name','min','max'])text(group[key],128)
   for(const row of array(group.defaults,20)){keys(row,['id','qty']);text(row.id,128);text(row.qty,60)}
   for(const choice of array(group.choices,20)){keys(choice,['id','name','priceDelta','max','components','omit']);for(const key of ['id','name','priceDelta','max'])text(choice[key],128);for(const row of array(choice.components,100))component(row);for(const row of array(choice.omit,100))text(row,128)}
  }
 }
}
export function validOwnerMenuDraft(value){try{
 keys(value,['draft','baseline','open','chosen','basis','reconcile'],['draft','baseline','open','chosen']);text(value.baseline,131072);text(value.chosen,128);if(typeof value.open!=='boolean')return false;if(value.draft!==null)menu(value.draft)
 if(value.basis!=null){const names=Object.keys(value.basis);keys(value.basis,names);if(names.length>10000)return false;for(const id of names){text(id,128);if(['__proto__','prototype','constructor'].includes(id))return false;text(value.basis[id],100)}}
 if(value.reconcile!=null){const r=value.reconcile;keys(r,['localDigest','remoteDigest','policy','choices']);if(![r.localDigest,r.remoteDigest].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||![null,'local','remote'].includes(r.policy))return false;const seen=new Set();for(const row of array(r.choices,2000)){keys(row,['key','choice']);text(row.key,1500);if(!['local','remote'].includes(row.choice)||seen.has(row.key))return false;seen.add(row.key)}}
 return true
}catch{return false}}
export function validStaffMenuDraft(value){try{keys(value,['cart','labels','selection','selectionLabel','form','menuRevision']);text(value.menuRevision,64);text(value.selectionLabel,2000);if(array(value.labels,100).length!==value.cart.length)return false;for(const label of value.labels)text(label,2000);assertRestaurantAgentItems(value.cart,{allowEmpty:true});if(value.selection!==null)assertRestaurantAgentItems([value.selection]);keys(value.form,['channel','day','slot','customer','contact','note']);for(const [key,max]of [['channel',10],['day',10],['slot',5],['customer',100],['contact',100],['note',1000]])text(value.form[key],max);return true}catch{return false}}
export const validWorkspaceQuickDraft=(value,context)=>validQuickDraftState(value,context)
export function validOrdinaryOrderDraft(value,context){try{
 keys(value,['form','chosen','meta','modified']);text(value.chosen,128);if(typeof value.modified!=='boolean')return false
 keys(value.meta,['id','issuedAt','storeId','catalogueRevision']);if(!/^[A-Za-z0-9_-]{8,80}$/.test(value.meta.id)||!Number.isFinite(Date.parse(value.meta.issuedAt))||value.meta.storeId!==context.storeId)return false;text(value.meta.catalogueRevision,64);if(value.meta.catalogueRevision&&!/^[a-f0-9]{64}$/.test(value.meta.catalogueRevision))return false
 keys(value.form,['channel','day','slot','customer','contact','note','items']);for(const [key,max]of [['channel',10],['day',10],['slot',5],['customer',100],['contact',100],['note',1000]])text(value.form[key],max)
 const seen=new Set();for(const row of array(value.form.items,100)){keys(row,['id','name','unit','qty','price']);for(const [key,max]of [['id',128],['name',500],['unit',100],['qty',32]])text(row[key],max);if(!row.id||seen.has(row.id))return false;moneyValue(row.price,'餐點金額');seen.add(row.id)}return true
}catch{return false}}
