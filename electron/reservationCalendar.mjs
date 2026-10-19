const formatters=new Map(),minute=60000
const bad=()=>{throw Object.assign(Error('這個當地時間不存在或有兩種可能，請選擇其他時間。'),{code:'RESERVATION_LOCAL_TIME'})}
export function reservationDate(value){
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))bad()
 const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day))
 if(date.toISOString().slice(0,10)!==value)bad();return value
}
export function reservationMinutes(value,{end=false}={}){
 if(end&&value==='24:00')return 1440
 if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))bad()
 const [hour,min]=value.split(':').map(Number);return hour*60+min
}
export function reservationZone(value){
 if(typeof value!=='string'||value.length>100)bad()
 try{new Intl.DateTimeFormat('en-GB',{timeZone:value}).format(0)}catch{bad()};return value
}
export function reservationParts(instant,zone){
 if(!Number.isFinite(instant))bad()
 let formatter=formatters.get(zone)
 if(!formatter){reservationZone(zone);formatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});if(formatters.size>=16)formatters.delete(formatters.keys().next().value);formatters.set(zone,formatter)}
 const parts=Object.fromEntries(formatter.formatToParts(instant).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]))
 return {date:parts.year+'-'+parts.month+'-'+parts.day,slot:parts.hour+':'+parts.minute}
}
export function reservationAddDays(date,days){reservationDate(date);if(!Number.isSafeInteger(days)||Math.abs(days)>400)bad();return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)}
function matches(date,slot,zone){
 reservationDate(date);reservationMinutes(slot);reservationZone(zone)
 const wall=Date.parse(date+'T'+slot+':00Z'),offsets=new Set()
 for(const hours of [-36,-24,-12,0,12,24,36]){const probe=wall+hours*3600000,local=reservationParts(probe,zone);offsets.add(Date.parse(local.date+'T'+local.slot+':00Z')-probe)}
 return [...new Set([...offsets].map(offset=>wall-offset))].filter(value=>{const local=reservationParts(value,zone);return local.date===date&&local.slot===slot}).sort((a,b)=>a-b)
}
export function reservationInstant(date,slot,zone){const found=matches(date,slot,zone);if(found.length!==1)bad();return found[0]}
function boundary(date,slot,zone,end=false){const found=matches(date,slot,zone);if(!found.length)bad();return end?found.at(-1):found[0]}
function startOfDay(date,zone){
 let low=Date.parse(date+'T00:00:00Z')-48*3600000,high=low+96*3600000
 while(high-low>minute){const middle=Math.floor((low+high)/2/minute)*minute;if(reservationParts(middle,zone).date<date)low=middle;else high=middle}
 return high
}
export function reservationWindows(config,date){
 reservationDate(date);const dates=[-1,0,1,2].map(n=>reservationAddDays(date,n)),zone=config.timeZone
 const intervals=(anchor,windows)=>windows.map(row=>{const start=reservationMinutes(row.start),end=reservationMinutes(row.end,{end:true}),endDate=end>start&&end<1440?anchor:reservationAddDays(anchor,1),endSlot=end===1440?'00:00':row.end;return {start:boundary(anchor,row.start,zone),end:boundary(endDate,endSlot,zone,true)}})
 let result=dates.flatMap(anchor=>intervals(anchor,config.weekly.find(row=>row.day===new Date(anchor+'T00:00:00Z').getUTCDay())?.windows||[]))
 for(const anchor of dates){const exception=config.exceptions.find(row=>row.date===anchor);if(!exception)continue;const start=startOfDay(anchor,zone),end=startOfDay(reservationAddDays(anchor,1),zone)
  result=result.flatMap(row=>row.end<=start||row.start>=end?[row]:[...(row.start<start?[{start:row.start,end:start}]:[]),...(row.end>end?[{start:end,end:row.end}]:[])])
  result.push(...intervals(anchor,exception.windows))
 }
 const merged=[];for(const row of result.sort((a,b)=>a.start-b.start||a.end-b.end)){if(row.end<=row.start)bad();const last=merged.at(-1);if(last&&row.start<=last.end)last.end=Math.max(last.end,row.end);else merged.push({...row})}
 return merged
}
