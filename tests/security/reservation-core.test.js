import {describe,it,expect} from 'vitest'
import {defaultReservationConfig,normalizeReservationConfig,RESERVATION_PROTOCOL,RESERVATION_FENCE,RESERVATION_HEAD} from '../../electron/reservationConfig.mjs'
import {reservationInstant,reservationParts,reservationWindows} from '../../electron/reservationCalendar.mjs'
import {emptyReservationState,planReservation,replayReservationReceipts} from '../../electron/reservationModel.mjs'
import {reservationAvailability} from '../../electron/reservationCapacity.mjs'
import {makeReservationBarrier,ordinaryRestaurantOperations} from '../../electron/reservationBarrier.mjs'
import {readReservationBook,reservationAudit,reservationResult,assertReservationResult} from '../../electron/reservationHistory.mjs'

const actor={userId:'owner',username:'Booking fixture',role:'owner'},staff={userId:'staff',username:'Booking staff',role:'staff'},now=Date.parse('2026-10-20T00:00:00.000Z'),date='2026-10-20'
const config=()=>({...defaultReservationConfig(),enabled:true,weekly:defaultReservationConfig().weekly.map(row=>({...row,windows:[{start:'11:00',end:'15:00'},{start:'17:00',end:'21:00'}]})),tables:[{id:'A',name:'四人桌',seats:4,online:true},{id:'B',name:'兩人桌',seats:2,online:true}],combinations:[{id:'AB',tableIds:['A','B']}]})
function base(){return {storeId:'booking-store',epoch:'booking-epoch',now,users:[{id:actor.userId,...actor},{id:staff.userId,...staff}],state:emptyReservationState(),receipts:[],serial:0}}
function command(data,action,fields={}){return {protocol:RESERVATION_PROTOCOL,id:'booking-op-'+(++data.serial),storeId:data.storeId,epoch:data.epoch,expectedRevision:data.state.revision,time:new Date(data.now).toISOString(),action,...fields,reviewed:true}}
function apply(data,action,fields={},who=actor){const request=command(data,action,fields),plan=planReservation(request,data,who);data.state=plan.state;data.receipts.push(plan.receipt);expect(replayReservationReceipts(data.receipts,data.storeId)).toEqual(data.state);return {...plan,request}}
function started(){const data=base();apply(data,'configure',{config:config()});return data}
const booking=(fields={})=>({date,slot:'11:00',partySize:4,customer:{name:'客人',contact:'0900000000'},channel:'phone',tableIds:[],note:'',...fields})
function book(data){return {settings:[{key:'sharedStoreId',value:data.storeId},{key:RESERVATION_FENCE,value:'1'},{key:RESERVATION_HEAD,value:JSON.stringify(data.state.head)}],auditLog:data.receipts.map(reservationAudit),restaurantOperations:[makeReservationBarrier(data.receipts[0])]}}

