import {draftObject} from '../../electron/privateDrafts.mjs'
import {moneyValue} from '../../electron/operationRules.mjs'
import {expenseDate} from '../../electron/expenseEntry.mjs'
import {drawerBasis,drawerReturnCommand,DRAWER_RETURN} from '../../electron/expenseDrawer.mjs'
export const newExpenseReturn=()=>({expense:null,drawer:null,date:'',submission:null})
export function validExpenseReturn(value){try{
 draftObject(value,['expense','drawer','date','submission']);if(typeof value.date!=='string')return false
 if(value.expense){draftObject(value.expense,['id','digest','description','amount']);if(!/^expense-entry-[-a-f0-9]{36}$/.test(value.expense.id)||!/^[a-f0-9]{64}$/.test(value.expense.digest)||typeof value.expense.description!=='string'||value.expense.description.length>500)return false;moneyValue(value.expense.amount,'支出金額',.01);expenseDate(value.date)}
 if(value.drawer)drawerBasis(value.drawer)
 if(value.submission){draftObject(value.submission,['id','time','date']);if(!value.expense||!value.drawer||!/^expense-return-[-a-f0-9]{36}$/.test(value.submission.id)||!Number.isFinite(Date.parse(value.submission.time)))return false;expenseDate(value.submission.date)}
 return true
}catch{return false}}
export function expenseReturnInput(value,context){if(!validExpenseReturn(value)||!value.submission)throw Error('退回紀錄需要核對，請保留原輸入。');return drawerReturnCommand({protocol:DRAWER_RETURN,...value.submission,draftContext:context,expenseId:value.expense.id,expectedDigest:value.expense.digest,drawer:value.drawer,physicalCashReturned:true})}
