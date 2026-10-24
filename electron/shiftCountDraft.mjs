import {privateDraftDigest,privateDraftMappingInput,draftObject} from './privateDrafts.mjs'
import {moneyValue} from './operationRules.mjs'
import {summarizeShift} from './shiftReconciliation.mjs'
const changed=()=>Object.assign(Error('班別或現金已變動，請重新點算。'),{code:'SHIFT_COUNT_CHANGED'})
export const isShiftCountRequest=input=>Object.hasOwn(input||{},'draftContext')||Object.hasOwn(input||{},'draftBasis')
export function shiftCountBasis(kind,book,target=''){
 if(!Array.isArray(book.shifts))throw Error('班別資料需要核對')
 if(kind==='open'){
  if(book.shifts.some(row=>row.status==='open'))throw changed()
  return privateDraftDigest(book.shifts.map(row=>[row.id,row.status,row.openTime,row.closeTime||'']).sort((a,b)=>String(a[0])===String(b[0])?0:String(a[0])<String(b[0])?-1:1))
 }
 const shift=book.shifts.find(row=>row.id===target)
 if(kind!=='close'||!shift||shift.status!=='open'||book.shifts.filter(row=>row.status==='open').length!==1)throw changed()
 const ids=rows=>rows.filter(row=>row.shiftId===target).map(row=>[String(row.id||''),String(row.time||'')]).sort((a,b)=>a[0]===b[0]?0:a[0]<b[0]?-1:1)
 return privateDraftDigest({shift:{id:shift.id,openTime:shift.openTime,openCash:shift.openCash},stats:summarizeShift(shift,book.orders,book.cashLog,book.topups),orders:ids(book.orders),cashLog:ids(book.cashLog),topups:ids(book.topups)})
}
export function shiftCountOriginal(kind,id,input,shifts){
 if(!Array.isArray(shifts))throw Error('班別資料需要核對')
 const row=shifts.find(value=>value.id===id);if(!row)return null
 if(kind==='open'){
  if(!['open','closed'].includes(row.status)||['openCash','openTime','cashier','cashierId'].some(key=>(row[key]??'')!==(input[key]??'')))throw Error('原開班內容不同，請保留點算並核對。')
  moneyValue(row.openCash,'開班現金');return row
 }
 if(kind!=='close')throw changed()
 if(row.status==='open')return null
 if(row.status!=='closed'||row.closeCash!==input.closeCash||(row.note||'')!==(input.note||''))throw Error('原交班內容不同，請保留點算並核對。')
 if(!Number.isFinite(row.expectedCash)||!Number.isFinite(row.diff)||Math.round((row.closeCash-row.expectedCash)*100)!==Math.round(row.diff*100))throw Error('交班紀錄需要核對')
 moneyValue(row.closeCash,'交班現金');return row
}
export function admitShiftCount(kind,id,input,current,book,actor){
 const {draftBasis,...data}=privateDraftMappingInput(input,current)
 if(typeof draftBasis!=='string'||!/^[a-f0-9]{64}$/.test(draftBasis))throw changed()
 draftObject(data,kind==='open'?['id','cashier','cashierId','openTime','openCash']:['closeCash','note'])
 if(kind==='open'){
  if(typeof data.id!=='string'||!/^S[-A-Za-z0-9_:]{1,127}$/.test(data.id)||!Number.isFinite(Date.parse(data.openTime))||data.cashier!==actor?.username||data.cashierId!==actor?.userId)throw Error('店面或帳號已變更，請保留原輸入核對。')
  moneyValue(data.openCash,'開班現金')
 }else{moneyValue(data.closeCash,'交班現金');if(typeof data.note!=='string'||data.note.length>4000)throw changed()}
 const original=shiftCountOriginal(kind,id,data,book.shifts)
 if(!original&&shiftCountBasis(kind,book,id)!==draftBasis)throw changed()
 return {data,original}
}
export function shiftCountResult(kind,row,alreadySaved=false){return kind==='open'?{success:true,id:row.id,shift:row,alreadySaved}:{success:true,expected:row.expectedCash,diff:row.diff,shift:row,alreadySaved}}
export function shiftCountRejection(kind,id,input,error){if(error.code!=='SHIFT_COUNT_CHANGED')throw error;return {success:false,committed:false,error:error.message,errorCode:error.code,requestDigest:privateDraftDigest([kind,id,input])}}
export function isShiftCountRejection(result,kind,id,input){return result?.success===false&&result.committed===false&&result.errorCode==='SHIFT_COUNT_CHANGED'&&result.requestDigest===privateDraftDigest([kind,id,input])}
