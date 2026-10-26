import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import source from '../fixtures/opening-whole-source-v1.json'
import fixture from '../fixtures/lot-count-native-v1.json'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {previewOpeningCutover,projectOpeningCutoverBook} from '../../electron/openingCutoverModel.mjs'
import {validMigrationInput,migrationHandoff} from '../../electron/migrationSource.mjs'
import {cutoverSourceCanRoute,cutoverSourceDate,emptyCutoverDraft,validCutoverDraft,cutoverDraftInput,assertCutoverPreview,cutoverDisplayTotals} from '../../src/utils/openingCutoverDraft.mjs'
import messages from '../../public/i18n/messages.mjs'

const time='2026-10-19T04:00:00.000Z',actor={userId:'owner',username:'Lot fixture',role:'owner'},book=()=>browserToBook(structuredClone(readPortableBackup(fixture,'browser').book)),scope=b=>privateDraftContext(fixture.storeId,'cutover-intake-epoch',actor,b.users),form=(value=source)=>({...emptyCutoverDraft(),text:JSON.stringify(value),cutoffDate:'2026-10-19'})
function prepared(){const data=book(),draft=form(),input=cutoverDraftInput(draft,scope(data)),view=previewOpeningCutover(input,data,scope(data),actor);expect(view.ready,JSON.stringify(view.trial||view.plan)).toBe(true);return {data,draft,input,view,command:{...input,review:view.review}}}
beforeEach(()=>vi.setSystemTime(new Date(time)));afterEach(()=>vi.useRealTimers())

