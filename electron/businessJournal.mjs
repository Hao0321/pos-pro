import {orderToJournalEntries,topupToJournalEntries,wasteToJournalEntries} from './accountingCore.mjs'
import {procurementToJournalEntries} from './procurementRules.mjs'
import {salesToJournalEntries} from './salesJournal.mjs'
import {customerLedgerToJournalEntries} from './customerJournal.mjs'
import {supplierLedgerToJournalEntries} from './supplierJournal.mjs'
import {restaurantFundsToJournalEntries} from './restaurantFundsJournal.mjs'

// Preserve the existing category and source order. Native opening previews and
// the live accounting screen must calculate from the same source functions.
export function automaticBusinessJournal({orders=[],products=[],topups=[],wasteLog=[],purchases=[],salesDocuments=[],customerEntries=[],supplierEntries=[],restaurantEntries=[]}){
  const originals=new Map()
  for(const entry of restaurantEntries)if(entry.funds&&entry.saleId){
    if(originals.has(entry.saleId))throw Error('餐飲交付分錄缺少一致的原單來源。')
    originals.set(entry.saleId,entry)
  }
  return [
    ...orders.flatMap(order=>orderToJournalEntries(order,products,originals.get(order.refundOf||order.id))),
    ...topups.flatMap(topupToJournalEntries),
    ...wasteLog.flatMap(wasteToJournalEntries),
    ...purchases.flatMap(procurementToJournalEntries),
    ...salesDocuments.flatMap(salesToJournalEntries),
    ...customerLedgerToJournalEntries(customerEntries),
    ...supplierLedgerToJournalEntries(supplierEntries),
    ...restaurantFundsToJournalEntries(restaurantEntries),
  ]
}
