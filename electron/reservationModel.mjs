import {canonicalSignature} from './operationRules.mjs'
import {privateDraftDigest,draftObject} from './privateDrafts.mjs'
import {defaultReservationConfig,normalizeReservationConfig,reservationError,reservationId,reservationText,reservationInteger,RESERVATION_PROTOCOL,RESERVATION_EVENT} from './reservationConfig.mjs'
import {reservationParts,reservationWindows} from './reservationCalendar.mjs'
import {reservationSpan,reservationOccupies,chooseReservationTables} from './reservationCapacity.mjs'
import {guestReservationRequest,guestReservationOperationId,guestReservationActor,guestReservationOriginal} from './reservationGuest.mjs'
import {RESERVATION_SERVICE_FIELDS,deriveReservationService,reservationGuestAccess} from './reservationService.mjs'
import {RESERVATION_DINING_FIELDS,deriveReservationDining,reservationDiningLinks} from './reservationDining.mjs'

const clone=value=>structuredClone(value),same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
export const reservationBookingId=(storeId,id)=>'booking-'+privateDraftDigest([storeId,id]).slice(0,48)
export const emptyReservationState=()=>({revision:0,head:null,configVersion:0,publicEnabled:false,guestLinkPolicy:null,config:defaultReservationConfig(),bookings:[],events:[]})
const header=['protocol','id','storeId','epoch','action','expectedRevision','time'],fields={configure:['config','reviewed'],book:['date','slot','partySize','customer','channel','tableIds','note','reviewed'],waitlist:['date','slot','partySize','customer','channel','tableIds','note','reviewed'],move:['bookingId','expectedBookingRevision','date','slot','partySize','tableIds','reason','reviewed'],promote:['bookingId','expectedBookingRevision','date','slot','partySize','tableIds','reason','reviewed'],status:['bookingId','expectedBookingRevision','status','reason','reviewed'],recover:['reviewed']}
export function reservationActor(actor,users=null){
 draftObject(actor,['userId','username','role','token','loginAt','expiresAt'],['userId','username','role']);reservationId(actor.userId);reservationText(actor.username,100,true)
 if(!['owner','staff'].includes(actor.role)||users&&!users.some(user=>user.id===actor.userId&&user.username===actor.username&&user.role===actor.role))throw Error('權限不足')
 return {userId:actor.userId,username:actor.username,role:actor.role}
}
export function reservationCommand(input){
 const extra=input?.action==='dine'?RESERVATION_DINING_FIELDS:(Object.hasOwn(RESERVATION_SERVICE_FIELDS,input?.action)?RESERVATION_SERVICE_FIELDS[input.action]:null)||(input?.action==='publish'?['enabled','reviewed']:input?.action==='guest'?['request','reviewed']:fields[input?.action])
 if(!Array.isArray(extra))throw reservationError('HISTORY')
 draftObject(input,[...header,...extra]);reservationId(input.id);reservationId(input.storeId);reservationId(input.epoch);reservationInteger(input.expectedRevision,0,Number.MAX_SAFE_INTEGER-1)
 if(input.protocol!==RESERVATION_PROTOCOL||typeof input.time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.time)||!Number.isFinite(Date.parse(input.time))||input.reviewed!==true)throw reservationError('HISTORY')
 if(new Date(input.time).toISOString()!==input.time.replace(/Z$/,input.time.includes('.')?'Z':'.000Z'))throw reservationError('HISTORY')
 if(input.action==='guest'){guestReservationRequest(input.request);if(input.id!==guestReservationOperationId(input.request)||input.storeId!==input.request.storeId)throw reservationError('HISTORY')}
 if(input.action==='publish'&&typeof input.enabled!=='boolean')throw reservationError('CONFIG')
 return input
}
function customer(input){draftObject(input,['name','contact']);return {name:reservationText(input.name,100,true),contact:reservationText(input.contact,100)}}
function configure(input,state,actor,now){
 if(actor.role!=='owner')throw Error('權限不足');const config=normalizeReservationConfig(input.config)
 for(const booking of state.bookings.filter(row=>reservationOccupies(row)&&(row.busyUntilMs>now||row.status==='seated'))){
  if(config.timeZone!==state.config.timeZone||booking.tableIds.some(id=>!config.tables.some(table=>table.id===id))||config.tables.filter(table=>booking.tableIds.includes(table.id)).reduce((n,row)=>n+row.seats,0)<booking.partySize)throw reservationError('CONFIG')
  if(config.enabled&&!reservationWindows(config,booking.date).some(window=>window.start<=booking.startMs&&window.end>=booking.busyUntilMs))throw reservationError('CONFIG')
 }
 return {config}
}
function newBooking(input,state,now){
 if(!['phone','walkin','online'].includes(input.channel))throw reservationError('CONFIG')
 reservationInteger(input.partySize,1,100);const person=customer(input.customer),note=reservationText(input.note,1000,false,true),span=reservationSpan(state.config,input.date,input.slot,now,{publicRequest:input.channel==='online'}),waiting=input.action==='waitlist'
 const tableIds=waiting?[]:chooseReservationTables(state.config,state.bookings,span,input.partySize,input.tableIds,{online:input.channel==='online',now})
 if(waiting&&(!Array.isArray(input.tableIds)||input.tableIds.length))throw reservationError('CONFIG')
 return {booking:{id:reservationBookingId(input.storeId,input.id),revision:1,storeId:input.storeId,status:waiting?'waiting':'confirmed',customer:person,channel:input.channel,partySize:input.partySize,tableIds,...span,configVersion:state.configVersion,note,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()}}
}
function changeBooking(input,state,now){
 const booking=state.bookings.find(row=>row.id===input.bookingId)
 if(!booking||input.expectedBookingRevision!==booking.revision)throw reservationError('STALE')
 const reason=reservationText(input.reason,500,true),next={...clone(booking),revision:booking.revision+1,updatedAt:new Date(now).toISOString()}
 if(['move','promote'].includes(input.action)){
  if(input.action==='promote'?booking.status!=='waiting':!['waiting','confirmed','arrived'].includes(booking.status))throw reservationError('STATUS')
  const span=reservationSpan(state.config,input.date,input.slot,now,{existing:true}),waiting=booking.status==='waiting'&&input.action!=='promote'
  reservationInteger(input.partySize,1,100)
  if(waiting&&(!Array.isArray(input.tableIds)||input.tableIds.length))throw reservationError('CONFIG')
  Object.assign(next,span,{partySize:input.partySize,tableIds:waiting?[]:chooseReservationTables(state.config,state.bookings,span,input.partySize,input.tableIds,{ignoreId:booking.id,now}),configVersion:state.configVersion,status:input.action==='promote'?'confirmed':booking.status})
 }else{
  const allowed={waiting:['cancelled'],confirmed:['arrived','cancelled','no-show'],arrived:['seated','cancelled'],seated:['completed']}
  if(!allowed[booking.status]?.includes(input.status))throw reservationError('STATUS')
  if(input.status==='no-show'&&now<booking.startMs||input.status==='arrived'&&now<booking.startMs-120*60000||input.status==='seated'&&(now<booking.startMs-30*60000||state.bookings.some(row=>row.id!==booking.id&&row.status==='seated'&&row.tableIds.some(id=>booking.tableIds.includes(id)))))throw reservationError('STATUS')
  next.status=input.status;next[input.status==='seated'?'seatedAt':input.status==='completed'?'completedAt':input.status==='arrived'?'arrivedAt':'closedAt']=new Date(now).toISOString()
  if(input.status==='completed')next.busyUntilMs=Math.max(booking.startMs,Math.min(booking.busyUntilMs,now+booking.bufferMinutes*60000))
 }
 return {booking:next,reason}
}
function guestChange(input,state,now){
 const request=input.request
 if(request.action!=='cancel'&&(!state.publicEnabled||!state.config.enabled||request.configVersion!==state.configVersion))throw reservationError('STALE')
 if(request.action==='book')return newBooking({...input,...request,action:'book',channel:'online',tableIds:[]},state,now)
 const booking=state.bookings.find(row=>row.id===request.bookingId)
 if(!guestReservationOriginal(state,request.bookingId)||!booking||booking.status!=='confirmed'||booking.startMs<=now)throw reservationError('STATUS')
 if(!reservationGuestAccess(state,booking,now)?.active)throw reservationError('ACCESS')
 if(request.action==='cancel')return changeBooking({...input,...request,action:'status',status:'cancelled',reason:'客人從訂位網站取消'},state,now)
 // A guest move uses the online notice and online tables, including when the
 // merchant has since limited a table to staff bookings.
 const span=reservationSpan(state.config,request.date,request.slot,now,{publicRequest:true})
 const tableIds=chooseReservationTables(state.config,state.bookings,span,request.partySize,[],{online:true,ignoreId:booking.id,now})
 return changeBooking({...input,...request,action:'move',tableIds,reason:'客人從訂位網站改期'},state,now)
}
export function deriveReservationEvent(input,state,actor,time,{allowRecovery=false,allowGuest=false}={}){
 reservationCommand(input)
 if(input.action==='guest'){if(!allowGuest||!same(actor,guestReservationActor(input)))throw Error('權限不足');actor=guestReservationActor(input)}else actor=reservationActor(actor)
 const now=Date.parse(time)
 if(!Number.isFinite(now)||input.expectedRevision!==state.revision)throw reservationError('STALE')
 if(state.needsRecovery&&input.action!=='recover')throw reservationError('RECOVERY')
 let change
 if(input.action==='recover'){if(actor.role!=='owner')throw Error('權限不足');if(!allowRecovery)throw reservationError('RECOVERY');change={recoveredHead:state.head}}
 else if(input.action==='publish'){if(actor.role!=='owner')throw Error('權限不足');if(input.enabled&&(!state.config.enabled||!state.config.tables.some(row=>row.online)))throw reservationError('CONFIG');change={publicEnabled:input.enabled}}
 else if(Object.hasOwn(RESERVATION_SERVICE_FIELDS,input.action))change=deriveReservationService(input,state,actor,now)
 else if(input.action==='dine')change=deriveReservationDining(input,state,now)
 else if(input.action==='guest')change=guestChange(input,state,now)
 else if(input.action==='configure')change=configure(input,state,actor,now)
 else if(['book','waitlist'].includes(input.action))change=newBooking(input,state,now)
 else change=changeBooking(input,state,now)
 const body={protocol:RESERVATION_EVENT,id:input.id,sequence:state.revision+1,previousHash:state.head,storeId:input.storeId,input:clone(input),actor:clone(actor),time:new Date(now).toISOString(),change}
 return {...body,hash:privateDraftDigest(body)}
}
export function projectReservationEvent(state,event){
 const next={...state,revision:event.sequence,head:event.hash,events:[...state.events,clone(event)],needsRecovery:false}
 if(event.change.config){next.config=clone(event.change.config);next.configVersion=event.sequence}
 if(Object.hasOwn(event.change,'publicEnabled'))next.publicEnabled=event.change.publicEnabled
 if(event.change.guestLinkPolicy)next.guestLinkPolicy=clone(event.change.guestLinkPolicy)
 if(event.change.booking){const booking=clone(event.change.booking);next.bookings=[...state.bookings.filter(row=>row.id!==booking.id),booking].sort((a,b)=>a.startMs-b.startMs||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))}
 return next
}
export function reservationReceipt(event){return {protocol:'pos-reservation-receipt/v1',success:true,id:event.id,signature:canonicalSignature(event.input),revision:event.sequence,event:clone(event)}}
export function replayReservationReceipts(receipts,storeId){
 let state=emptyReservationState();const ids=new Set()
 for(const receipt of [...receipts].sort((a,b)=>a.revision-b.revision)){
  const event=receipt?.event
  if(!event||event.storeId!==storeId||ids.has(event.id)||!same(receipt,reservationReceipt(event)))throw reservationError('HISTORY')
  const actual=deriveReservationEvent(event.input,state,event.actor,event.time,{allowRecovery:event.input.action==='recover',allowGuest:true})
  if(!same(actual,event))throw reservationError('HISTORY');ids.add(event.id);state=projectReservationEvent(state,event)
 }
 return state
}
export function planReservation(input,data,actor,{allowGuest=false}={}){
 if(!allowGuest||input?.action!=='guest')reservationActor(actor,data.users);reservationCommand(input)
 if(input.storeId!==data.storeId||input.epoch!==data.epoch||Math.abs(data.now-Date.parse(input.time))>300000)throw reservationError('STALE')
 if(input.action==='dine'&&(input.order?.costMode!==data.costMode||input.memberId!==null&&!data.members?.some(row=>row.id===input.memberId)))throw reservationError('STALE')
 const event=deriveReservationEvent(input,data.state,actor,new Date(data.now).toISOString(),{allowRecovery:data.state.needsRecovery===true,allowGuest})
 return {event,receipt:reservationReceipt(event),state:projectReservationEvent(data.state,event)}
}
// Authenticated staff view; this contains customer contacts and is never a
// guest availability or receipt response.
export function reservationStaffView(state,now){
 return {revision:state.revision,head:state.head,configVersion:state.configVersion,publicEnabled:state.publicEnabled,guestLinkPolicy:clone(state.guestLinkPolicy),diningLinks:reservationDiningLinks(state),config:clone(state.config),bookings:clone(state.bookings),needsRecovery:state.needsRecovery===true,history:state.events.map(event=>({id:event.id,action:event.input.action,bookingId:event.change.booking?.id||null,actor:clone(event.actor),time:event.time})),today:reservationParts(now,state.config.timeZone).date,now:new Date(now).toISOString()}
}
