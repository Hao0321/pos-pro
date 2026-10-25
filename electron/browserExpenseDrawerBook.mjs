import {DRAWER_JOURNAL,readDrawerJournal,validateDrawerBook,planDrawerOperation} from './expenseDrawer.mjs'
import {readExchangeTextSetting} from './businessExchange.mjs'
import {updateBrowserSettings} from './settingEncoding.mjs'
import {privateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
export const drawerFacts=data=>({manualEntries:data.pos2_manual_j,cashLog:data.pos2_cash_log,shifts:data.pos2_shifts,orders:data.pos2_orders,topups:data.pos2_topups})
export const drawerJournal=data=>readDrawerJournal(readExchangeTextSetting(data.pos_business_settings,DRAWER_JOURNAL))
export function validateBrowserDrawer(data){const marked=data.pos_business_settings.some(row=>row.key===DRAWER_JOURNAL);validateDrawerBook(drawerJournal(data),drawerFacts(data));return marked}
export function appendBrowserDrawer(record,{input,actor}){
 const context=privateDraftContext(readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId'),record.salesEpoch,actor,record.data.pos_users),plan=planDrawerOperation(input,context,drawerJournal(record.data),drawerFacts(record.data),actor)
 if(plan.original)throw Error('原支出已保存，請核對原編號。')
 return {plan,updates:{pos2_manual_j:[plan.entry,...record.data.pos2_manual_j],pos2_cash_log:[plan.cash,...record.data.pos2_cash_log],pos_business_settings:updateBrowserSettings(record.data.pos_business_settings,{[DRAWER_JOURNAL]:JSON.stringify(JSON.stringify(plan.journal))})}}
}
export function guardBrowserDrawer(before,after){
 const a=before.pos_business_settings.find(row=>row.key===DRAWER_JOURNAL)||null,b=after.pos_business_settings.find(row=>row.key===DRAWER_JOURNAL)||null
 if(privateDraftDigest(a)!==privateDraftDigest(b))throw Error('抽屜支出紀錄由正式支出與退回流程保存。')
}
