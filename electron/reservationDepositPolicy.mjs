import {draftObject,privateDraftDigest} from './privateDrafts.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {reservationDate,reservationMinutes,reservationAddDays} from './reservationCalendar.mjs'
import {reservationId,reservationInteger} from './reservationConfig.mjs'

export const RESERVATION_DEPOSIT_FEATURE='reservation-deposits-v1'
export const RESERVATION_DEPOSIT_FENCE='reservationDepositVersionFence'
export const RESERVATION_DEPOSIT_POLICY='pos-reservation-deposit-policy/v1'
export const RESERVATION_DEPOSIT_TERMS='pos-reservation-deposit-terms/v1'
export const MAX_DEPOSIT_CENTS=100000000000
export const depositError=code=>Object.assign(Error({POLICY:'請核對訂金條件與金額。',REVIEW:'請先核對這筆訂位的訂金條件，再確認訂位。',STALE:'訂金資料已更新，請重新核對。',SOURCE:'訂金原收款或可用餘額需要核對。',SHIFT:'現金訂金與退款需要目前開啟的班次。',RECOVERY:'訂金與原收款尚未找回，請先用完整備份核對復原。',MONEY:'訂金金額須為有效整數分，且不可超過原來源。'}[code]||'訂金原紀錄需要核對，請保留原編號。'),{code:'RESERVATION_DEPOSIT_'+code})
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),bad=()=>{throw depositError('POLICY')}
export function depositCents(value,{positive=false}={}){if(!Number.isSafeInteger(value)||value<(positive?1:0)||value>MAX_DEPOSIT_CENTS)throw depositError('MONEY');return value}
function basis(row){if(!['none','per-booking','per-guest'].includes(row.basis))bad();depositCents(row.amountCents);if(row.basis==='none'?row.amountCents!==0:row.amountCents===0)bad();return {basis:row.basis,amountCents:row.amountCents}}
export const defaultReservationDepositPolicy=()=>({enabled:false,currency:'TWD',basis:'none',amountCents:0,refund:'full-unused',rules:[]})
export function normalizeReservationDepositPolicy(value){
 draftObject(value,['enabled','currency','basis','amountCents','refund','rules']);if(typeof value.enabled!=='boolean'||value.currency!=='TWD'||value.refund!=='full-unused'||!Array.isArray(value.rules)||value.rules.length>100)bad();basis(value)
 const ids=new Set(),rules=value.rules.map(rule=>{
  draftObject(rule,['id','fromDate','toDate','weekdays','start','end','minParty','maxParty','channels','basis','amountCents']);reservationId(rule.id);if(ids.has(rule.id))bad();ids.add(rule.id)
  if(rule.fromDate!==null)reservationDate(rule.fromDate);if(rule.toDate!==null)reservationDate(rule.toDate);if(rule.fromDate&&rule.toDate&&rule.toDate<rule.fromDate)bad()
  const start=reservationMinutes(rule.start),end=reservationMinutes(rule.end,{end:true});if(start===end||!Array.isArray(rule.weekdays)||!rule.weekdays.length||rule.weekdays.length>7||new Set(rule.weekdays).size!==rule.weekdays.length||!Array.isArray(rule.channels)||!rule.channels.length||new Set(rule.channels).size!==rule.channels.length||rule.channels.some(channel=>!['phone','walkin','online'].includes(channel)))bad()
  for(const day of rule.weekdays)reservationInteger(day,0,6);reservationInteger(rule.minParty,1,100);reservationInteger(rule.maxParty,rule.minParty,100);basis(rule)
  return {...structuredClone(rule),weekdays:[...rule.weekdays].sort(),channels:[...rule.channels].sort()}
 })
 return {...structuredClone(value),rules}
}
export function makeReservationDepositPolicy(config,version){reservationInteger(version,1,Number.MAX_SAFE_INTEGER);const value={protocol:RESERVATION_DEPOSIT_POLICY,version,config:normalizeReservationDepositPolicy(config)};return {...value,hash:privateDraftDigest(value)}}
export function assertReservationDepositPolicy(policy){draftObject(policy,['protocol','version','config','hash']);if(!same(policy,makeReservationDepositPolicy(policy.config,policy.version)))bad();return policy}
function matchedRule(rule,booking){
 const start=reservationMinutes(rule.start),end=reservationMinutes(rule.end,{end:true}),slot=reservationMinutes(booking.slot),overnight=end<=start,anchor=overnight&&slot<end?reservationAddDays(booking.date,-1):booking.date
 const inTime=overnight?(slot>=start||slot<end):(slot>=start&&slot<end)
 return inTime&&(!rule.fromDate||anchor>=rule.fromDate)&&(!rule.toDate||anchor<=rule.toDate)&&rule.weekdays.includes(new Date(anchor+'T00:00:00Z').getUTCDay())&&booking.partySize>=rule.minParty&&booking.partySize<=rule.maxParty&&rule.channels.includes(booking.channel)
}
export function quoteReservationDeposit(policy,booking){
 assertReservationDepositPolicy(policy);reservationDate(booking.date);reservationMinutes(booking.slot);reservationInteger(booking.partySize,1,100);if(!['phone','walkin','online'].includes(booking.channel))bad()
 const config=policy.config,rule=config.enabled?config.rules.find(row=>matchedRule(row,booking)):null,selected=config.enabled?(rule||config):{basis:'none',amountCents:0},required=BigInt(selected.amountCents)*BigInt(selected.basis==='per-guest'?booking.partySize:selected.basis==='none'?0:1)
 if(required>BigInt(MAX_DEPOSIT_CENTS))throw depositError('MONEY')
 const value={protocol:RESERVATION_DEPOSIT_TERMS,policyVersion:policy.version,policyHash:policy.hash,currency:config.currency,date:booking.date,slot:booking.slot,partySize:booking.partySize,channel:booking.channel,ruleId:rule?.id||null,basis:selected.basis,unitCents:selected.amountCents,requiredCents:Number(required),refund:config.refund}
 return {...value,hash:privateDraftDigest(value)}
}
export function assertReservationDepositTerms(terms,policy){
 draftObject(terms,['protocol','policyVersion','policyHash','currency','date','slot','partySize','channel','ruleId','basis','unitCents','requiredCents','refund','hash'])
 if(!same(terms,quoteReservationDeposit(policy,terms)))bad();return terms
}
