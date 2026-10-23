import {tr} from '../../i18n'
import {fundsAmountText} from '../../utils/restaurantFundsView.mjs'
import {reservationDepositWork} from '../../utils/reservationDepositWork.mjs'
export {reservationDepositUnresolved} from '../../utils/reservationDepositWork.mjs'

export default function ReservationDepositStatus({booking,balance,uncertain,reception,owner=false,disabled=false,onReceive,onRefund}){
 if(!booking.depositTerms?.requiredCents)return null
 const work=reservationDepositWork(booking,balance,uncertain,reception)
 return <section className="reservation-deposit-status" data-reservation-deposit-status={booking.id}>
  {uncertain||!balance?<p role="status">{tr('訂金款項待店家核對。')}</p>:<>
   {balance.remainingCents>0&&<p>{tr('尚待支付訂金 {0}',{0:'NT$ '+fundsAmountText(balance.remainingCents)})}</p>}
   {balance.availableCents>0&&<p className="reservation-deposit-unresolved">{tr('未使用訂金 {0}',{0:'NT$ '+fundsAmountText(balance.availableCents)})}</p>}
   {work.unresolved&&<p>{tr(work.terminal?'訂位已結束，這筆訂金仍待退回。':'餐點已結束，請核對未用訂金。')}</p>}
   <details><summary>{tr('查看訂金明細')}</summary><p>{tr('原訂金條件 {0}',{0:'NT$ '+fundsAmountText(booking.depositTerms.requiredCents)})}</p><p>{tr('已確認實收 {0}',{0:'NT$ '+fundsAmountText(balance.receivedCents-balance.refundedCents)})}</p>{balance.allocatedCents>0&&<p>{tr('已抵餐費 {0}',{0:'NT$ '+fundsAmountText(balance.allocatedCents)})}</p>}{balance.refundedCents>0&&<p>{tr('已退回 {0}',{0:'NT$ '+fundsAmountText(balance.refundedCents)})}</p>}<p>{tr('訂金可抵餐費，未使用部分可退回。')}</p></details>
   <div className="reservation-actions">{onReceive&&balance.remainingCents>0&&['confirmed','arrived','seated'].includes(booking.status)&&<button className="btn btn-primary" type="button" data-deposit-receive-open disabled={disabled} onClick={onReceive}>{tr('登記訂金實收')}</button>}{onRefund&&owner&&balance.availableCents>0&&<button className="btn btn-ghost" type="button" data-deposit-refund-open disabled={disabled} onClick={onRefund}>{tr('退回未使用訂金')}</button>}</div>
  </>}
 </section>
}
