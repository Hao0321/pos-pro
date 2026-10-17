import {aggregateJournal,centsNumber,percentCents} from './journalAmounts.mjs'

function balances(journals,accounts){
 const result=aggregateJournal(journals),totals=Object.fromEntries(Object.entries(result.accounts).map(([code,row])=>[code,{debit:centsNumber(row.debitCents),credit:centsNumber(row.creditCents)}]))
 for(const code of Object.keys(result.accounts))if(!accounts[code])result.issues.push({code:'unknown-account',account:code})
 const net=code=>BigInt(result.accounts[code]?.netDebitCents||0)*(accounts[code]?.normal==='credit'?-1n:1n)
 const sum=filter=>Object.keys(accounts).filter(filter).reduce((value,code)=>value+net(code),0n)
 return {...result,totals,net,sum}
}
const strings=values=>Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.toString()]))
const numbers=values=>Object.fromEntries(Object.entries(values).map(([key,value])=>[key,centsNumber(value)]))

export function financialPnL(journals,from,to,accounts,options={}){
 const inRange=journals.filter(row=>row.date>=from&&row.date<=to),b=balances(inRange,accounts)
 const revenue=b.sum(code=>accounts[code].type==='revenue'),cogs=b.net('5101'),grossProfit=revenue-cogs,opExpenses=b.sum(code=>accounts[code].type==='expense'&&code!=='5101'),netIncome=grossProfit-opExpenses
 const values={revenue,cogs,grossProfit,opExpenses,netIncome},known=numbers(values),knownExact=strings(values),complete=options.profitComplete!==false&&b.issues.length===0
 const lines=type=>Object.keys(accounts).filter(code=>accounts[code].type===type).map(code=>({code,name:accounts[code].name,amount:centsNumber(b.net(code)),amountCents:b.net(code).toString()})).filter(row=>row.amountCents!=='0')
 return {...known,...(!complete?{cogs:null,grossProfit:null,netIncome:null}:{}),grossMargin:complete?percentCents(grossProfit,revenue):null,netMargin:complete?percentCents(netIncome,revenue):null,
  complete,known,knownExact,exact:{...knownExact,...(!complete?{cogs:null,grossProfit:null,netIncome:null}:{})},issues:b.issues,disclosure:options,
  revenueLines:lines('revenue'),expenseLines:lines('expense'),totals:b.totals,totalsCents:b.accounts,netBalance:code=>centsNumber(b.net(code)),netBalanceCents:code=>b.net(code).toString()}
}

export function financialBalance(journals,asOf,accounts,options={}){
 const b=balances(journals.filter(row=>row.date<=asOf),accounts),sections={asset:{label:'資產',items:[]},liability:{label:'負債',items:[]},equity:{label:'業主權益',items:[]}}
 for(const [code,info]of Object.entries(accounts)){
  const value=b.net(code)
  if(value&&sections[info.type])sections[info.type].items.push({code,name:info.name,group:info.group,amount:centsNumber(value),amountCents:value.toString()})
 }
 // Before a formal close, the accumulated result is still part of equity.
 const result=b.sum(code=>accounts[code].type==='revenue')-b.sum(code=>accounts[code].type==='expense')
 if(result)sections.equity.items.push({code:'current-result',name:'累計未結轉損益',group:'業主權益',amount:centsNumber(result),amountCents:result.toString()})
 const sum=type=>sections[type].items.reduce((n,row)=>n+BigInt(row.amountCents),0n),values={totalAssets:sum('asset'),totalLiabilities:sum('liability'),totalEquity:sum('equity')},complete=options.assetsComplete!==false&&options.profitComplete!==false&&b.issues.length===0
 return {sections,...numbers(values),...(!complete?{totalAssets:null}:{}),known:numbers(values),knownExact:strings(values),exact:{...strings(values),...(!complete?{totalAssets:null}:{})},complete,issues:b.issues,disclosure:options,differenceCents:(values.totalAssets-values.totalLiabilities-values.totalEquity).toString(),balanced:values.totalAssets===values.totalLiabilities+values.totalEquity}
}
