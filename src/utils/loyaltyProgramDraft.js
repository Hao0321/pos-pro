import {loyaltyRules} from '../../electron/loyaltyProgram.mjs'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
export const loyaltyForm=program=>Object.fromEntries(['earn','redeem','birthdayBonus'].map(key=>[key,String(program[key])]))
export function loyaltyFormProgram(form){if(['earn','redeem','birthdayBonus'].some(key=>typeof form[key]!=='string'||!form[key].trim()))throw Error('請填完整數字，原輸入會保留。');try{return loyaltyRules(Object.fromEntries(Object.entries(form).map(([key,value])=>[key,Number(value)])))}catch{throw Error('集點門檻與每點金額需大於0，生日贈點需為零或正整數。')}}
export function validLoyaltyProgramDraft(value,context){
 if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='form,submission'||!value.form||Object.keys(value.form).sort().join(',')!=='birthdayBonus,earn,redeem'||Object.values(value.form).some(row=>typeof row!=='string'||row.length>2000))return false
 const s=value.submission;if(s===null)return true;if(!s||Object.keys(s).sort().join(',')!=='id,quote,time'||!/^loyalty-program-[-a-f0-9]{36}$/.test(s.id)||!Number.isFinite(Date.parse(s.time)))return false
 try{const {digest,...body}=s.quote;return s.quote.protocol==='pos-loyalty-program-preview/v1'&&digest===privateDraftDigest(body)&&privateDraftDigest(s.quote.context)===privateDraftDigest(context)&&privateDraftDigest(loyaltyFormProgram(value.form))===privateDraftDigest(s.quote.program)}catch{return false}
}
