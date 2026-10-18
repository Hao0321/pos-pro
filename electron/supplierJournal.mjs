import {SUPPLIER_MONEY_ACTIONS} from './supplierLedger.mjs'
import {SUPPLIER_CONTROL_ACTIONS} from './supplierControl.mjs'
import {moneyValue} from './operationRules.mjs'
const line=(account,debit=0,credit=0)=>({account,debit,credit})
const descriptions={pay:'供應商預付款',allocate:'預付款抵付應付',unallocate:'解除供應商抵付',refund:'退回供應商預付款','refund-reverse':'供應商預付退款更正','pay-reverse':'供應商預付款沖銷'}
export function supplierLedgerToJournalEntries(entries=[]){
 return entries.flatMap(event=>{
  if([...SUPPLIER_CONTROL_ACTIONS,'purchase-register'].includes(event.action))return []
  if(!SUPPLIER_MONEY_ACTIONS.includes(event.action))throw Error('供應商款項分錄類型不正確')
  const money=moneyValue(event.amount,'供應商分錄金額',.01),cash=event.method==='cash'?'1101':'1103'
  if(event.fundingKind==='opening-credit'&&['allocate','unallocate'].includes(event.action))return []
  const pairs={pay:[line('1261',money),line(cash,0,money)],allocate:[line('2101',money),line('1261',0,money)],unallocate:[line('1261',money),line('2101',0,money)],refund:[line(cash,money),line('1261',0,money)],'refund-reverse':[line('1261',money),line(cash,0,money)],'pay-reverse':[line(cash,money),line('1261',0,money)]}
  if(event.fundingKind==='opening-credit'){
   if(!['refund','refund-reverse'].includes(event.action)||!['cash','bank'].includes(event.method))throw Error('原單貸項退款分錄不正確')
   for(const row of pairs[event.action])if(row.account==='1261')row.account='2101'
  }
  return [{id:'JS-'+event.id,supplierId:event.supplierId,date:event.date,type:'auto_supplier_ledger',description:descriptions[event.action]+' · '+event.supplierName+' · '+event.supplierId,descriptionKey:descriptions[event.action]+' · {0} · {1}',descriptionValues:{0:event.supplierName,1:event.supplierId},lines:pairs[event.action]}]
 })
}
