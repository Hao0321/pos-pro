import useWorkspaceDraft from './useWorkspaceDraft'
import {getReservationState} from '../utils/dataAccess'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {assertReservationResult} from '../../electron/reservationHistory.mjs'
import {draftObject} from '../../electron/privateDrafts.mjs'
import {hashGuestCapability} from '../../electron/reservationService.mjs'

export function reservationDraftFields(value){return value.action==='access'?{bookingId:value.bookingId,expectedBookingRevision:value.bookingRevision,accessHash:hashGuestCapability(value.token),reason:value.reason}:value.config?{config:value.config}:{date:value.date,slot:value.slot,partySize:Number(value.partySize),customer:{name:value.name.trim(),contact:value.contact.trim()},channel:'phone',tableIds:[],note:value.note.trim()}}
export function validateReservationDraft(value){
 if(value?.action==='access')try{draftObject(value,['id','action','bookingId','bookingRevision','token','reason']);return /^reservation-[-a-z0-9]+$/.test(value.id)&&/^booking-[a-f0-9]{48}$/.test(value.bookingId)&&Number.isSafeInteger(value.bookingRevision)&&value.bookingRevision>0&&/^[a-f0-9]{64}$/.test(value.token)&&typeof value.reason==='string'&&value.reason.length<=500}catch{return false}
 try{const keys=value?.config?['id','action','config','configVersion']:['id','action','date','slot','partySize','name','contact','note'];draftObject(value,keys);if(typeof value.id!=='string'||!/^reservation-[-a-z0-9]+$/.test(value.id))return false;if(value.config)return value.action==='configure'&&Number.isSafeInteger(value.configVersion)&&value.configVersion>=0&&!!value.config&&Array.isArray(value.config.tables)&&Array.isArray(value.config.weekly);return ['book','waitlist'].includes(value.action)&&['date','slot','partySize','name','contact','note'].every(key=>typeof value[key]==='string'&&value[key].length<=1000)}catch{return false}
}
export default function useReservationDraft({kind,session,value,hasContent,onRestore,onSaved}){
 return useWorkspaceDraft({kind,session,state:value,hasContent,validate:validateReservationDraft,onRestore:source=>onRestore(source),onOriginal:(result,source)=>onSaved(result,source),findOriginal:async(source,{context})=>{
  const state=await getReservationState(session),receipt=state.entries.find(row=>row.id===source.id);if(!receipt)return null
  const input=receipt.event.input,fields=reservationDraftFields(source)
  if(input.storeId!==context.storeId||receipt.event.actor.userId!==context.userId||input.action!==source.action||Object.keys(fields).some(key=>canonicalSignature(input[key])!==canonicalSignature(fields[key])))throw Error('訂位紀錄或保存回執需要核對，請保留原編號。')
  return assertReservationResult(input,{success:true,storeId:state.storeId,epoch:state.epoch,receipt,state})
 }})
}
