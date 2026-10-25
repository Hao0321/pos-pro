import {MEMBER_PROFILE_FIELDS,memberProfileValues,normalMemberProfile,assertMemberProfileValues,memberProfileConflicts,memberPhoneMatches} from '../../electron/memberProfile.mjs'

export const newMemberProfileDraft=row=>({action:row?'update':'create',memberId:row?.id||'m'+crypto.randomUUID(),base:row?memberProfileValues(row):null,form:memberProfileValues(row),more:false,submission:null,duplicates:null})
export const memberProfileChanges=value=>{const desired=normalMemberProfile(value.form);return value.action==='create'?desired:Object.fromEntries(MEMBER_PROFILE_FIELDS.filter(key=>desired[key]!==value.base[key]).map(key=>[key,desired[key]]))}
export const hasMemberProfileInput=value=>!!value&&(!!value.submission||MEMBER_PROFILE_FIELDS.some(key=>value.form[key]!==memberProfileValues(value.base)[key]))
export function validMemberProfileDraft(value){
 if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='action,base,duplicates,form,memberId,more,submission'||!['create','update'].includes(value.action)||typeof value.memberId!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(value.memberId)||typeof value.more!=='boolean')return false
 try{assertMemberProfileValues(value.form,{dates:false});if(value.action==='create'){if(value.base!==null)return false}else assertMemberProfileValues(value.base)}catch{return false}
 if(value.duplicates!==null&&(!Array.isArray(value.duplicates)||value.duplicates.some(row=>!row||Object.keys(row).sort().join(',')!=='id,name,phone'||['id','name','phone'].some(key=>typeof row[key]!=='string'))))return false
 const s=value.submission;if(s===null)return true
 return !!s&&Object.keys(s).sort().join(',')==='id,time'&&/^member-profile-[-a-f0-9]{36}$/.test(s.id)&&Number.isFinite(Date.parse(s.time))
}
export function memberProfileInput(value,context){if(!value.submission)throw Error('請先核對這次會員保存結果。');return {...(value.action==='create'?{id:value.memberId}:{}),...memberProfileChanges(value),_memberProfile:{...value.submission,action:value.action,expected:value.base,duplicates:value.duplicates||[]},draftContext:context}}
export function memberProfileReview(value,rows){
 const row=rows.find(row=>row.id===value.memberId);if(value.action==='update'&&!row)throw Error('找不到原會員，原輸入仍保留。')
 const current=memberProfileValues(row),changes=memberProfileChanges(value),conflicts=value.action==='update'?memberProfileConflicts(value.base,changes,current):[],desired=value.action==='create'?changes:{...current,...changes}
 return {current,conflicts,duplicates:value.action==='create'||Object.hasOwn(changes,'phone')?memberPhoneMatches(rows,desired.phone,value.memberId):[]}
}
export function rebaseMemberProfile(value,row,choice){
 if(value.action!=='update'||!row)throw Error('找不到原會員，原輸入仍保留。');const current=memberProfileValues(row),changes=memberProfileChanges(value),conflicts=memberProfileConflicts(value.base,changes,current),form={...current}
 for(const key of Object.keys(changes))if(choice==='mine'||!conflicts.includes(key))form[key]=value.form[key]
 return {...value,base:current,form,submission:null,duplicates:null}
}
