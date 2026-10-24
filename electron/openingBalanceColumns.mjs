// Frozen canonical financial column vocabulary. Raw-file adapters translate
// into these same fields without changing historical source meanings.
export const normalizeOpeningColumn=value=>value.trim().toLowerCase().replace(/[\s_-]/g,'')
export const openingBalanceColumnAliases={
 party:['partyexternalid','customerexternalid','supplierexternalid','客戶原編號','供應商原編號','往來原編號'],
 name:['partyname','customername','suppliername','客戶名稱','供應商名稱','往來名稱'],
 number:['invoicenumber','invoiceno','documentnumber','documentno','原單號','單據號碼','發票號碼'],
 type:['documenttype','invoicetype','單據種類','單據類型'],
 date:['invoicedate','documentdate','postingdate','原單日期','單據日期'],
 due:['duedate','到期日','付款到期日'],
 outstanding:['outstanding','outstandingamount','remaining','remainingamount','未結清金額','未收金額','未付金額'],
 currency:['currency','currencycode','幣別','貨幣'],
 cutoff:['cutoffdate','asofdate','切換日','截止日期'],
 total:['originalamount','originaltotal','原單總額','原始金額'],
 paid:['paidamount','previouslypaid','先前已付','以前已付金額'],
 note:['note','reference','備註','參考資料'],
}
