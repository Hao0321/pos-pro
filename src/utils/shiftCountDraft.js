import {CASH_DENOMINATIONS,countedCash,emptyCashCount} from './cashCount.mjs'
import {draftObject} from '../../electron/privateDrafts.mjs'
import {shiftCountOriginal} from '../../electron/shiftCountDraft.mjs'
const denominations=new Set(CASH_DENOMINATIONS.map(row=>String(row.amount)))
export function validShiftCountDraft(value,context){
 try{
  draftObject(value,['kind','target','basis','cash','note','submission']);if(!['open','close'].includes(value.kind)||typeof value.target!=='string'||value.target.length>128||value.kind==='open'&&value.target!==''||value.kind==='close'&&!value.target||!/^[a-f0-9]{64}$/.test(value.basis)||typeof value.note!=='string'||value.note.length>4000)return false
  draftObject(value.cash,['mode','manual','counts']);if(!['manual','count'].includes(value.cash.mode)||typeof value.cash.manual!=='string'||value.cash.manual.length>64)return false
  const counts=value.cash.counts;if(!counts||typeof counts!=='object'||Array.isArray(counts)||Object.entries(counts).some(([key,raw])=>!denominations.has(key)||typeof raw!=='string'||raw.length>64))return false
  const s=value.submission;if(s===null)return true
  draftObject(s,['id','time','amount','note','cashier','cashierId']);const total=countedCash(value.cash)
  return total.valid&&s.amount===total.amount&&s.note===value.note&&typeof s.id==='string'&&/^[-A-Za-z0-9_:]{1,128}$/.test(s.id)&&(value.kind!=='open'||s.id.startsWith('S'))&&(value.kind!=='close'||s.id===value.target)&&Number.isFinite(Date.parse(s.time))&&typeof s.cashier==='string'&&s.cashier.length<=2000&&s.cashierId===context.userId
 }catch{return false}
}
export const newShiftCountDraft=(kind,target,basis)=>({kind,target,basis,cash:emptyCashCount(),note:'',submission:null})
export function shiftCountInput(value){
 const s=value.submission;if(!s)throw Error('請先等草稿核對完成')
 return value.kind==='open'?{id:s.id,openTime:s.time,openCash:s.amount,cashier:s.cashier,cashierId:s.cashierId}:{closeCash:s.amount,note:s.note}
}
export function savedShiftCount(value,shifts){return value.submission?shiftCountOriginal(value.kind,value.submission.id,shiftCountInput(value),shifts):null}
