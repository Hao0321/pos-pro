import {draftObject,privateDraftDigest} from './privateDrafts.mjs'
import {businessId} from './businessExchange.mjs'
import {salesText} from './salesRules.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {masterSourceKey} from './masterMigration.mjs'
import {openingBalanceMappings} from './openingBalanceLedger.mjs'

const fail=()=>{throw Error('往來對象的原編號或核對選擇需要確認。')}
const normalize=s=>s.trim().toLowerCase().replace(/[\s_-]/g,'')
const phoneKey=s=>s.replace(/[\s()-]/g,'')
const fields={name:['name','partyname','customername','suppliername','客戶名稱','供應商名稱','名稱'],contact:['contact','聯絡人'],phone:['phone','電話'],email:['email'],address:['address','地址'],note:['note','備註'],payTerms:['payterms','付款條件']}
const profileFields=['name','contact','phone','email','address','note']
function sourceProfile(party,sourceRows){
 const values={name:party.name},issues=[],positions=[]
 for(const {table,row,source,item}of sourceRows){
  positions.push({table,row});const seen=new Set()
  source.columns.forEach((header,column)=>{
   const field=Object.keys(fields).find(key=>fields[key].includes(normalize(header))),raw=item.values[column]
   if(field){if(seen.has(field))issues.push('duplicate-party-field');seen.add(field);if(raw!==''&&!(field==='payTerms'&&party.side==='payable')){if(field==='payTerms')issues.push('unhandled-party-field');if(Object.hasOwn(values,field)&&values[field]&&values[field]!==raw)issues.push('party-name-conflict');values[field]=raw}}
   else if(raw.trim())issues.push('unhandled-party-field')
  })
 }
 for(const [key,value]of Object.entries(values))try{if(key==='name'&&!value)continue;if(salesText(value,key==='name'?100:key==='note'?1000:300,key==='name')!==value||value.includes('\u0000'))issues.push('invalid-party-'+key)}catch{issues.push('invalid-party-'+key)}
 return {values,issues,positions}
}
function directory(items){
 if(!Array.isArray(items)||items.length>100000)fail()
 const byId=new Map(),byName=new Map(),byPhone=new Map(),add=(map,key,row)=>{if(key){if(!map.has(key))map.set(key,[]);map.get(key).push(row)}}
 for(const row of items){businessId(row.id);salesText(row.name,100);if(byId.has(row.id))fail();byId.set(row.id,row);add(byName,row.name,row);add(byPhone,phoneKey(row.phone||''),row)}
 return {byId,byName,byPhone}
}
export const openingFinancialCustomerId=(storeId,key)=>'opening-customer-'+privateDraftDigest([storeId,key]).slice(0,40)
export const openingFinancialSupplierId=(storeId,source,externalId)=>'migr-s-'+privateDraftDigest([storeId,masterSourceKey(source,'suppliers',externalId)]).slice(0,40)

