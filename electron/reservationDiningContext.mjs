import {reservationError} from './reservationConfig.mjs'
import {reservationDiningSchedule} from './reservationDining.mjs'
import {draftObject} from './privateDrafts.mjs'

export function reservationDiningContext(input,state,restaurant,products,members,costMode){
 draftObject(input,['bookingId'])
 const booking=state.bookings.find(row=>row.id===input.bookingId)
 if(state.needsRecovery)throw reservationError('DINING_RECOVERY')
 if(!booking||booking.status!=='seated')throw reservationError('STALE')
 const tableNames=booking.tableIds.map(id=>state.config.tables.find(row=>row.id===id)?.name)
 if(!tableNames.length||tableNames.some(name=>!name))throw reservationError('CONFIG')
 return {protocol:'pos-reservation-dining-context/v1',storeId:state.storeId,epoch:state.epoch,revision:state.revision,now:state.now,timeZone:state.config.timeZone,costMode,booking:structuredClone(booking),tableNames,restaurant:{...structuredClone(restaurant),storeId:state.storeId,epoch:state.epoch,costMode,today:state.today,now:state.now},products:structuredClone(products),members:members.map(({id,name,phone})=>({id,name,phone})),...reservationDiningSchedule(state.now,state.config.timeZone)}
}
