// Public DTO validation only. The existing reservation authority quotes and
// verifies depositQuoteHash; this module never writes a balance or payment.
const maximum=100000000000,fail=()=>{throw Error('deposit')},integer=value=>Number.isSafeInteger(value)&&value>=0&&value<=maximum
const object=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',')
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),id=value=>typeof value==='string'&&/^[-A-Za-z0-9_:]{1,128}$/.test(value)
export function assertGuestDepositTerms(value,scope={}){
 if(!object(value,['protocol','policyVersion','policyHash','currency','date','slot','partySize','channel','ruleId','basis','unitCents','requiredCents','refund','hash'])||value.protocol!=='pos-reservation-deposit-terms/v1'||!Number.isSafeInteger(value.policyVersion)||value.policyVersion<1||!hash(value.policyHash)||!hash(value.hash)||value.currency!=='TWD'||value.channel!=='online'||value.refund!=='full-unused'||!['none','per-booking','per-guest'].includes(value.basis)||!integer(value.unitCents)||!integer(value.requiredCents)||!Number.isSafeInteger(value.partySize)||value.partySize<1||value.partySize>100||!/^\d{4}-\d{2}-\d{2}$/.test(value.date)||!Number.isFinite(Date.parse(value.date+'T00:00:00Z'))||new Date(value.date+'T00:00:00Z').toISOString().slice(0,10)!==value.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.slot)||value.ruleId!==null&&!id(value.ruleId))fail()
 const required=BigInt(value.unitCents)*BigInt(value.basis==='per-guest'?value.partySize:value.basis==='none'?0:1)
 if(value.basis==='none'?value.unitCents!==0:value.unitCents===0)fail()
 if(required>BigInt(maximum)||required!==BigInt(value.requiredCents))fail()
 for(const key of ['date','slot','partySize'])if(scope[key]!==undefined&&value[key]!==scope[key])fail()
 return value
}
export function assertGuestDepositReceipt(value,booking){
 if(!value||typeof value.uncertain!=='boolean')fail();assertGuestDepositTerms(value.terms)
 const money=['receivedCents','refundedCents','allocatedCents','availableCents','remainingCents','refundDueCents']
 if(!object(value,['terms','uncertain',...(value.uncertain?[]:money)]))fail()
 if(value.uncertain)return value
 if(money.some(key=>['receivedCents','refundedCents'].includes(key)?!Number.isSafeInteger(value[key])||value[key]<0:!integer(value[key]))||value.refundedCents>value.receivedCents||value.receivedCents-value.refundedCents!==value.allocatedCents+value.availableCents||value.receivedCents-value.refundedCents>value.terms.requiredCents||value.remainingCents>value.terms.requiredCents||value.refundDueCents>value.availableCents)fail()
 if(['completed','cancelled','no-show'].includes(booking.status)&&(value.remainingCents!==0||value.refundDueCents!==value.availableCents))fail()
 if(!['completed','cancelled','no-show'].includes(booking.status)&&(value.refundDueCents!==0||value.allocatedCents>0&&value.remainingCents!==0||value.remainingCents!==0&&value.remainingCents!==value.terms.requiredCents-value.receivedCents+value.refundedCents))fail()
 return value
}
export function guestDepositAmount(cents){if(!Number.isSafeInteger(cents)||cents<0)fail();const amount=BigInt(cents),fraction=amount%100n;return 'NT$ '+(amount/100n).toString()+(fraction?'.'+fraction.toString().padStart(2,'0'):'')}