// Pure identity projection. A name/phone suggests choices; it never establishes
// a permanent identity. Membership is intentionally absent from the directory.
export function projectOpeningBalanceParties(parsed,{storeId,customers=[],suppliers=[],context=null,masterRows=[]},choices=[]){
 businessId(storeId)
 if(!Array.isArray(choices)||choices.length>5000)fail()
 const choiceMap=new Map(),partyKeys=new Set(parsed.parties.map(row=>row.key)),prior=new Map(openingBalanceMappings(context,storeId).map(row=>[row.key,row])),directories={receivable:directory(customers),payable:directory(suppliers)},sourceRows=new Map(),masters=new Map(masterRows.filter(row=>row.entity==='suppliers').map(row=>[row.externalId,row]))
 for(const [table,source]of parsed.source.tables.entries())if(['customers','suppliers'].includes(source.entity))for(const [row,item]of source.rows.entries()){
  const key=canonicalSignature([source.entity,item.externalId]);if(!sourceRows.has(key))sourceRows.set(key,[]);sourceRows.get(key).push({table,row,source,item})
 }
 for(const choice of choices){
  draftObject(choice,['key','action','targetId','expectedName'],['key','action'])
  if(!partyKeys.has(choice.key)||choiceMap.has(choice.key)||!['existing','new'].includes(choice.action))fail()
  if(choice.action==='existing'){businessId(choice.targetId);salesText(choice.expectedName,100)}
  else if(Object.hasOwn(choice,'targetId')||Object.hasOwn(choice,'expectedName'))fail()
  choiceMap.set(choice.key,choice)
 }
 const rows=parsed.parties.map(party=>{
  const {values,issues,positions}=sourceProfile(party,sourceRows.get(canonicalSignature([party.side==='receivable'?'customers':'suppliers',party.externalId]))||[]),index=directories[party.side],items=index.byId,choice=choiceMap.get(party.key),mapped=prior.get(party.key)
  const candidates=[...new Map([...(index.byName.get(party.name)||[]),...(values.phone?index.byPhone.get(phoneKey(values.phone))||[]:[])].map(row=>[row.id,row])).values()].map(item=>({id:item.id,name:item.name,phone:item.phone||''})).sort((a,b)=>a.id.localeCompare(b.id))
  const master=party.side==='payable'?masters.get(party.externalId):null
  let targetId='',targetName='',action='blocked',creation=null
  if(mapped){
   targetId=mapped.targetId;const target=items.get(targetId)
   if(!target)issues.push('missing-mapped-party')
   else {targetName=target.name;action='existing'}
   if(choice&&(choice.action!=='existing'||choice.targetId!==targetId))issues.push('source-party-changed')
   if(choice?.action==='existing'&&target?.name!==choice.expectedName)issues.push('stale-party-choice')
  }else if(choice?.action==='existing'){
   const target=items.get(choice.targetId)
   if(!target||target.name!==choice.expectedName)issues.push('stale-party-choice')
   else {targetId=target.id;targetName=target.name;action='existing'}
  }else if(master){
   targetId=master.targetId;targetName=master.values?.name||master.before?.name||master.sourceValues?.name||'';action=master.action==='create'?'create':'existing'
   if(master.issues.length||master.action==='blocked')issues.push('master-party-unresolved')
   if(choice?.action==='new'&&master.action!=='create')issues.push('master-party-choice-conflict')
  }else if(candidates.length&&!choice)issues.push('choose-party')
  else if(!values.name?.trim())issues.push('missing-party-name')
  else {
   targetId=party.side==='receivable'?openingFinancialCustomerId(storeId,party.key):openingFinancialSupplierId(storeId,parsed.source.source,party.externalId);targetName=values.name;action='create'
   if(items.has(targetId))issues.push('party-id-collision')
   else creation=party.side==='receivable'?{id:targetId,...Object.fromEntries(profileFields.filter(key=>Object.hasOwn(values,key)).map(key=>[key,values[key]]))}:{id:targetId,name:targetName,...Object.fromEntries(['contact','phone','note'].filter(key=>Object.hasOwn(values,key)).map(key=>[key,values[key]]))}
  }
  if(master&&targetId!==master.targetId)issues.push('master-party-choice-conflict')
  if(master?.issues.length)issues.push('master-party-unresolved')
  if(master&&targetId===master.targetId&&master.values?.name)targetName=master.values.name
  if(master&&master.action==='create')creation=null // The master projection owns this creation.
  const target=items.get(targetId),before=target?Object.fromEntries((party.side==='receivable'?profileFields:['name','contact','phone','note','payTerms']).filter(key=>Object.hasOwn(target,key)).map(key=>[key,target[key]])):null
  return {...party,sourceValues:values,sourcePositions:positions,candidates,targetId,targetName,action,creation,before,profilePolicy:master?'master-managed':action==='create'?'create':'keep-existing',issues:[...new Set(issues)]}
 })
 const targets=new Map()
 for(const row of rows){const key=canonicalSignature([row.side,row.targetId]);if(row.targetId){const previous=targets.get(key);if(previous){previous.issues.push('duplicate-party-target');row.issues.push('duplicate-party-target')}targets.set(key,row)}}
 for(const row of rows)if(row.issues.length)row.action='blocked'
 return {rows,ready:rows.every(row=>!row.issues.length),mappings:rows.filter(row=>!row.issues.length).map(({key,side,externalId,targetId,targetName})=>({key,side,externalId,targetId,targetName})),creations:rows.filter(row=>!row.issues.length&&row.creation).map(row=>({side:row.side,sourceKey:row.key,values:row.creation}))}
}
