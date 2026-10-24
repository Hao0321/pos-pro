// Monetary aggregation stays in exact integer/rational cents. Legacy journals
// retain their original values; true sub-cent entries are disclosed for review.
const TEN=10n
const power=places=>TEN**BigInt(places)
const zero=()=>({n:0n,scale:0})
function add(a,b){const scale=Math.max(a.scale,b.scale);return {n:a.n*power(scale-a.scale)+b.n*power(scale-b.scale),scale}}
const negate=value=>({...value,n:-value.n})
function rounded(value){if(!value.scale)return value.n;const denominator=power(value.scale),absolute=value.n<0n?-value.n:value.n,result=(absolute+denominator/2n)/denominator;return value.n<0n?-result:result}
function decimalCents(value){
 const text=String(value),match=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text)
 if(!match)throw Error('帳務金額需要核對')
 const shift=Number(match[4]||0)+2-(match[3]||'').length,n=BigInt(match[2]+(match[3]||''))*(match[1]?-1n:1n)
 return shift>=0?{n:n*power(shift),scale:0}:{n,scale:-shift}
}
export function journalAmount(entry,line,side){
 if(!['debit','credit'].includes(side))throw Error('帳務金額需要核對')
 if(entry.amountUnit==='cents'){
  const value=line[side+'Cents']
  if(!Number.isSafeInteger(value)||value<0)throw Error('帳務金額需要核對')
  return {n:BigInt(value),scale:0,issues:[]}
 }
 if(entry.amountUnit!==undefined)throw Error('帳務金額單位需要核對')
 const value=line[side]??0
 if(typeof value!=='number'||!Number.isFinite(value))throw Error('帳務金額需要核對')
 const cents=Math.round(value*100),tolerance=4*Number.EPSILON*Math.max(1,Math.abs(value))
 if(Number.isSafeInteger(cents)&&tolerance<.005&&Math.abs(value-cents/100)<=tolerance)return {n:BigInt(cents),scale:0,issues:[]}
 const exact=decimalCents(value),issues=[]
 if(exact.n%power(exact.scale)!==0n)issues.push('legacy-subcent')
 if(!Number.isSafeInteger(cents)||tolerance>=.005)issues.push('legacy-precision-review')
 return {...exact,issues}
}
export function journalLineCents(entry,line,side){return rounded(journalAmount(entry,line,side))}
export function aggregateJournal(journals){
 const accounts=new Map(),issues=[]
 for(const entry of journals){
  if(!Array.isArray(entry.lines))throw Error('帳務分錄需要核對')
  let balance=zero()
  for(const line of entry.lines){
   const debit=journalAmount(entry,line,'debit'),credit=journalAmount(entry,line,'credit'),old=accounts.get(line.account)||{debit:zero(),credit:zero()}
   accounts.set(line.account,{debit:add(old.debit,debit),credit:add(old.credit,credit)})
   balance=add(balance,add(debit,negate(credit)))
   for(const code of new Set([...debit.issues,...credit.issues]))issues.push({code,journalId:entry.id,account:line.account})
  }
  if(balance.n!==0n)issues.push({code:'entry-unbalanced',journalId:entry.id})
 }
 const rows=Object.fromEntries([...accounts].map(([account,row])=>[account,{debitCents:rounded(row.debit).toString(),creditCents:rounded(row.credit).toString(),netDebitCents:rounded(add(row.debit,negate(row.credit))).toString()}]))
 return {accounts:rows,issues}
}
export function centsDecimal(input){
 const value=BigInt(input),absolute=value<0n?-value:value
 return (value<0n?'-':'')+(absolute/100n).toString()+'.'+(absolute%100n).toString().padStart(2,'0')
}
export function formatMoneyCents(input,locale='zh-TW'){
 if(input===null||input===undefined)return '—'
 const value=BigInt(input),absolute=value<0n?-value:value,fraction=absolute%100n
 return (value<0n?'-':'')+new Intl.NumberFormat(locale).format(absolute/100n)+(fraction?'.'+fraction.toString().padStart(2,'0'):'')
}
// Larger values are deliberately text cells: a spreadsheet's numeric precision
// must not silently discard a source cent. This is a human-view CSV export.
export function spreadsheetMoneyCents(input){
 const value=BigInt(input),decimal=centsDecimal(value)
 if(value>999999999999999n||value< -999999999999999n)return '\t'+decimal
 const number=Number(decimal)
 return Math.round(number*100)===Number(value)?number:'\t'+decimal
}
export function centsNumber(input){return Number(centsDecimal(input))}
export function percentCents(part,total){
 const numerator=BigInt(part),denominator=BigInt(total)
 if(denominator<=0n)return '0.0'
 const scaled=rounded({n:numerator*1000n,scale:0})
 const absolute=scaled<0n?-scaled:scaled,tenths=(absolute+denominator/2n)/denominator
 return (scaled<0n?'-':'')+(tenths/10n).toString()+'.'+(tenths%10n).toString()
}
