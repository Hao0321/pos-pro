import {expenseLookup,verifyExpenseProof} from '../../electron/expenseEntry.mjs'
import {expenseRejection} from './expenseEntryDraft'

// Keep expense transport, rejection identity and original-proof admission in
// one adapter; the shared facade supplies its existing authenticated ports.
export function createExpenseEntryAccess({isElectron,getNative,lookup}){
 return {
  async saveExpenseEntry(input,actor){
   const result=isElectron?await getNative().addManualEntry(input):await(await import('./browserExpenseEntry')).commitBrowserExpense(input,actor)
   if(result?.success!==true)throw Object.assign(Error(result?.error||'支出結果尚未確認，請先核對原編號。'),{notCommitted:expenseRejection(input,result)})
   return result
  },
  async lookupExpenseEntry(input,actor){
   const proof=await lookup(expenseLookup(input),actor)
   if(proof?.protocol!=='pos-private-draft-original/v1'||proof.id!==input.id||!['matched','missing'].includes(proof.status))throw Error('支出結果尚未確認，請先核對原編號。')
   if(proof.status==='matched')verifyExpenseProof(input,proof)
   return proof
  },
  async dbDeleteManualEntry(id,actor){
   return isElectron?getNative().deleteManualEntry(id):(await import('./browserExpenseEntry')).removeBrowserExpense(id,actor)
  },
 }
}
