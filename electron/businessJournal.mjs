import {orderToJournalEntries,topupToJournalEntries,wasteToJournalEntries} from './accountingCore.mjs'
import {procurementToJournalEntries} from './procurementRules.mjs'
import {salesToJournalEntries} from './salesJournal.mjs'
import {customerLedgerToJournalEntries} from './customerJournal.mjs'
import {supplierLedgerToJournalEntries} from './supplierJournal.mjs'

// Preserve the existing category and source order. Native opening previews and
// the live accounting screen must calculate from the same source functions.
export function automaticBusinessJournal({orders=[],products=[],topups=[],wasteLog=[],purchases=[],salesDocuments=[],customerEntries=[],supplierEntries=[]}){
  return [
    ...orders.flatMap(order=>orderToJournalEntries(order,products)),
    ...topups.flatMap(topupToJournalEntries),
    ...wasteLog.flatMap(wasteToJournalEntries),
    ...purchases.flatMap(procurementToJournalEntries),
    ...salesDocuments.flatMap(salesToJournalEntries),
    ...customerLedgerToJournalEntries(customerEntries),
    ...supplierLedgerToJournalEntries(supplierEntries),
  ]
}
