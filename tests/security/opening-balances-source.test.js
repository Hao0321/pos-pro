import {describe,it,expect} from 'vitest'
import fixture from '../fixtures/opening-balances-source-v1.json'
import {projectOpeningBalanceSource,openingBalancesToJournalEntries} from '../../electron/openingBalanceSource.mjs'
import {appendOpeningBalanceContext,openingBalanceTimeline} from '../../electron/openingBalanceLedger.mjs'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'

const cutoff='2026-10-18',time='2026-10-18T06:00:00.000Z',actor={userId:'owner',username:'Owner',role:'owner'},text=()=>JSON.stringify(fixture),alter=fn=>{const source=structuredClone(fixture);fn(source,source.tables[2],source.tables[3]);return JSON.stringify(source)}
function context(sourceText=text(),prior){const source=projectOpeningBalanceSource(sourceText,cutoff);return appendOpeningBalanceContext(prior,{storeId:'store',sourceText,cutoffDate:cutoff,partyMappings:source.parties.map(p=>({key:p.key,side:p.side,externalId:p.externalId,targetId:p.side==='receivable'?'customer':'supplier',targetName:p.name})),customerRevision:1,supplierRevision:0,actor,time})}
const account=(entries,id)=>entries.flatMap(e=>e.lines).filter(l=>l.account===id).reduce((sum,line)=>sum+Math.round(line.debit*100)-Math.round(line.credit*100),0)

