import { browserStorage } from './browserStorage'
export const FINANCIAL_PENDING='pos_pending_financial_v1'
// A lost reply retains the original ID. Retrying identical input is safe only
// because every participating persistence adapter deduplicates that ID.
export async function executeFinancial(kind, input, persist) {
  const signature=JSON.stringify({kind,input}), raw=browserStorage.getItem(FINANCIAL_PENDING)
  let pending=raw?JSON.parse(raw):null
  if (pending && pending.signature!==signature) throw new Error('上一筆異動結果尚未確認。請以原內容重試並核對紀錄，勿建立另一笔。')
  if (!pending) {
    pending={signature,kind,request:{...input,id:kind+'-'+crypto.randomUUID(),time:new Date().toISOString()}}
    browserStorage.setItem(FINANCIAL_PENDING,JSON.stringify(pending))
  }
  let result
  try {result=await persist(pending.request)} catch {throw new Error('保存結果尚未確認。請以原內容重試；系統會沿用原單號，勿重複付款或退款。')}
  if (result?.success===false && result.committed===false) {
    browserStorage.removeItem(FINANCIAL_PENDING)
    throw new Error(result.error||'資料保存失敗')
  }
  if (result?.success!==true) throw new Error('保存結果尚未確認，請以原內容重試。')
  browserStorage.removeItem(FINANCIAL_PENDING)
  return result
}
