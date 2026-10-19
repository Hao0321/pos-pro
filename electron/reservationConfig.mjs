import {draftObject} from './privateDrafts.mjs'
import {reservationDate,reservationMinutes,reservationZone} from './reservationCalendar.mjs'

export const RESERVATION_PROTOCOL='pos-reservation/v1',RESERVATION_EVENT='pos-reservation-event/v1',RESERVATION_FEATURE='reservation-capacity-v1',RESERVATION_FENCE='reservationVersionFence',RESERVATION_HEAD='reservationBookHead',RESERVATION_ACTION='RESERVATION_OPERATION',RESERVATION_METHOD='applyReservationOperation'
const errors={CONFIG:'訂位設定需要核對。',HISTORY:'訂位紀錄或保存回執需要核對，請保留原編號。',STALE:'訂位資料已更新，請重新核對。',FULL:'這個時段已沒有合適桌位，請選其他時間。',RECOVERY:'資料已還原，請先核對未來訂位，再恢復接單。',TIME:'訂位日期或時段需要核對。',STATUS:'這筆訂位目前不能進行這個操作。'}
export const reservationError=code=>Object.assign(Error(code==='DINING_RECOVERY'?'訂位對應的餐飲原單尚未找回，請先用完整備份核對復原。':code==='ACCESS'?'私人訂位連結需要更新，請聯絡店家。':errors[code]||errors.HISTORY),{code:'RESERVATION_'+code})
export const reservationId=value=>{if(typeof value!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(value))throw reservationError('HISTORY');return value}
export function reservationText(value,max,required=false,multiline=false){if(multiline&&typeof value==='string')value=value.replace(/\r\n?/g,'\n');if(typeof value!=='string'||value.length>max||/[\p{Cc}\p{Cf}]/u.test(multiline?value.replace(/\n/g,''):value)||required&&!value.trim())throw reservationError('CONFIG');return value.trim()}
export const reservationInteger=(value,min,max)=>{if(!Number.isSafeInteger(value)||value<min||value>max)throw reservationError('CONFIG');return value}
export const defaultReservationConfig=()=>({enabled:false,timeZone:'Asia/Taipei',durationMinutes:90,bufferMinutes:15,slotMinutes:15,noticeMinutes:30,horizonDays:60,tables:[],combinations:[],weekly:[{day:1,windows:[{start:'11:00',end:'14:00'},{start:'17:00',end:'21:00'}]},{day:2,windows:[{start:'11:00',end:'14:00'},{start:'17:00',end:'21:00'}]},{day:3,windows:[{start:'11:00',end:'14:00'},{start:'17:00',end:'21:00'}]},{day:4,windows:[{start:'11:00',end:'14:00'},{start:'17:00',end:'21:00'}]},{day:5,windows:[{start:'11:00',end:'14:00'},{start:'17:00',end:'21:00'}]},{day:6,windows:[{start:'11:00',end:'14:00'},{start:'17:00',end:'21:00'}]},{day:0,windows:[{start:'11:00',end:'14:00'},{start:'17:00',end:'21:00'}]}],exceptions:[]})
function windows(rows){
 if(!Array.isArray(rows)||rows.length>8)throw reservationError('CONFIG')
 const spans=rows.map(row=>{draftObject(row,['start','end']);const start=reservationMinutes(row.start),raw=reservationMinutes(row.end,{end:true}),end=raw>start?raw:raw+1440;return {start,end,row}}).sort((a,b)=>a.start-b.start)
 if(spans.some((row,index)=>index&&row.start<spans[index-1].end))throw reservationError('CONFIG')
 return spans.map(({row})=>({...row}))
}
export function normalizeReservationConfig(input){
 try{
  draftObject(input,['enabled','timeZone','durationMinutes','bufferMinutes','slotMinutes','noticeMinutes','horizonDays','tables','combinations','weekly','exceptions'])
  if(typeof input.enabled!=='boolean'||!Array.isArray(input.tables)||input.tables.length>200||!Array.isArray(input.combinations)||input.combinations.length>200||!Array.isArray(input.weekly)||input.weekly.length!==7||!Array.isArray(input.exceptions)||input.exceptions.length>400)throw reservationError('CONFIG')
  reservationZone(input.timeZone);reservationInteger(input.durationMinutes,5,720);reservationInteger(input.bufferMinutes,0,180);reservationInteger(input.noticeMinutes,0,10080);reservationInteger(input.horizonDays,1,365)
  if(![5,10,15,30,60].includes(input.slotMinutes))throw reservationError('CONFIG')
  const ids=new Set(),tables=input.tables.map(row=>{draftObject(row,['id','name','seats','online']);reservationId(row.id);if(ids.has(row.id)||typeof row.online!=='boolean')throw reservationError('CONFIG');ids.add(row.id);return {...row,name:reservationText(row.name,50,true),seats:reservationInteger(row.seats,1,100)}})
  if(input.enabled&&!tables.length)throw reservationError('CONFIG')
  const groupIds=new Set(),groups=new Set(),combinations=input.combinations.map(row=>{draftObject(row,['id','tableIds']);reservationId(row.id);if(groupIds.has(row.id)||!Array.isArray(row.tableIds)||row.tableIds.length<2||row.tableIds.length>10||new Set(row.tableIds).size!==row.tableIds.length||row.tableIds.some(id=>!ids.has(id)))throw reservationError('CONFIG');groupIds.add(row.id);const tableIds=[...row.tableIds].sort(),key=JSON.stringify(tableIds);if(groups.has(key))throw reservationError('CONFIG');groups.add(key);return {id:row.id,tableIds}})
  const days=new Set(),weekly=input.weekly.map(row=>{draftObject(row,['day','windows']);reservationInteger(row.day,0,6);if(days.has(row.day))throw reservationError('CONFIG');days.add(row.day);return {day:row.day,windows:windows(row.windows)}}).sort((a,b)=>a.day-b.day)
  const spans=weekly.flatMap(row=>row.windows.map(window=>{const start=row.day*1440+reservationMinutes(window.start),raw=reservationMinutes(window.end,{end:true}),end=row.day*1440+raw+(raw>reservationMinutes(window.start)?0:1440);return {start,end}})).sort((a,b)=>a.start-b.start)
  if(spans.some((row,index)=>index&&row.start<spans[index-1].end)||spans.length>1&&spans[0].start+10080<spans.at(-1).end)throw reservationError('CONFIG')
  const dates=new Set(),exceptions=input.exceptions.map(row=>{draftObject(row,['date','windows']);reservationDate(row.date);if(dates.has(row.date))throw reservationError('CONFIG');dates.add(row.date);return {date:row.date,windows:windows(row.windows)}}).sort((a,b)=>a.date.localeCompare(b.date))
  return {...input,tables,combinations,weekly,exceptions}
 }catch(error){if(error.code==='RESERVATION_CONFIG')throw error;throw reservationError('CONFIG')}
}
