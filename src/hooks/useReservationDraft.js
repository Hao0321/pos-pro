import useWorkspaceDraft from './useWorkspaceDraft'
import {getReservationState} from '../utils/dataAccess'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {assertReservationResult} from '../../electron/reservationHistory.mjs'
import {draftObject} from '../../electron/privateDrafts.mjs'
import {hashGuestCapability} from '../../electron/reservationService.mjs'
import {reviewedReservationDepositFields,validateReservationDepositReview} from '../utils/reservationDepositReview.mjs'
import {reservationDepositFormFields,validateReservationDepositForm} from '../utils/reservationDepositForms.mjs'

export function reservationDraftFields(value){
 if(['deposit-policy','deposit-receive','deposit-refund'].includes(value.action))return reservationDepositFormFields(value)
 if(value.action==='access')return {bookingId:value.bookingId,expectedBookingRevision:value.bookingRevision,accessHash:hashGuestCapability(value.token),reason:value.reason}
 if(value.config)return {config:value.config}
 if(['move','promote','status'].includes(value.action))return {bookingId:value.bookingId,expectedBookingRevision:value.bookingRevision,reason:value.reason.trim(),...(value.action==='status'?{status:value.status}:{date:value.date,slot:value.slot,partySize:Number(value.partySize),tableIds:[],...reviewedReservationDepositFields(value)})}
 return {date:value.date,slot:value.slot,partySize:Number(value.partySize),customer:{name:value.name.trim(),contact:value.contact.trim()},channel:'phone',tableIds:[],note:value.note.trim(),...reviewedReservationDepositFields(value)}
}
export function validateReservationDraft(value){
 if(['deposit-policy','deposit-receive','deposit-refund'].includes(value?.action))return validateReservationDepositForm(value)
 if(value?.action==='access')try{draftObject(value,['id','action','bookingId','bookingRevision','token','reason']);return /^reservation-[-a-z0-9]+$/.test(value.id)&&/^booking-[a-f0-9]{48}$/.test(value.bookingId)&&Number.isSafeInteger(value.bookingRevision)&&value.bookingRevision>0&&/^[a-f0-9]{64}$/.test(value.token)&&typeof value.reason==='string'&&value.reason.length<=500}catch{return false}
 try{
  const changing=['move','promote','status'].includes(value?.action),keys=value?.config?['id','action','config','configVersion']:changing?['id','action','bookingId','bookingRevision','reason',...(value.action==='status'?['status']:['date','slot','partySize'])]:['id','action','date','slot','partySize','name','contact','note'],deposit=Object.hasOwn(value||{},'deposit')
  draftObject(value,[...keys,...(deposit?['deposit']:[])]);if(typeof value.id!=='string'||!/^reservation-[-a-z0-9]+$/.test(value.id)||deposit&&(!['book','promote'].includes(value.action)||!validateReservationDepositReview(value.deposit)))return false
  if(value.config)return value.action==='configure'&&Number.isSafeInteger(value.configVersion)&&value.configVersion>=0&&!!value.config&&Array.isArray(value.config.tables)&&Array.isArray(value.config.weekly)
  if(changing)return /^booking-[a-f0-9]{48}$/.test(value.bookingId)&&Number.isSafeInteger(value.bookingRevision)&&value.bookingRevision>0&&typeof value.reason==='string'&&value.reason.length<=500&&(value.action==='status'?['cancelled','no-show'].includes(value.status):['date','slot','partySize'].every(key=>typeof value[key]==='string'&&value[key].length<=1000))
  return ['book','waitlist'].includes(value.action)&&['date','slot','partySize','name','contact','note'].every(key=>typeof value[key]==='string'&&value[key].length<=1000)
 }catch{return false}
}
export function assertReservationDraftResult(source,result,actor){
 const receipt=result?.receipt,input=receipt?.event?.input,fields=reservationDraftFields(source)
 if(receipt?.id!==source.id||input?.action!==source.action||actor&&(receipt.event.actor.userId!==actor.userId||receipt.event.actor.role!==actor.role)||Object.keys(fields).some(key=>canonicalSignature(input[key])!==canonicalSignature(fields[key]))||['deposit-receive','deposit-refund'].includes(source.action)&&receipt.event.change.deposit?.method!==source.method)throw Error('訂位紀錄或保存回執需要核對，請保留原編號。')
 return result
}
export default function useReservationDraft({kind,session,value,hasContent,onRestore,onSaved}){
 const validate=source=>validateReservationDraft(source)&&(!kind.startsWith('reservation-change:')||kind==='reservation-change:'+(source.action==='status'?source.status:source.action)+':'+source.bookingId)&&(!kind.startsWith('reservation-deposit:')||kind==='reservation-deposit:'+source.action.slice(8)+':'+source.bookingId)&&(kind!=='reservation-deposit-policy'||source.action==='deposit-policy')
 return useWorkspaceDraft({kind,session,state:value,hasContent,validate,onRestore:source=>onRestore(source),onOriginal:(result,source)=>onSaved(result,source),findOriginal:async(source,{context})=>{
  const state=await getReservationState(session),receipt=state.entries.find(row=>row.id===source.id);if(!receipt)return null
  const input=receipt.event.input,fields=reservationDraftFields(source)
  if(input.storeId!==context.storeId||receipt.event.actor.userId!==context.userId||receipt.event.actor.role!==context.role||input.action!==source.action||Object.keys(fields).some(key=>canonicalSignature(input[key])!==canonicalSignature(fields[key]))||['deposit-receive','deposit-refund'].includes(source.action)&&receipt.event.change.deposit?.method!==source.method)throw Error('訂位紀錄或保存回執需要核對，請保留原編號。')
  return assertReservationResult(input,{success:true,storeId:state.storeId,epoch:state.epoch,receipt,state})
 }})
}
