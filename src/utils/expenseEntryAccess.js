import {expenseLookup,verifyExpenseProof,EXPENSE_JOURNAL} from '../../electron/expenseEntry.mjs'
import {DRAWER_EXPENSE,DRAWER_RETURN,DRAWER_JOURNAL,drawerLookup,verifyDrawerProof,isDrawerRejection} from '../../electron/expenseDrawer.mjs'
import {expenseRejection} from './expenseEntryDraft'
const drawer=input=>[DRAWER_EXPENSE,DRAWER_RETURN].includes(input?.protocol)
export const isExpenseReceiptSetting=key=>[EXPENSE_JOURNAL,DRAWER_JOURNAL].includes(key)

// Keep expense transport, rejection identity and original-proof admission in
// one adapter; the shared facade supplies its existing authenticated ports.
export function createExpenseEntryAccess({isElectron,getNative,lookup,context}){
 return {
  async saveExpenseEntry(input,actor){
   const result=isElectron?await getNative().addManualEntry(input):drawer(input)?await(await import('./browserExpenseDrawer')).commitBrowserDrawer(input,actor):await(await import('./browserExpenseEntry')).commitBrowserExpense(input,actor)
   if(result?.success!==true)throw Object.assign(Error(result?.error||'支出結果尚未確認，請先核對原編號。'),{notCommitted:drawer(input)?isDrawerRejection(input,result):expenseRejection(input,result)})
   return result
  },
  async lookupExpenseEntry(input,actor){
   const proof=await lookup(drawer(input)?drawerLookup(input):expenseLookup(input),actor)
   if(proof?.protocol!=='pos-private-draft-original/v1'||proof.id!==input.id||!['matched','missing',...(input.protocol===DRAWER_RETURN?['rejected']:[])].includes(proof.status))throw Error('支出結果尚未確認，請先核對原編號。')
   if(proof.status!=='missing')(drawer(input)?verifyDrawerProof:verifyExpenseProof)(input,proof)
   return proof
  },
  async loadExpenseDrawerState(actor){
   if(isElectron)return getNative().getExpenseDrawerState()
   await context(actor);return (await import('./browserExpenseDrawer')).getBrowserExpenseDrawerState(actor)
  },
  async dbDeleteManualEntry(id,actor){
   return isElectron?getNative().deleteManualEntry(id):(await import('./browserExpenseEntry')).removeBrowserExpense(id,actor)
  },
 }
}
