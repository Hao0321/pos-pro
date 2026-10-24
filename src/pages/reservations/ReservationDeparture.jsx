import {tr} from '../../i18n'
import {fundsAmountText} from '../../utils/restaurantFundsView.mjs'

export default function ReservationDeparture({booking,summary={dueCents:0},deposit,depositUncertain=false,disabled,onClose,onPayment,onDeposit,onConfirm}){
 const unused=deposit?.availableCents||0,uncertain=booking.depositTerms?.requiredCents&&(depositUncertain||!deposit)
 return <section className="card reservation-action" role="dialog" aria-modal="false" aria-label={tr('離席前確認')} data-reservation-departure>
  <h2>{booking.customer.name} · {tr('離席前確認')}</h2>
  <p>{summary.dueCents===null?tr('這桌的款項還需要核對。'):summary.dueCents?tr('這桌還有 NT$ {0} 沒收',{0:fundsAmountText(summary.dueCents)}):tr(booking.depositTerms?.requiredCents?'餐點沒有待收款':'款項已收齊')}</p>
  {uncertain?<p role="status">{tr('訂金款項待店家核對。')}</p>:unused>0&&<p>{tr('未使用訂金 {0}',{0:'NT$ '+fundsAmountText(unused)})} · {tr('離席不會退回訂金，未用款項會繼續提醒。')}</p>}
  {unused>0&&onDeposit&&<button className="btn btn-ghost" type="button" data-reservation-go-deposit disabled={disabled} onClick={onDeposit}>{tr('查看未用訂金')}</button>}
  <div className="reservation-actions">{summary.dueCents>0&&<button type="button" className="btn btn-primary" data-reservation-go-payment disabled={disabled} onClick={onPayment}>{tr('先去收款')}</button>}<button type="button" className="btn btn-ghost" data-reservation-confirm-departure disabled={disabled} onClick={onConfirm}>{tr(summary.dueCents===0?'客人已離席':'客人已走，保留待收款')}</button><button type="button" className="btn btn-ghost" disabled={disabled} onClick={onClose}>{tr('先不要離席')}</button></div>
 </section>
}
