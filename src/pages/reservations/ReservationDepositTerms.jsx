import {tr} from '../../i18n'
import {fundsAmountText} from '../../utils/restaurantFundsView.mjs'

export default function ReservationDepositTerms({review,disabled,onAccept,onRefresh,original=false}){
 if(!review?.terms)return null
 const {terms,stale}=review
 if(!terms.requiredCents&&!stale)return null
 return <section className="reservation-deposit-terms" data-reservation-deposit-terms>
  <h3>{tr('本筆訂金 {0}',{0:'NT$ '+fundsAmountText(terms.requiredCents)})}</h3>
  <p>{tr('訂金可抵餐費，未使用部分可退回。')}</p>
  {original?<p>{tr('沿用原條件：{0}，{1} 位',{0:terms.date,1:terms.partySize})}</p>:stale?<><p role="status">{tr('訂金條件已更新，原輸入仍保留。')}</p><button className="btn btn-ghost" type="button" data-reservation-deposit-refresh disabled={disabled} onClick={onRefresh}>{tr('重新核對訂金')}</button></>:terms.requiredCents>0&&<label className="reservation-deposit-accept"><input type="checkbox" data-reservation-deposit-accept disabled={disabled} checked={review.accepted===true} onChange={event=>onAccept(event.target.checked)}/><span>{tr('已向客人說明，客人同意這筆訂金與退款條件')}</span></label>}
 </section>
}
