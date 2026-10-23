import {quoteReservationDeposit} from './reservationDepositPolicy.mjs'
import {reservationDepositSummary} from './reservationDeposits.mjs'
import {assertGuestDepositTerms,assertGuestDepositReceipt} from '../public/reserve/deposit.mjs'

export function publicReservationDepositTerms(state,{date,slot,partySize},existing=null){
 const terms=existing?existing.depositTerms||null:state.depositPolicy?quoteReservationDeposit(state.depositPolicy,{date,slot,partySize,channel:'online'}):null
 return terms?structuredClone(assertGuestDepositTerms(terms)):null
}
export function publicReservationDepositReceipt(state,booking){
 if(!booking.depositTerms)return null
 const terms=structuredClone(assertGuestDepositTerms(booking.depositTerms))
 if(state.needsRecovery||state.depositRecovery)return {terms,uncertain:true}
 const summary=reservationDepositSummary(state,booking.id),value={terms,uncertain:false}
 for(const key of ['receivedCents','refundedCents','allocatedCents','availableCents','remainingCents','refundDueCents'])value[key]=summary[key]
 return assertGuestDepositReceipt(value,booking)
}
