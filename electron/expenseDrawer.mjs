import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
import {expenseCommand,expenseEntry,expenseScope,expenseDate,EXPENSE_PROTOCOL} from './expenseEntry.mjs'
import {operationHeader,moneyValue} from './operationRules.mjs'
import {salesDate} from './salesRules.mjs'
import {summarizeShift} from './shiftReconciliation.mjs'

export const DRAWER_EXPENSE='pos-drawer-expense/v1',DRAWER_RETURN='pos-expense-cash-return/v1',DRAWER_JOURNAL='expenseDrawerReceiptsV1'
const clone=value=>structuredClone(value),same=(a,b)=>privateDraftDigest(a)===privateDraftDigest(b)
const uncertain=()=>Object.assign(Error('抽屜支出與現金紀錄需要核對，請勿重做。'),{historyUncertain:true})
const reject=(message,code)=>Object.assign(Error(message),{code})
const object=(value,keys,required=keys)=>draftObject(value,keys,required)
const material=row=>({id:row.id,type:row.type,orderId:row.orderId||'',date:row.date,description:row.description,lines:row.lines})
export function drawerBasis(value){object(value,['id','openTime','cashier']);if(!/^[-A-Za-z0-9_:]{1,128}$/.test(value.id)||!Number.isFinite(Date.parse(value.openTime))||typeof value.cashier!=='string'||!value.cashier||value.cashier.length>2000)throw uncertain();return clone(value)}
export function drawerExpenseCommand(input){
 object(input,['protocol','id','time','draftContext','date','description','amount','expenseAccount','payAccount','note','drawer'])
 const {drawer,...value}=input;expenseCommand({...value,protocol:EXPENSE_PROTOCOL});drawerBasis(drawer)
 if(input.protocol!==DRAWER_EXPENSE||input.payAccount!=='1101'||input.expenseAccount==='1211')throw reject('抽屜支出請用今天與現金付款記錄。','DRAWER_DATE_OR_ACCOUNT')
 return clone(input)
}
export function drawerReturnCommand(input){
 object(input,['protocol','id','time','date','draftContext','expenseId','expectedDigest','drawer','physicalCashReturned']);operationHeader(input);assertPrivateDraftContext(input.draftContext);drawerBasis(input.drawer)
 expenseDate(input.date)
 if(input.protocol!==DRAWER_RETURN||!/^expense-return-[-a-f0-9]{36}$/.test(input.id)||!/^expense-entry-[-a-f0-9]{36}$/.test(input.expenseId)||!/^[a-f0-9]{64}$/.test(input.expectedDigest)||input.physicalCashReturned!==true)throw reject('請確認現金已實際退回，再記錄退回。','DRAWER_RETURN_CONFIRMATION')
 return clone(input)
}
const core=input=>{const {drawer,...value}=input;return {...value,protocol:EXPENSE_PROTOCOL}}
const outgoing=input=>({id:'expense-out-'+input.id.slice('expense-entry-'.length),time:input.time,shiftId:input.drawer.id,type:'out',amount:input.amount,reason:input.description.trim(),cashier:input.drawer.cashier})
function returning(input,original){return {entry:{id:input.id,type:'manual',orderId:'',date:input.date,description:'退回支出：'+original.document.description.trim(),lines:[{account:'1101',debit:original.document.amount,credit:0,note:'現金已退回抽屜'},{account:original.document.expenseAccount,debit:0,credit:original.document.amount,note:original.document.note||original.document.description.trim()}]},cashIn:{id:'expense-in-'+input.id.slice('expense-return-'.length),time:input.time,shiftId:input.drawer.id,type:'in',amount:original.document.amount,reason:'退回支出：'+original.document.description.trim(),cashier:input.drawer.cashier}}}
export function readDrawerJournal(raw){
 if(raw==null)return {version:1,entries:[]}
 try{
  const journal=typeof raw==='string'?JSON.parse(raw):clone(raw);object(journal,['version','entries']);if(journal.version!==1||!Array.isArray(journal.entries))throw uncertain();const ids=new Set()
  for(const row of journal.entries){
   object(row,['id','digest','document','entry','cashOut','returned']);const request=drawerExpenseCommand(row.document)
   if(ids.has(row.id)||row.id!==request.id||row.digest!==privateDraftDigest(request)||!same(row.entry,expenseEntry(core(request)))||!same(row.cashOut,outgoing(request)))throw uncertain();ids.add(row.id)
   if(row.returned!==null){const saved=row.returned;object(saved,['id','digest','document','entry','cashIn']);const refund=drawerReturnCommand(saved.document),expected=returning(refund,row)
    if(ids.has(saved.id)||saved.id!==refund.id||refund.expenseId!==row.id||refund.expectedDigest!==row.digest||saved.digest!==privateDraftDigest(refund)||refund.draftContext.storeId!==request.draftContext.storeId||!same(saved.entry,expected.entry)||!same(saved.cashIn,expected.cashIn))throw uncertain();ids.add(saved.id)
   }
  }return journal
 }catch{throw uncertain()}
}
export function validateDrawerBook(journal,{manualEntries,cashLog,shifts}){
 const cashIds=new Set(),entryIds=new Set()
 function pair(entry,cash,basis){const a=manualEntries.filter(row=>row.id===entry.id),b=cashLog.filter(row=>row.id===cash.id),s=shifts.find(row=>row.id===cash.shiftId);if(a.length!==1||b.length!==1||!same(material(a[0]),entry)||!same(b[0],cash)||!s||s.openTime!==basis.openTime||Date.parse(cash.time)<Date.parse(s.openTime)||s.status==='closed'&&s.closeTime&&Date.parse(cash.time)>Date.parse(s.closeTime))throw uncertain();cashIds.add(cash.id);entryIds.add(entry.id)}
 for(const row of journal.entries){pair(row.entry,row.cashOut,row.document.drawer);if(row.returned)pair(row.returned.entry,row.returned.cashIn,row.returned.document.drawer)}
 if(cashLog.some(row=>/^expense-(?:out|in)-/.test(row.id)&&!cashIds.has(row.id)))throw uncertain()
 return {cashIds,entryIds}
}
function activeShift(facts){const rows=facts.shifts.filter(row=>row.status==='open');if(rows.length>1)throw uncertain();return rows[0]||null}
function storeScope(journal,context){if(journal.entries.some(row=>row.document.draftContext.storeId!==context.storeId))throw uncertain()}
export function expenseDrawerState(context,journal,facts,actor,now=new Date().toISOString()){
 if(context.role!=='owner')throw Error('此操作需要店主權限');storeScope(journal,context);validateDrawerBook(journal,facts);const shift=activeShift(facts)
 return {protocol:'pos-expense-drawer-state/v1',context,now,date:salesDate(new Date(now)),shift:shift?{id:shift.id,openTime:shift.openTime,cashier:shift.cashier||'',basis:{id:shift.id,openTime:shift.openTime,cashier:actor.username},expected:summarizeShift(shift,facts.orders,facts.cashLog,facts.topups).expected}:null,expenses:journal.entries.map(row=>({id:row.id,digest:row.digest,description:row.entry.description,date:row.entry.date,amount:row.document.amount,shiftId:row.cashOut.shiftId,returned:!!row.returned,returnEntryId:row.returned?.entry.id||'',returnShiftId:row.returned?.cashIn.shiftId||''}))}
}
function admitShift(request,context,facts,actor,now){
 expenseScope(request.draftContext,context);const shift=activeShift(facts)
 if(!shift||shift.id!==request.drawer.id||shift.openTime!==request.drawer.openTime)throw reject('班次已變更，請先確認現金實際在哪一班進出。','DRAWER_SHIFT_CHANGED')
 if(request.drawer.cashier!==actor.username||Date.parse(request.time)<Date.parse(shift.openTime)||Date.parse(request.time)>Date.parse(now)+60000||request.date!==salesDate(new Date(now)))throw reject('抽屜現金的日期或操作人員已變更，請重新核對。','DRAWER_TIME_CHANGED')
 return shift
}
function resultFor(row,request){const returned=row.returned,isReturn=request.protocol===DRAWER_RETURN;return {protocol:isReturn?DRAWER_RETURN:DRAWER_EXPENSE,success:true,id:request.id,digest:privateDraftDigest(request),entry:isReturn?returned.entry:row.entry,entries:[row.entry,...(returned?[returned.entry]:[])],cashLogs:[row.cashOut,...(returned?[returned.cashIn]:[])],returned:!!returned,sourceReceipt:clone(row)}}
export const drawerLookup=input=>({family:input.protocol===DRAWER_RETURN?'expense-drawer-return':'expense-drawer',context:input.draftContext,id:input.id,digest:privateDraftDigest(input),document:input})
export function drawerOriginal(input,current,journal,facts){
 object(input,['family','context','id','digest','document']);expenseScope(input.context,current);const isReturn=input.family==='expense-drawer-return',request=isReturn?drawerReturnCommand(input.document):drawerExpenseCommand(input.document);expenseScope(request.draftContext,current)
 if(!['expense-drawer','expense-drawer-return'].includes(input.family)||input.id!==request.id||input.digest!==privateDraftDigest(request))throw uncertain();storeScope(journal,current);validateDrawerBook(journal,facts)
 const row=journal.entries.find(row=>row.id===(isReturn?request.expenseId:request.id));if(!row)return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}
 if(isReturn){if(row.digest!==request.expectedDigest)throw uncertain();if(!row.returned)return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id};if(row.returned.id!==request.id)return {protocol:'pos-private-draft-original/v1',status:'rejected',id:input.id,digest:input.digest,reason:'ALREADY_RETURNED',sourceReceipt:clone(row),entries:[row.entry,row.returned.entry],cashLogs:[row.cashOut,row.returned.cashIn]};if(row.returned.digest!==input.digest)throw uncertain()}
 else if(row.digest!==input.digest)throw uncertain()
 return {protocol:'pos-private-draft-original/v1',status:'matched',id:input.id,digest:input.digest,action:'create',result:resultFor(row,request)}
}
export function planDrawerOperation(input,context,journal,facts,actor,now=new Date().toISOString()){
 const isReturn=input.protocol===DRAWER_RETURN,request=isReturn?drawerReturnCommand(input):drawerExpenseCommand(input);expenseScope(request.draftContext,context);const proof=drawerOriginal(drawerLookup(request),context,journal,facts)
 if(proof.status==='matched')return {original:proof.result};if(proof.status==='rejected')throw reject('別台已記錄這筆退回，請核對現金，勿重複退回。','DRAWER_ALREADY_RETURNED')
 const shift=admitShift(request,context,facts,actor,now)
 if(isReturn){const row=journal.entries.find(row=>row.id===request.expenseId);if(!row||row.digest!==request.expectedDigest||row.document.draftContext.storeId!==context.storeId)throw uncertain();const pair=returning(request,row);if(facts.manualEntries.some(row=>row.id===pair.entry.id)||facts.cashLog.some(row=>row.id===pair.cashIn.id))throw uncertain();const returned={id:request.id,digest:privateDraftDigest(request),document:request,...pair};return {entry:pair.entry,cash:pair.cashIn,journal:{version:1,entries:journal.entries.map(value=>value.id===row.id?{...row,returned}:value)}}}
 const expected=summarizeShift(shift,facts.orders,facts.cashLog,facts.topups).expected;moneyValue(request.amount,'支出金額',.01);if(Math.round(request.amount*100)>Math.round(expected*100))throw reject('抽屜預計現金不足，請先核對或改用其他付款。','DRAWER_INSUFFICIENT')
 const entry=expenseEntry(core(request)),cash=outgoing(request);if(facts.manualEntries.some(row=>row.id===entry.id)||facts.cashLog.some(row=>row.id===cash.id))throw uncertain();const receipt={id:request.id,digest:privateDraftDigest(request),document:request,entry,cashOut:cash,returned:null};return {entry,cash,journal:{version:1,entries:[...journal.entries,receipt]}}
}
export function verifyDrawerProof(input,proof){
 const isReturn=input.protocol===DRAWER_RETURN
 if(proof?.protocol!=='pos-private-draft-original/v1'||proof.id!==input.id||proof.digest!==privateDraftDigest(input)||!['matched',...(isReturn?['rejected']:[])].includes(proof.status))throw uncertain()
 const result=proof.status==='matched'?proof.result:proof,row=result.sourceReceipt,journal=readDrawerJournal({version:1,entries:[row]});if(!Array.isArray(result.entries)||!Array.isArray(result.cashLogs)||result.entries.length!==(row.returned?2:1)||result.cashLogs.length!==result.entries.length)throw uncertain();validateDrawerBook(journal,{manualEntries:result.entries,cashLog:result.cashLogs,shifts:[{id:row.cashOut.shiftId,openTime:row.document.drawer.openTime,status:'open'},...(row.returned?[{id:row.returned.cashIn.shiftId,openTime:row.returned.document.drawer.openTime,status:'open'}]:[])]})
 if(proof.status==='rejected'){if(!isReturn||proof.reason!=='ALREADY_RETURNED'||row.id!==input.expenseId||row.digest!==input.expectedDigest||row.returned.id===input.id)throw uncertain();return result}
 if(result.success!==true||result.protocol!==input.protocol||result.id!==input.id||result.digest!==proof.digest||(!isReturn?row.digest:row.returned?.digest)!==proof.digest)throw uncertain();return result
}
export function drawerRejection(input,error,known=false){return {protocol:input.protocol,success:false,committed:known||error.historyUncertain?null:false,id:input.id,digest:privateDraftDigest(input),error:error.message,errorCode:error.code||''}}
export const isDrawerRejection=(input,result)=>result?.protocol===input.protocol&&result.success===false&&result.committed===false&&result.id===input.id&&result.digest===privateDraftDigest(input)
