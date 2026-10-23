import {privateDraftMappingInput,privateDraftDigest,draftObject} from './privateDrafts.mjs'
import {moneyValue,operationHeader,sameCommand} from './operationRules.mjs'
export const cashMovementFields=['id','time','shiftId','type','amount','reason','cashier']
export const isCashMovementDraft=input=>Object.hasOwn(input||{},'draftContext')
const changed=()=>Object.assign(Error('原班次已結束，請核對這筆現金要記在哪一班。'),{code:'CASH_MOVEMENT_SHIFT_CHANGED'})
export function cashMovementOriginal(input,rows){
 if(!Array.isArray(rows))throw Error('現金流水回覆不完整，請保留原輸入。')
 const row=rows.find(value=>value.id===input.id);if(!row)return null
 if(!sameCommand(row,input,cashMovementFields))throw Error('原現金紀錄內容不同，請保留輸入並核對。')
 moneyValue(row.amount,'現金流水',.01);return row
}
export function cashMovementShift(shifts,id){if(!Array.isArray(shifts)||shifts.filter(row=>row.status==='open').length!==1||!shifts.some(row=>row.id===id&&row.status==='open'))throw changed();return id}
export function admitCashMovement(input,current,{shifts,cashLog}){
 const data=privateDraftMappingInput(input,current);draftObject(data,cashMovementFields);operationHeader(data);moneyValue(data.amount,'現金流水',.01)
 if(!['in','out'].includes(data.type)||typeof data.shiftId!=='string'||!data.shiftId||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>4000||typeof data.cashier!=='string'||data.cashier.length>2000)throw Error('請填正確金額與現金進出原因。')
 const original=cashMovementOriginal(data,cashLog);if(!original)cashMovementShift(shifts,data.shiftId)
 return {data,original}
}
export function cashMovementRejection(input,error){return {success:false,committed:false,error:error.message,errorCode:'CASH_MOVEMENT_REJECTED',requestDigest:privateDraftDigest(input)}}
export function isCashMovementRejection(result,input){return result?.success===false&&result.committed===false&&result.errorCode==='CASH_MOVEMENT_REJECTED'&&result.requestDigest===privateDraftDigest(input)}
