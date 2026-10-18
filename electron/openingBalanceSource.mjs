import {readCanonicalMigrationDraft} from './migrationDraftSource.mjs'
import {parseAgentDocument} from './agentHandoff.mjs'
import {decimalUnits} from './decimalUnits.mjs'
import {validateSalesDay} from './salesRules.mjs'
import {privateDraftDigest} from './privateDrafts.mjs'
import {canonicalSignature} from './operationRules.mjs'

// Original invoice facts only. This reader does not create a sale, purchase,
// receipt or payment, and does not authorize a business write. OB2 / OB3.
export const OPENING_BALANCE_CONTEXT='pos-opening-balance-context/v1'
const fail=message=>{throw Error(message||'原單帳款需要核對，原輸入仍保留。')}
const openingDate=value=>{try{return validateSalesDay(value)}catch{fail('請填寫確定的原單、到期或切換日期。')}}
const normalize=value=>value.trim().toLowerCase().replace(/[\s_-]/g,'')
const aliases={
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
function text(value,label,max=128){if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max||/[\p{Cc}\p{Cf}]/u.test(value)||value.normalize('NFC')!==value)fail(label);return value}
function columns(table){
 const result={}
 const other=table.entity==='opening-receivables'?['supplierexternalid','suppliername','供應商原編號','供應商名稱']:['customerexternalid','customername','客戶原編號','客戶名稱']
 if(table.columns.some(header=>other.includes(normalize(header))))fail('原單的客戶／供應商欄位與帳款種類不同，請核對來源。')
 table.columns.forEach((header,index)=>{const key=Object.keys(aliases).find(name=>aliases[name].includes(normalize(header)));if(key){if(Object.hasOwn(result,key))fail('原單欄位用途重複，請核對來源欄位。');result[key]=index}else if(table.rows.some(row=>row.values[index].trim()))fail('原單還有未處理的欄位，請先核對用途。')})
 for(const key of ['party','number','type','date','outstanding','currency'])if(!Object.hasOwn(result,key))fail('原單缺少往來原編號、單號、種類、日期、未結清金額或幣別。')
 return result
}
function positiveCents(raw,label){return decimalUnits(raw,2,1e11,label)}
function documentType(raw){const type=normalize(raw);if(['invoice','發票','請款'].includes(type))return 'invoice';if(['credit','creditnote','貸項','折讓'].includes(type))return 'credit';fail('請確認原單是請款還是貸項，不能只靠正負號猜測。')}
function masterPartyNames(source,side){
 const entity=side==='receivable'?'customers':'suppliers',names=new Map()
 for(const table of source.tables.filter(row=>row.entity===entity)){
  const indices=table.columns.flatMap((value,index)=>['name',side==='receivable'?'customername':'suppliername',side==='receivable'?'客戶名稱':'供應商名稱','名稱'].includes(normalize(value))?[index]:[])
  if(indices.length>1)fail('往來主檔名稱欄位重複，請核對來源。')
  for(const row of table.rows){if(!row.externalId.trim())fail('往來主檔缺少原編號。');if(names.has(row.externalId))fail('往來主檔原編號重複，請先核對。');names.set(row.externalId,indices.length?row.values[indices[0]]:'')}
 }
 return names
}
export const openingBalanceSourceKey=(source,side,externalId)=>canonicalSignature([source.system,source.company,side==='receivable'?'opening-receivables':'opening-payables',externalId])
export const openingBalancePartyKey=(source,side,externalId)=>canonicalSignature([source.system,source.company,side==='receivable'?'financial-customers':'suppliers',externalId])
export const openingBalanceBatchId=(source,storeId)=>'opening-finance-'+privateDraftDigest([storeId,source.source.system,source.source.company,source.id]).slice(0,48)
export function projectOpeningBalanceSource(sourceText,cutoffDate){
 openingDate(cutoffDate)
 const source=readCanonicalMigrationDraft(parseAgentDocument(sourceText,{maxBytes:250000}))
 // The existing raw-table v1 vocabulary is deliberately unchanged. A later
 // raw financial adapter must retain its own original-file/column evidence.
 if(source.protocol!=='pos-migration-draft/v1')fail('這份原單需要帳款欄位核對，請保留原檔。')
 const facts=[],seen=new Set(),economic=new Set(),parties=new Map(),names={receivable:masterPartyNames(source,'receivable'),payable:masterPartyNames(source,'payable')}
 source.tables.forEach((table,tableIndex)=>{
  const side=table.entity==='opening-receivables'?'receivable':table.entity==='opening-payables'?'payable':null
  if(!side)return
  const map=columns(table)
  table.rows.forEach((row,rowIndex)=>{
   const externalId=text(row.externalId,'原單缺少原編號。'),partyExternalId=text(row.values[map.party],'請填入往來對象的原編號。'),number=text(row.values[map.number],'請填入原單號碼。'),type=documentType(row.values[map.type]),key=openingBalanceSourceKey(source.source,side,externalId)
   if(seen.has(key))fail('原單編號重複，請先核對，不能重複加帳款。');seen.add(key)
   const date=openingDate(row.values[map.date]),dueDate=Object.hasOwn(map,'due')?row.values[map.due]:''
   if(date>cutoffDate)fail('原單日期晚於切換日，請先核對。')
   if(type==='invoice'&&!dueDate)fail('請填入原單的確定到期日。');if(dueDate)openingDate(dueDate)
   if(row.values[map.currency]!=='TWD')fail('原單幣別需要先核對換算，目前款項帳使用新台幣。')
   if(Object.hasOwn(map,'cutoff')&&row.values[map.cutoff]!==''&&row.values[map.cutoff]!==cutoffDate)fail('原報表截止日與切換日不同，請先核對。')
   const raw=row.values[map.outstanding],signed=type==='credit'&&typeof raw==='string'&&raw.startsWith('-'),outstandingCents=positiveCents(signed?raw.slice(1):raw,'原單未結清金額需要核對，最多兩位小數。')
   const totalRaw=Object.hasOwn(map,'total')?row.values[map.total]:'',paidRaw=Object.hasOwn(map,'paid')?row.values[map.paid]:'',originalCents=totalRaw===''?null:positiveCents(type==='credit'&&totalRaw.startsWith('-')?totalRaw.slice(1):totalRaw,'原單總額需要核對。'),paidCents=paidRaw===''?null:positiveCents(paidRaw,'以前已付金額需要核對。')
   if(originalCents!==null&&(originalCents<outstandingCents||paidCents!==null&&originalCents-paidCents!==outstandingCents))fail('原單總額、以前已付與未結清金額不一致，請核對原報表。')
   const masterName=names[side].get(partyExternalId)||'',rowName=Object.hasOwn(map,'name')?row.values[map.name]:'',partyName=rowName||masterName
   if(rowName&&masterName&&rowName!==masterName)fail('原單往來名稱與主檔不同，請先核對身份。')
   if(partyName)text(partyName,'請核對往來對象名稱。',100)
   const partyKey=openingBalancePartyKey(source.source,side,partyExternalId),existing=parties.get(partyKey)
   if(existing?.name&&partyName&&existing.name!==partyName)fail('同一往來原編號有不同名稱，請核對來源。')
   parties.set(partyKey,{key:partyKey,side,externalId:partyExternalId,name:partyName||existing?.name||''})
   const economicKey=canonicalSignature([side,partyExternalId,type,number,date,'TWD']);if(economic.has(economicKey))fail('同一對象的原單重複，請先核對，不能用另一個原編號再加一次。');economic.add(economicKey)
   facts.push({side,table:tableIndex,row:rowIndex,externalId,key,partyKey,partyExternalId,partyName,number,type,date,dueDate,currency:'TWD',cutoffDate,outstandingCents,originalCents,paidCents,note:Object.hasOwn(map,'note')?row.values[map.note]:'',origin:{kind:'agent',table:tableIndex,row:rowIndex}})
  })
 })
 if(!facts.length)fail('請提供原單的未收、未付或貸項資料。')
 const totals={receivable:{invoices:0,credits:0,invoiceCents:0,creditCents:0,netCents:0},payable:{invoices:0,credits:0,invoiceCents:0,creditCents:0,netCents:0}}
 for(const fact of facts){const total=totals[fact.side];if(fact.outstandingCents){total[fact.type==='invoice'?'invoices':'credits']++;total[fact.type==='invoice'?'invoiceCents':'creditCents']+=fact.outstandingCents}total.netCents=total.invoiceCents-total.creditCents;if(![total.invoiceCents,total.creditCents,total.netCents].every(Number.isSafeInteger))fail('原單合計超過可核對範圍。')}
 const referenceFields=new Set(['name','partyname','customername','suppliername','客戶名稱','供應商名稱','名稱','contact','聯絡人','phone','電話','email','address','地址','note','備註','payterms','付款條件']),partyReferenceIssues=[]
 for(const [tableIndex,table]of source.tables.entries())if(['customers','suppliers'].includes(table.entity)){
  const side=table.entity==='customers'?'receivable':'payable'
  for(const [rowIndex,row]of table.rows.entries()){
   if(!parties.has(openingBalancePartyKey(source.source,side,row.externalId)))partyReferenceIssues.push({table:tableIndex,row:rowIndex,issue:'unreferenced-party'})
   table.columns.forEach((header,column)=>{if(row.values[column].trim()&&!referenceFields.has(normalize(header)))partyReferenceIssues.push({table:tableIndex,row:rowIndex,column,issue:'unhandled-party-field'})})
  }
 }
 return {source,facts,parties:[...parties.values()],totals,stockRequired:source.tables.some(table=>table.entity==='opening-stock'),otherEntities:source.tables.filter(table=>!['opening-receivables','opening-payables','products','suppliers','customers','opening-stock'].includes(table.entity)).map(table=>table.entity),partyReferenceIssues}
}
export function openingBalancesToJournalEntries(batch,claims){
 openingDate(batch.cutoffDate);businessBatch(batch.id)
 if(!Array.isArray(claims))fail()
 return claims.flatMap(row=>{
  if(!row||!['receivable','payable'].includes(row.side)||!['invoice','credit'].includes(row.type)||row.currency!=='TWD'||!Number.isSafeInteger(row.outstandingCents)||row.outstandingCents<0||row.outstandingCents>1e11||row.batchId!==batch.id||row.cutoffDate!==batch.cutoffDate||typeof row.key!=='string'||!row.key)fail('原單帳款分錄的來源或金額不正確。')
  businessBatch(row.id);text(row.number,'原單號需要核對。');if(!row.outstandingCents)return []
  const amount=row.outstandingCents/100,account=row.side==='receivable'?'1141':'2101',controlDebit=(row.side==='receivable')===(row.type==='invoice'),line=(account,debit,credit)=>({account,debit,credit})
  return [{id:'JOF-'+row.id,date:batch.cutoffDate,type:'auto_opening_balance',description:'原單帳款搬入 · '+row.number,lines:controlDebit?[line(account,amount,0),line('3902',0,amount)]:[line('3902',amount,0),line(account,0,amount)],openingBatchId:batch.id,sourceRowKey:row.key}]
 })
}
function businessBatch(value){if(typeof value!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(value))fail('原單帳款分錄缺少原來源編號。')}
