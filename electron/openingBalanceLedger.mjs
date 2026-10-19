import {draftObject,privateDraftDigest} from './privateDrafts.mjs'
import {businessId} from './businessExchange.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {OPENING_BALANCE_CONTEXT,projectOpeningBalanceSource,openingBalanceBatchId,openingBalancesToJournalEntries} from './openingBalanceSource.mjs'
import {OPENING_CUTOVER_CONTEXT,readOpeningCutoverProof,OPENING_ACTIVATION} from './openingCutoverRules.mjs'

const bad=()=>{throw Error('原單帳款的來源、身份或生效版本需要核對。')}
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const count=value=>{if(!Number.isSafeInteger(value)||value<0)bad();return value}
const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>100||/[\p{Cc}\p{Cf}]/u.test(value))bad();return value}
const batchFields=['id','sequence','previousHash','sourceText','cutoffDate','partyMappings','customerRevision','supplierRevision','actor','time','hash']
const sideRevision=side=>side==='receivable'?'customerRevision':'supplierRevision'
const partyField=side=>side==='receivable'?'customerId':'supplierId'
export const openingBalanceClaimIds=(storeId,fact)=>{
 const hash=privateDraftDigest([storeId,fact.key])
 return {id:'opening-claim-'+hash.slice(0,48),documentId:(fact.side==='receivable'?'opening-ar-':'opening-ap-')+hash.slice(0,48),claimId:'opening-item-'+hash.slice(0,48),fundingId:'opening-credit-'+hash.slice(0,48)}
}
function compileBatch(batch,storeId,protocol){
 let parsed
 if(protocol===OPENING_CUTOVER_CONTEXT){const proof=readOpeningCutoverProof(batch,storeId);parsed=proof.parsed;batch=proof.batch}
 else{
 draftObject(batch,batchFields);const {hash,...body}=batch
 parsed=projectOpeningBalanceSource(batch.sourceText,batch.cutoffDate)
 // This first context version carries financial facts and referenced party
 // metadata only. A future combined writer must prove the other source work in
 // its own version, rather than silently using this as a partial import.
 if(parsed.stockRequired||parsed.otherEntities.length||parsed.partyReferenceIssues.length||parsed.source.tables.some(table=>table.entity==='products'))throw Error('這份來源還有主檔、庫存或歷史待處理，帳款尚未保存。')
 if(hash!==privateDraftDigest(body)||batch.id!==openingBalanceBatchId(parsed.source,storeId)||!Number.isSafeInteger(batch.sequence)||batch.sequence<1||batch.previousHash!==null&&!/^[a-f0-9]{64}$/.test(batch.previousHash)||!Array.isArray(batch.partyMappings)||batch.partyMappings.length!==parsed.parties.length||batch.actor?.role!=='owner')bad()
 }
 const hash=batch.hash
 draftObject(batch.actor,['userId','username','role']);businessId(batch.actor.userId);name(batch.actor.username)
 if(typeof batch.time!=='string'||!Number.isFinite(Date.parse(batch.time))||new Date(batch.time).toISOString()!==batch.time||batch.cutoffDate>new Date(Date.parse(batch.time)+14*3600000).toISOString().slice(0,10))bad()
 count(batch.customerRevision);count(batch.supplierRevision)
 const mappings=new Map()
 for(const row of batch.partyMappings){
  draftObject(row,['key','side','externalId','targetId','targetName']);businessId(row.targetId);name(row.targetName)
  if(mappings.has(row.key)||!parsed.parties.some(p=>p.key===row.key&&p.side===row.side&&p.externalId===row.externalId))bad()
  mappings.set(row.key,row)
 }
 const claims=parsed.facts.map(fact=>{
  const mapping=mappings.get(fact.partyKey);if(!mapping)bad()
  return Object.freeze({...fact,...openingBalanceClaimIds(storeId,fact),[partyField(fact.side)]:mapping.targetId,partyName:mapping.targetName,batchId:batch.id,batchHash:hash,activationRevision:batch[sideRevision(fact.side)],origin:Object.freeze({...fact.origin}),source:Object.freeze({...parsed.source.source})})
 })
 return {batch:structuredClone(batch),parsed,claims}
}
function compileContext(context,storeId){
 if(context===undefined||context===null)return []
 draftObject(context,['protocol','storeId','batches','digest']);businessId(context.storeId)
 if(![OPENING_BALANCE_CONTEXT,OPENING_CUTOVER_CONTEXT].includes(context.protocol)||storeId!==undefined&&context.storeId!==storeId||!Array.isArray(context.batches)||context.batches.length>5000||context.digest!==privateDraftDigest({protocol:context.protocol,storeId:context.storeId,batches:context.batches}))bad()
 const compiled=[],ids=new Set(),sourceKeys=new Set(),economic=new Set(),parties=new Map();let head=null,customerRevision=0,supplierRevision=0
 for(const [index,batch]of context.batches.entries()){
  const row=compileBatch(batch,context.storeId,context.protocol)
  if(batch.sequence!==index+1||batch.previousHash!==head||ids.has(batch.id)||batch.customerRevision<customerRevision||batch.supplierRevision<supplierRevision)bad()
  if(context.protocol===OPENING_CUTOVER_CONTEXT&&(batch.customerRevision<=customerRevision||batch.supplierRevision<=supplierRevision||batch.priorCustomerDigest!==sideDigest(compiled,context.storeId,'receivable',context.protocol)||batch.priorSupplierDigest!==sideDigest(compiled,context.storeId,'payable',context.protocol)))bad()
  for(const claim of row.claims){
   if(sourceKeys.has(claim.key))bad();sourceKeys.add(claim.key)
   const old=parties.get(claim.partyKey),target=claim[partyField(claim.side)];if(old&&old!==target)bad();parties.set(claim.partyKey,target)
   const key=canonicalSignature([claim.side,target,claim.type,claim.number,claim.date,claim.currency]);if(economic.has(key))bad();economic.add(key)
  }
  compiled.push(row);ids.add(batch.id);head=batch.hash;customerRevision=batch.customerRevision;supplierRevision=batch.supplierRevision
 }
 return compiled
}
function sideDigest(compiled,storeId,side,protocol){const active=compiled.filter(row=>row.claims.some(claim=>claim.side===side));return active.length?privateDraftDigest({protocol,storeId,side,batches:active.map(row=>({id:row.batch.id,hash:row.batch.hash}))}):null}
export function openingBalanceContextFromCutovers(storeId,batches){
 if(!batches.length)return undefined
 const context={protocol:OPENING_CUTOVER_CONTEXT,storeId,batches:structuredClone(batches)};context.digest=privateDraftDigest(context);compileContext(context,storeId);return context
}
export function assertOpeningActivation(request,side,data,revision,actor,pendingReceipt=null){
 const batch=pendingReceipt?readOpeningCutoverProof(pendingReceipt,data.storeId).batch:compileContext(data.openingBalanceContext,data.storeId).find(row=>row.batch.id===request.openingBatchId)?.batch
 if(!batch||request.action!==OPENING_ACTIVATION||request.openingBatchId!==batch.id||request.id!==batch[side==='receivable'?'customerBarrierId':'supplierBarrierId']||revision!==batch[sideRevision(side)]||request.sourceDigest!==batch.sourceDigest||request.date!==batch.cutoffDate||request.time!==batch.time||request.epoch!==JSON.parse(batch.signature).scope.epoch||request.reviewed!==true||!same(actor,batch.actor))bad()
}
// Permanent source-party links are reconstructed from the same validated proof
// as settlement. Callers cannot supply an unverified mapping dictionary.
export function openingBalanceMappings(context,storeId){
 const mappings=new Map()
 for(const {batch} of compileContext(context,storeId))for(const row of batch.partyMappings)mappings.set(row.key,structuredClone(row))
 return [...mappings.values()]
}
// Pure proof construction for an owner-authorized import transaction. Calling
// this helper alone has no persistence or authority. Every source fact is
// reconstructed from original text when a ledger accepts the context. OB3/OB4.
export function appendOpeningBalanceContext(context,{storeId,sourceText,cutoffDate,partyMappings,customerRevision,supplierRevision,actor,time}){
 businessId(storeId);if(context&&context.protocol!==OPENING_BALANCE_CONTEXT)bad();compileContext(context,storeId)
 const parsed=projectOpeningBalanceSource(sourceText,cutoffDate),batches=context?.batches||[],body={id:openingBalanceBatchId(parsed.source,storeId),sequence:batches.length+1,previousHash:batches.at(-1)?.hash||null,sourceText,cutoffDate,partyMappings:structuredClone(partyMappings),customerRevision,supplierRevision,actor:structuredClone(actor),time}
 const batch={...body,hash:privateDraftDigest(body)},next={protocol:OPENING_BALANCE_CONTEXT,storeId,batches:[...structuredClone(batches),batch]};next.digest=privateDraftDigest(next);compileContext(next,storeId);return next
}
export function openingBalanceTimeline(context,side,totalRevision,storeId){
 if(!['receivable','payable'].includes(side))bad();count(totalRevision)
 const compiled=compileContext(context,storeId),revisionKey=sideRevision(side)
 if(compiled.some(row=>row.batch[revisionKey]>totalRevision))bad()
 const relevant=compiled.filter(row=>row.claims.some(claim=>claim.side===side)),cache=new Map(),contextStoreId=context?.storeId
 return {at(revision){
  count(revision);if(revision>totalRevision)bad()
  let index=-1;while(index+1<relevant.length&&relevant[index+1].batch[revisionKey]<=revision)index++
  if(!cache.has(index)){
   const active=relevant.slice(0,index+1),claims=Object.freeze(active.flatMap(row=>row.claims.filter(claim=>claim.side===side))),digest=active.length?privateDraftDigest({protocol:context?.protocol||OPENING_BALANCE_CONTEXT,storeId:contextStoreId,side,batches:active.map(row=>({id:row.batch.id,hash:row.batch.hash}))}):null
   cache.set(index,Object.freeze({side,digest,claims,credits:Object.freeze(claims.filter(claim=>claim.type==='credit'&&claim.outstandingCents>0))}))
  }
  return cache.get(index)
 }}
}
export function assertOpeningBalanceOrdinaryIds(active,documents=[]){
 const ids=new Set(documents.map(row=>row.id));if(active.claims.some(row=>ids.has(row.documentId)))bad()
}
export function assertOpeningBalanceParties(active,ids){if(active.claims.some(row=>!ids.has(row[partyField(active.side)])))bad()}
export function assertOpeningBalanceRequest(request,active,required,{history=false}={}){
 const present=Object.hasOwn(request,'expectedOpeningDigest'),legacyNull=history&&active.digest===null&&request.expectedOpeningDigest===null
 // A field explicitly set to null is still a new field to an older reader.
 // Never persist it without an active source. Preserve the exact requests
 // already accepted by the preceding draft when replaying their old history.
 if(present&&(!active.digest||request.expectedOpeningDigest!==active.digest)&&!legacyNull||required&&active.digest&&!present)throw Error('原單帳款已更新，請重新核對。')
}
export function syncOpeningBalanceProjection(state,active){
 if(state.opening===active)return
 const side=active.side,field=partyField(side),funds=side==='receivable'?state.receipts:state.payments
 for(const claim of active.claims)state.latestDay.set(claim[field],[(state.latestDay.get(claim[field])||''),claim.cutoffDate].sort().at(-1))
 for(const claim of active.credits){
  const event={id:claim.fundingId,action:'opening-credit',fundingKind:'opening-credit',date:claim.cutoffDate,[field]:claim[field],[side==='receivable'?'customerName':'supplierName']:claim.partyName,amount:claim.outstandingCents/100,method:'opening-credit',openingBatchId:claim.batchId,sourceRowKey:claim.key,sourceNumber:claim.number}
  const prior=funds.get(event.id)
  if(prior){if(!same(prior.event,event))bad()}
  else funds.set(event.id,{event,allocated:0,refunded:0,reversed:false})
 }
 state.opening=active
}
export function openingBalanceClaim(active,documentId,claimId,revision,partyId,date,credits){
 const claim=active.claims.find(row=>row.documentId===documentId&&row.claimId===claimId&&row.type==='invoice')
 if(!claim)return null
 if(claim[partyField(active.side)]!==partyId)throw Error(active.side==='receivable'?'只能抵付同一客戶的原單':'只能抵付同一供應商的原單')
 if(revision!==1)throw Error('原單版本不同，請重新核對。')
 if(date<claim.cutoffDate)throw Error('原單抵付日期不能早於切換日。')
 const key=canonicalSignature([documentId,claimId]),allocated=credits.get(key)||0
 if(!Number.isSafeInteger(allocated)||allocated<0||allocated>claim.outstandingCents)bad()
 return {claim,owedCents:claim.outstandingCents-allocated}
}
export function openingBalanceView(state){
 if(!state.opening?.digest)return {}
 const {side,digest,claims}=state.opening,field=partyField(side)
 const batches=new Map();for(const claim of claims){if(!batches.has(claim.batchId))batches.set(claim.batchId,[]);batches.get(claim.batchId).push(claim)}
 const openingJournals=[...batches].flatMap(([id,rows])=>openingBalancesToJournalEntries({id,cutoffDate:rows[0].cutoffDate},rows))
 return {openingDigest:digest,openingJournals,openingCutoffDates:[...new Set(claims.map(row=>row.cutoffDate))].sort(),openingClaims:claims.filter(row=>row.type==='invoice'&&row.outstandingCents>0).map(row=>{
  const allocated=state.credits.get(canonicalSignature([row.documentId,row.claimId]))||0
  if(!Number.isSafeInteger(allocated)||allocated<0||allocated>row.outstandingCents)bad()
  return {id:row.id,[field]:row[field],partyName:row.partyName,...(side==='receivable'?{documentId:row.documentId,deliveryId:row.claimId}:{purchaseId:row.documentId,invoiceId:row.claimId}),revision:1,number:row.number,date:row.date,dueDate:row.dueDate,cutoffDate:row.cutoffDate,currency:row.currency,amount:row.outstandingCents/100,allocated:allocated/100,owed:(row.outstandingCents-allocated)/100,openingBatchId:row.batchId,sourceRowKey:row.key}
 })}
}
