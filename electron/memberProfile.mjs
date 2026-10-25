import {draftObject,privateDraftDigest,privateDraftMappingInput} from './privateDrafts.mjs'
import {operationHeader} from './operationRules.mjs'

export const MEMBER_PROFILE_JOURNAL='memberProfileJournalV1'
export const MEMBER_PROFILE_FIELDS=['name','phone','birthday','note']
const invalid=()=>Error('會員保存紀錄需要核對，請保留原輸入。')
const identifier=value=>typeof value==='string'&&/^[-A-Za-z0-9_:]{1,128}$/.test(value)
export const isMemberProfile=input=>Object.hasOwn(input||{},'_memberProfile')
export const memberProfileValues=row=>Object.fromEntries(MEMBER_PROFILE_FIELDS.map(key=>[key,row?.[key]??'']))
export const memberPhoneKey=value=>String(value??'').normalize('NFKC').replace(/[\s().-]/g,'').toLocaleLowerCase('en-US')
export function assertMemberProfileValues(value,{partial=false,required=false,dates=true}={}){
 draftObject(value,MEMBER_PROFILE_FIELDS,partial?[]:MEMBER_PROFILE_FIELDS)
 if(Object.values(value).some(text=>typeof text!=='string'||text.length>2000))throw invalid()
 if(required&&(['name','phone'].some(key=>Object.hasOwn(value,key)&&!value[key].trim())||!partial&&(!value.name.trim()||!memberPhoneKey(value.phone))))throw Error('請填姓名與手機號碼，原輸入會保留。')
 if(dates&&value.birthday){const match=value.birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/),date=new Date(value.birthday+'T00:00:00.000Z');if(!match||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value.birthday)throw Error('生日日期需要核對，原輸入會保留。')}
 return value
}
export function normalMemberProfile(form){assertMemberProfileValues(form);return assertMemberProfileValues({...form,name:form.name.trim(),phone:form.phone.trim()},{required:true})}
export function memberPhoneMatches(rows,phone,excludeId=''){
 const key=memberPhoneKey(phone);if(!key)return []
 return rows.filter(row=>row.id!==excludeId&&memberPhoneKey(row.phone)===key).map(row=>({id:row.id,name:row.name??'',phone:row.phone??''})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
}
function assertMatches(rows){
 if(!Array.isArray(rows))throw invalid();let previous=''
 for(const row of rows){draftObject(row,['id','name','phone']);if(!identifier(row.id)||row.id<=previous||typeof row.name!=='string'||typeof row.phone!=='string'||row.name.length>2000||row.phone.length>2000)throw invalid();previous=row.id}
}
export function memberProfileRequest(action,memberId,input,current){
 if(!['create','update'].includes(action)||!identifier(memberId)||!Object.hasOwn(input||{},'draftContext'))throw invalid()
 const body=privateDraftMappingInput(input,current),meta=body._memberProfile
 draftObject(body,[...MEMBER_PROFILE_FIELDS,'_memberProfile',...(action==='create'?['id']:[])],['_memberProfile',...(action==='create'?['id',...MEMBER_PROFILE_FIELDS]:[])])
 draftObject(meta,['id','time','action','expected','duplicates']);operationHeader(meta)
 if(!/^member-profile-[-a-f0-9]{36}$/.test(meta.id)||meta.action!==action||action==='create'&&body.id!==memberId)throw invalid()
 if(action==='create'){if(meta.expected!==null)throw invalid()}else assertMemberProfileValues(meta.expected)
 assertMatches(meta.duplicates)
 const changes=Object.fromEntries(MEMBER_PROFILE_FIELDS.filter(key=>Object.hasOwn(body,key)).map(key=>[key,body[key]]));assertMemberProfileValues(changes,{partial:action==='update',required:true})
 if(!Object.keys(changes).length)throw Error('沒有需要保存的修改。')
 return {id:meta.id,time:meta.time,action,memberId,expected:meta.expected,changes,duplicates:meta.duplicates,draftContext:input.draftContext}
}
export function readMemberProfileJournal(raw){
 const journal=raw==null?{version:1,entries:[]}:typeof raw==='string'?JSON.parse(raw):raw;draftObject(journal,['version','entries']);if(journal.version!==1||!Array.isArray(journal.entries))throw invalid()
 const ids=new Set();for(const row of journal.entries){draftObject(row,['id','time','action','memberId','storeId','epoch','userId','role','digest']);if(!/^member-profile-[-a-f0-9]{36}$/.test(row.id)||ids.has(row.id)||!Number.isFinite(Date.parse(row.time))||!['create','update'].includes(row.action)||!['owner','staff'].includes(row.role)||!['memberId','storeId','epoch','userId'].every(key=>identifier(row[key]))||typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest))throw invalid();ids.add(row.id)}return journal
}
export function memberProfileOriginal(input,current,journal){
 const row=journal.entries.find(row=>row.id===input.id);if(!row)return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}
 if(['storeId','epoch','userId','role'].some(key=>row[key]!==current[key])||row.digest!==input.digest)throw Error('原會員保存編號內容不同，請保留輸入並核對。')
 return {protocol:'pos-private-draft-original/v1',status:'matched',id:row.id,digest:row.digest,action:row.action,entryId:row.memberId}
}
export const memberProfileConflicts=(expected,changes,current)=>Object.keys(changes).filter(key=>current[key]!==expected[key]&&current[key]!==changes[key])
export function admitMemberProfile(action,memberId,input,current,rows,journal){
 const request=memberProfileRequest(action,memberId,input,current),original=memberProfileOriginal({id:request.id,digest:privateDraftDigest(request)},current,journal)
 if(original.status==='matched')return {request,original}
 const row=rows.find(row=>row.id===memberId)
 if(action==='create'&&row||action==='update'&&(!row||memberProfileConflicts(request.expected,request.changes,memberProfileValues(row)).length))throw Object.assign(Error('會員資料已更新，請先核對差異。'),{code:'MEMBER_PROFILE_REVIEW_CHANGED'})
 const desired=action==='create'?request.changes:{...memberProfileValues(row),...request.changes};assertMemberProfileValues(desired,{required:true})
 const duplicates=action==='create'||Object.hasOwn(request.changes,'phone')?memberPhoneMatches(rows,desired.phone,memberId):[]
 if(privateDraftDigest(duplicates)!==privateDraftDigest(request.duplicates))throw Object.assign(Error('相同手機的會員已更新，請再核對。'),{code:'MEMBER_PROFILE_REVIEW_CHANGED'})
 return {request,original:null,data:request.changes}
}
export const memberProfileReceipt=(request,current)=>({id:request.id,time:request.time,action:request.action,memberId:request.memberId,storeId:current.storeId,epoch:current.epoch,userId:current.userId,role:current.role,digest:privateDraftDigest(request)})
export const memberProfileRejection=(action,memberId,input,error)=>({success:false,committed:false,error:error.message,errorCode:'MEMBER_PROFILE_REJECTED',requestDigest:privateDraftDigest([action,memberId,input])})
export const isMemberProfileRejection=(result,action,memberId,input)=>result?.success===false&&result.committed===false&&result.errorCode==='MEMBER_PROFILE_REJECTED'&&result.requestDigest===privateDraftDigest([action,memberId,input])
