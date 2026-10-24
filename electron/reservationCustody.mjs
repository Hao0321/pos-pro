import {canonicalSignature} from './operationRules.mjs'
import {readReservationBook} from './reservationHistory.mjs'
import {reservationError} from './reservationConfig.mjs'
import {depositError} from './reservationDepositPolicy.mjs'

export const RESERVATION_CUSTODY_METHODS=['checkout','refundOrder','applyInventoryOperation','applyRestaurantOperation','applySalesOperation','addWaste','addProduct','applyOpeningMigration','updateProduct','deleteProduct','addTopup','addCashLog','addManualEntry','deleteManualEntry','applyCustomerLedgerOperation','applySupplierLedgerOperation','applyWarehouseOperation','applyLotOperation','applyStockCostOperation','openShift','closeShift','addPurchase','updatePurchase','deletePurchase','addMember','updateMember','deleteMember']
export const reservationRequiresCompleteRecovery=(book,known=[])=>{if(!known.length)return false;const history=readReservationBook(book,known);return history.diningMissing.length>0||history.depositMissing.length>0}
export const reservationIncompleteRecoveryError=(book,known=[])=>readReservationBook(book,known).depositMissing.length?depositError('RECOVERY'):reservationError('DINING_RECOVERY')
const materialKeys=['products','orders','cashLog','wasteLog','purchases','salesDocuments','salesOperations','customerEntries','customerOperations','supplierEntries','supplierOperations','stockCostEntries','stockCostOperations','shifts','memberTopups','manualJournal','restaurantOrders','restaurantOperations']
function material(book){return {...Object.fromEntries(materialKeys.map(key=>[key,book[key]||[]])),memberMoney:(book.members||[]).map(row=>({id:row.id,points:row.points||0,balance:row.balance||0,totalSpent:row.totalSpent||0,tier:row.tier||'normal',lastBirthdayBonus:row.lastBirthdayBonus||''})).filter(row=>row.points||row.balance||row.totalSpent||row.tier!=='normal'||row.lastBirthdayBonus)}}
// Callers hold their normal write lock. Owner-reviewed full restore is a
// separate path; an automatic lot expiry observes stock, never allocates it.
export function assertReservationBusinessChange(before,after,known=[]){if(reservationRequiresCompleteRecovery(before,known)&&canonicalSignature(material(before))!==canonicalSignature(material(after)))throw reservationIncompleteRecoveryError(before,known)}
