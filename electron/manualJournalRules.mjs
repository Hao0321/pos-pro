import {moneyValue} from './operationRules.mjs'
export function validateManualEntry(data){
  if(typeof data.description!=='string'||!data.description.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||!Array.isArray(data.lines)||!data.lines.length||data.lines.length>1000)throw Error('請確認帳務日期、摘要與分錄')
  let debit=0,credit=0
  for(const line of data.lines){if(typeof line.account!=='string'||!/^\d{4}$/.test(line.account))throw Error('帳務科目不正確');const d=moneyValue(line.debit,'借方'),c=moneyValue(line.credit,'貸方');if(d>0&&c>0)throw Error('同一行不可同時借貸');debit+=Math.round(d*100);credit+=Math.round(c*100)}
  if(!Number.isSafeInteger(debit)||debit!==credit||debit<=0)throw Error('借貸需平衡且金額大於零')
}
