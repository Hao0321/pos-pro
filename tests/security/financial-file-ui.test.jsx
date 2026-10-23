// @vitest-environment jsdom
import React,{useState} from 'react'
import {it,expect,afterEach} from 'vitest'
import {render,fireEvent,cleanup} from '@testing-library/react'
import workbook from './financialMigrationFixture.cjs'
import Setup from '../../src/components/FinancialFileMigrationSetup'
import {makeFinancialFileDraft,financialWorkbookSheets} from '../../electron/financialFileDraft.mjs'
import {projectFinancialFileSource} from '../../electron/financialFileSource.mjs'
import {projectOpeningBalanceTables} from '../../electron/openingBalanceSource.mjs'
import messages from '../../public/i18n/messages.mjs'

afterEach(()=>cleanup())
function mount(sheets){const file=workbook({sheets}),draft=makeFinancialFileDraft({system:'Original ERP',company:'Original shop'},'TWD',[{kind:'xlsx',file,sheets:financialWorkbookSheets(file)}]);let current=draft
 function Shell(){const [value,setValue]=useState(draft);return <Setup value={value} disabled={false} onChange={next=>{current=makeFinancialFileDraft(next.source,next.currency,next.files);setValue(current)}} onPreview={()=>{}} onAddFiles={async()=>{}}/>}
 render(<Shell/>);fireEvent.change(document.querySelector('[data-financial-sheet]'),{target:{value:'0:2'}});return {file,current:()=>current}
}
it('keeps a missing amount input mounted through each digit and retains its original file and exact correction',()=>{
 const sheets=structuredClone(workbook.standard);sheets[1].rows[0][7]='';const state=mount(sheets),selector='[data-financial-cell="0:2:0:7"]',field=document.querySelector(selector);expect(field).not.toBe(null)
 for(const value of ['6','60','600.00']){fireEvent.change(document.querySelector(selector),{target:{value}});expect(document.querySelector(selector)).toBe(field);expect(field.value).toBe(value)}
 expect(state.current().files[0].file.base64).toBe(state.file.base64);expect(state.current().files[0].sheets[1].plan.repairs).toEqual([{row:0,column:7,value:'600.00'}]);expect(projectOpeningBalanceTables(projectFinancialFileSource(state.current()),'2026-10-23').facts[0].outstandingCents).toBe(60000)
})
it('shows a known precision error as a disabled source fact, with no replacement correction',()=>{
 const sheets=structuredClone(workbook.standard);sheets[1].rows[0][7]='600.001';const state=mount(sheets),field=document.querySelector('[data-financial-cell="0:2:0:7"]');expect(field).not.toBe(null);expect(field.disabled).toBe(true);expect(field.value).toBe('600.001');expect(state.current().files[0].sheets[1].plan.repairs).toEqual([]);expect(()=>projectOpeningBalanceTables(projectFinancialFileSource(state.current()),'2026-10-23')).toThrow()
})
it('changes a whole date-column interpretation explicitly while leaving the original text and file unchanged',()=>{
 const sheets=structuredClone(workbook.standard);sheets[1].rows[0][5]='03/10/2026';const state=mount(sheets);expect(document.querySelector('[data-financial-cell="0:2:0:5"]').disabled).toBe(true);fireEvent.change(document.querySelector('[data-financial-date-format]'),{target:{value:'dmy'}});expect(state.current().files[0].file.base64).toBe(state.file.base64);expect(state.current().files[0].sheets[1].plan.repairs).toEqual([]);expect(projectOpeningBalanceTables(projectFinancialFileSource(state.current()),'2026-10-23').facts[0].date).toBe('2026-10-03')
})
it('provides real translated text for each new primary review choice and original-fact refusal',()=>{
 for(const key of ['一起核對原庫存與欠款','核對日期與金額格式','原日期的排列','原金額的符號','只核對這 {0} 格','加入另一份表格','這格是原檔已知的數字、日期或編號，不能改成零或另一筆資料。']){expect(messages[key]).toHaveLength(3);for(const translated of messages[key])expect(typeof translated==='string'&&translated.length>0).toBe(true);expect(messages[key][0]).not.toBe(key);expect(messages[key][1]).not.toBe(key)}
 expect(messages['原日期的排列'][2]).toBe('原日期的排列')
})
