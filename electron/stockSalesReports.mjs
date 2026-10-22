import {settledOrders} from './orderLedger.mjs'
import {businessReportRows,reportDay} from './reportRows.mjs'
import {journalLineCents,percentCents} from './journalAmounts.mjs'
import {buildPnL} from './accountingCore.mjs'
import {makeStockAccountingReport,stockPeriodDisclosure} from './stockAccounting.mjs'
import {stockReportCostPostings} from './stockReportCosts.mjs'
import {splitReportCents} from './stockReportBasis.mjs'
import {stockCostSummary} from './stockCost.mjs'

const money=value=>journalLineCents({}, {debit:value||0},'debit')
const sum=(rows,key)=>rows.reduce((n,row)=>n+BigInt(row[key]),0n)
const inPeriod=(row,from,to)=>row.date>=from&&row.date<=to
export const reportDateShift=(day,days)=>new Date(Date.parse(day)+days*86400000).toISOString().slice(0,10)
export function salesReportPeriods(today){
 return {today:[today,today],yesterday:[reportDateShift(today,-1),reportDateShift(today,-1)],week:[reportDateShift(today,-6),today],month:[today.slice(0,7)+'-01',today],all:['0000-01-01','9999-12-31'],last30:[reportDateShift(today,-29),today]}
}

export function salesRevenuePostings(orders){
 return settledOrders(orders).flatMap(order=>{
  const date=reportDay(order),lines=order.items||[],total=money(order.total)+money(order.balanceUsed),weights=lines.map(item=>({productId:item.id||item.productId,name:item.name,unit:item.unit,quantityUnits:Math.round(item.qty*1000).toString(),weight:(money(Math.abs(item.price||0))*BigInt(Math.round(Math.abs(item.qty)*1000))).toString()}))
  if(order.source==='business-report')return lines.map((item,index)=>({...weights[index],date,amountCents:money(item.reportRevenue).toString()}))
  if(!weights.length)return [{date,productId:null,quantityUnits:'0',amountCents:total.toString()}]
  // A nonzero adjustment on an all-free cart stays explicitly unallocated.
  if(weights.every(row=>row.weight==='0'))return [...weights.map(row=>({...row,date,amountCents:'0'})),...(total?[{date,productId:null,quantityUnits:'0',amountCents:total.toString()}]:[])]
  return splitReportCents(total,weights).map(row=>({...row,date}))
 })
}

function stockValues(custody,products){
 const sources=new Map(custody.sources.map(row=>[row.id,row]))
 return new Map(products.map(product=>{
  const stage=type=>{const segments=custody.positions.filter(row=>row.owner.stage===type).flatMap(row=>row.segments).filter(row=>sources.get(row.sourceId).productId===product.id),value=stockCostSummary(custody.sources,segments);return {quantityUnits:segments.reduce((n,row)=>n+BigInt(row.quantityUnits),0n).toString(),valueCents:value.valueCents===null?null:String(value.valueCents),knownValueCents:String(value.knownValueCents)}}
  return [product.id,{available:stage('available'),reserved:stage('reserved')}]
 }))
}

