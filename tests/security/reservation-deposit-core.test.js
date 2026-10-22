import {describe,it,expect} from 'vitest'
import {defaultReservationConfig} from '../../electron/reservationConfig.mjs'
import {defaultReservationDepositPolicy,makeReservationDepositPolicy,quoteReservationDeposit,assertReservationDepositTerms,MAX_DEPOSIT_CENTS} from '../../electron/reservationDepositPolicy.mjs'
import {reservationDepositSummary} from '../../electron/reservationDeposits.mjs'
import {projectReservationBook,reservationView} from '../../electron/reservationCommit.mjs'
import {readReservationBook,assertReservationResult} from '../../electron/reservationHistory.mjs'
import {reservationDepositsToJournalEntries} from '../../electron/reservationDepositJournal.mjs'
import {assertReservationBusinessChange} from '../../electron/reservationCustody.mjs'
import {automaticBusinessJournal} from '../../electron/businessJournal.mjs'
import {businessCashFlows} from '../../electron/reportRows.mjs'

const owner={userId:'owner',username:'Deposit owner',role:'owner'},staff={userId:'staff',username:'Deposit staff',role:'staff'},now='2026-10-23T00:00:00.000Z',scope={storeId:'deposit-store',epoch:'deposit-epoch'},day='2026-10-24'
const policy=(amount=10000,basis='per-booking')=>({...defaultReservationDepositPolicy(),enabled:true,basis,amountCents:amount})
const guest=(extra={})=>({date:day,slot:'12:00',partySize:2,customer:{name:'Guest',contact:'0900000000'},channel:'phone',tableIds:[],note:'',...extra})
function fixture(){
 let serial=0,book={settings:[{key:'sharedStoreId',value:scope.storeId}],auditLog:[],restaurantOperations:[],restaurantOrders:[],orders:[],products:[],members:[],cashLog:[],wasteLog:[],shifts:[{id:'shift',status:'open'}],users:[{id:owner.userId,...owner},{id:staff.userId,...staff}]}
 const state=()=>reservationView(book,scope,Date.parse(now)),request=(action,fields={})=>{const current=state(),quote=['book','promote'].includes(action)&&current.depositPolicy?{depositQuoteHash:quoteReservationDeposit(current.depositPolicy,{...fields,channel:action==='promote'?current.bookings.find(row=>row.id===fields.bookingId).channel:fields.channel}).hash}:{};return {protocol:'pos-reservation/v1',id:'deposit-'+(++serial),...scope,expectedRevision:current.revision,time:now,action,reviewed:true,...fields,...quote}}
 const save=(input,actor=owner,known=[])=>{const result=projectReservationBook(book,input,scope,actor,now,known);book=result.book;return assertReservationResult(input,{...result.result,state:reservationView(book,scope,Date.parse(now),known)})}
 const apply=(action,fields={},actor=owner)=>save(request(action,fields),actor)
 apply('configure',{config:{...defaultReservationConfig(),enabled:true,tables:[{id:'table',name:'Table',seats:100,online:true}]}})
 return {state,request,save,apply,book:()=>book,setBook:value=>{book=value},newBooking:fields=>apply('book',guest(fields)).receipt.event.change.booking}
}
function prepared(amount=10000){const f=fixture();f.apply('deposit-policy',{policy:policy(amount)});const b=f.newBooking();return {...f,id:b.id}}
const money=(f,extra={})=>({bookingId:f.id,expectedBookingRevision:f.state().bookings.find(row=>row.id===f.id).revision,amountCents:1000,paidCents:1000,method:'cash',shiftId:'shift',reference:'',confirmed:true,...extra})
const refund=(f,receiptId,amountCents,extra={})=>({bookingId:f.id,expectedBookingRevision:f.state().bookings.find(row=>row.id===f.id).revision,receiptId,amountCents,shiftId:'shift',reference:'',reason:'Guest refund confirmed',confirmed:true,...extra})

