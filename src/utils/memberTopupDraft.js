import {memberTopupMoney,memberTopupBasis,assertMemberTopupBasis,memberTopupOriginal} from '../../electron/memberTopupDraft.mjs'
export const newMemberTopupDraft=(member,shiftId='')=>({member:memberTopupBasis(member),shiftId,amount:'',bonus:'',payMethod:'cash',more:false,submission:null})
export function memberTopupRequest(value,context){
 if(!value.submission)throw Error('請先核對原儲值。')
 return {id:value.submission.id,time:value.submission.time,memberId:value.member.id,memberBasis:value.member,amount:memberTopupMoney(value.amount),bonus:memberTopupMoney(value.bonus,{optional:true}),payMethod:value.payMethod,cashier:value.submission.cashier,note:'',shiftId:value.shiftId,draftContext:context}
}
export function validMemberTopupDraft(value){try{
 if(!value||Object.keys(value).sort().join(',')!=='amount,bonus,member,more,payMethod,shiftId,submission'||['amount','bonus'].some(key=>typeof value[key]!=='string'||value[key].length>2000)||typeof value.shiftId!=='string'||value.shiftId.length>128||typeof value.more!=='boolean'||!['cash','card'].includes(value.payMethod))return false
 assertMemberTopupBasis(value.member);if(value.submission===null)return true
 const s=value.submission;if(!s||Object.keys(s).sort().join(',')!=='cashier,id,time'||!/^member-topup-[-a-f0-9]{36}$/.test(s.id)||typeof s.time!=='string'||!Number.isFinite(Date.parse(s.time))||typeof s.cashier!=='string'||s.cashier.length>2000)return false
 memberTopupRequest(value,null);return true
}catch{return false}}
export const savedMemberTopup=(value,rows)=>value.submission?memberTopupOriginal(memberTopupRequest(value,null),rows):null
export function memberTopupReview(value,facts){const current=facts.members.find(row=>row.id===value.member.id)||null,open=facts.shifts.filter(row=>row.status==='open'),shift=open.length===1?open[0]:null;return {current,shift,memberChanged:!current||JSON.stringify(memberTopupBasis(current))!==JSON.stringify(value.member),shiftChanged:!shift||shift.id!==value.shiftId}}
