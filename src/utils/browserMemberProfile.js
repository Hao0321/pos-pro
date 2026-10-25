import {readRecords,writeRecords,withSalesLock,RECORD_KEY} from './browserStorage'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {updateBrowserSettings} from '../../electron/settingEncoding.mjs'
import * as model from '../../electron/memberProfile.mjs'
const context=(record,actor)=>privateDraftContext(readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId'),record.salesEpoch,actor,record.data.pos_users)
export function commitBrowserMemberProfile(action,memberId,input,actor){return withSalesLock(()=>{
 let admitted=false,writing=false,beforeRaw=null,lookup=null
 try{
  const record=readRecords(),current=context(record,actor),journal=model.readMemberProfileJournal(readExchangeTextSetting(record.data.pos_business_settings,model.MEMBER_PROFILE_JOURNAL)),rows=record.data.pos2_members,checked=model.admitMemberProfile(action,memberId,input,current,rows,journal)
  if(checked.original)return {success:true,member:rows.find(row=>row.id===memberId)||null,receipt:journal.entries.find(row=>row.id===checked.request.id),alreadySaved:true}
  admitted=true;const member=action==='create'?{...checked.data,id:memberId,points:0,totalSpent:0,tier:'normal',balance:0,joinDate:new Date().toISOString().slice(0,10),lastBirthdayBonus:''}:{...rows.find(row=>row.id===memberId),...checked.data},members=action==='create'?[...rows,member]:rows.map(row=>row.id===memberId?member:row),receipt=model.memberProfileReceipt(checked.request,current),settings=updateBrowserSettings(record.data.pos_business_settings,{[model.MEMBER_PROFILE_JOURNAL]:JSON.stringify(JSON.stringify({version:1,entries:[...journal.entries,receipt]}))})
  lookup={id:receipt.id,digest:receipt.digest};beforeRaw=localStorage.getItem(RECORD_KEY);writing=true;writeRecords({pos2_members:members,pos_business_settings:settings},record.revision)
  return {success:true,member,receipt}
 }catch(error){
  if(writing&&localStorage.getItem(RECORD_KEY)!==beforeRaw){try{const record=readRecords(),current=context(record,actor),journal=model.readMemberProfileJournal(readExchangeTextSetting(record.data.pos_business_settings,model.MEMBER_PROFILE_JOURNAL));if(model.memberProfileOriginal(lookup,current,journal).status==='matched')return {success:true,member:record.data.pos2_members.find(row=>row.id===memberId)||null,receipt:journal.entries.find(row=>row.id===lookup.id)}}catch{}return {success:false,committed:null,error:'會員保存紀錄需要核對，請保留原輸入。'}}
  if(admitted||error.code==='MEMBER_PROFILE_REVIEW_CHANGED')return model.memberProfileRejection(action,memberId,input,error);throw error
 }
})}