describe('DP2 frozen reservation deposit policies',()=>{
 it('requires the caller to acknowledge the exact current quote before creating a funded reservation',()=>{const f=fixture();f.apply('deposit-policy',{policy:policy(500)});const input=f.request('book',guest()),missing={...input};delete missing.depositQuoteHash;expect(()=>f.save(missing)).toThrow('核對這筆訂位');expect(()=>f.save({...input,depositQuoteHash:'0'.repeat(64)})).toThrow('核對這筆訂位');f.apply('deposit-policy',{policy:policy(600)});expect(()=>f.save({...input,expectedRevision:f.state().revision})).toThrow('核對這筆訂位')})
 it('quotes per guest with integer cents and keeps an exact policy fingerprint',()=>{const p=makeReservationDepositPolicy(policy(29,'per-guest'),2),terms=quoteReservationDeposit(p,guest({partySize:3}));expect(terms.requiredCents).toBe(87);expect(assertReservationDepositTerms(terms,p)).toEqual(terms);expect(()=>assertReservationDepositTerms({...terms,requiredCents:88},p)).toThrow()})
 it('uses ordered weekday/date/channel/party rules and the original service day across midnight',()=>{
  const rule={id:'late',fromDate:'2026-10-23',toDate:'2026-10-23',weekdays:[5],start:'22:00',end:'02:00',minParty:2,maxParty:4,channels:['online'],basis:'per-guest',amountCents:1250},p=makeReservationDepositPolicy({...policy(500),rules:[rule,{...rule,id:'second',amountCents:9999}]},4)
  expect(quoteReservationDeposit(p,guest({date:'2026-10-23',slot:'23:00',channel:'online'})).requiredCents).toBe(2500)
  expect(quoteReservationDeposit(p,guest({slot:'01:00',channel:'online'})).ruleId).toBe('late')
  for(const edit of [{slot:'02:00',channel:'online'},{slot:'01:00',channel:'phone'},{date:'2026-10-25',slot:'01:00',channel:'online'},{slot:'01:00',partySize:5,channel:'online'}])expect(quoteReservationDeposit(p,guest(edit)).requiredCents).toBe(500)
 })
 it('rejects malformed policy, currency, fractional cents, overflow, duplicate rules and reversed dates',()=>{
  for(const patch of [{amountCents:.1},{amountCents:-1},{amountCents:NaN},{amountCents:Infinity},{amountCents:MAX_DEPOSIT_CENTS+1},{currency:'USD'},{basis:'none'},{refund:'auto-forfeit'}])expect(()=>makeReservationDepositPolicy({...policy(),...patch},1)).toThrow()
  expect(()=>quoteReservationDeposit(makeReservationDepositPolicy(policy(MAX_DEPOSIT_CENTS,'per-guest'),1),guest())).toThrow()
  const rule={id:'rule',fromDate:'2026-10-25',toDate:'2026-10-23',weekdays:[5],start:'11:00',end:'14:00',minParty:1,maxParty:4,channels:['phone'],basis:'per-booking',amountCents:1};expect(()=>makeReservationDepositPolicy({...policy(),rules:[rule]},1)).toThrow();expect(()=>makeReservationDepositPolicy({...policy(),rules:[{...rule,toDate:null},{...rule,toDate:null}]},1)).toThrow()
 })
 it('does not rewrite accepted terms on a later policy or party/date change',()=>{
  const f=prepared(),original=structuredClone(f.state().bookings[0].depositTerms);f.apply('deposit-policy',{policy:policy(20000)});f.apply('move',{bookingId:f.id,expectedBookingRevision:1,date:day,slot:'17:00',partySize:4,tableIds:[],reason:'Guest chose a new time'});expect(f.state().bookings[0].depositTerms).toEqual(original);expect(f.newBooking({slot:'12:00'}).depositTerms.requiredCents).toBe(20000)
 })
 it('assigns terms when a waitlist actually becomes a booking and enforces actual owner/staff identities',()=>{
  const f=fixture();expect(()=>f.apply('deposit-policy',{policy:policy()},staff)).toThrow();f.apply('deposit-policy',{policy:policy(500)});const b=f.apply('waitlist',guest()).receipt.event.change.booking;expect(b.depositTerms).toBeUndefined();const promoted=f.apply('promote',{bookingId:b.id,expectedBookingRevision:1,date:day,slot:'12:00',partySize:2,tableIds:[],reason:'Guest accepted the table'},staff);expect(promoted.receipt.event.change.booking.depositTerms.requiredCents).toBe(500)
 })
})
describe('DP3 actual reservation postimage and monetary source custody',()=>{
 it('requires deposit acknowledgements once a policy exists while retaining ordinary prior-server replies',()=>{const ordinary=fixture(),request=ordinary.request('book',guest()),old=ordinary.save(request);delete old.state.depositPolicy;delete old.state.depositBalances;delete old.state.depositRecovery;expect(()=>assertReservationResult(request,old)).not.toThrow();const f=prepared(),input=f.request('deposit-receive',money(f)),saved=f.save(input);delete saved.state.depositBalances;expect(()=>assertReservationResult(input,saved)).toThrow();const omitted=f.state();delete omitted.depositPolicy;expect(()=>assertReservationResult(input,{...f.save(input),state:omitted})).toThrow()})
 it('saves real cash and bank sources, exact change and owner refunds without stock, sale or point effects',()=>{
  const f=prepared(),before=f.book(),cash=f.apply('deposit-receive',money(f,{amountCents:3029,paidCents:5000}),staff),bank=f.apply('deposit-receive',money(f,{amountCents:1071,paidCents:1071,method:'bank',shiftId:'',reference:'Verified bank receipt'}),staff)
  expect(cash.receipt.event.change.deposit.changeCents).toBe(1971);expect(f.book().cashLog).toHaveLength(1);expect(f.book().cashLog[0].amount).toBe(30.29)
  f.apply('deposit-refund',refund(f,cash.receipt.id,1000));f.apply('deposit-refund',refund(f,bank.receipt.id,71,{shiftId:''}));const summary=f.state().depositBalances[0]
  expect(summary).toMatchObject({receivedCents:4100,refundedCents:1071,availableCents:3029,remainingCents:6971});expect(f.book().cashLog).toHaveLength(2);expect(f.book().cashLog[1].amount).toBe(10)
  for(const key of ['products','members','orders','wasteLog','restaurantOrders'])expect(f.book()[key]).toEqual(before[key])
  const journals=automaticBusinessJournal({reservationEntries:f.state().entries});expect(journals).toHaveLength(4);for(const row of journals)expect(row.lines.reduce((sum,line)=>sum+Math.round(line.debit*100)-Math.round(line.credit*100),0)).toBe(0)
  const balance=account=>journals.flatMap(row=>row.lines).filter(row=>row.account===account).reduce((sum,row)=>sum+Math.round(row.debit*100)-Math.round(row.credit*100),0);expect(balance('1101')).toBe(2029);expect(balance('1103')).toBe(1000);expect(balance('2193')).toBe(-3029);expect(balance('4101')).toBe(0)
  const flows=businessCashFlows([],[],[],[],f.state().entries);expect(flows).toHaveLength(4);expect(flows.filter(row=>row.method==='cash').reduce((sum,row)=>sum+Math.round(row.amount*100),0)).toBe(2029);expect(flows.filter(row=>row.method==='bank').reduce((sum,row)=>sum+Math.round(row.amount*100),0)).toBe(1000)
 })
 it('keeps exact original replay read-only after its original cash shift closed and rejects content conflicts',()=>{
  const f=prepared(),input=f.request('deposit-receive',money(f)),saved=f.save(input);f.setBook({...f.book(),shifts:[{id:'shift',status:'closed'}]});const before=structuredClone(f.book());expect(f.save(input).receipt).toEqual(saved.receipt);expect(f.book()).toEqual(before);expect(()=>f.save({...input,amountCents:999})).toThrow();expect(f.book()).toEqual(before)
 })
 it('rejects stale competing submissions, overcollection, unconfirmed money and closed or false drawer/bank identities',()=>{
  const f=prepared(),input=f.request('deposit-receive',money(f));f.apply('deposit-receive',money(f));expect(()=>f.save(input)).toThrow()
  for(const extra of [{amountCents:10001,paidCents:10001},{amountCents:.1},{paidCents:999},{confirmed:false},{method:'bank',shiftId:'shift'},{method:'bank',shiftId:'',paidCents:1001},{shiftId:'unknown'}]){const before=structuredClone(f.book());expect(()=>f.apply('deposit-receive',money(f,extra))).toThrow();expect(f.book()).toEqual(before)}
 })
 it('does not allow cross-booking refunds, source overrefund or staff refund authority',()=>{
  const f=prepared(),cash=f.apply('deposit-receive',money(f)),other=f.newBooking({slot:'17:00'});for(const edit of [{amountCents:1001},{receiptId:'unknown'},{bookingId:other.id,expectedBookingRevision:1}])expect(()=>f.apply('deposit-refund',refund(f,cash.receipt.id,100,edit))).toThrow();expect(()=>f.apply('deposit-refund',refund(f,cash.receipt.id,100),staff)).toThrow();f.apply('deposit-refund',refund(f,cash.receipt.id,1000));expect(()=>f.apply('deposit-refund',refund(f,cash.receipt.id,1))).toThrow()
 })
 it('keeps a cancelled reservation funded until a separately confirmed original refund',()=>{
  const f=prepared(),cash=f.apply('deposit-receive',money(f));f.apply('status',{bookingId:f.id,expectedBookingRevision:2,status:'cancelled',reason:'Guest cancelled'});expect(f.state().depositBalances[0]).toMatchObject({availableCents:1000,remainingCents:0,refundDueCents:1000});expect(()=>f.apply('deposit-receive',money(f))).toThrow();f.apply('deposit-refund',refund(f,cash.receipt.id,1000));expect(f.state().depositBalances[0].refundDueCents).toBe(0)
 })
 it('rejects missing or altered drawer evidence and keeps older restore money unknown and fresh business paused',()=>{
  const f=prepared(),old=structuredClone(f.book());f.apply('deposit-receive',money(f));const current=structuredClone(f.book()),known=f.state().entries
  expect(()=>readReservationBook({...current,cashLog:[]},[])).toThrow();expect(()=>readReservationBook({...current,cashLog:current.cashLog.map(row=>({...row,amount:999}))},[])).toThrow()
  const history=readReservationBook(old,known);expect(history.state.needsRecovery).toBe(true);expect(history.state.depositRecovery).toBe(true);expect(history.depositMissing).toHaveLength(1);expect(()=>assertReservationBusinessChange(old,{...old,orders:[{id:'fresh-sale'}]},known)).toThrow();f.setBook(old);expect(()=>f.save(f.request('recover'),owner,known)).toThrow('完整備份')
 })
 it('does not accept a forged deposit display or a hand-written unbacked cash row',()=>{
  const f=prepared(),input=f.request('deposit-receive',money(f)),saved=f.save(input);const altered=structuredClone(saved);altered.state.depositBalances[0].availableCents++;expect(()=>assertReservationResult(input,altered)).toThrow();expect(()=>readReservationBook({...f.book(),cashLog:[...f.book().cashLog,{id:'reservation-deposit-forged',amount:1}]})).toThrow();expect(reservationDepositsToJournalEntries(f.state().entries)).toHaveLength(1);expect(reservationDepositSummary(readReservationBook(f.book()).state,f.id).availableCents).toBe(1000)
 })
})
