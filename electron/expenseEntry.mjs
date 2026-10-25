import {ACCOUNTS} from './accountingCore.mjs'
import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
import {moneyValue,operationHeader} from './operationRules.mjs'
import {validateManualEntry} from './manualJournalRules.mjs'
import {memberTopupMoney} from './memberTopupDraft.mjs'
export const EXPENSE_PROTOCOL='pos-expense-entry/v1',EXPENSE_JOURNAL='expenseEntryReceiptsV1'
const uncertain=message=>Object.assign(Error(message),{historyUncertain:true})
export const expenseAccounts=Object.entries(ACCOUNTS).filter(([,value])=>value.type==='expense').map(([code])=>code)
export function expenseMoney(raw){if(typeof raw!=='string')throw Error('請填正確金額，最多到小數點後兩位。');const text=raw.normalize('NFKC').trim();return memberTopupMoney(text.startsWith('.')?'0'+text:text)}
export function expenseDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('請填正確的支出日期。');return value}
export function expenseCommand(value){
 draftObject(value,['protocol','id','time','draftContext','date','description','amount','expenseAccount','payAccount','note']);operationHeader(value);assertPrivateDraftContext(value.draftContext)
 if(value.protocol!==EXPENSE_PROTOCOL||!/^expense-entry-[-a-f0-9]{36}$/.test(value.id)||typeof value.description!=='string'||!value.description.trim()||value.description.length>500||typeof value.note!=='string'||value.note.length>1000||![...expenseAccounts,'1211'].includes(value.expenseAccount)||!['1101','1103','2101'].includes(value.payAccount))throw Error('支出內容需要核對，原輸入仍保留。')
 expenseDate(value.date);moneyValue(value.amount,'支出金額',.01);return structuredClone(value)
}
export function expenseEntry(value){const r=expenseCommand(value),entry={id:r.id,type:'manual',orderId:'',date:r.date,description:r.description.trim(),lines:[{account:r.expenseAccount,debit:r.amount,credit:0,note:r.note||r.description.trim()},{account:r.payAccount,debit:0,credit:r.amount,note:'付款'}]};validateManualEntry(entry);return entry}
const material=row=>({id:row.id,type:row.type,orderId:row.orderId||'',date:row.date,description:row.description,lines:row.lines})
export function readExpenseJournal(raw){
 if(raw==null)return {version:1,entries:[]}
 let journal;try{journal=typeof raw==='string'?JSON.parse(raw):structuredClone(raw);draftObject(journal,['version','entries']);if(journal.version!==1||!Array.isArray(journal.entries))throw Error();const ids=new Set();for(const row of journal.entries){draftObject(row,['id','digest','document','entry','removed']);const request=expenseCommand(row.document);if(ids.has(row.id)||row.id!==request.id||row.digest!==privateDraftDigest(request)||typeof row.removed!=='boolean'||privateDraftDigest(row.entry)!==privateDraftDigest(expenseEntry(request)))throw Error();ids.add(row.id)}}catch{throw uncertain('支出保存紀錄需要核對，請保留原輸入。')}return journal
}
export function expenseScope(context,current){assertPrivateDraftContext(context);assertPrivateDraftContext(current);if(current.role!=='owner'||privateDraftDigest(context)!==privateDraftDigest(current))throw uncertain('店面或帳號已變更，請保留原輸入核對。')}
export function expenseOriginal(input,current,journal,rows){
 draftObject(input,['family','context','id','digest','document']);if(input.family!=='expense-entry')throw Error('支出原單需要核對。');expenseScope(input.context,current);const request=expenseCommand(input.document);expenseScope(request.draftContext,current)
 if(input.id!==request.id||input.digest!==privateDraftDigest(request))throw uncertain('原支出編號內容不同，請保留原輸入。')
 const receipt=journal.entries.find(row=>row.id===input.id);if(!receipt)return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}
 if(receipt.digest!==input.digest)throw uncertain('原支出編號內容不同，請保留原輸入。')
 const row=rows.find(row=>row.id===input.id)
 if(receipt.removed?!!row:!row||privateDraftDigest(material(row))!==privateDraftDigest(receipt.entry))throw uncertain('原支出紀錄需要核對，請勿重新記帳。')
 return {protocol:'pos-private-draft-original/v1',status:'matched',id:request.id,digest:receipt.digest,action:'create',result:{protocol:EXPENSE_PROTOCOL,success:true,id:request.id,digest:receipt.digest,entry:row||null,removed:receipt.removed,receipt}}
}
export const expenseLookup=input=>({family:'expense-entry',context:input.draftContext,id:input.id,digest:privateDraftDigest(input),document:input})
export function planExpense(input,current,journal,rows,stockActive){
 const request=expenseCommand(input);expenseScope(request.draftContext,current);const original=expenseOriginal(expenseLookup(request),current,journal,rows);if(original.status==='matched')return {request,original}
 if(rows.some(row=>row.id===request.id))throw uncertain('原支出紀錄需要核對，請勿重新記帳。')
 if(stockActive&&request.expenseAccount==='1211')throw Error('進貨請到進貨管理，數量與成本會一起保存')
 const entry=expenseEntry(request),receipt={id:request.id,digest:privateDraftDigest(request),document:request,entry,removed:false};return {request,entry,receipt,original:null}
}
export function verifyExpenseProof(input,proof){if(proof?.protocol!=='pos-private-draft-original/v1'||proof.status!=='matched'||proof.id!==input.id||proof.digest!==privateDraftDigest(input)||proof.action!=='create'||proof.result?.protocol!==EXPENSE_PROTOCOL||proof.result.success!==true)throw Error('支出結果尚未確認，請先核對原編號。');const history=readExpenseJournal({version:1,entries:[proof.result.receipt]});expenseOriginal(expenseLookup(input),input.draftContext,history,proof.result.entry?[proof.result.entry]:[]);return proof.result}
