import {draftObject,privateDraftDigest,assertPrivateDraftContext} from './privateDrafts.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {businessId} from './businessExchange.mjs'
import {projectOpeningBalanceSource,projectOpeningBalanceTables} from './openingBalanceSource.mjs'
import {readFinancialFileSource} from './financialFileSource.mjs'
import {decimalUnits} from './decimalUnits.mjs'
import {parseAgentDocument} from './agentHandoff.mjs'
import {MIGRATION_BATCH_PROTOCOL} from './migrationBatchDraft.mjs'
import {projectMigrationBatchSource} from './migrationBatchSource.mjs'

// Source/receipt proof. Raw v3 sources are re-read through the same bounded
// decoder. This is not a write authority; the full book also checks linked
// master, cost and activation records before exposing the context.
export const OPENING_CUTOVER_PROTOCOL='pos-opening-migration/v2'
export const OPENING_CUTOVER_RECEIPT='pos-opening-migration-receipt/v2'
export const OPENING_CUTOVER_FEATURE='opening-cutover-v1'
export const OPENING_CUTOVER_FENCE='openingCutoverVersionFence'
export const OPENING_CUTOVER_HEAD='openingCutoverHead'
export const OPENING_CUTOVER_ACTION='AGENT_OPENING_CUTOVER'
export const OPENING_CUTOVER_MASTER='pos-opening-master-migration/v2'
export const OPENING_RAW_CUTOVER_PROTOCOL='pos-opening-migration/v3'
export const OPENING_RAW_CUTOVER_RECEIPT='pos-opening-migration-receipt/v3'
export const OPENING_RAW_CUTOVER_MASTER='pos-opening-master-migration/v3'
export const isOpeningCutoverProtocol=protocol=>[OPENING_CUTOVER_PROTOCOL,OPENING_RAW_CUTOVER_PROTOCOL].includes(protocol)
export const isOpeningCutoverMaster=protocol=>[OPENING_CUTOVER_MASTER,OPENING_RAW_CUTOVER_MASTER].includes(protocol)
export const OPENING_CUTOVER_CONTEXT='pos-opening-balance-context/v2'
export const OPENING_ACTIVATION='opening-import'
export const cutoverError=()=>Error('整批搬家來源、帳款或保存回執需要核對，請保留原編號。')
const bad=()=>{throw cutoverError()},same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const requestFields=['protocol','id','sourceText','cutoffDate','currency','scope','masterChoices','partyChoices','declaredTotals','review']
const receiptFields=['protocol','success','id','signature','sourceDigest','sequence','previousHash','source','cutoffDate','rows','totalValueCents','clearingAccount','masterId','stockReceipt','bootstrapId','partyMappings','customerCreates','supplierCreates','customerRevision','supplierRevision','customerBarrierId','supplierBarrierId','priorCustomerDigest','priorSupplierDigest','custodyDigest','actor','time','hash']
const text=(value,max=100)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\p{Cc}\p{Cf}]/u.test(value))bad();return value}
const digest=value=>{if(value!==null&&(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)))bad()}
const totalMessages={receivableInvoices:'客戶未收款合計與原單明細不同，請核對。',receivableCredits:'客戶貸項合計與原單明細不同，請核對。',payableInvoices:'供應商未付款合計與原單明細不同，請核對。',payableCredits:'供應商貸項合計與原單明細不同，請核對。'}
export const openingCutoverId=(source,scope)=>'opening2-'+privateDraftDigest([scope.storeId,source.source.system,source.source.company,source.id]).slice(0,48)
export const openingCutoverSourceDigest=input=>privateDraftDigest({...input,review:undefined})
export const openingBarrierId=(id,side)=>'opening-activation-'+(side==='receivable'?'ar-':'ap-')+privateDraftDigest([id,side]).slice(0,40)
export function readOpeningCutoverFacts(input){
 draftObject(input,requestFields,requestFields.filter(key=>key!=='review'));assertPrivateDraftContext(input.scope)
 if(!isOpeningCutoverProtocol(input.protocol)||!['','TWD'].includes(input.currency)||input.scope.role!=='owner'||!Array.isArray(input.masterChoices)||input.masterChoices.length>5000||!Array.isArray(input.partyChoices)||input.partyChoices.length>5000)bad()
 const raw=input.protocol===OPENING_RAW_CUTOVER_PROTOCOL?parseAgentDocument(input.sourceText,{maxBytes:250000}):null,batch=raw?.protocol===MIGRATION_BATCH_PROTOCOL
 const parsed=raw?projectOpeningBalanceTables(batch?projectMigrationBatchSource(raw,input.currency):readFinancialFileSource(input.sourceText,input.currency),input.cutoffDate,{allowEmpty:batch}):projectOpeningBalanceSource(input.sourceText,input.cutoffDate)
 if(parsed.otherEntities.length||input.id!==openingCutoverId(parsed.source,input.scope))bad()
 draftObject(input.declaredTotals,['stockValue','receivableInvoices','receivableCredits','payableInvoices','payableCredits'],[])
 const totals={receivableInvoices:parsed.totals.receivable.invoiceCents,receivableCredits:parsed.totals.receivable.creditCents,payableInvoices:parsed.totals.payable.invoiceCents,payableCredits:parsed.totals.payable.creditCents}
 for(const [key,value]of Object.entries(input.declaredTotals)){
  if(typeof value!=='string')bad()
  if(value!==''){
   let cents;try{cents=decimalUnits(value,2,Number.MAX_SAFE_INTEGER,'原報表合計需要核對。')}catch{const error=Error('原報表合計需為非負金額，最多兩位小數。');error.cutoverTotalKey=key;throw error}
   if(Object.hasOwn(totals,key)&&cents!==totals[key]){const error=Error(totalMessages[key]);error.cutoverTotalKey=key;throw error}
  }
 }
 const seen=new Set()
 for(const choice of input.masterChoices){draftObject(choice,['table','row','targetId','resolution'],['table','row','targetId']);const key=choice.table+':'+choice.row;if(!Number.isSafeInteger(choice.table)||!Number.isSafeInteger(choice.row)||!['products','customers','suppliers'].includes(parsed.source.tables[choice.table]?.entity)||!parsed.source.tables[choice.table]?.rows[choice.row]||seen.has(key)||typeof choice.targetId!=='string'||choice.targetId.length>128||choice.resolution!==undefined&&!['keep','source'].includes(choice.resolution))bad();seen.add(key)}
 seen.clear()
 for(const choice of input.partyChoices){draftObject(choice,['key','action','targetId','expectedName'],['key','action']);if(seen.has(choice.key)||!parsed.parties.some(row=>row.key===choice.key)||!['new','existing'].includes(choice.action))bad();seen.add(choice.key);if(choice.action==='existing'){businessId(choice.targetId);text(choice.expectedName)}else if(Object.hasOwn(choice,'targetId')||Object.hasOwn(choice,'expectedName'))bad()}
 return parsed
}
export function readOpeningCutoverProof(receipt,storeId){
 draftObject(receipt,receiptFields)
 const {hash,...body}=receipt,input=JSON.parse(receipt.signature),parsed=readOpeningCutoverFacts(input)
 if(receipt.protocol!==(input.protocol===OPENING_RAW_CUTOVER_PROTOCOL?OPENING_RAW_CUTOVER_RECEIPT:OPENING_CUTOVER_RECEIPT)||receipt.success!==true||hash!==privateDraftDigest(body)||receipt.id!==input.id||receipt.signature!==canonicalSignature(input)||receipt.sourceDigest!==openingCutoverSourceDigest(input)||storeId!==input.scope.storeId||receipt.actor?.role!=='owner'||receipt.actor.userId!==input.scope.userId||!same(receipt.source,parsed.source.source)||receipt.cutoffDate!==input.cutoffDate||receipt.clearingAccount!=='3902')bad()
 draftObject(receipt.actor,['userId','username','role']);businessId(receipt.actor.userId);text(receipt.actor.username)
 if(!Number.isSafeInteger(receipt.sequence)||receipt.sequence<1||!Number.isSafeInteger(receipt.customerRevision)||receipt.customerRevision<1||!Number.isSafeInteger(receipt.supplierRevision)||receipt.supplierRevision<1||!Array.isArray(receipt.rows)||receipt.rows.length>5000||!Number.isSafeInteger(receipt.totalValueCents)||receipt.totalValueCents<0)bad()
 for(const value of [receipt.previousHash,receipt.priorCustomerDigest,receipt.priorSupplierDigest])digest(value)
 for(const value of [hash,receipt.custodyDigest])if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))bad()
 if(new Date(receipt.time).toISOString()!==receipt.time||receipt.cutoffDate>new Date(Date.parse(receipt.time)+14*3600000).toISOString().slice(0,10))bad()
 if(receipt.customerBarrierId!==openingBarrierId(receipt.id,'receivable')||receipt.supplierBarrierId!==openingBarrierId(receipt.id,'payable'))bad()
 const review=input.review
 draftObject(review,['protocol','createdAt','scope','inputDigest','dataDigest','planDigest','trialDigest'])
 if(review.protocol!=='pos-opening-cutover-review/v1'||!same(review.scope,input.scope)||review.inputDigest!==openingCutoverSourceDigest(input)||!Number.isFinite(review.createdAt)||Date.parse(receipt.time)-review.createdAt>900000||review.createdAt>Date.parse(receipt.time)+5000)bad()
 for(const key of ['dataDigest','planDigest','trialDigest'])if(typeof review[key]!=='string'||!/^[a-f0-9]{64}$/.test(review[key]))bad()
 if(!Array.isArray(receipt.partyMappings)||receipt.partyMappings.length!==parsed.parties.length||!Array.isArray(receipt.customerCreates)||!Array.isArray(receipt.supplierCreates))bad()
 const keys=new Set(),targets=new Set()
 for(const row of receipt.partyMappings){draftObject(row,['key','side','externalId','targetId','targetName']);businessId(row.targetId);text(row.targetName);if(keys.has(row.key)||!parsed.parties.some(p=>p.key===row.key&&p.side===row.side&&p.externalId===row.externalId)||targets.has(canonicalSignature([row.side,row.targetId])))bad();keys.add(row.key);targets.add(canonicalSignature([row.side,row.targetId]))}
 return {input,parsed,batch:{...receipt,sourceText:input.sourceText}}
}
export function openingActivationRequest(receipt,side,scope){
 const receivable=side==='receivable',prior=receivable?receipt.priorCustomerDigest:receipt.priorSupplierDigest
 return {id:receivable?receipt.customerBarrierId:receipt.supplierBarrierId,kind:receivable?'customer-ledger':'supplier-ledger',action:OPENING_ACTIVATION,storeId:scope.storeId,epoch:scope.epoch,time:receipt.time,date:receipt.cutoffDate,expectedRevision:(receivable?receipt.customerRevision:receipt.supplierRevision)-1,openingBatchId:receipt.id,sourceDigest:receipt.sourceDigest,reviewed:true,...(prior?{expectedOpeningDigest:prior}:{})}
}
