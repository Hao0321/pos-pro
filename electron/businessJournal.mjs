import {orderToJournalEntries,topupToJournalEntries,wasteToJournalEntries} from './accountingCore.mjs'
import {procurementToJournalEntries} from './procurementRules.mjs'
import {salesToJournalEntries} from './salesJournal.mjs'
import {customerLedgerToJournalEntries} from './customerJournal.mjs'
import {supplierLedgerToJournalEntries} from './supplierJournal.mjs'
import {restaurantFundsToJournalEntries} from './restaurantFundsJournal.mjs'
import {restaurantMenuReferenceEvents} from './restaurantMenuCost.mjs'
import {restaurantFundsWaste} from './restaurantFundedPlan.mjs'

// Preserve the existing category and source order. Native opening previews and
// the live accounting screen must calculate from the same source functions.
export function automaticBusinessJournal({orders=[],products=[],topups=[],wasteLog=[],purchases=[],salesDocuments=[],customerEntries=[],supplierEntries=[],restaurantEntries=[],openingJournals=[]}){
  const originals=new Map()
  const menuWasteCosts=new Map()
  for(const entry of restaurantEntries){
    const costs=restaurantMenuReferenceEvents(entry);if(!costs)continue
    for(const event of entry.funds.events)for(const [index,waste]of restaurantFundsWaste(event).entries())menuWasteCosts.set(waste.id,costs.get(event.id).wasteCents[index])
  }
  for(const entry of restaurantEntries)if(entry.funds&&entry.saleId){
    if(originals.has(entry.saleId))throw Error('餐飲交付分錄缺少一致的原單來源。')
    originals.set(entry.saleId,entry)
  }
  return [
    ...orders.flatMap(order=>orderToJournalEntries(order,products,originals.get(order.refundOf||order.id))),
    ...topups.flatMap(topupToJournalEntries),
    ...wasteLog.flatMap(row=>wasteToJournalEntries(row,menuWasteCosts.has(row.id)?{valueCents:menuWasteCosts.get(row.id)}:null)),
    ...purchases.flatMap(procurementToJournalEntries),
    ...salesDocuments.flatMap(salesToJournalEntries),
    ...customerLedgerToJournalEntries(customerEntries),
    ...supplierLedgerToJournalEntries(supplierEntries),
    ...restaurantFundsToJournalEntries(restaurantEntries),
    ...openingJournals,
  ]
}
