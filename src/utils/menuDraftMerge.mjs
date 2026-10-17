import {canonicalSignature} from '../../electron/operationRules.mjs'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {menuEditorDraft} from './restaurantMenuEditor.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),copy=value=>structuredClone(value)
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)
const rows=value=>Array.isArray(value)&&value.every(row=>record(row)&&typeof row.id==='string')&&new Set(value.map(row=>row.id)).size===value.length
const byId=(values,id)=>values?.find(row=>row.id===id)

export function menuDraftUnitBasis(menu,products){
 const ids=new Set()
 for(const offer of menu?.offers||[]){for(const variant of offer.variants)for(const row of variant.components)ids.add(row.id);for(const group of offer.groups)for(const choice of group.choices)for(const row of choice.components)ids.add(row.id)}
 return Object.fromEntries([...ids].sort().map(id=>[id,products.find(row=>row.id===id)?.unit||'']))
}
export const menuDraftInputDigest=state=>privateDraftDigest({draft:state.draft,baseline:state.baseline,basis:state.basis??null})
export function menuDraftResolution(plan,previous=null){
 const current=previous?.localDigest===plan.localDigest&&previous?.remoteDigest===plan.remoteDigest
 return {localDigest:plan.localDigest,remoteDigest:plan.remoteDigest,policy:current?previous.policy:null,choices:current?copy(previous.choices):[]}
}

export function planMenuEditorMerge(state,current,products){
 const normalizedBase=JSON.parse(state.baseline),baseProducts=state.basis?products.map(row=>Object.hasOwn(state.basis,row.id)?{...row,unit:state.basis[row.id]}:row):products
 const base=menuEditorDraft(normalizedBase,baseProducts),remote=menuEditorDraft(current,products),local=state.draft
 const plan={localDigest:menuDraftInputDigest(state),remoteDigest:privateDraftDigest({menu:remote,units:menuDraftUnitBasis(current,products)}),baseline:canonicalSignature(current??null),basis:menuDraftUnitBasis(current,products),draft:null,conflicts:[]}
 const resolution=menuDraftResolution(plan,state.reconcile),choices=new Map(resolution.choices.map(row=>[row.key,row.choice]))
 function choose(path,left,right,kind='value'){
  const key=JSON.stringify([kind,...path]),choice=choices.get(key)||resolution.policy||null
  plan.conflicts.push({key,path:[...path],kind,local:copy(left),remote:copy(right),choice})
  return copy(choice==='remote'?right:left)
 }
 function merge(before,left,right,path=[]){
  if(same(left,before))return copy(right)
  if(same(right,before)||same(left,right))return copy(left)
  // C2: a measurement is one intent. Never merge a quantity into the other unit.
  if(path.at(-2)==='components')return choose(path,left,right,'measurement')
  if([before,left,right].every(record)){
   const result=Object.create(null)
   for(const key of new Set([...Object.keys(before),...Object.keys(right),...Object.keys(left)])){const value=merge(before[key],left[key],right[key],[...path,key]);if(value!==undefined)result[key]=value}
   return result
  }
  if([before,left,right].every(rows)){
   const ids=[...new Set([...right.map(row=>row.id),...left.map(row=>row.id)])],result=[]
   for(const id of ids){const value=merge(byId(before,id),byId(left,id),byId(right,id),[...path,id]);if(value!==undefined)result.push(value)}
   return result
  }
  return choose(path,left,right)
 }
 plan.draft=merge(base,local,remote)
 // C2: explain and resolve dangling defaults without discarding independent rows.
 for(const offer of plan.draft.offers){
  const left=byId(local.offers,offer.id),right=byId(remote.offers,offer.id)
  if(!byId(offer.variants,offer.defaultVariantId)){
   const option=side=>side&&({id:side.defaultVariantId,row:byId(side.variants,side.defaultVariantId)})
   const selected=choose(['offers',offer.id,'defaultVariantId'],option(left),option(right),'default-variant')
   if(selected?.row){offer.defaultVariantId=selected.id;if(!byId(offer.variants,selected.id))offer.variants.push(copy(selected.row))}
  }
  for(const group of offer.groups){
   const leftGroup=byId(left?.groups,group.id),rightGroup=byId(right?.groups,group.id)
   for(const entry of [...group.defaults])if(!byId(group.choices,entry.id)){
    const option=side=>{const selected=byId(side?.defaults,entry.id);return selected?{selection:selected,row:byId(side.choices,entry.id)}:undefined}
    const selected=choose(['offers',offer.id,'groups',group.id,'defaults',entry.id],option(leftGroup),option(rightGroup),'default-choice')
    group.defaults=group.defaults.filter(row=>row.id!==entry.id)
    if(selected?.row){group.defaults.push(copy(selected.selection));if(!byId(group.choices,selected.row.id))group.choices.push(copy(selected.row))}
   }
  }
 }
 return plan
}

// Retain the legacy throwing API for callers that do not present value choices.
export function rebaseMenuEditorDraft(local,baseline,current,products){
 const plan=planMenuEditorMerge({draft:local,baseline},current,products)
 if(plan.conflicts.length)throw Error('同一欄位也被其他視窗修改，請先核對店內最新設定。')
 return plan.draft
}
