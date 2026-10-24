import {tr,trMessage} from '../../i18n'
import {diningDepositAmounts} from '../../utils/reservationDiningDraft.mjs'
import {fundsAmountText} from '../../utils/restaurantFundsView.mjs'

export default function ReservationDepositAmounts({source,totalCents}){
 if(!source?.deposit||totalCents===null)return null
 let quote;try{quote=diningDepositAmounts(source,totalCents)}catch(error){return <p role="alert">{trMessage(error.message)}</p>}
 if(!quote.availableCents)return null
 const money=value=>'NT$ '+fundsAmountText(value)
 return <section className="reservation-deposit-amounts" data-dining-deposit={quote.appliedCents} aria-label={tr('訂金抵用')}>
  <p><span>{tr('訂金抵用')}</span><strong>{money(quote.appliedCents)}</strong></p>
  <p className="reservation-deposit-due"><span>{tr('餐點還要收')}</span><strong data-dining-deposit-due={quote.remainingMealCents}>{money(quote.remainingMealCents)}</strong></p>
  {quote.availableCents>quote.appliedCents&&<small>{tr('剩餘訂金 {0}',{0:money(quote.availableCents-quote.appliedCents)})}</small>}
 </section>
}
