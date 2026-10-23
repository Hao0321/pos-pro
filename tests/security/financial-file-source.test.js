import {describe,it,expect} from 'vitest'
import workbook from './financialMigrationFixture.cjs'
import source from '../fixtures/opening-whole-source-v1.json'
import {readCanonicalMigrationDraft} from '../../electron/migrationDraftSource.mjs'
import {projectOpeningBalanceSource,projectOpeningBalanceTables} from '../../electron/openingBalanceSource.mjs'
import {projectOpeningStockTables} from '../../electron/openingMigrationSource.mjs'
import {makeTabularDraft,isTabularDraftSetup} from '../../electron/tabularMigration.mjs'
import {financialAmountText,financialDateText,financialCellCanFill,suggestFinancialFilePlan,suggestFinancialEntity} from '../../electron/financialFileColumns.mjs'
import {makeFinancialFileDraft,readFinancialFileDraft,isFinancialFileDraft,financialWorkbookSheets} from '../../electron/financialFileDraft.mjs'
import {projectFinancialFileSource} from '../../electron/financialFileSource.mjs'

const date='2026-10-23',identity={system:'Original ERP',company:'Original shop'},headers=workbook.standard[1].headers,rows=workbook.standard[1].rows,csv=(values=rows,fields=headers)=>'\uFEFF'+fields.join(',')+'\r\n\r\n'+values.map(row=>row.map(value=>/[",\r\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value).join(',')).join('\r\n')+'\r\n'
const packet=(text=csv())=>{const plan=suggestFinancialFilePlan(headers);return makeFinancialFileDraft(identity,'',[{kind:'csv',file:{name:'original.csv',text,delimiter:','},sheets:[{sheetId:'csv',headerRow:0,plan}]}])},rebuild=value=>makeFinancialFileDraft(value.source,value.currency,value.files),finance=value=>projectOpeningBalanceTables(projectFinancialFileSource(value),date)
describe('OB raw financial source custody',()=>{
 it('keeps canonical v1 meanings and deliberately uses a different raw-file vocabulary',()=>{
  const original=projectOpeningBalanceSource(JSON.stringify(source),date);expect(original.totals.receivable.invoiceCents).toBe(60000);expect(original.totals.payable.creditCents).toBe(20000)
  const draft=packet(),old=makeTabularDraft(draft.source,draft.files[0].file,{entity:'opening-receivables',externalId:0,mapping:draft.files[0].sheets[0].plan.mapping,unit:'',repairs:[]});expect(isTabularDraftSetup(old)).toBe(false);expect(()=>readCanonicalMigrationDraft(draft)).toThrow();expect(()=>projectOpeningBalanceSource(JSON.stringify(draft),date)).toThrow()
 })
 it('derives real original invoices/credits and exact file, physical row and source-column evidence from CSV',()=>{
  const raw=csv(),draft=packet(raw),projected=projectFinancialFileSource(draft),facts=finance(draft)
  expect(draft.files[0].file.text).toBe(raw);expect(projected.source.tables[0].rows[0].externalId).toBe('00001');expect(facts.facts[0].outstandingCents).toBe(60000);expect(facts.facts[1].outstandingCents).toBe(10000);expect(facts.facts[1].type).toBe('credit');expect(facts.facts[0].origin).toMatchObject({kind:'csv',fileIndex:0,fileName:'original.csv',physicalRow:3,headerRow:1,externalIdColumn:0,columns:{outstanding:7}});expect(facts.totals.receivable.netCents).toBe(50000)
 })
 it('decodes the actual XLSX together with its hidden payable sheet and original stock table',()=>{
  const file=workbook(),sheets=financialWorkbookSheets(file),draft=makeFinancialFileDraft(identity,'TWD',[{kind:'xlsx',file,sheets}]),parsed=projectFinancialFileSource(draft),facts=projectOpeningBalanceTables(parsed,date),stock=projectOpeningStockTables(parsed,date,{combined:true})
  expect(sheets.map(row=>row.plan.entity)).toEqual(['products','opening-receivables','opening-payables']);expect(parsed.raw.files[0].file.base64).toBe(file.base64);expect(facts.facts).toHaveLength(4);expect(facts.facts.find(row=>row.number==='AP-001').origin).toMatchObject({kind:'xlsx',sheetId:'3',physicalRow:6,headerRow:3,fileIndex:0});expect(facts.totals.payable.netCents).toBe(70000);expect(stock.totalValueCents).toBe(25001);expect(stock.opening[0].quantityUnits).toBe(12500)
 })
 it('refuses silently omitted hidden or unclassified business sheets',()=>{
  const file=workbook(),draft=makeFinancialFileDraft(identity,'TWD',[{kind:'xlsx',file,sheets:financialWorkbookSheets(file).slice(0,2)}]);expect(()=>projectFinancialFileSource(draft)).toThrow(/未核對的工作表/)
  const other=workbook({sheets:[...workbook.standard,{name:'Unknown history',headers:['timestamp','something'],rows:[['2026-10-01','real data']]}]}),selected=financialWorkbookSheets(other);selected.at(-1).headerRow=3
  const all=makeFinancialFileDraft(identity,'TWD',[{kind:'xlsx',file:other,sheets:selected}]);expect(()=>projectFinancialFileSource(all)).toThrow(/未分類/)
 })
 it('requires explicit date order and exact grouping conventions without rounding a known amount',()=>{
  expect(()=>financialDateText('03/10/2026','iso')).toThrow();expect(financialDateText('03/10/2026','dmy')).toBe('2026-10-03');expect(financialDateText('03/10/2026','mdy')).toBe('2026-03-10');expect(()=>financialDateText('31/02/2026','dmy')).toThrow()
  expect(financialAmountText('1,200.01','grouped-dot')).toBe('1200.01');expect(financialAmountText('-1.200,01','grouped-comma')).toBe('-1200.01');expect(financialAmountText('1,200.001','grouped-dot')).toBe('1200.001');expect(()=>financialAmountText('1,20.01','grouped-dot')).toThrow();expect(financialAmountText('','decimal-dot')).toBe('')
 })
 it('changes neither a known precision error nor a known date/ID into a replacement zero',()=>{
  const draft=packet();draft.files[0].sheets[0].plan.repairs=[{row:0,column:7,value:'0'}];expect(()=>projectFinancialFileSource(rebuild(draft))).toThrow(/已知/);expect(financialCellCanFill('600.001','outstanding')).toBe(false);expect(financialCellCanFill('1,200.00','outstanding')).toBe(false);expect(financialCellCanFill('03/10/2026','invoiceDate')).toBe(false);expect(financialCellCanFill('00001','externalId')).toBe(false);expect(financialCellCanFill('600','outstanding',{issue:'merged'})).toBe(false)
 })
 it('fills only a genuinely unknown amount and retains the original blank and repair separately',()=>{
  const changed=structuredClone(rows);changed[0][7]='';const draft=packet(csv(changed)),p=draft.files[0].sheets[0].plan;p.repairs=[{row:0,column:7,value:'600.00'}];const fixed=rebuild(draft);expect(finance(fixed).facts[0].outstandingCents).toBe(60000);expect(fixed.files[0].file.text).toBe(csv(changed));expect(fixed.files[0].sheets[0].plan.repairs[0].value).toBe('600.00');expect(()=>finance(packet(csv(changed)))).toThrow()
 })
 it('never uses an Excel formula cache as an outstanding amount',()=>{
  const sheets=structuredClone(workbook.standard);sheets[1].rows[0][7]={formula:'1+1',cache:'999999.99'};const file=workbook({sheets}),draft=makeFinancialFileDraft(identity,'TWD',[{kind:'xlsx',file,sheets:financialWorkbookSheets(file)}]);expect(()=>projectFinancialFileSource(draft)).toThrow(/公式/);draft.files[0].sheets[1].plan.repairs=[{row:0,column:7,value:'600.00'}];const repaired=rebuild(draft);expect(finance(repaired).facts[0].outstandingCents).toBe(60000);expect(repaired.files[0].file.base64).toBe(file.base64)
 })
 it('does not hide, relabel or net out a populated financial column',()=>{
  const draft=packet();draft.files[0].sheets[0].plan.mapping[7]='note';expect(()=>projectFinancialFileSource(rebuild(draft))).toThrow();const extra=packet(csv(rows.map(row=>[...row,'50']),[...headers,'Unprocessed balance']));extra.files[0].sheets[0].plan.mapping.push('');expect(()=>projectFinancialFileSource(rebuild(extra))).toThrow(/未處理/)
 })
 it('cannot treat supplier invoices as customer debt or guess an ambiguous party side',()=>{
  expect(suggestFinancialEntity(['partyExternalId','invoiceNumber','outstanding'])).toBe('');const draft=packet();draft.files[0].sheets[0].plan.entity='opening-payables';expect(()=>projectFinancialFileSource(rebuild(draft))).toThrow(/客戶／供應商/)
 })
 it('retains a foreign currency and exact duplicate IDs for the actual financial validator to reject',()=>{
  const changed=structuredClone(rows);changed[0][8]='USD';expect(()=>finance(packet(csv(changed)))).toThrow(/幣別/);const duplicate=structuredClone(rows);duplicate[1][0]='00001';expect(()=>finance(packet(csv(duplicate)))).toThrow(/原單編號重複/)
 })
 it('binds raw file identity while leaving choices to the confirmed request, and rejects extra authority or an oversized editable draft',()=>{
  const draft=packet();expect(isFinancialFileDraft(draft)).toBe(true);const changed=structuredClone(draft);changed.files[0].sheets[0].plan.amountFormat='grouped-dot';expect(rebuild(changed).id).toBe(draft.id);draft.files[0].file.text+='\r\n';expect(()=>readFinancialFileDraft(draft)).toThrow();expect(isFinancialFileDraft({...packet(),actor:{role:'owner'}})).toBe(false);const large=packet();large.files[0].file.text='字'.repeat(80000);expect(isFinancialFileDraft(rebuild(large))).toBe(false)
 })
})
