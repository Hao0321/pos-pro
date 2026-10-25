import {readRecords,writeRecords,withSalesLock,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {browserCartContext} from './browserHeldCart'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {updateBrowserSettings} from '../../electron/settingEncoding.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import * as model from '../../electron/expenseEntry.mjs'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {browserDrawerJournal} from './browserExpenseDrawer'
export const browserExpenseJournal=record=>model.readExpenseJournal(readExchangeTextSetting(record.data.pos_business_settings,model.EXPENSE_JOURNAL))
export const browserExpenseOriginal=(input,record,actor)=>model.expenseOriginal(input,browserCartContext(record,actor),browserExpenseJournal(record),record.data.pos2_manual_j)
export function commitBrowserExpense(input,actor){return withSalesLock(()=>{
 let writing=false,before=null,verified=false,known=false
 try{
  const record=readRecords(),context=browserCartContext(record,actor),journal=browserExpenseJournal(record);verified=true;known=journal.entries.some(row=>row.id===input.id);const plan=model.planExpense(input,context,journal,record.data.pos2_manual_j,record.data.pos_stock_cost_entries.length>0);if(plan.original)return plan.original.result
  assertOriginalOperationAvailable('addManualEntry',input.id,record,plan.entry);const settings=updateBrowserSettings(record.data.pos_business_settings,{[model.EXPENSE_JOURNAL]:JSON.stringify(JSON.stringify({version:1,entries:[...journal.entries,plan.receipt]}))});before=localStorage.getItem(RECORD_KEY);writing=true;writeRecords({pos2_manual_j:[plan.entry,...record.data.pos2_manual_j],pos_business_settings:settings},record.revision);return browserExpenseOriginal(model.expenseLookup(input),readRecords(),actor).result
 }catch(error){
  if(writing&&localStorage.getItem(RECORD_KEY)!==before){try{const proof=browserExpenseOriginal(model.expenseLookup(input),readRecords(),actor);if(proof.status==='matched')return proof.result}catch{}return {protocol:model.EXPENSE_PROTOCOL,success:false,committed:null,id:input.id,digest:privateDraftDigest(input),error:'支出結果尚未確認，請先核對原編號。'}}
  return {protocol:model.EXPENSE_PROTOCOL,success:false,committed:!verified||known||error.historyUncertain?null:false,id:input.id,digest:privateDraftDigest(input),error:error.message}
 }
})}
export function removeBrowserExpense(id,actor){return withSalesLock(()=>{
 const record=readRecords(),context=browserCartContext(record,actor);if(context.role!=='owner')throw Error('此操作需要店主權限');const journal=browserExpenseJournal(record),receipt=journal.entries.find(row=>row.id===id)
 if(browserDrawerJournal(record).entries.some(row=>row.id===id||row.returned?.entry.id===id))throw Error('抽屜支出請先確認現金已退回，不能直接刪改。')
 if(record.data.pos_stock_cost_entries.length&&validateStockCostBook(browserToBook(record.data)).projection.legacyJournals.some(row=>row.id===id))throw Error('開帳前的帳務已保留，請新增更正分錄')
 const settings=receipt?updateBrowserSettings(record.data.pos_business_settings,{[model.EXPENSE_JOURNAL]:JSON.stringify(JSON.stringify({version:1,entries:journal.entries.map(row=>row.id===id?{...row,removed:true}:row)}))}):record.data.pos_business_settings
 writeRecords({pos2_manual_j:record.data.pos2_manual_j.filter(row=>row.id!==id),pos_business_settings:settings},record.revision);return {success:true}
})}