describe('RL2 actual reservation projection, capacity and original receipts',()=>{
 it('keeps ordinary multiline guest notes through actual replay',()=>{const result=apply(started(),'book',booking({note:'少鹽\r\n不要蔥'}));expect(result.event.change.booking.note).toBe('少鹽\n不要蔥')})
 it('accepts a real authenticated session while persisting only the minimal actor identity',()=>{
  const data=base(),session={...actor,token:'owned-fixture-token',loginAt:now,expiresAt:now+3600000},plan=planReservation(command(data,'configure',{config:config()}),data,session)
  expect(plan.event.actor).toEqual(actor);expect(JSON.stringify(plan)).not.toContain('owned-fixture-token')
 })
 it('normalizes real weekly/exception/combination settings and refuses invalid table identities',()=>{
  expect(normalizeReservationConfig(config()).tables).toHaveLength(2)
  for(const edit of [c=>c.tables.push({...c.tables[0]}),c=>c.combinations[0].tableIds.push('unknown'),c=>c.weekly[0].windows.push({start:'12:00',end:'15:00'}),c=>c.exceptions.push({date:'2026-02-30',windows:[]}),c=>c.timeZone='not-a-zone']){const c=config();edit(c);expect(()=>normalizeReservationConfig(c)).toThrow()}
 })
 it('selects the smallest fitting table and only approved combinations',()=>{
  const data=started(),two=apply(data,'book',booking({partySize:2})),four=apply(data,'book',booking());expect(two.event.change.booking.tableIds).toEqual(['B']);expect(four.event.change.booking.tableIds).toEqual(['A']);expect(()=>apply(data,'book',booking({partySize:6}))).toThrow('沒有合適桌位')
  const joined=started();expect(apply(joined,'book',booking({partySize:6})).event.change.booking.tableIds).toEqual(['A','B']);expect(()=>apply(started(),'book',booking({partySize:7}))).toThrow()
 })
 it('checks the whole dining and cleaning interval, including a partially overlapping slot',()=>{
  const data=started();apply(data,'book',booking({tableIds:['A']}));expect(()=>apply(data,'book',booking({slot:'12:30',tableIds:['A']}))).toThrow('沒有合適桌位');expect(apply(data,'book',booking({slot:'12:45',tableIds:['A']})).event.change.booking.startMs).toBe(Date.parse('2026-10-20T04:45:00Z'))
 })
 it('keeps an old snapshot from winning the same last table',()=>{
  const data=started(),stale=command(data,'book',booking({tableIds:['A']}));apply(data,'book',booking({tableIds:['A']}));expect(()=>planReservation(stale,data,staff)).toThrow('已更新');expect(data.state.bookings).toHaveLength(1)
 })
 it('does not hold tables for waiting guests and rechecks promotion against current capacity',()=>{
  const data=started(),waiting=apply(data,'waitlist',booking()),booked=apply(data,'book',booking({tableIds:['A']})),row=waiting.event.change.booking
  expect(row.tableIds).toEqual([]);expect(()=>apply(data,'promote',{bookingId:row.id,expectedBookingRevision:row.revision,date,slot:'11:00',partySize:4,tableIds:[],reason:'候位轉正'})).toThrow('沒有合適桌位')
  apply(data,'status',{bookingId:booked.event.change.booking.id,expectedBookingRevision:1,status:'cancelled',reason:'客人取消'});expect(apply(data,'promote',{bookingId:row.id,expectedBookingRevision:1,date,slot:'11:00',partySize:4,tableIds:[],reason:'客人確認'}).event.change.booking.status).toBe('confirmed')
 })
 it('atomically replaces a reservation interval without releasing it on a rejected move',()=>{
  const data=started(),original=apply(data,'book',booking({tableIds:['A']}));apply(data,'book',booking({slot:'17:00',tableIds:['A']}));const before=structuredClone(data.state)
  expect(()=>apply(data,'move',{bookingId:original.event.change.booking.id,expectedBookingRevision:1,date,slot:'17:00',partySize:4,tableIds:['A'],reason:'客人改期'})).toThrow();expect(data.state).toEqual(before)
  expect(apply(data,'move',{bookingId:original.event.change.booking.id,expectedBookingRevision:1,date,slot:'12:45',partySize:4,tableIds:['A'],reason:'客人改期'}).event.change.booking.slot).toBe('12:45')
 })
 it('requires a real staff identity and keeps settings/recovery owner-only',()=>{
  const data=base(),request=command(data,'configure',{config:config()});expect(()=>planReservation(request,data,staff)).toThrow('權限不足');expect(()=>planReservation(request,data,{...actor,userId:'forged'})).toThrow('權限不足');apply(data,'configure',{config:config()});expect(apply(data,'book',booking(),staff).event.actor.role).toBe('staff')
 })
 it('retains the original table and duration when future settings are edited',()=>{
  const data=started(),saved=apply(data,'book',booking()).event.change.booking,changed=config();changed.durationMinutes=60;apply(data,'configure',{config:changed});expect(data.state.bookings[0].durationMinutes).toBe(90)
  changed.tables=changed.tables.filter(row=>row.id!=='A');changed.combinations=[];expect(()=>apply(data,'configure',{config:changed})).toThrow()
  expect(data.state.bookings[0].id).toBe(saved.id)
 })
 it('requires actual seating to finish and retains the cleaning interval',()=>{
  const data=started(),row=apply(data,'book',booking({tableIds:['A']})).event.change.booking;data.now=Date.parse('2026-10-20T02:50:00Z');apply(data,'status',{bookingId:row.id,expectedBookingRevision:1,status:'arrived',reason:'客人到店'});apply(data,'status',{bookingId:row.id,expectedBookingRevision:2,status:'seated',reason:'已入座'});data.now=Date.parse('2026-10-20T03:20:00Z');apply(data,'status',{bookingId:row.id,expectedBookingRevision:3,status:'completed',reason:'用餐結束'});expect(()=>apply(data,'book',booking({slot:'11:30',tableIds:['A']}))).toThrow('沒有合適桌位');expect(apply(data,'book',booking({slot:'11:45',tableIds:['A']})).event.change.booking.status).toBe('confirmed')
 })
 it('never seats two parties at one physical table even after an earlier party overruns its planned window',()=>{
  const data=started(),a=apply(data,'book',booking({tableIds:['A']})).event.change.booking,b=apply(data,'book',booking({slot:'12:45',tableIds:['A']})).event.change.booking;data.now=Date.parse('2026-10-20T03:00:00Z');apply(data,'status',{bookingId:a.id,expectedBookingRevision:1,status:'arrived',reason:'到店'});apply(data,'status',{bookingId:a.id,expectedBookingRevision:2,status:'seated',reason:'入座'});data.now=Date.parse('2026-10-20T04:45:00Z');apply(data,'status',{bookingId:b.id,expectedBookingRevision:1,status:'arrived',reason:'到店'});expect(()=>apply(data,'status',{bookingId:b.id,expectedBookingRevision:2,status:'seated',reason:'入座'})).toThrow('目前不能')
 })
 it('applies exception closures to the whole day, including an overnight spill',()=>{
  const c=config();c.weekly=c.weekly.map(row=>({...row,windows:row.day===2?[{start:'18:00',end:'02:00'}]:[]}));const data=base();apply(data,'configure',{config:c});expect(apply(data,'book',booking({date:'2026-10-21',slot:'00:00'})).event.change.booking.date).toBe('2026-10-21')
  const closed={...c,exceptions:[{date:'2026-10-21',windows:[]}]};expect(reservationWindows(normalizeReservationConfig(closed),'2026-10-21').some(row=>row.start<=Date.parse('2026-10-20T16:00:00Z')&&row.end>Date.parse('2026-10-20T16:00:00Z'))).toBe(false)
 })
 it('uses the store clock, enforces public notice and exposes no false slot outside hours',()=>{
  const data=started();data.now=Date.parse('2026-10-20T02:50:00Z');expect(reservationAvailability(data.state,date,4,data.now,{online:true}).slots.some(row=>row.slot==='11:00')).toBe(false);expect(reservationAvailability(data.state,date,4,data.now).slots.some(row=>row.slot==='11:00')).toBe(true)
  expect(()=>apply(data,'book',booking({slot:'14:00'}))).toThrow('時段需要核對')
 })
 it('binds source events and exact receipts to a strict chain and a stored activation',()=>{
  const data=started(),saved=apply(data,'book',booking()),history=readReservationBook(book(data));expect(history.state.bookings).toEqual(data.state.bookings);expect(ordinaryRestaurantOperations(book(data).restaurantOperations)).toEqual([])
  const result=reservationResult(saved.request,saved.receipt,history,data,data.now);expect(assertReservationResult(saved.request,result)).toBe(result);const invalid=structuredClone(result);invalid.state.epoch='another-epoch';expect(()=>assertReservationResult(saved.request,invalid)).toThrow()
  for(const damage of ['parent','receipt','barrier','source']){const altered=book(data);if(damage==='parent')altered.auditLog.shift();if(damage==='receipt')altered.auditLog[1].detail=altered.auditLog[1].detail.replace('客人','別人');if(damage==='barrier')altered.restaurantOperations=[];if(damage==='source')altered.restaurantOperations[0].source.event.storeId='other';expect(()=>readReservationBook(altered)).toThrow()}
 })
 it('surfaces a retained newer reservation after restoring an old book and blocks new allocation until recovery',()=>{
  const data=started(),old=book(data),saved=apply(data,'book',booking()),history=readReservationBook(old,data.receipts);expect(history.state.needsRecovery).toBe(true);expect(history.state.bookings[0].id).toBe(saved.event.change.booking.id);expect(reservationAvailability(history.state,date,4,data.now).paused).toBe(true);data.state=history.state;expect(()=>planReservation(command(data,'book',booking()),data,actor)).toThrow('已還原');const recovery=planReservation(command(data,'recover'),data,actor);expect(recovery.event.change.recoveredHead).toBe(history.state.head)
 })
})

describe('RL2 civil time and timezone boundaries',()=>{
 it('converts the selected store time rather than using the device timezone',()=>{expect(reservationInstant(date,'11:00','Asia/Taipei')).toBe(Date.parse('2026-10-20T03:00:00Z'));expect(reservationParts(Date.parse('2026-10-20T03:00:00Z'),'Asia/Taipei')).toEqual({date,slot:'11:00'})})
 it('rejects nonexistent, ambiguous and invalid calendar times',()=>{for(const [day,slot,zone]of [['2026-03-08','02:30','America/New_York'],['2026-11-01','01:30','America/New_York'],['2026-02-30','12:00','Asia/Taipei'],['2011-12-30','12:00','Pacific/Apia']])expect(()=>reservationInstant(day,slot,zone)).toThrow()})
})
