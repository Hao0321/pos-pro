import {readRecords,withSalesLock} from './browserStorage'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {stockSetupOwner} from '../../electron/browserStockSetup.mjs'
import {replayStockLedger} from '../../electron/stockLedgerModel.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {stockHistoryQuery,makeStockHistory} from '../../electron/stockHistory.mjs'
import {expireBrowserLotsLocked} from './browserLots'

export function getBrowserStockHistory(input,actor){
 stockHistoryQuery(input)
 return withSalesLock(()=>{
  const old=readRecords();stockSetupOwner(browserToBook(old.data),actor);const record=expireBrowserLotsLocked(old),book=browserToBook(record.data)
  const spans=[],state=replayStockLedger(book.stockCostEntries,book.stockCostOperations,undefined,(sequence,start,end)=>spans.push({sequence,start,end}))
  validateStockCostBook(book,state)
  return makeStockHistory(input,{book,state,spans,epoch:record.salesEpoch})
 })
}
