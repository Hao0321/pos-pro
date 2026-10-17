import {readRecords} from './browserStorage'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {makeStockAccountingReport} from '../../electron/stockAccounting.mjs'
import {makeStockSalesReport} from '../../electron/stockSalesReports.mjs'
import {readBrowserTrading} from './browserSalesDocuments'
import {readBrowserSupplier} from './browserSupplierLedger'
import {salesDate} from '../../electron/salesRules.mjs'

// Standalone device-local reports. Paired phones always use the native API.
function snapshot(actor,ownerOnly){
 const record=readRecords(),book=browserToBook(record.data),state=validateStockCostBook(book)
 if(!state.projection)return {state}
 const user=book.users.find(row=>row.id===actor?.userId)
 if(!user||user.username!==actor.username||user.role!==actor.role||!['owner',...(ownerOnly?[]:['staff'])].includes(user.role))throw Error('權限不足')
 const data={products:book.products,orders:book.orders,members:book.members,restaurantEntries:book.restaurantOrders}
 if(user.role==='owner'){
  const trading=readBrowserTrading(record),supplier=readBrowserSupplier(record),today=salesDate(new Date())
  Object.assign(data,{purchases:book.purchases,topups:book.memberTopups,wasteLog:book.wasteLog,manualJournal:book.manualJournal,salesDocuments:book.salesDocuments,customerEntries:book.customerEntries,supplierEntries:book.supplierEntries,sales:{storeId:trading.storeId,epoch:record.salesEpoch,today,documents:trading.documents,customerLedger:trading.customerLedger},supplierState:{storeId:supplier.storeId,epoch:record.salesEpoch,today,supplierLedger:supplier.supplierLedger}})
 }
 return {state,data,role:user.role}
}
export function getBrowserStockAccountingState(actor){const {state,data}=snapshot(actor,true);return state.projection?makeStockAccountingReport(state,data):{status:'reference-only-not-activated'}}
export function getBrowserStockSalesState(actor){const {state,data,role}=snapshot(actor,false);return state.projection?makeStockSalesReport(state,data,salesDate(new Date()),role):{status:'reference-only-not-activated'}}
