import {moneyValue} from '../../electron/operationRules.mjs'
import {cashMovementOriginal} from '../../electron/cashMovementDraft.mjs'
export const newCashMovementDraft=shiftId=>({shiftId,type:'in',amount:'',reason:'',submission:null})
export function cashMovementRequest(value){
 if(!value.submission)throw Error('請先核對原現金紀錄。')
 const amount=Number(value.amount);if(!value.amount.trim()||!value.reason.trim())throw Error('請填金額與現金進出原因。');moneyValue(amount,'現金流水',.01)
 return {id:value.submission.id,time:value.submission.time,shiftId:value.shiftId,type:value.type,amount,reason:value.reason,cashier:value.submission.cashier}
}
export function validCashMovementDraft(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='amount,reason,shiftId,submission,type'||!['in','out'].includes(value.type)||typeof value.shiftId!=='string'||!value.shiftId||value.shiftId.length>128||typeof value.amount!=='string'||value.amount.length>2000||typeof value.reason!=='string'||value.reason.length>4000)return false
 const s=value.submission;if(s===null)return true
 if(!s||typeof s!=='object'||Object.keys(s).sort().join(',')!=='cashier,id,time'||!/^cash-[-a-f0-9]{36}$/.test(s.id)||typeof s.time!=='string'||!Number.isFinite(Date.parse(s.time))||typeof s.cashier!=='string'||s.cashier.length>2000)return false
 try{cashMovementRequest(value);return true}catch{return false}
}
export const savedCashMovement=(value,rows)=>value.submission?cashMovementOriginal(cashMovementRequest(value),rows):null
