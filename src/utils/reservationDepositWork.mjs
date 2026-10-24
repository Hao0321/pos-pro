const ended=new Set(['completed','cancelled','no-show']),mealEnded=new Set(['completed','cancelled'])
export function reservationDepositWork(booking,balance,uncertain=false,reception=null){
 const rows=(reception?.orders||[]).filter(row=>row.bookingId===booking.id),terminal=ended.has(booking.status),finishedMeals=booking.status==='seated'&&rows.length>0&&rows.every(row=>mealEnded.has(row.status)),missingMeals=booking.status==='seated'&&rows.some(row=>row.status==='missing')
 return {terminal,finishedMeals,missingMeals,unresolved:!!booking.depositTerms?.requiredCents&&(terminal||finishedMeals||missingMeals)&&(uncertain||!balance||balance.availableCents>0)}
}
export const reservationDepositUnresolved=(booking,balance,uncertain=false,reception=null)=>reservationDepositWork(booking,balance,uncertain,reception).unresolved
