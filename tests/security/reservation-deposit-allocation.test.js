import {describe,it,expect} from 'vitest'
import {makeReservationDepositPolicy,defaultReservationDepositPolicy,quoteReservationDeposit} from '../../electron/reservationDepositPolicy.mjs'
import {reservationDepositSummary} from '../../electron/reservationDeposits.mjs'
import {RESERVATION_DEPOSIT_APPLICATION,quoteReservationDepositApplication,assertReservationDepositApplicationReview,reservationDepositApplicationDescriptor,reservationDepositFundingId,reservationDepositReturnId,applyReservationDepositAllocation} from '../../electron/reservationDepositAllocation.mjs'

const scope={storeId:'allocation-store',epoch:'allocation-epoch'}
function fixture(){
 const policy=makeReservationDepositPolicy({...defaultReservationDepositPolicy(),enabled:true,basis:'per-booking',amountCents:10000},1),booking={id:'booking',storeId:scope.storeId,revision:4,status:'seated',date:'2026-10-23',slot:'12:00',channel:'phone',partySize:2};booking.depositTerms=quoteReservationDeposit(policy,booking)
 const receive=(id,method,amountCents)=>({id,input:{action:'deposit-receive',amountCents},change:{deposit:{protocol:'pos-reservation-deposit/v1',id,bookingId:booking.id,action:'receive',termsHash:booking.depositTerms.hash,amountCents,method}}})
 const state={bookings:[booking],events:[{id:'policy',input:{action:'deposit-policy'},change:{depositPolicy:policy}},receive('cash-original','cash',3029),receive('bank-original','bank',1071)]}
 const summary=()=>reservationDepositSummary(state,booking.id),context=(orderId='meal-one',totalCents=2500)=>({scope,booking,balance:summary(),orderId,restaurantVersion:1,totalCents,dueCents:totalCents})
 const apply=(id,orderId='meal-one',totalCents=2500)=>{const review=quoteReservationDepositApplication(context(orderId,totalCents)),descriptor=reservationDepositApplicationDescriptor(id,review);state.events.push({id,input:{action:'deposit-apply'},change:{depositApplication:descriptor}});return descriptor}
 const release=(operationId,application,amountCents,{disposition='retain',payment=0}={})=>{const id=reservationDepositReturnId(scope.storeId,operationId),source=application.sources[payment],descriptor={protocol:RESERVATION_DEPOSIT_APPLICATION,id,bookingId:booking.id,orderId:application.orderId,operationId,amountCents,sources:[{...source,amountCents,applicationId:application.id}],disposition};state.events.push({id,input:{action:'deposit-return'},change:{depositReturn:descriptor}});return descriptor}
 return {state,booking,summary,context,apply,release}
}
describe('DP6 original deposit allocation and return ledger',()=>{
 it('quotes exact cents from original cash then bank and binds the current store, booking, meal and balance',()=>{
  const f=fixture(),quote=quoteReservationDepositApplication(f.context('meal-one',3500));expect(quote).toMatchObject({...scope,bookingId:'booking',bookingRevision:4,orderId:'meal-one',restaurantVersion:1,totalCents:3500,dueCents:3500,availableCents:4100,appliedCents:3500,remainingMealCents:0,sources:[{receiptId:'cash-original',method:'cash',amountCents:3029},{receiptId:'bank-original',method:'bank',amountCents:471}]});expect(assertReservationDepositApplicationReview(quote,f.context('meal-one',3500))).toEqual(quote)
 })
 it('caps a transfer at actual meal due and leaves the unused original balance available for another meal',()=>{
  const f=fixture();f.apply('use-one');expect(f.summary()).toMatchObject({receivedCents:4100,refundedCents:0,allocatedCents:2500,availableCents:1600,remainingCents:0,receipts:[{id:'cash-original',allocatedCents:2500,availableCents:529},{id:'bank-original',allocatedCents:0,availableCents:1071}]});const second=f.apply('use-two','meal-two',3000);expect(second.amountCents).toBe(1600);expect(f.summary()).toMatchObject({receivedCents:4100,allocatedCents:4100,availableCents:0});expect(quoteReservationDepositApplication(f.context('meal-three',1000))).toMatchObject({sources:[],appliedCents:0,remainingMealCents:1000})
 })
 it('returns only the cancelled allocation to the same original source and never creates another receipt',()=>{
  const f=fixture(),a=f.apply('use-one','meal-one',3500);f.release('cancel-one',a,1000);expect(f.summary()).toMatchObject({receivedCents:4100,refundedCents:0,allocatedCents:2500,availableCents:1600,applications:[{id:'use-one',returnedCents:1000}]});f.release('cancel-bank',a,471,{payment:1});expect(f.summary().receipts).toMatchObject([{id:'cash-original',availableCents:1000},{id:'bank-original',availableCents:1071}]);expect(f.summary().receivedCents).toBe(4100)
 })
 it('keeps fulfilled allocations separate from unused refundable booking deposits',()=>{const f=fixture();f.apply('use-one');f.booking.status='completed';expect(f.summary()).toMatchObject({allocatedCents:2500,availableCents:1600,refundDueCents:1600,remainingCents:0})})
 it('restores the source before an explicitly recorded actual refund and cannot refund the spent part',()=>{
  const f=fixture(),a=f.apply('use-one'),returned=f.release('cancel-one',a,1000,{disposition:'refund'}),refund={id:'actual-refund',input:{action:'deposit-refund',amountCents:1000},change:{deposit:{protocol:'pos-reservation-deposit/v1',id:'actual-refund',bookingId:f.booking.id,termsHash:f.booking.depositTerms.hash,action:'refund',receiptId:'cash-original',method:'cash',amountCents:1000}}};f.state.events.push(refund);expect(returned.disposition).toBe('refund');expect(f.summary()).toMatchObject({receivedCents:4100,refundedCents:1000,allocatedCents:1500,availableCents:1600});refund.change.deposit.amountCents=2530;refund.input.amountCents=2530;expect(()=>f.summary()).toThrow()
 })
 it('rejects a review after another meal, source refund, booking revision, order version or store changes',()=>{
  const f=fixture(),context=f.context(),review=quoteReservationDepositApplication(context);f.apply('other','meal-two',100);expect(()=>assertReservationDepositApplicationReview(review,f.context())).toThrow();for(const edit of [{booking:{...context.booking,revision:5}},{restaurantVersion:2},{scope:{...scope,storeId:'foreign'}},{scope:{...scope,epoch:'restored'}},{orderId:'foreign-meal'},{dueCents:2499}])expect(()=>assertReservationDepositApplicationReview(review,{...context,...edit})).toThrow()
 })
 it('rejects altered amounts, sources and unknown fields in an acknowledged review',()=>{const f=fixture(),context=f.context(),review=quoteReservationDepositApplication(context);for(const change of [{appliedCents:2501},{remainingMealCents:1},{sources:[{...review.sources[0],method:'bank'}]},{confirmed:true}])expect(()=>assertReservationDepositApplicationReview({...review,...change},context)).toThrow()})
 it('rejects cross-booking, false method, overallocated, duplicate or changed original identities',()=>{
  for(const edit of [a=>{a.bookingId='foreign'},a=>{a.sources[0].method='bank'},a=>{a.sources[0].amountCents=5000;a.amountCents=5000},a=>{a.sources[0].receiptId='missing'},a=>{a.sources[0].paymentId='arbitrary'}]){const f=fixture(),a=f.apply('use-one');edit(f.state.events.at(-1).change.depositApplication);expect(()=>f.summary()).toThrow()}
  const f=fixture();f.apply('duplicate');f.state.events.push(structuredClone(f.state.events.at(-1)));expect(()=>f.summary()).toThrow()
 })
 it('rejects repeated, excess, foreign meal, foreign receipt and false source returns',()=>{
  for(const edit of [r=>{r.orderId='other-meal'},r=>{r.bookingId='other-booking'},r=>{r.sources[0].receiptId='bank-original'},r=>{r.sources[0].applicationId='missing'},r=>{r.sources[0].amountCents=2501;r.amountCents=2501},r=>{r.sources[0].method='bank'},r=>{r.id='made-up'}]){const f=fixture(),a=f.apply('use-one');f.release('return-one',a,100);edit(f.state.events.at(-1).change.depositReturn);expect(()=>f.summary()).toThrow()}
  const f=fixture(),a=f.apply('use-one');f.release('return-one',a,1500);f.release('return-two',a,1001);expect(()=>f.summary()).toThrow()
 })
 it('validates all selected sources before mutating a replay accumulator',()=>{
  const f=fixture(),review=quoteReservationDepositApplication(f.context('meal-one',3500)),a=reservationDepositApplicationDescriptor('use-one',review),receipts=new Map(f.summary().receipts.map(row=>[row.id,structuredClone(row)])),before=structuredClone(receipts);a.sources[1].receiptId='missing';expect(()=>applyReservationDepositAllocation({id:a.id,change:{depositApplication:a}},receipts,new Map(),{bookingId:f.booking.id,termsHash:f.booking.depositTerms.hash,storeId:scope.storeId})).toThrow();expect(receipts).toEqual(before)
 })
 it('rejects malformed cent precision, inconsistent source balances and numerical overflow',()=>{
  const f=fixture(),context=f.context();for(const edit of [{totalCents:.1},{dueCents:-1},{dueCents:2501},{totalCents:100000000001},{balance:{...context.balance,availableCents:4101}},{balance:{...context.balance,receipts:context.balance.receipts.map((row,i)=>i?row:{...row,availableCents:3030})}}])expect(()=>quoteReservationDepositApplication({...context,...edit})).toThrow()
 })
 it('preserves the original published summary shape when no deposit has been applied',()=>{const f=fixture(),summary=f.summary();expect(summary).toMatchObject({allocatedCents:0,availableCents:4100,remainingCents:5900});expect(summary).not.toHaveProperty('applications');expect(reservationDepositFundingId('use-one')).toMatch(/^reservation-deposit-use-[a-f0-9]{48}$/)})
})
