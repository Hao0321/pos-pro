import {reservationInstant,reservationDate,reservationParts,reservationAddDays,reservationWindows,reservationMinutes} from './reservationCalendar.mjs'
import {reservationError,reservationInteger} from './reservationConfig.mjs'

export const reservationOccupies=booking=>['confirmed','arrived','seated'].includes(booking.status)||booking.status==='completed'&&booking.busyUntilMs>booking.startMs
export const reservationOverlap=(a,b)=>a.startMs<b.busyUntilMs&&b.startMs<a.busyUntilMs
export function reservationSpan(config,date,slot,now,{publicRequest=false,existing=false}={}){
 reservationDate(date);reservationMinutes(slot);const partyDay=reservationParts(now,config.timeZone).date
 if(reservationMinutes(slot)%config.slotMinutes||date>reservationAddDays(partyDay,config.horizonDays)||date<partyDay)throw reservationError('TIME')
 const startMs=reservationInstant(date,slot,config.timeZone),endMs=startMs+config.durationMinutes*60000,busyUntilMs=endMs+config.bufferMinutes*60000
 if(startMs<now+(publicRequest?config.noticeMinutes*60000:0)||!existing&&!config.enabled)throw reservationError('TIME')
 if(!reservationWindows(config,date).some(window=>window.start<=startMs&&window.end>=busyUntilMs))throw reservationError('TIME')
 return {date,slot,timeZone:config.timeZone,startMs,endMs,busyUntilMs,durationMinutes:config.durationMinutes,bufferMinutes:config.bufferMinutes}
}
export function reservationCandidates(config,bookings,span,partySize,{online=false,ignoreId='',now=0}={}){
 reservationInteger(partySize,1,100);const tables=new Map(config.tables.map(row=>[row.id,row])),occupied=bookings.filter(row=>row.id!==ignoreId&&reservationOccupies(row)&&reservationOverlap(row,span)),seated=bookings.filter(row=>row.id!==ignoreId&&row.status==='seated'&&span.startMs<now+config.slotMinutes*60000)
 return [...config.tables.map(row=>[row.id]),...config.combinations.map(row=>row.tableIds)].map(tableIds=>({tableIds:[...tableIds].sort(),seats:tableIds.reduce((n,id)=>n+tables.get(id).seats,0)})).filter(row=>row.seats>=partySize&&(!online||row.tableIds.every(id=>tables.get(id).online))&&!occupied.some(booking=>booking.tableIds.some(id=>row.tableIds.includes(id)))&&!seated.some(booking=>booking.tableIds.some(id=>row.tableIds.includes(id)))).sort((a,b)=>a.seats-b.seats||a.tableIds.length-b.tableIds.length||JSON.stringify(a.tableIds).localeCompare(JSON.stringify(b.tableIds)))
}
export function chooseReservationTables(config,bookings,span,partySize,tableIds,options){
 if(!Array.isArray(tableIds)||new Set(tableIds).size!==tableIds.length)throw reservationError('CONFIG')
 const candidates=reservationCandidates(config,bookings,span,partySize,options),chosen=tableIds.length?candidates.find(row=>JSON.stringify(row.tableIds)===JSON.stringify([...tableIds].sort())):candidates[0]
 if(!chosen)throw reservationError('FULL');return chosen.tableIds
}
export function reservationAvailability(state,date,partySize,now,{online=false,ignoreId=''}={}){
 reservationDate(date);reservationInteger(partySize,1,100)
 if(!state.config.enabled||state.needsRecovery)return {date,partySize,slots:[],paused:true}
 const slots=[];for(let minutes=0;minutes<1440;minutes+=state.config.slotMinutes){const slot=String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');try{const span=reservationSpan(state.config,date,slot,now,{publicRequest:online}),candidates=reservationCandidates(state.config,state.bookings,span,partySize,{online,ignoreId,now});if(candidates.length)slots.push({slot,start: new Date(span.startMs).toISOString(),end:new Date(span.endMs).toISOString(),candidates})}catch(error){if(!['RESERVATION_TIME','RESERVATION_LOCAL_TIME'].includes(error.code))throw error}}
 return {date,partySize,slots,paused:false}
}