export function productCostPerformance(products,revenueRows,costRows,from,to,values=null){
 const names=new Map(products.map(row=>[row.id,{...row}])),history=new Map(),rowFor=id=>{if(!history.has(id))history.set(id,{revenue:0n,cost:0n,qty:0n,pending:false});return history.get(id)}
 for(const row of revenueRows.filter(row=>inPeriod(row,from,to)&&row.productId)){if(!names.has(row.productId))names.set(row.productId,{id:row.productId,name:row.name||row.productId,unit:row.unit||'',stock:0});const item=rowFor(row.productId);item.revenue+=BigInt(row.amountCents);item.qty+=BigInt(row.quantityUnits)}
 let unallocated=0n
 for(const row of costRows.filter(row=>inPeriod(row,from,to))){
  const pending=Object.hasOwn(row,'unknownUntil')&&(!row.unknownUntil||row.unknownUntil>to)
  if(row.productId){const item=rowFor(row.productId);item.cost+=BigInt(row.amountCents);item.pending||=pending}
  else{unallocated+=BigInt(row.amountCents);for(const id of row.pendingTargets||[])rowFor(id).pending=true}
 }
 const enriched=[...names.values()].map(product=>{
  const row=rowFor(product.id),profit=row.revenue-row.cost,value=values?.get(product.id)
  return {...product,totalSold:Number(row.qty)/1000,quantityUnits:row.qty.toString(),dailyAvg:Number(row.qty)/30000,revenueCents:row.revenue.toString(),costCents:row.pending?null:row.cost.toString(),knownCostCents:row.cost.toString(),profitCents:row.pending?null:profit.toString(),margin:row.pending?null:percentCents(profit,row.revenue),costComplete:!row.pending,...(value?{stockValue:value}:{})}
 })
 const compare=(a,b,key)=>{const x=BigInt(a[key]),y=BigInt(b[key]);return x>y?-1:x<y?1:a.id.localeCompare(b.id)}
 const slowMovers=enriched.filter(row=>row.totalSold<1&&row.stock>0).sort((a,b)=>{
  if(values){const x=a.stockValue?.available.valueCents,y=b.stockValue?.available.valueCents;if(x===null||y===null)return x===y?a.id.localeCompare(b.id):x===null?-1:1;return compare({id:a.id,v:x||'0'},{id:b.id,v:y||'0'},'v')}
  return b.stock*(b.cost||0)-a.stock*(a.cost||0)
 }).slice(0,20)
 return {enriched,topSellers:enriched.filter(row=>row.totalSold>0).sort((a,b)=>compare(a,b,'quantityUnits')).slice(0,10),slowMovers,highMargin:enriched.filter(row=>row.totalSold>0&&row.profitCents!==null&&BigInt(row.profitCents)>0n).sort((a,b)=>compare(a,b,'profitCents')).slice(0,10),pendingProducts:enriched.filter(row=>!row.costComplete),unallocatedCostCents:unallocated.toString(),stockBasis:values?'actual':'reference'}
}

export function makeStockSalesReport(state,data,today,scope='owner'){
 if(!state.projection)return {status:'reference-only-not-activated'}
 const owner=scope==='owner',orders=[...settledOrders(data.orders),...businessReportRows(owner?data.salesDocuments||[]:[])],revenues=salesRevenuePostings(orders),allCosts=stockReportCostPostings(state,data),costs=owner?allCosts:allCosts.filter(row=>row.scope==='pos')
 const book=owner?makeStockAccountingReport(state,data):null
 const period=(from,to)=>{
  const selectedCosts=costs.filter(row=>inPeriod(row,from,to)),sales=sum(revenues.filter(row=>inPeriod(row,from,to)),'amountCents'),knownCost=sum(selectedCosts,'amountCents')
  const pending=selectedCosts.some(row=>Object.hasOwn(row,'unknownUntil')&&(!row.unknownUntil||row.unknownUntil>to))
  const pnl=owner?buildPnL(book.journals,from,to,stockPeriodDisclosure(book,from,to)):null,revenue=owner?BigInt(pnl.knownExact.revenue):sales,cogs=owner?BigInt(pnl.knownExact.cogs):knownCost,complete=owner?pnl.complete:!pending
  return {from,to,complete,revenueCents:revenue.toString(),costCents:complete?cogs.toString():null,profitCents:complete?(revenue-cogs).toString():null,knownCostCents:cogs.toString(),margin:complete?percentCents(revenue-cogs,revenue):null,salesRevenueCents:sales.toString(),otherRevenueCents:(revenue-sales).toString(),unallocatedCostCents:(cogs-selectedCosts.filter(row=>row.productId).reduce((n,row)=>n+BigInt(row.amountCents),0n)).toString()}
 }
 const ranges=salesReportPeriods(today),periods=Object.fromEntries(Object.entries(ranges).map(([key,[from,to]])=>[key,period(from,to)])),days=Array.from({length:7},(_,i)=>{const day=reportDateShift(today,i-6);return {date:day,...period(day,day)}})
 const from=ranges.last30[0],to=today,performance=productCostPerformance(data.products,revenues,costs,from,to,owner?stockValues(state.projection.custody,data.products):null)
 if(owner)performance.unallocatedCostCents=periods.last30.unallocatedCostCents
 // No journal, source evidence, supplier ledger or actual asset value to staff.
 return {status:'active',scope:owner?'store':'pos',today,sequence:state.entries.length,stateDigest:state.stateDigest,periods,days,performance,data:{products:data.products,orders:data.orders,members:data.members||[],...(owner?{sales:data.sales,supplierState:data.supplierState,purchases:data.purchases,reservationEntries:data.reservationEntries||[],restaurantEntries:data.restaurantEntries||[]}:{purchases:[]})}}
}