describe('OB2 original open invoices and credits',()=>{
 it('preserves the original partial-payment facts and zero references without treating old paid amounts as new cash',()=>{
  const p=projectOpeningBalanceSource(text(),cutoff)
  expect(p.facts.map(f=>[f.externalId,f.outstandingCents,f.originalCents,f.paidCents])).toEqual([['AR0001',60000,100000,40000],['CR0001',10000,10000,0],['AR0000',0,1000,1000],['AP0001',90000,120000,30000],['SC0001',20000,20000,0]])
  expect(p.totals).toEqual({receivable:{invoices:1,credits:1,invoiceCents:60000,creditCents:10000,netCents:50000},payable:{invoices:1,credits:1,invoiceCents:90000,creditCents:20000,netCents:70000}})
  expect(p.source).toEqual(fixture);expect(p.facts[0]).toMatchObject({number:'AR-ORIGINAL-001',date:'2026-10-01',dueDate:'2026-10-31',cutoffDate:cutoff,partyExternalId:'C0001',partyName:'原客戶',origin:{kind:'agent',table:2,row:0}})
 })
 it('posts only the four original control-account balances, leaving cash, revenue, expense, tax and inventory absent',()=>{
  const ctx=context(),claims=[...openingBalanceTimeline(ctx,'receivable',1,'store').at(1).claims,...openingBalanceTimeline(ctx,'payable',0,'store').at(0).claims],journals=openingBalancesToJournalEntries(ctx.batches[0],claims)
  expect(journals).toHaveLength(4);expect(account(journals,'1141')).toBe(50000);expect(account(journals,'2101')).toBe(-70000);expect(account(journals,'3902')).toBe(20000)
  expect([...new Set(journals.flatMap(j=>j.lines).map(l=>l.account))].sort()).toEqual(['1141','2101','3902'])
  expect(journals.every(j=>j.date===cutoff&&j.lines.reduce((n,l)=>n+Math.round(l.debit*100)-Math.round(l.credit*100),0)===0)).toBe(true)
 })
 for(const [column,value]of [[0,''],[1,''],[2,''],[2,'receipt'],[3,''],[3,'2026-02-30'],[3,'2026-10-19'],[4,''],[4,'2026-02-30'],[5,''],[5,'-1'],[5,'1.001'],[5,'1e2'],[5,'=100+20'],[5,'1000000000.01'],[6,'USD'],[6,''],[7,'599'],[7,'1000.001'],[8,'399.99']])it('leaves an unknown or inconsistent source fact unresolved '+column+' '+JSON.stringify(value),()=>expect(()=>projectOpeningBalanceSource(alter((_s,t)=>t.rows[0].values[column]=value),cutoff)).toThrow())
 it('does not infer a credit merely from a negative amount and retains an explicit positive credit magnitude',()=>{
  expect(()=>projectOpeningBalanceSource(alter((_s,t)=>t.rows[0].values[5]='-600'),cutoff)).toThrow()
  expect(projectOpeningBalanceSource(alter((_s,t)=>t.rows[1].values[5]='100'),cutoff).totals.receivable.netCents).toBe(50000)
 })
 it('refuses to swap customer and supplier column semantics',()=>{
  expect(()=>projectOpeningBalanceSource(alter((_s,t)=>t.columns[0]='supplierExternalId'),cutoff)).toThrow('帳款種類')
  expect(()=>projectOpeningBalanceSource(alter((_s,_t,p)=>p.columns[0]='customerExternalId'),cutoff)).toThrow('帳款種類')
 })
 it('preserves overdue dates and requires an explicit invoice due date without inventing a date for credits',()=>{
  expect(projectOpeningBalanceSource(alter((_s,t)=>t.rows[0].values[4]='2026-10-05'),cutoff).facts[0].dueDate).toBe('2026-10-05')
  const source=JSON.parse(text());source.tables[2].columns.splice(4,1);source.tables[2].rows.forEach(r=>r.values.splice(4,1));expect(()=>projectOpeningBalanceSource(JSON.stringify(source),cutoff)).toThrow('到期日')
 })
 it('rejects duplicate source rows and a duplicate economic invoice under another source ID',()=>{
  expect(()=>projectOpeningBalanceSource(alter((_s,t)=>t.rows[1].externalId='AR0001'),cutoff)).toThrow('重複')
  expect(()=>projectOpeningBalanceSource(alter((_s,t)=>t.rows.push({...structuredClone(t.rows[0]),externalId:'OTHER-ID'})),cutoff)).toThrow('重複')
 })
 it('does not merge same-name source parties or trim padded source identities',()=>{
  const source=alter((s,t)=>{s.tables[0].rows.push({externalId:'C0002',values:['原客戶','0900000000']});t.rows[1].values[0]='C0002'})
  expect(projectOpeningBalanceSource(source,cutoff).parties.filter(p=>p.side==='receivable').map(p=>p.externalId)).toEqual(['C0001','C0002'])
  expect(()=>projectOpeningBalanceSource(alter((_s,t)=>t.rows[0].values[0]=' C0001'),cutoff)).toThrow('原編號')
 })
 it('requires explicit treatment of extra populated columns and duplicate monetary roles',()=>{
  expect(()=>projectOpeningBalanceSource(alter((_s,t)=>{t.columns.push('taxAmount');t.rows.forEach(r=>r.values.push('10'))}),cutoff)).toThrow('未處理')
  expect(()=>projectOpeningBalanceSource(alter((_s,t)=>{t.columns.push('未收金額');t.rows.forEach(r=>r.values.push('0'))}),cutoff)).toThrow('重複')
  expect(()=>projectOpeningBalanceSource(alter((_s,t)=>{t.columns.push('cutoffDate');t.rows.forEach(r=>r.values.push('2026-10-17'))}),cutoff)).toThrow('截止日')
 })
 it('reports other source work explicitly so a combined importer cannot discard stock or historical content',()=>{
  const source=alter(s=>{s.tables.push({entity:'opening-stock',columns:['productExternalId'],rows:[{externalId:'stock',values:['p']}]});s.tables.push({entity:'history-reference',columns:['old'],rows:[{externalId:'h',values:['actual old history']}]})}),p=projectOpeningBalanceSource(source,cutoff)
  expect(p.stockRequired).toBe(true);expect(p.otherEntities).toEqual(['history-reference']);expect(p.source.tables).toHaveLength(6)
 })
})
describe('OB3 / OB4 source identity and exact activation boundaries',()=>{
 it('activates invoices and credits at each ledger boundary and binds the source bytes and target identity',()=>{
  const ctx=context(),ar=openingBalanceTimeline(ctx,'receivable',1,'store'),ap=openingBalanceTimeline(ctx,'payable',0,'store')
  expect(ar.at(0)).toMatchObject({digest:null,claims:[],credits:[]});expect(ar.at(1).credits[0]).toMatchObject({customerId:'customer',outstandingCents:10000});expect(ap.at(0).credits[0]).toMatchObject({supplierId:'supplier',outstandingCents:20000})
  expect(ctx.batches[0].sourceText).toBe(text());expect(ar.at(1).claims[0].documentId).not.toBe(ap.at(0).claims[0].documentId)
  expect(()=>openingBalanceTimeline(ctx,'receivable',0,'store')).toThrow('生效版本');expect(()=>openingBalanceTimeline(ctx,'receivable',1,'other')).toThrow('生效版本')
 })
 it('snapshots and freezes the source proof so later caller edits cannot alter a compiled timeline',()=>{
  const ctx=context(),timeline=openingBalanceTimeline(ctx,'receivable',1,'store'),active=timeline.at(1),digest=active.digest
  expect(()=>active.claims[0].outstandingCents=1).toThrow();expect(()=>active.claims[0].source.company='other').toThrow();expect(()=>active.claims.pop()).toThrow()
  ctx.storeId='other';ctx.batches[0].hash='0'.repeat(64);expect(timeline.at(1)).toBe(active);expect(timeline.at(1).digest).toBe(digest);expect(()=>openingBalanceTimeline(ctx,'receivable',1,'store')).toThrow()
 })
 it.each(['stock','products','history','stored-value','unreferenced-party'])('does not turn a %s source into an apparently complete financial-only import',kind=>{
  const source=alter(s=>{
   if(kind==='stock')s.tables.push({entity:'opening-stock',columns:['productExternalId'],rows:[{externalId:'S',values:['P']}]})
   if(kind==='products')s.tables.push({entity:'products',columns:['name'],rows:[{externalId:'P',values:['Actual product']}]})
   if(kind==='history')s.tables.push({entity:'history-reference',columns:['amount'],rows:[{externalId:'H',values:['100']}]})
   if(kind==='stored-value'){s.tables[0].columns.push('balance');s.tables[0].rows[0].values.push('100')}
   if(kind==='unreferenced-party')s.tables[0].rows.push({externalId:'UNUSED',values:['Another actual party','0900000001']})
  });expect(()=>context(source)).toThrow('尚未保存')
 })
 it.each(['side','type','currency','amount','batch','cutoff'])('rejects a %s change at the journal boundary',kind=>{
  const ctx=context(),claim={...openingBalanceTimeline(ctx,'receivable',1,'store').at(1).claims[0]}
  if(kind==='side')claim.side='other';if(kind==='type')claim.type='cash';if(kind==='currency')claim.currency='USD';if(kind==='amount')claim.outstandingCents=1.1;if(kind==='batch')claim.batchId='other';if(kind==='cutoff')claim.cutoffDate='2026-10-17'
  expect(()=>openingBalancesToJournalEntries(ctx.batches[0],[claim])).toThrow()
 })
 for(const kind of ['amount','mapping','activation','actor','missing-row','unknown-field'])it('rejects a changed '+kind+' proof without accepting a recomputed display balance',()=>{
  const ctx=context(),changed=structuredClone(ctx)
  if(kind==='amount')changed.batches[0].sourceText=alter((_s,t)=>{t.rows[0].values[5]='599';t.rows[0].values[8]='401'})
  if(kind==='mapping')changed.batches[0].partyMappings[0].targetId='other'
  if(kind==='activation')changed.batches[0].customerRevision=0
  if(kind==='actor')changed.batches[0].actor.role='staff'
  if(kind==='missing-row')changed.batches[0].partyMappings.pop()
  if(kind==='unknown-field')changed.batches[0].confirmed=true
  expect(()=>openingBalanceTimeline(changed,'receivable',1,'store')).toThrow()
 })
 it('rejects duplicate imports and cross-source duplicate economic invoices, including after recalculating the new batch ID',()=>{
  const ctx=context();expect(()=>context(text(),ctx)).toThrow()
  expect(()=>context(alter(s=>{s.id='other-report';s.tables[2].rows[0].externalId='DIFFERENT-SOURCE-ID'}),ctx)).toThrow()
 })
 it('keeps source-party mappings permanent across later batches',()=>{
  const first=context(),sourceText=alter(s=>{s.id='next-report';s.tables=s.tables.filter(t=>t.entity==='opening-receivables');s.tables[0].rows=[{externalId:'AR-LATER',values:['C0001','DIFFERENT-INVOICE','invoice','2026-10-10','2026-10-31','25','TWD','25','0']}]})
  const parsed=projectOpeningBalanceSource(sourceText,cutoff),row={storeId:'store',sourceText,cutoffDate:cutoff,partyMappings:parsed.parties.map(p=>({key:p.key,side:p.side,externalId:p.externalId,targetId:'other',targetName:'Other'})),customerRevision:2,supplierRevision:0,actor,time}
  expect(()=>appendOpeningBalanceContext(first,row)).toThrow()
  row.partyMappings[0].targetId='customer';const ctx=appendOpeningBalanceContext(first,row);expect(openingBalanceTimeline(ctx,'receivable',2,'store').at(1).claims).toHaveLength(3);expect(openingBalanceTimeline(ctx,'receivable',2,'store').at(2).claims).toHaveLength(4)
  const changed=structuredClone(ctx);changed.batches[1].customerRevision=0;const {hash,...body}=changed.batches[1];changed.batches[1].hash=privateDraftDigest(body);const {digest,...root}=changed;changed.digest=privateDraftDigest(root);expect(()=>openingBalanceTimeline(changed,'receivable',2,'store')).toThrow()
 })
})