it('routes a whole canonical source before the stock-only path, including fenced Agent replies without changing source bytes',()=>{
 const draft=form(),wrapped='Agent reply:\n```json\n'+draft.text+'\n```';expect(cutoverSourceCanRoute(draft.text)).toBe(true);expect(cutoverSourceCanRoute(wrapped)).toBe(true);expect(cutoverDraftInput({...draft,text:wrapped},scope(book())).sourceText).toBe(wrapped)
 for(const value of ['',JSON.stringify({...source,protocol:'unknown'}),JSON.stringify({...source,tables:source.tables.filter(row=>!row.entity.startsWith('opening-receivables')&&!row.entity.startsWith('opening-payables'))})])expect(cutoverSourceCanRoute(value)).toBe(false)
 expect(validMigrationInput({text:draft.text,workflow:'opening-cutover'})).toBe(true);expect(validMigrationInput({text:draft.text,workflow:'execute-finance'})).toBe(false)
})
it('does not discard unsupported source history when financial routing is selected',()=>{const value=structuredClone(source);value.tables.push({entity:'history-reference',columns:['note'],rows:[{externalId:'history-01',values:['Keep this original history']} ]});const draft=form(value);expect(cutoverSourceCanRoute(draft.text)).toBe(true);expect(()=>cutoverDraftInput(draft,scope(book()))).toThrow();expect(JSON.parse(draft.text).tables.at(-1).rows[0].values[0]).toBe('Keep this original history')})
it('prefills only a verified consistent report date, never today, an invoice date or one side of a conflict',()=>{
 expect(cutoverSourceDate(form().text)).toBe('');const value=structuredClone(source);for(const table of value.tables.filter(row=>row.entity==='opening-receivables'||row.entity==='opening-payables')){table.columns.push('cutoffDate');for(const row of table.rows)row.values.push('2026-10-19')}
 expect(cutoverSourceDate(JSON.stringify(value))).toBe('2026-10-19');value.tables.find(row=>row.entity==='opening-payables').rows[0].values[value.tables.find(row=>row.entity==='opening-payables').columns.length-1]='2026-10-18';expect(cutoverSourceDate(JSON.stringify(value))).toBe('')
})
it('keeps partially typed amounts and malformed editable source, but never turns them into an accepted financial request',()=>{
 expect(validCutoverDraft({...form(),text:'not yet JSON',declaredTotals:{stockValue:'1.'}})).toBe(true)
 for(const raw of ['1e3','NaN','-1','250.001']){const draft={...form(),declaredTotals:{stockValue:raw}};expect(validCutoverDraft(draft)).toBe(true);expect(()=>cutoverDraftInput(draft,scope(book()))).toThrow()}
 expect(()=>cutoverDraftInput({...form(),cutoffDate:''},scope(book()))).toThrow();expect(validCutoverDraft({...form(),currency:'JPY'})).toBe(false);expect(validCutoverDraft({...form(),confirmed:true})).toBe(false)
})
it('binds every pending original fact to the durable draft rather than allowing another source or new choices to replace it',()=>{
 const {draft,command}=prepared(),pending={...draft,attempted:command};expect(validCutoverDraft(pending)).toBe(true)
 for(const edit of [value=>value.text+=' ',value=>value.cutoffDate='2026-10-18',value=>value.currency='TWD',value=>value.masterChoices=[{table:1,row:0,targetId:''}],value=>value.partyChoices=[{key:'other',action:'new'}],value=>value.declaredTotals={receivableInvoices:'600'}]){const changed=structuredClone(pending);edit(changed);expect(validCutoverDraft(changed)).toBe(false)}
 expect(validCutoverDraft({...draft,attempted:null})).toBe(false);expect(validCutoverDraft({...draft,attempted:{...command,id:'another-batch'}})).toBe(false)
})
it('accepts a real complete preview and refuses a different original, scope or review proof before displaying confirmation',()=>{
 const {input,view}=prepared();expect(assertCutoverPreview(input,view)).toBe(view)
 for(const edit of [value=>value.id='another-batch',value=>value.plan.source.company='another-company',value=>value.plan.sourceId='another-source',value=>value.review.inputDigest='0'.repeat(64),value=>value.review.scope.epoch='another-epoch']){const changed=structuredClone(view);edit(changed);expect(()=>assertCutoverPreview(input,changed)).toThrow('試算回覆')}
})
it('rejects missing totals and malformed cents in an acknowledgement instead of rendering fabricated zero or imprecise money',()=>{
 const {input,view}=prepared();for(const edit of [value=>value.plan.totals.pop(),value=>value.plan.totals[0].expectedCents=NaN,value=>value.plan.totals[1].expectedCents=-1,value=>value.plan.financialRows[0].outstandingCents=0.01,value=>value.plan.stockRows[0].fact.valueCents=Number.MAX_SAFE_INTEGER+1]){const changed=structuredClone(view);edit(changed);expect(()=>assertCutoverPreview(input,changed)).toThrow('試算回覆')}
})
it('verifies a saved original receipt before treating an already imported source as complete, and does not repeat its effects',()=>{
 const {input,view,data,command}=prepared(),saved=projectOpeningCutoverBook(command,view.plan,data,scope(data),actor,time),value={protocol:'pos-opening-cutover-preview/v1',id:input.id,ready:false,saved:saved.receipt},before=JSON.stringify(saved.book)
 expect(assertCutoverPreview(input,value)).toBe(value);expect(JSON.stringify(saved.book)).toBe(before)
 const tampered=structuredClone(value);tampered.saved.hash='0'.repeat(64);expect(()=>assertCutoverPreview(input,tampered)).toThrow();expect(()=>assertCutoverPreview({...input,declaredTotals:{stockValue:'250.01'}},value)).toThrow()
})
it('displays gross original invoices and source credits separately without inventing payments, and checks each independent original subtotal',()=>{
 const {input,data}=prepared(),snapshot=JSON.stringify(data);expect(cutoverDisplayTotals(input)).toEqual({stockValue:25001,receivableInvoices:60000,receivableCredits:10000,payableInvoices:90000,payableCredits:20000});expect(JSON.stringify(data)).toBe(snapshot)
 const declaredTotals={stockValue:'250.01',receivableInvoices:'600.00',receivableCredits:'100.00',payableInvoices:'900.00',payableCredits:'200.00'};expect(cutoverDraftInput({...form(),declaredTotals},scope(data)).declaredTotals).toEqual(declaredTotals)
 expect(()=>cutoverDraftInput({...form(),declaredTotals:{...declaredTotals,receivableInvoices:'600.01'}},scope(data))).toThrow();expect(()=>cutoverDraftInput({...form(),declaredTotals:{...declaredTotals,receivableCredits:'100.01'}},scope(data))).toThrow()
})
it('keeps the Agent handoff a draft without credentials or payment authority while describing the actual supported financial source facts',()=>{
 const packet=migrationHandoff();expect(packet.businessCommit).toBe(false);expect(packet.openingBalances).toMatchObject({entities:['opening-receivables','opening-payables'],humanReviewRequired:true,currency:'TWD',rawFinancialFiles:true,fullMigrationComplete:false});expect(packet.openingBalances.invoiceRequiredColumns).toContain('dueDate');expect(packet.openingBalances.requiredColumns).toContain('outstanding');expect(packet).not.toHaveProperty('actor');expect(packet).not.toHaveProperty('confirmed')
})
it('includes actual English, Japanese and Simplified Chinese for the intake decisions instead of relying on Traditional Chinese fallback',()=>{
 for(const key of ['搬家核對','原來還沒結清的資料','客戶尚未付款','供應商原有貸項','我已核對這批原資料與金額','確認整批搬入','接著收欠款','修正我剛選的對照']){expect(messages[key]?.length).toBe(3);expect(messages[key].every(value=>typeof value==='string'&&value.trim())).toBe(true);expect(messages[key][0]).not.toBe(key);expect(messages[key][1]).not.toBe(key)}
})
