import {test,expect} from 'vitest'
import {exportJournalCSV,exportPnLCSV,buildPnL} from '../../src/utils/accounting.js'
import {parseCSV} from '../../src/utils/csv.js'
import {spreadsheetRowsCSV} from '../../electron/spreadsheetCsv.mjs'
const journal=description=>({id:'fixture',date:'2026-10-16',description,type:'manual',lines:[{account:'1211',debit:1,credit:0}]})

test('real accounting export keeps comma and formula-like text within the original description field',()=>{
 const input=[journal('原文,=1+1,尾巴')],before=JSON.stringify(input),parsed=parseCSV(exportJournalCSV(input))
 expect(parsed.headers).toHaveLength(8);expect(parsed.records).toHaveLength(1);expect(parsed.records[0]['科目代號']).toBe('1211');expect(parsed.records[0]['摘要']).toBe(input[0].description);expect(JSON.stringify(input)).toBe(before)
})

test('quotes, commas and newlines in merchant text do not add CSV rows or change account values',()=>{
 const description='原文 "quoted", next\nsecond line',parsed=parseCSV(exportJournalCSV([journal(description)]))
 expect(parsed.records).toHaveLength(1);expect(parsed.records[0]['摘要']).toBe(description);expect(parsed.records[0]['借方']).toBe('1')
})

test('spreadsheet-view CSV guards dangerous text prefixes including whitespace and Japanese full-width variants',()=>{
 for(const text of ['=1+1','+1+1','-1+1','@SUM(1)','＝1+1','＋1+1','－1+1','＠SUM(1)',' \t=1+1','\r=1+1','\n=1+1']){
  const parsed=parseCSV(exportJournalCSV([journal(text)]));expect(parsed.records).toHaveLength(1);expect(parsed.records[0]['摘要']).toBe('\t'+text.replace(/\r/g,'\n'))
 }
})

test('finite negative numbers remain numeric while negative-looking strings are text and invalid amounts are rejected',()=>{
 expect(spreadsheetRowsCSV([[-5,'-5',0,1.25]])).toBe('-5,"\t-5",0,1.25')
 for(const value of [Infinity,-Infinity,NaN])expect(()=>spreadsheetRowsCSV([[value]])).toThrow('無效數值')
})

test('P&L exports preserve the original financial signs and quoted date labels',()=>{
 const pnl=buildPnL([{id:'j',date:'2026-10-16',lines:[{account:'5208',debit:5,credit:0},{account:'1101',debit:0,credit:5}]}],'2026-10-16','2026-10-16'),csv=exportPnLCSV(pnl,'2026-10-16','2026-10-16')
 expect(csv).toContain('"營業費用",-5');expect(csv).toContain('"本期淨利",-5');expect(csv).toContain('"2026-10-16 ~ 2026-10-16"')
})
