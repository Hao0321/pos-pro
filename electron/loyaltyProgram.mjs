import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
import {operationHeader,canonicalSignature} from './operationRules.mjs'
export const LOYALTY_PROGRAMS='loyaltyProgramsV1'
export const LOYALTY_RULE_KEYS=['pointsEarnRate','pointsRedeemRate','birthdayBonus']
const invalid=()=>Error('會員福利資料需要核對，原規則仍保留。'),same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
export function loyaltyRules(value){draftObject(value,['earn','redeem','birthdayBonus']);for(const key of ['earn','redeem'])if(typeof value[key]!=='number'||!Number.isFinite(value[key])||value[key]<.01||value[key]>1000000000)throw invalid();if(!Number.isSafeInteger(value.birthdayBonus)||value.birthdayBonus<0||value.birthdayBonus>1000000000)throw invalid();return {...value}}
export const readLoyaltyRules=get=>loyaltyRules({earn:Number(get('pointsEarnRate')??10),redeem:Number(get('pointsRedeemRate')??1),birthdayBonus:Number(get('birthdayBonus')??100)})
export function readLoyaltyPrograms(raw){
 const value=raw==null?{version:1,entries:[]}:typeof raw==='string'?JSON.parse(raw):raw;draftObject(value,['version','entries']);if(value.version!==1||!Array.isArray(value.entries))throw invalid();const ids=new Set()
 for(const [index,row]of value.entries.entries()){draftObject(row,['id','time','context','revision','previous','program','valueLocked','digest']);operationHeader(row);assertPrivateDraftContext(row.context);loyaltyRules(row.previous);loyaltyRules(row.program);if(!/^loyalty-program-[-a-f0-9]{36}$/.test(row.id)||ids.has(row.id)||row.context.role!=='owner'||row.revision!==index+1||typeof row.valueLocked!=='boolean'||typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest)||index&&!same(row.previous,value.entries[index-1].program))throw invalid();ids.add(row.id)}return value
}
export function issuedLoyaltyValue(members,orders){if(!Array.isArray(members)||!Array.isArray(orders))throw invalid();return members.some(row=>!Number.isSafeInteger(row.points)||row.points!==0||row.totalSpent!==0||!!row.lastBirthdayBonus)||orders.some(row=>!!row.memberId)}
export function loyaltyFacts(context,rules,journal,issued){assertPrivateDraftContext(context);if(context.role!=='owner')throw Error('請用店主帳號設定會員福利。');loyaltyRules(rules);const last=journal.entries.at(-1);if(last&&!same(last.program,rules))throw invalid();return {context,rules,journal,valueLocked:!!issued||journal.entries.some(row=>row.valueLocked)}}
export function loyaltyProgramPreview(program,facts){
 const proposed=loyaltyRules(program||facts.rules),allowed=!facts.valueLocked||proposed.redeem===facts.rules.redeem,earned=Math.floor(1000/proposed.earn),birthdayEarned=earned+proposed.birthdayBonus
 const body={protocol:'pos-loyalty-program-preview/v1',context:facts.context,basis:privateDraftDigest({rules:facts.rules,head:facts.journal.entries.map(row=>[row.id,row.digest])}),current:facts.rules,program:proposed,valueLocked:facts.valueLocked,hasProgram:!!facts.journal.entries.length,allowed,example:{spend:1000,earned,birthdayEarned,pointValue:proposed.redeem,rewardValue:Math.round(earned*proposed.redeem*100+1e-7)/100},error:allowed?'':'已發點數的折抵價值會保留，請採用目前點值。'}
 return {...body,digest:privateDraftDigest(body)}
}
export function loyaltyProgramOriginal(input,facts){const row=facts.journal.entries.find(row=>row.id===input.id);if(!row)return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id};if(row.digest!==input.digest||!same(row.context,input.context)||!same(input.context,facts.context))throw Error('原福利方案編號內容不同，請保留輸入核對。');return {protocol:'pos-private-draft-original/v1',status:'matched',id:row.id,digest:row.digest,action:'configure',entryId:row.id,receipt:row}}
export function admitLoyaltyProgram(request,facts){
 draftObject(request,['id','time','quote']);operationHeader(request);if(!/^loyalty-program-[-a-f0-9]{36}$/.test(request.id))throw invalid();assertPrivateDraftContext(request.quote?.context);if(!same(request.quote.context,facts.context))throw Error('店面或帳號已變更，請保留原輸入核對。')
 const digest=privateDraftDigest(request),original=loyaltyProgramOriginal({id:request.id,digest,context:facts.context},facts);if(original.status==='matched')return {original:original.receipt}
 const current=loyaltyProgramPreview(request.quote.program,facts);if(!current.allowed||!same(current,request.quote))throw Object.assign(Error(current.allowed?'目前方案已更新，請重新核對。':current.error),{code:'LOYALTY_REVIEW_CHANGED'})
 return {receipt:{id:request.id,time:request.time,context:facts.context,revision:facts.journal.entries.length+1,previous:facts.rules,program:current.program,valueLocked:current.valueLocked,digest}}
}
export const loyaltyProgramRejection=(request,error)=>({success:false,committed:false,error:error.message,errorCode:'LOYALTY_REVIEW_CHANGED',requestDigest:privateDraftDigest(request)})
export const isLoyaltyProgramRejection=(result,request)=>result?.success===false&&result.committed===false&&result.errorCode==='LOYALTY_REVIEW_CHANGED'&&result.requestDigest===privateDraftDigest(request)
export function assertLegacyLoyaltyWrite(values,facts){if(Object.hasOwn(values,LOYALTY_PROGRAMS))throw Error('福利方案紀錄由正式設定與完整備份流程管理。');if(!LOYALTY_RULE_KEYS.some(key=>Object.hasOwn(values,key)))return;if(facts.journal.entries.length)throw Error('請從會員福利設定保存，原規則仍保留。');if(Object.hasOwn(values,'pointsRedeemRate')&&facts.valueLocked&&Number(values.pointsRedeemRate)!==facts.rules.redeem)throw Error('已發點數的折抵價值會保留，請採用目前點值。')}
