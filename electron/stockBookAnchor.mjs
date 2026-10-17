import {stockLedgerError} from './stockOpeningPlan.mjs'

export const STOCK_BOOK_HEAD='stockCostBookHead'
export function withStockBookHead(book,head){
  if(typeof head!=='string'||!/^sha256:[a-f0-9]{64}$/.test(head))throw stockLedgerError('HISTORY')
  const rows=book.settings||[],value=JSON.stringify(head)
  return {...book,settings:rows.some(row=>row.key===STOCK_BOOK_HEAD)?rows.map(row=>row.key===STOCK_BOOK_HEAD?{key:STOCK_BOOK_HEAD,value}:row):[...rows,{key:STOCK_BOOK_HEAD,value}]}
}
export function assertStockBookHead(book,state){
  const rows=(book.settings||[]).filter(row=>row.key===STOCK_BOOK_HEAD)
  if(!rows.length)return true
  try{if(rows.length!==1||!state.projection||JSON.parse(rows[0].value)!==state.head)throw Error();return true}catch{throw stockLedgerError('HISTORY')}
}
