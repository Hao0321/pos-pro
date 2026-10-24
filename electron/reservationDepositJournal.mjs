import {replayReservationReceipts} from './reservationModel.mjs'

// DP3: recording an actual manual collection changes cash/bank and the existing
// restaurant contract liability. It never creates a sale or touches stock.
export function reservationDepositsToJournalEntries(receipts=[]){
 if(!receipts.length)return []
 const state=replayReservationReceipts(receipts,receipts[0]?.event?.storeId)
 return state.events.filter(event=>event.change.deposit).map(event=>{
  const source=event.change.deposit,receiving=source.action==='receive',amount=source.amountCents/100,cash=source.method==='cash'?'1101':'1103',lines=receiving?[{account:cash,debit:amount,credit:0},{account:'2193',debit:0,credit:amount}]:[{account:'2193',debit:amount,credit:0},{account:cash,debit:0,credit:amount}]
  return {id:'JRD-'+event.id,reservationId:source.bookingId,date:source.date,type:'auto_reservation_deposit',description:(receiving?'訂位訂金實收':'訂位訂金退款')+' · '+source.bookingId,descriptionKey:(receiving?'訂位訂金實收':'訂位訂金退款')+' · {0}',descriptionValues:{0:source.bookingId},lines}
 })
}
export function reservationDepositsToCashFlows(receipts=[]){
 if(!receipts.length)return []
 const state=replayReservationReceipts(receipts,receipts[0]?.event?.storeId)
 return state.events.filter(event=>event.change.deposit).map(event=>{const source=event.change.deposit;return {id:event.id,date:source.date,time:event.time,method:source.method,amount:(source.action==='receive'?1:-1)*source.amountCents/100}})
}
