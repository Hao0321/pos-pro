import {canonicalSignature,quantityValue} from '../../electron/operationRules.mjs'
import {draftObject,privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {normalizeRestaurantConfig} from '../../electron/restaurantRules.mjs'

const invalid=()=>Error('草稿資料需要核對，原內容仍保留。')
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),copy=value=>value===undefined?undefined:structuredClone(value)
const text=(value,max=128)=>{if(typeof value!=='string'||value.length>max)throw invalid()}
const id=value=>{text(value);if(!/^[A-Za-z0-9:_-]{1,128}$/.test(value))throw invalid()}
export function restaurantSettingsDraft(config,proposal=false){return {enabled:config.enabled,dailyCapacity:String(config.dailyCapacity),slotCapacity:String(config.slotCapacity),fundsEnabled:proposal||config.fundsEnabled===true,recipes:Object.fromEntries(Object.entries(config.recipes).map(([target,rows])=>[target,rows.map(row=>({id:row.id,qty:String(row.qty)}))]))}}
export function validRestaurantSettingsDraft(value){try{
 draftObject(value,['draft','baseline','recipeTarget','ingredient','open','setupProposal']);text(value.baseline,131072);text(value.recipeTarget);text(value.ingredient)
 if(typeof value.open!=='boolean'||typeof value.setupProposal!=='boolean')return false
 if(value.draft===null)return value.baseline===''&&!value.recipeTarget&&!value.ingredient&&!value.setupProposal
 const draft=value.draft;draftObject(draft,['enabled','dailyCapacity','slotCapacity','fundsEnabled','recipes']);if(typeof draft.enabled!=='boolean'||typeof draft.fundsEnabled!=='boolean')return false;text(draft.dailyCapacity,32);text(draft.slotCapacity,32)
 draftObject(draft.recipes,Object.keys(draft.recipes));if(Object.keys(draft.recipes).length>100)return false
 for(const [target,rows]of Object.entries(draft.recipes)){id(target);if(!Array.isArray(rows)||rows.length>100)return false;const seen=new Set();for(const row of rows){draftObject(row,['id','qty']);id(row.id);text(row.qty,32);if(seen.has(row.id))return false;seen.add(row.id)}}
 const base=JSON.parse(value.baseline);draftObject(base,['enabled','dailyCapacity','slotCapacity','recipes','fundsEnabled','tableOrdering','kitchenPrinting','menu'],['enabled','dailyCapacity','slotCapacity','recipes']);return canonicalSignature(base)===value.baseline&&typeof base.enabled==='boolean'&&Number.isSafeInteger(base.dailyCapacity)&&Number.isSafeInteger(base.slotCapacity)&&!!base.recipes&&typeof base.recipes==='object'&&!Array.isArray(base.recipes)
}catch{return false}}
function capacity(value,label){if(!/^\d{1,6}$/.test(value)||Number(value)<1||Number(value)>100000)throw Error(label+'須為有效正整數');return Number(value)}
function usage(value){if(!/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(value)||Number(value)<=0)throw Error('配方用量必須大於零');return quantityValue(Number(value),'配方用量')}
export function compileRestaurantSettingsDraft(state,products){
 if(!validRestaurantSettingsDraft(state)||!state.draft)throw invalid()
 const base=JSON.parse(state.baseline),raw=state.draft,config={...base,enabled:raw.enabled,dailyCapacity:capacity(raw.dailyCapacity,'每日產能'),slotCapacity:capacity(raw.slotCapacity,'時段產能'),recipes:Object.fromEntries(Object.entries(raw.recipes).map(([target,rows])=>[target,rows.map(row=>({id:row.id,qty:usage(row.qty)}))]))}
 if(Object.hasOwn(base,'fundsEnabled')||raw.fundsEnabled)config.fundsEnabled=raw.fundsEnabled
 return normalizeRestaurantConfig(config,products)
}
const mergeShape=raw=>({...raw,recipes:Object.fromEntries(Object.entries(raw.recipes).map(([target,rows])=>[target,Object.fromEntries(rows.map(row=>[row.id,row.qty]))]))})
const editorShape=raw=>({...raw,recipes:Object.fromEntries(Object.entries(raw.recipes).map(([target,rows])=>[target,Object.entries(rows).map(([id,qty])=>({id,qty}))]))})
export function rebaseRestaurantSettingsDraft(state,current,resolutions={}){
 if(!validRestaurantSettingsDraft(state)||!state.draft)throw invalid()
 const base=mergeShape(restaurantSettingsDraft(JSON.parse(state.baseline))),local=mergeShape(state.draft),remote=mergeShape(restaurantSettingsDraft(current)),conflicts=[]
 function merge(b,l,r,path=[]){
  if(same(l,b))return copy(r)
  if(same(r,b)||same(l,r))return copy(l)
  const record=value=>value&&typeof value==='object'&&!Array.isArray(value)
  if([b,l,r].every(record)){const result=Object.create(null);for(const key of new Set([...Object.keys(b),...Object.keys(r),...Object.keys(l)])){const value=merge(b[key],l[key],r[key],[...path,key]);if(value!==undefined)result[key]=value}return result}
  const key=JSON.stringify(path),choice=resolutions[key]
  if(choice==='local')return copy(l)
  if(choice==='remote')return copy(r)
  conflicts.push({key,path,local:copy(l),remote:copy(r)});return copy(l)
 }
 const merged=merge(base,local,remote)
 return {draft:editorShape(merged),baseline:canonicalSignature(current),conflicts}
}
export function assertRestaurantSettingsOriginal(result,context){
 const receipt=result?.result?.receipt,request=receipt&&JSON.parse(receipt.signature)
 if(result?.protocol!=='pos-private-draft-original/v1'||result.status!=='matched'||result.action!=='configure'||result.result?.success!==true||receipt?.kind!=='restaurant'||receipt.action!=='configure'||receipt.id!==result.id||request?.id!==result.id||request.action!=='configure'||request.kind!=='restaurant'||receipt.signature!==canonicalSignature(request)||privateDraftDigest(request)!==result.digest||request.storeId!==context.storeId||request.epoch!==context.epoch||receipt.actor?.userId!==context.userId||receipt.actor?.role!=='owner'||!result.result.config||!Array.isArray(result.result.products)||!Array.isArray(receipt.productIds)||new Set(receipt.productIds).size!==receipt.productIds.length||new Set(result.result.products.map(row=>row.id)).size!==result.result.products.length||receipt.productIds.length!==result.result.products.length||receipt.productIds.some(id=>!result.result.products.some(row=>row.id===id)))throw Error('保存結果尚未確認，請保留原編號核對。')
 return request
}
