import {canonicalSignature} from './operationRules.mjs'
import {STOCK_COST_STATES} from './stockCost.mjs'
export const STOCK_SETUP_REVIEW='pos-stock-setup-review/v1'
const error=()=>Error('庫存成本預覽需要重新核對')
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw error()}
const amount=value=>Number.isSafeInteger(value)&&value>=0
export function stockSetupSummary(valuation){
  return {complete:valuation.complete,ownedKnownValueCents:valuation.ownedKnownValueCents,ownedValueCents:valuation.ownedValueCents,
    categories:Object.fromEntries(STOCK_COST_STATES.map(stage=>{const row=valuation.categories[stage];return [stage,{knownValueCents:row.knownValueCents,valueCents:row.valueCents,unknownSources:row.unvalued.length}]}))}
}
export function assertStockSetupReview(review){
  exact(review,['protocol','sourceDigest','issuedAt','summary','journalLines','selection','subject'])
  if(review.protocol!==STOCK_SETUP_REVIEW||!/^sha256:[a-f0-9]{64}$/.test(review.sourceDigest)||typeof review.issuedAt!=='string'||!Number.isFinite(Date.parse(review.issuedAt))||new Date(review.issuedAt).toISOString()!==review.issuedAt)throw error()
  const s=review.summary;exact(s,['complete','ownedKnownValueCents','ownedValueCents','categories']);exact(s.categories,STOCK_COST_STATES)
  if(typeof s.complete!=='boolean'||!amount(s.ownedKnownValueCents)||s.ownedValueCents!==null&&!amount(s.ownedValueCents))throw error()
  for(const stage of STOCK_COST_STATES){const row=s.categories[stage];exact(row,['knownValueCents','valueCents','unknownSources']);if(!amount(row.knownValueCents)||!amount(row.unknownSources)||row.valueCents!==(row.unknownSources?null:row.knownValueCents))throw error()}
  const owned=s.categories.available.knownValueCents+s.categories.reserved.knownValueCents,unknown=s.categories.available.unknownSources+s.categories.reserved.unknownSources
  if(s.ownedKnownValueCents!==owned||s.ownedValueCents!==(unknown?null:owned)||s.complete!==STOCK_COST_STATES.every(stage=>s.categories[stage].unknownSources===0))throw error()
  if(!Array.isArray(review.journalLines)||review.journalLines.length>20000)throw error()
  for(const line of review.journalLines){exact(line,['account','debitCents','creditCents']);if(!['1211','3901','5101','5208','5204','4191','2102','2291'].includes(line.account)||!amount(line.debitCents)||!amount(line.creditCents))throw error()}
  exact(review.selection,['entries','useReferences'])
  if(typeof review.selection.useReferences!=='boolean'||!Array.isArray(review.selection.entries)||review.selection.entries.length>10000)throw error()
  for(const row of review.selection.entries){exact(row,['key','mode','raw']);if(typeof row.key!=='string'||!row.key||!['reference','unknown','free','unit','total'].includes(row.mode)||typeof row.raw!=='string'||row.raw.length>32)throw error()}
  if(review.subject!==null){exact(review.subject,['sourceId','productId','name','unit','quantityUnits']);if(['sourceId','productId','unit'].some(key=>typeof review.subject[key]!=='string'||!review.subject[key])||typeof review.subject.name!=='string'||!amount(review.subject.quantityUnits)||review.subject.quantityUnits===0)throw error()}
  return review
}
export function stockSetupJournalLines(projection,previous=null){return projection.journals.slice(previous?.journals.length||0).flatMap(row=>row.lines)}
export function assertStockSetupProjection(input,body,projection,valuation,previous=null){
  if(input.review===undefined)return
  const review=assertStockSetupReview(input.review)
  const source=projection.custody.sources.find(row=>row.id===input.sourceId)
  if(input.action==='open'?review.subject!==null:!review.subject||review.subject.sourceId!==input.sourceId||source?.productId!==review.subject.productId||source?.unit!==review.subject.unit||source?.quantityUnits!==review.subject.quantityUnits)throw error()
  if(!Number.isFinite(Date.parse(body.time))||review.sourceDigest!==(input.action==='open'?input.snapshotDigest:body.beforeDigest)||Math.abs(Date.parse(body.time)-Date.parse(review.issuedAt))>300000||!same(review.summary,stockSetupSummary(valuation))||!same(review.journalLines,stockSetupJournalLines(projection,previous)))throw error()
}
export function assertStockSetupResult(request,result){
  const review=assertStockSetupReview(request.review),receipt=result?.receipt
  let summary;try{summary=stockSetupSummary(receipt?.valuation)}catch{throw Error('庫存成本回覆尚未確認，請保留原編號核對')}
  if(result?.success!==true||!same(result.command,request)||receipt?.success!==true||receipt.protocol!=='pos-stock-cost/v1'||receipt.id!==request.id||receipt.sourceMethod!==undefined||!Number.isSafeInteger(receipt.sequence)||receipt.sequence<1||typeof receipt.eventId!=='string'||!receipt.eventId||['eventHash','stateDigest'].some(key=>!/^sha256:[a-f0-9]{64}$/.test(receipt[key]))||!same(summary,review.summary))throw Error('庫存成本回覆尚未確認，請保留原編號核對')
  return result
}
