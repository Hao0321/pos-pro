const {timingSafeEqual}=require('node:crypto')
const {canonicalSignature}=require('./operationRules.mjs')
const {draftObject}=require('./privateDrafts.mjs')
const {reservationData}=require('./reservationCommit.mjs')
const {reservationAvailability}=require('./reservationCapacity.mjs')
const {reservationParts,reservationAddDays}=require('./reservationCalendar.mjs')
const {reservationError}=require('./reservationConfig.mjs')
const {guestReservationRequest,guestReservationOperationId,guestReservationActor,guestReservationOriginal}=require('./reservationGuest.mjs')
const {hashGuestCapability:tokenHash,reservationGuestAccess}=require('./reservationService.mjs')
const {publicReservationDepositTerms,publicReservationDepositReceipt}=require('./reservationDepositPublic.mjs')
const sameHash=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b))
// This private database surface is used only by the guest HTTP host. It is not
// registered in preload, IPC, or companion RPC, and never invents a staff user.
module.exports=function(db,api,{book,known,commit}){
 const scope=()=>{const storeId=api.getSetting('sharedStoreId'),epoch=db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value;if(typeof storeId!=='string'||!storeId||typeof epoch!=='string'||!epoch)throw reservationError('CONFIG');return {storeId,epoch}}
 function current(){const context=scope(),retained=known(context),before=book(),now=Date.now(),{history}=reservationData(before,context,now,retained);return {scope:context,history,now}}
 function own(state,id,token,now){const booking=state.bookings.find(row=>row.id===id),access=booking&&reservationGuestAccess(state,booking,now);if(!access?.active||!sameHash(access.hash,tokenHash(token)))throw Object.assign(reservationError('ACCESS'),{committed:null});return booking}
 function context(value){const {scope:identity,history:{state},now}=value;return {protocol:'pos-reservation-public/v1',storeId:identity.storeId,storeName:api.getSetting('storeName')||'商店',enabled:state.publicEnabled&&state.config.enabled&&!state.needsRecovery,configVersion:state.configVersion,timeZone:state.config.timeZone,today:reservationParts(now,state.config.timeZone).date,lastDate:reservationAddDays(reservationParts(now,state.config.timeZone).date,state.config.horizonDays),durationMinutes:state.config.durationMinutes,noticeMinutes:state.config.noticeMinutes,guestLinkProtection:!!state.guestLinkPolicy,now:new Date(now).toISOString()}}
 function receipt(value,id,token,requestId=null){const row=own(value.history.state,id,token,value.now),canChange=row.status==='confirmed'&&row.startMs>value.now&&!value.history.state.needsRecovery,deposit=publicReservationDepositReceipt(value.history.state,row);return {protocol:'pos-reservation-guest-receipt/v1',success:true,storeId:value.scope.storeId,requestId,originalRequestId:guestReservationOriginal(value.history.state,id).input.request.requestId,linkExpiresAt:reservationGuestAccess(value.history.state,row,value.now).expiresAt,needsRecovery:value.history.state.needsRecovery,canCancel:canChange,canMove:canChange&&context(value).enabled,...(deposit?{deposit}:{}),booking:{id:row.id,revision:row.revision,status:row.status,date:row.date,slot:row.slot,partySize:row.partySize,customer:structuredClone(row.customer),note:row.note,timeZone:row.timeZone,start:new Date(row.startMs).toISOString(),end:new Date(row.endMs).toISOString()}}}
 api.getPublicReservationContext=()=>db.transaction(()=>context(current()))()
 api.getPublicReservationAvailability=(input,token)=>db.transaction(()=>{
  draftObject(input,['date','partySize','bookingId'],['date','partySize']);const value=current(),state=value.history.state;let existing=null
  if(input.bookingId){existing=own(state,input.bookingId,token,value.now);if(existing.status!=='confirmed'||existing.startMs<=value.now)throw reservationError('STATUS')}
  const available=reservationAvailability({...state,config:{...state.config,enabled:context(value).enabled}},input.date,input.partySize,value.now,{online:true,ignoreId:input.bookingId||''})
  return {...context(value),date:available.date,partySize:available.partySize,paused:available.paused,slots:available.slots.map(({slot,start,end})=>{const depositTerms=publicReservationDepositTerms(state,{date:available.date,slot,partySize:available.partySize},existing);return {slot,start,end,...(depositTerms?{depositTerms}:{})}})}
 })()
 api.getPublicReservation=(id,token)=>db.transaction(()=>receipt(current(),id,token))()
 api.applyPublicReservation=(request,token)=>{try{return db.transaction(()=>{
  const accessHash=tokenHash(token)
  if(request?.action==='book'){if(Object.hasOwn(request,'accessHash'))throw reservationError('CONFIG');request={...request,accessHash}}
  guestReservationRequest(request);const value=current(),id=guestReservationOperationId(request),existing=value.history.byId.get(id)
  if(request.storeId!==value.scope.storeId)throw reservationError('STALE')
  if(existing)own(value.history.state,existing.event.change.booking.id,token,value.now)
  if(request.action==='book'){if(!sameHash(request.accessHash,accessHash))throw reservationError('STATUS')}else own(value.history.state,request.bookingId,token,value.now)
  if(existing&&canonicalSignature(existing.event.input.request)!==canonicalSignature(request))throw Object.assign(reservationError('HISTORY'),{committed:null})
  const input=existing?.event.input||{protocol:'pos-reservation/v1',id,storeId:value.scope.storeId,epoch:value.scope.epoch,expectedRevision:value.history.state.revision,time:new Date(value.now).toISOString(),action:'guest',request:structuredClone(request),reviewed:true}
  const saved=commit(input,guestReservationActor(input),value.scope,{allowGuest:true})
  if(saved.success!==true)throw Object.assign(reservationError('HISTORY'),{committed:saved.committed})
  const result=receipt(current(),saved.receipt.event.change.booking.id,token,request.requestId)
  return result
 }).immediate()}catch(error){throw Object.assign(error,{committed:Object.hasOwn(error,'committed')?error.committed:false})}}
}
