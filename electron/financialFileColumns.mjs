import {normalizeOpeningColumn as norm,openingBalanceColumnAliases as aliases} from './openingBalanceColumns.mjs'
import {openingDate} from './openingMigrationSource.mjs'

export const financialFileEntities=['opening-receivables','opening-payables']
export const financialFileFields=['partyExternalId','partyName','invoiceNumber','documentType','invoiceDate','dueDate','outstanding','currency','cutoffDate','originalAmount','paidAmount','note']
const canonical={party:'partyExternalId',name:'partyName',number:'invoiceNumber',type:'documentType',date:'invoiceDate',due:'dueDate',outstanding:'outstanding',currency:'currency',cutoff:'cutoffDate',total:'originalAmount',paid:'paidAmount',note:'note'}
const ids=['externalid','documentid','invoiceid','originalid','原單編號','單據原編號','原系統單據編號'],moneyFields=['outstanding','originalAmount','paidAmount'],dateFields=['invoiceDate','dueDate','cutoffDate']
export const financialAmountFormats=['decimal-dot','grouped-dot','grouped-comma']
export const financialDateFormats=['iso','ymd-slash','dmy','mdy']
export const financialFieldLabel={partyExternalId:'往來原編號',partyName:'往來名稱',invoiceNumber:'原單號',documentType:'單據種類',invoiceDate:'原單日期',dueDate:'到期日',outstanding:'原未結清金額',currency:'幣別',cutoffDate:'原報表日期',originalAmount:'原單總額',paidAmount:'以前已付（參考）',note:'備註'}
export function financialFileField(header){const name=norm(header);if(ids.includes(name))return 'externalId';const key=Object.keys(aliases).find(field=>aliases[field].includes(name));return key?canonical[key]:''}
export function suggestFinancialEntity(headers){const names=headers.map(norm),customer=names.some(name=>['customerexternalid','customername','客戶原編號','客戶名稱','未收金額'].includes(name)),supplier=names.some(name=>['supplierexternalid','suppliername','供應商原編號','供應商名稱','未付金額'].includes(name));return customer!==supplier?(customer?'opening-receivables':'opening-payables'):''}
export function isFinancialFileTable(headers){const fields=headers.map(financialFileField);return fields.includes('outstanding')&&(fields.includes('invoiceNumber')||fields.includes('documentType')||fields.includes('partyExternalId'))}
export function suggestFinancialFilePlan(headers,entity=suggestFinancialEntity(headers)){
 const fields=headers.map(financialFileField),externalId=fields.filter(field=>field==='externalId').length===1?fields.indexOf('externalId'):-1
 return {entity,externalId,mapping:fields.map(field=>field!=='externalId'&&fields.filter(other=>other===field).length===1?field:''),unit:'',repairs:[],amountFormat:'decimal-dot',dateFormat:'iso'}
}
export function assertFinancialPartyColumns(headers,entity){const opposite=entity==='opening-receivables'?['supplierexternalid','suppliername','供應商原編號','供應商名稱','未付金額']:['customerexternalid','customername','客戶原編號','客戶名稱','未收金額'];if(headers.some(header=>opposite.includes(norm(header))))throw Error('原單的客戶／供應商欄位與帳款種類不同，請核對來源。')}
export function financialAmountText(raw,format){
 if(typeof raw!=='string'||!financialAmountFormats.includes(format))throw Error('請核對原金額的格式。')
 if(!raw)return raw
 const value=raw.trim();if(format==='decimal-dot')return value
 const dot=format==='grouped-dot',group=dot?',':'.',escapedGroup=dot?',':'\\.',escapedDecimal=dot?'\\.':','
 const pattern=new RegExp('^([+-]?)(\\d{1,3}(?:'+escapedGroup+'\\d{3})+|\\d+)(?:'+escapedDecimal+'(\\d+))?$'),match=value.match(pattern)
 if(!match)throw Error('原金額的千位與小數符號需要核對，不能改成零。')
 return match[1]+match[2].split(group).join('')+(match[3]===undefined?'':'.'+match[3])
}
export function financialDateText(raw,format){
 if(typeof raw!=='string'||!financialDateFormats.includes(format))throw Error('請核對原日期的格式。')
 if(!raw)return raw
 try{return openingDate(raw)}catch{}
 if(format==='iso')throw Error('請核對原日期格式，系統不會猜月份與日期。')
 const match=raw.match(format==='ymd-slash'?/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/:/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!match)throw Error('請核對原日期格式，系統不會猜月份與日期。')
 const year=format==='ymd-slash'?match[1]:match[3],month=format==='ymd-slash'?match[2]:format==='mdy'?match[1]:match[2],day=format==='ymd-slash'?match[3]:format==='mdy'?match[2]:match[1]
 return openingDate(year+'-'+month.padStart(2,'0')+'-'+day.padStart(2,'0'))
}
// Unsupported precision, a foreign currency and a different real date remain
// known facts. Review may fill an unknown cell, never replace these with zero.
export function financialCellCanFill(raw,field,issue=null){
 if(['formula','error'].includes(issue?.issue))return true
 if(!raw.trim())return true
 if(issue?.precisionRisk||['date','format'].includes(issue?.issue))return false
 if(moneyFields.includes(field))return !/^[+-]?(?:\d[\d.,]*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())
 if(dateFields.includes(field))return !/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(raw.trim())
 return false
}
export const financialFieldValue=(raw,field,plan)=>moneyFields.includes(field)?financialAmountText(raw,plan.amountFormat):dateFields.includes(field)?financialDateText(raw,plan.dateFormat):raw
