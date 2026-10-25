import {readRecords,writeRecords,withSalesLock,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {browserCartContext} from './browserHeldCart'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import * as model from '../../electron/expenseDrawer.mjs'
export const browserDrawerFacts=record=>({manualEntries:record.data.pos2_manual_j,cashLog:record.data.pos2_cash_log,shifts:record.data.pos2_shifts,orders:record.data.pos2_orders,topups:record.data.pos2_topups})
export const browserDrawerJournal=record=>model.readDrawerJournal(readExchangeTextSetting(record.data.pos_business_settings,model.DRAWER_JOURNAL))
export const getBrowserExpenseDrawerState=actor=>withSalesLock(()=>{const record=readRecords();return model.expenseDrawerState(browserCartContext(record,actor),browserDrawerJournal(record),browserDrawerFacts(record),actor)})
export const browserDrawerOriginal=(input,record,actor)=>model.drawerOriginal(input,browserCartContext(record,actor),browserDrawerJournal(record),browserDrawerFacts(record))
export function commitBrowserDrawer(input,actor){return withSalesLock(()=>{
 let verified=false,known=false,writing=false,before=null
 try{
  const record=readRecords(),context=browserCartContext(record,actor),journal=browserDrawerJournal(record);verified=true;known=journal.entries.some(row=>row.id===input.id||row.returned?.id===input.id);const plan=model.planDrawerOperation(input,context,journal,browserDrawerFacts(record),actor)
  if(plan.original)return plan.original
  assertOriginalOperationAvailable('addManualEntry',plan.entry.id,record,plan.entry);assertOriginalOperationAvailable('addCashLog',plan.cash.id,record,plan.cash)
  before=localStorage.getItem(RECORD_KEY);writing=true
  writeRecords({},record.revision,{expenseDrawer:{input,actor}})
  return browserDrawerOriginal(model.drawerLookup(input),readRecords(),actor).result
 }catch(error){
  if(writing&&localStorage.getItem(RECORD_KEY)!==before){try{const proof=browserDrawerOriginal(model.drawerLookup(input),readRecords(),actor);if(proof.status==='matched')return proof.result}catch{}return model.drawerRejection(input,Object.assign(Error('抽屜支出與現金紀錄需要核對，請勿重做。'),{historyUncertain:true}),true)}
  return model.drawerRejection(input,error,!verified||known)
 }
})}
