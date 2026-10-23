import {quoteReservationDeposit,assertReservationDepositQuote,depositError} from '../../electron/reservationDepositPolicy.mjs'
import {draftObject} from '../../electron/privateDrafts.mjs'

export function validateReservationDepositReview(value){
 try{draftObject(value,['terms','accepted']);assertReservationDepositQuote(value.terms);return typeof value.accepted==='boolean'}catch{return false}
}
export function reservationDepositQuote(state,form){
 if(!['book','promote'].includes(form.action)||!form.date||!form.slot||!state.depositPolicy)return null
 const channel=form.action==='book'?'phone':state.bookings.find(row=>row.id===form.bookingId)?.channel
 return quoteReservationDeposit(state.depositPolicy,{date:form.date,slot:form.slot,partySize:Number(form.partySize),channel})
}
export function reservationDepositReviewState(state,form){
 const current=reservationDepositQuote(state,form),saved=form.deposit?.terms||null,stale=(current?.hash||null)!==(saved?.hash||null)
 return {terms:saved||current,stale,ready:!stale&&(!current?.requiredCents||form.deposit?.accepted===true)}
}
export function reviewedReservationDepositFields(form){
 if(!form.deposit)return {}
 if(!['book','promote'].includes(form.action)||!validateReservationDepositReview(form.deposit)||form.deposit.terms.requiredCents>0&&!form.deposit.accepted)throw depositError('REVIEW')
 if(['date','slot'].some(key=>form[key]!==form.deposit.terms[key])||Number(form.partySize)!==form.deposit.terms.partySize)throw depositError('REVIEW')
 return {depositQuoteHash:form.deposit.terms.hash}
}
export function assertCurrentReservationDepositReview(state,form){if(!reservationDepositReviewState(state,form).ready)throw depositError('REVIEW');return reviewedReservationDepositFields(form)}
