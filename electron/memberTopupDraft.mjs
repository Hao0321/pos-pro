import {draftObject,privateDraftMappingInput} from './privateDrafts.mjs'
import {moneyValue,operationHeader,sameCommand} from './operationRules.mjs'
export const memberTopupFields=['id','time','memberId','amount','bonus','payMethod','cashier','note','shiftId']
export const isMemberTopupDraft=input=>Object.hasOwn(input||{},'draftContext')
export function memberTopupMoney(text,{optional=false}={}){
 if(typeof text!=='string')throw Error('請填正確金額，最多到小數點後兩位。')
 const value=text.normalize('NFKC').trim();if(optional&&!value)return 0
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value))throw Error('請填正確金額，最多到小數點後兩位。')
 const amount=Number(value.replaceAll(',',''));moneyValue(amount,'儲值金額',optional?0:.01);return amount
}
export function memberTopupTotals(balance,amount,bonus){
 for(const value of [balance,amount,bonus])moneyValue(value,'儲值金額')
 const creditCents=Math.round(amount*100)+Math.round(bonus*100),balanceCents=Math.round(balance*100)+creditCents
 if(!Number.isSafeInteger(creditCents)||!Number.isSafeInteger(balanceCents))throw Error('儲值金額超出可保存範圍。')
 moneyValue(balanceCents/100,'儲值餘額');return {received:amount,gift:bonus,credited:creditCents/100,balance:balanceCents/100}
}
export function memberTopupBasis(row){if(!row)throw Error('找不到原會員，請保留這筆儲值核對。');return {id:row.id,name:row.name,phone:row.phone}}
export function assertMemberTopupBasis(value){draftObject(value,['id','name','phone']);if(typeof value.id!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(value.id)||['name','phone'].some(key=>typeof value[key]!=='string'||value[key].length>2000))throw Error('會員資料需要核對。');return value}
export function memberTopupInput(input,current,actor){
 if(!Object.hasOwn(input||{},'draftContext'))throw Error('店面或帳號已變更，請保留原輸入核對。')
 const body=privateDraftMappingInput(input,current);draftObject(body,[...memberTopupFields,'memberBasis']);operationHeader(body);assertMemberTopupBasis(body.memberBasis)
 if(!/^member-topup-[-a-f0-9]{36}$/.test(body.id)||body.memberId!==body.memberBasis.id||body.cashier!==actor?.username||body.note!==''||typeof body.shiftId!=='string'||body.shiftId.length>128||!['cash','card'].includes(body.payMethod))throw Error('原儲值資料需要核對，請保留輸入。')
 moneyValue(body.amount,'儲值金額',.01);moneyValue(body.bonus,'贈額');if(current.role!=='owner'&&body.bonus!==0)throw Error('員工沒有儲值贈額權限')
 return Object.fromEntries(memberTopupFields.map(key=>[key,body[key]]))
}
export function memberTopupOriginal(input,rows){
 if(!Array.isArray(rows))throw Error('儲值紀錄讀不到，請保留原編號。')
 const row=rows.find(row=>row.id===input.id);if(!row)return null
 if(!sameCommand(row,input,memberTopupFields))throw Error('原儲值編號的內容不同，請保留輸入核對。')
 operationHeader(row);moneyValue(row.amount,'儲值金額',.01);moneyValue(row.bonus,'贈額');return row
}
export function admitMemberTopup(input,current,facts,actor){
 const data=memberTopupInput(input,current,actor),original=memberTopupOriginal(data,facts.topups);if(original)return {data,original}
 const row=facts.members.find(row=>row.id===data.memberId),changed=(message,kind)=>Object.assign(Error(message),{code:'MEMBER_TOPUP_REVIEW_CHANGED',review:kind})
 if(!row||JSON.stringify(memberTopupBasis(row))!==JSON.stringify(input.memberBasis))throw changed('會員資料已更新，請先核對這筆儲值的會員。','member')
 if(facts.shifts.filter(row=>row.status==='open').length!==1||!facts.shifts.some(row=>row.id===data.shiftId&&row.status==='open'))throw changed('原班次已結束，請先核對這筆儲值的班次。','shift')
 memberTopupTotals(row.balance||0,data.amount,data.bonus);return {data,original:null}
}
