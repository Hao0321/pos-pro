import {tr} from '../../i18n'
import {fundsAmountText} from '../../utils/restaurantFundsView.mjs'

export default function ReservationSettlement({summary}){
 if(!summary?.orderCount)return null
 const text=summary.missingCount?tr('餐點與款項待找回'):summary.dueCents?tr('尚待收款 NT$ {0}',{0:fundsAmountText(summary.dueCents)}):tr(summary.totalCents?'款項已收齊':'不需收款')
 return <p className={'reservation-settlement'+(summary.missingCount||summary.dueCents?' reservation-unsettled':'')} data-reservation-due={summary.dueCents===null?'unknown':summary.dueCents} role="status">{text}</p>
}
