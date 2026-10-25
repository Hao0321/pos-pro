import {readRecords,writeRecords,withSalesLock,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {admitMemberTopup,memberTopupTotals} from '../../electron/memberTopupDraft.mjs'
export function commitBrowserMemberTopup(input,actor){return withSalesLock(()=>{
 let writing=false,beforeRaw=null
 try{
  const record=readRecords(),context=privateDraftContext(readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId'),record.salesEpoch,actor,record.data.pos_users),checked=admitMemberTopup(input,context,{members:record.data.pos2_members,topups:record.data.pos2_topups,shifts:record.data.pos2_shifts},actor),member=record.data.pos2_members.find(row=>row.id===input.memberId)||null
  assertOriginalOperationAvailable('addTopup',input.id,record,checked.data)
  if(checked.original)return {success:true,topup:checked.original,member}
  const next={...member,balance:memberTopupTotals(member.balance||0,checked.data.amount,checked.data.bonus).balance};beforeRaw=localStorage.getItem(RECORD_KEY);writing=true
  writeRecords({pos2_topups:[checked.data,...record.data.pos2_topups],pos2_members:record.data.pos2_members.map(row=>row.id===next.id?next:row)},record.revision)
  return {success:true,member:next,topup:checked.data}
 }catch(error){if(writing)return {success:false,committed:localStorage.getItem(RECORD_KEY)===beforeRaw?false:null,error:error.message};if(error.code==='MEMBER_TOPUP_REVIEW_CHANGED')return {success:false,committed:false,error:error.message};throw error}
})}
