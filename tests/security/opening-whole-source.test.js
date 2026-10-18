import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest'
import original from '../fixtures/opening-whole-source-v1.json'
import financial from '../fixtures/opening-balances-source-v1.json'
import fixture from '../fixtures/lot-count-native-v1.json'
import {readPortableBackup} from '../../electron/backupEnvelope.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {makeOpeningSourcePlanInput,projectOpeningSourcePlan,verifyOpeningSourcePlan} from '../../electron/openingSourcePlan.mjs'
import {projectOpeningBalanceSource} from '../../electron/openingBalanceSource.mjs'
import {projectOpeningBalanceParties,openingFinancialCustomerId} from '../../electron/openingBalanceParties.mjs'
import {appendOpeningBalanceContext} from '../../electron/openingBalanceLedger.mjs'
import {makeOpeningMigrationInput} from '../../electron/openingMigration.mjs'
import {readMasterMigrationInput} from '../../electron/masterMigration.mjs'
import workbook from './openingMigrationFixture.cjs'

const cutoff='2026-10-19',now=Date.parse('2026-10-19T04:00:00.000Z'),actor={userId:'owner',username:'Lot fixture',role:'owner'},text=()=>JSON.stringify(original),book=()=>browserToBook(structuredClone(readPortableBackup(fixture,'browser').book)),scope=b=>privateDraftContext(fixture.storeId,'whole-epoch',actor,b.users),input=(b,options={},source=text())=>makeOpeningSourcePlanInput(source,scope(b),cutoff,options),plan=(b=book(),options={},source=text())=>projectOpeningSourcePlan(input(b,options,source),b,scope(b),actor,now),alter=fn=>{const source=structuredClone(original);fn(source);return JSON.stringify(source)},sum=(p,account)=>p.trial.accounts.find(row=>row.account===account)?.netCents||0

describe('OB2 / OB3 whole original source planning prerequisite',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now)})
 afterEach(()=>vi.useRealTimers())
 it('projects every source role together without saving, mutating or reserializing the original',()=>{
  const b=book(),before=canonicalSignature(b),command=input(b),p=projectOpeningSourcePlan(command,b,scope(b),actor,now)
  expect(p.factsReady).toBe(true);expect(p.writeAvailable).toBe(false);expect(p.trial).toMatchObject({status:'source-controls-only',persisted:false,stockCostPostimageChecked:false})
  expect(p.masterRows.map(r=>[r.entity,r.sourceTable,r.sourceRow])).toEqual([['suppliers',1,0],['products',3,0]])
  expect(p.custody).toHaveLength(9);expect(new Set(p.custody.map(r=>r.table+':'+r.row)).size).toBe(9);expect(p.custody[0].role).toBe('financial-customer')
  expect(p.financialRows).toHaveLength(5);expect(p.financialRows[2].outstandingCents).toBe(0);expect(p.financialRows[0].origin).toEqual({kind:'agent',table:2,row:0})
  expect(p.stockRows[0]).toMatchObject({fact:{quantityUnits:12500,valueCents:25001},afterUnits:12500})
  expect(p.parties.creations).toHaveLength(1);expect(p.parties.creations[0]).toMatchObject({side:'receivable',values:{name:'原客戶',phone:'0900000000'}})
  expect(command.sourceText).toBe(text());expect(canonicalSignature(b)).toBe(before)
 })
 it('balances exact stock and the four original invoice/credit controls without old cash, tax or trading results',()=>{
  const p=plan();expect([sum(p,'1211'),sum(p,'1141'),sum(p,'2101'),sum(p,'3902')]).toEqual([25001,50000,-70000,-5001]);expect(p.trial.accounts.reduce((n,r)=>n+r.netCents,0)).toBe(0)
  expect([...new Set(p.trial.lines.map(r=>r.account))].sort()).toEqual(['1141','1211','2101','3902']);expect(p.financialRows[0]).toMatchObject({outstandingCents:60000,originalCents:100000,paidCents:40000})
 })
 it('keeps absent independent totals unverified rather than comparing the calculated number with itself',()=>{
  expect(plan().totals.every(row=>row.status==='not-provided'&&row.declaredCents===null)).toBe(true)
  const p=plan(book(),{declaredTotals:{stockValue:'250.01',receivableInvoices:'600',receivableCredits:'100',payableInvoices:'900',payableCredits:'200'}})
  expect(p.totals.every(row=>row.status==='matched')).toBe(true);expect(p.factsReady).toBe(true)
 })
 it('refuses offsetting independent total errors even when the net account would match',()=>{
  const p=plan(book(),{declaredTotals:{receivableInvoices:'601',receivableCredits:'101'}})
  expect(sum(p,'1141')).toBe(50000);expect(p.factsReady).toBe(false);expect(p.totals.filter(row=>row.status==='mismatch').map(r=>r.key)).toEqual(['receivableInvoices','receivableCredits'])
 })
 it('treats an explicit zero total as a fact and rejects a changed known amount rather than dropping it',()=>{
  expect(plan(book(),{declaredTotals:{receivableInvoices:'0'}}).factsReady).toBe(false)
  expect(()=>plan(book(),{declaredTotals:{stockValue:'1e2'}})).toThrow();expect(()=>plan(book(),{declaredTotals:{stockValue:null}})).toThrow()
 })
 it.each(['history','foreign','stock-mismatch','unknown-money','unsupported-master','birthday'])('retains %s work as a blocking condition for the whole source',kind=>{
  const source=alter(s=>{
   if(kind==='history')s.tables.push({entity:'history-reference',columns:['value'],rows:[{externalId:'H',values:['100']}]})
   if(kind==='foreign')s.tables[2].rows[0].values[6]='USD'
   if(kind==='stock-mismatch')s.tables[3].rows[0].values[4]='12.4'
   if(kind==='unknown-money')s.tables[2].rows[0].values[5]=''
   if(kind==='unsupported-master'){s.tables[3].columns.push('taxAmount');s.tables[3].rows[0].values.push('10')}
   if(kind==='birthday'){s.tables[0].columns.push('birthday');s.tables[0].rows[0].values.push('1990-01-01')}
  })
  if(['unsupported-master','birthday'].includes(kind))expect(plan(book(),{},source).factsReady).toBe(false)
  else expect(()=>plan(book(),{currency:'TWD'},source)).toThrow()
 })
 it('keeps unreferenced membership data in its own master role and preserves original table/row choices',()=>{
  const source=alter(s=>s.tables[0].rows.push({externalId:'MEMBER-2',values:['一般會員','0900000001']})),b=book(),p=plan(b,{},source)
  expect(p.masterRows.map(r=>[r.entity,r.sourceTable,r.sourceRow])).toEqual([['customers',0,1],['suppliers',1,0],['products',3,0]])
  expect(p.custody.find(r=>r.table===0&&r.row===1).role).toBe('master');expect(p.parties.rows.filter(r=>r.side==='receivable')).toHaveLength(1)
  expect(()=>plan(b,{masterChoices:[{table:0,row:0,targetId:''}]},source)).toThrow('不屬於')
 })
 it('allows a truly empty extra column while refusing to drop its explicit zero',()=>{
  const source=JSON.parse(text());source.tables[3].columns.push('taxAmount');source.tables[3].rows[0].values.push('')
  expect(plan(book(),{},JSON.stringify(source)).factsReady).toBe(true)
  source.tables[3].rows[0].values[source.tables[3].rows[0].values.length-1]='0'
  const p=plan(book(),{},JSON.stringify(source));expect(p.factsReady).toBe(false);expect(p.masterRows.find(r=>r.entity==='products').issues).toContain('unhandled-master-field')
 })
 it('uses a separate financial directory even when a member has the same name and phone',()=>{
  const b=book();b.members.push({id:'a-member-only',name:'原客戶',phone:'0900000000'})
  const p=plan(b),customer=p.parties.rows.find(r=>r.side==='receivable');expect(customer.candidates).toEqual([]);expect(customer.action).toBe('create');expect(customer.targetId).toMatch(/^opening-customer-/);expect(customer.targetId).not.toBe('a-member-only')
 })
 it('preserves financial contact fields instead of forcing them through the membership schema',()=>{
  const p=plan(book(),{},alter(s=>{s.tables[0].columns.push('contact','email','address','note');s.tables[0].rows[0].values.push('聯絡人','original@example.invalid','原地址','原備註')}))
  expect(p.factsReady).toBe(true);expect(p.parties.creations[0].values).toMatchObject({contact:'聯絡人',email:'original@example.invalid',address:'原地址',note:'原備註'})
 })
 it('supports a financial-only source while retaining both sides and every zero reference',()=>{
  const p=plan(book(),{},JSON.stringify(financial));expect(p.factsReady).toBe(true);expect(p.stockRows).toEqual([]);expect(p.financialRows).toHaveLength(5);expect(sum(p,'1211')).toBe(0);expect(sum(p,'3902')).toBe(20000)
 })
 it('keeps the original XLSX binary and physical source rows without passing the expanded table through the Agent byte limit',()=>{
  const rows=Array.from({length:1400},(_,i)=>['WB-'+i,'Original '+i+' '+('x'.repeat(180)),'piece','75','1','1.01','']),source=JSON.stringify(workbook(rows)),b=book(),command=input(b,{},source),p=projectOpeningSourcePlan(command,b,scope(b),actor,now)
  expect(new TextEncoder().encode(source).length).toBeLessThan(250000);expect(new TextEncoder().encode(JSON.stringify(p.masterRows)).length).toBeGreaterThan(250000);expect(p.factsReady).toBe(true);expect(p.stockRows).toHaveLength(1400);expect(p.stockRows[0].fact.origin).toMatchObject({kind:'xlsx',physicalRow:6});expect(p.stockRows.at(-1).fact.origin.physicalRow).toBe(1405);expect(p.masterRows[0].origin).toMatchObject({kind:'xlsx',physicalRow:6,externalIdColumn:0});expect(command.sourceText).toBe(source)
 })
 it('reports source-key and economic duplicates against the original ledger proof before offering another import',()=>{
  const b=book(),base=JSON.stringify(financial),parsed=projectOpeningBalanceSource(base,cutoff),supplier=parsed.parties.find(p=>p.side==='payable')
  b.suppliers.push({id:'existing-supplier',name:supplier.name});b.customerEntries=[];b.customerOperations=[]
  // The payable-only proof exercises duplicate detection without synthesizing
  // a financial customer profile or a customer money event.
  const source=structuredClone(financial);source.tables=source.tables.filter(t=>['suppliers','opening-payables'].includes(t.entity));const sourceText=JSON.stringify(source),context=appendOpeningBalanceContext(null,{storeId:scope(b).storeId,sourceText,cutoffDate:cutoff,partyMappings:[{key:supplier.key,side:supplier.side,externalId:supplier.externalId,targetId:'existing-supplier',targetName:supplier.name}],customerRevision:0,supplierRevision:0,actor,time:new Date(now).toISOString()});b.openingBalanceContext=context
  const p=plan(b,{masterChoices:[{table:0,row:0,targetId:'existing-supplier',resolution:'keep'}]},sourceText);expect(p.factsReady).toBe(false);expect(p.financialRows.every(r=>r.issues.includes('financial-source-already-saved')&&r.issues.includes('financial-invoice-already-saved'))).toBe(true)
  source.id='another-filename';source.tables[1].rows[0].externalId='OTHER-ID';const q=plan(b,{masterChoices:[{table:0,row:0,targetId:'existing-supplier',resolution:'keep'}]},JSON.stringify(source));expect(q.financialRows[0].issues).toEqual(['financial-invoice-already-saved'])
 })
 it('cannot pass a combined source or a planning protocol through an existing public v1 writer',()=>{
  const b=book(),command=input(b);expect(()=>makeOpeningMigrationInput(text(),scope(b),cutoff)).toThrow('帳款');expect(()=>readMasterMigrationInput(command)).toThrow()
  const parsed=projectOpeningBalanceSource(text(),cutoff);expect(()=>appendOpeningBalanceContext(null,{storeId:scope(b).storeId,sourceText:text(),cutoffDate:cutoff,partyMappings:parsed.parties.map(p=>({key:p.key,side:p.side,externalId:p.externalId,targetId:'a-party',targetName:p.name})),customerRevision:0,supplierRevision:0,actor,time:new Date(now).toISOString()})).toThrow('尚未保存')
 })
 it('binds a review to the complete source, store, epoch, owner, choices, book and exact displayed totals',()=>{
  const b=book(),command=input(b),p=projectOpeningSourcePlan(command,b,scope(b),actor,now),reviewed={...command,review:p.review}
  expect(verifyOpeningSourcePlan(reviewed,b,scope(b),actor,now).factsReady).toBe(true)
  const changed=structuredClone(b);changed.products[0].name+='changed';expect(()=>verifyOpeningSourcePlan(reviewed,changed,scope(b),actor,now)).toThrow('已更新')
  expect(()=>verifyOpeningSourcePlan({...reviewed,declaredTotals:{stockValue:'250.01'}},b,scope(b),actor,now)).toThrow('已更新')
  expect(()=>verifyOpeningSourcePlan(reviewed,b,{...scope(b),epoch:'other'},actor,now)).toThrow();expect(()=>verifyOpeningSourcePlan(reviewed,b,scope(b),{...actor,userId:'forged'},now)).toThrow()
  expect(()=>verifyOpeningSourcePlan({...reviewed,review:{...p.review,createdAt:now-16*60*1000}},b,scope(b),actor,now)).toThrow();expect(()=>verifyOpeningSourcePlan({...reviewed,review:{...p.review,createdAt:now+6000}},b,scope(b),actor,now)).toThrow()
 })
 it('does not allow a display review to hide a changed source, unknown input field or false owner scope',()=>{
  const b=book(),command=input(b);expect(()=>projectOpeningSourcePlan({...command,force:true},b,scope(b),actor,now)).toThrow();expect(()=>projectOpeningSourcePlan({...command,scope:{...scope(b),role:'staff'}},b,scope(b),actor,now)).toThrow()
  expect(()=>makeOpeningSourcePlanInput(text(),scope(b),'2026-02-30')).toThrow();expect(()=>projectOpeningSourcePlan({...command,cutoffDate:'2026-10-20'},b,scope(b),actor,now)).toThrow()
 })
})

describe('OB3 financial identity choices',()=>{
 const parsed=()=>projectOpeningBalanceSource(JSON.stringify(financial),cutoff),customer={id:'customer-1',name:'原客戶',phone:'0900000000'},supplier={id:'supplier-1',name:'原供應商'},identity=(options={},choices=[],source=parsed())=>projectOpeningBalanceParties(source,{storeId:'store',...options},choices),key=()=>parsed().parties.find(r=>r.side==='receivable').key
 it('requires an explicit choice for name and phone candidates without auto merging',()=>{
  const p=identity({customers:[customer]});expect(p.rows[0].issues).toContain('choose-party');expect(p.ready).toBe(false)
  const q=identity({customers:[{...customer,name:'Different name',phone:'0900-000-000'}]});expect(q.rows[0].candidates).toHaveLength(1);expect(q.rows[0].issues).toContain('choose-party')
 })
 it('allows an explicit separate customer or a reviewed existing identity with a different display name',()=>{
  const p=identity({customers:[customer]},[{key:key(),action:'new'}]);expect(p.ready).toBe(true);expect(p.rows[0].targetId).not.toBe(customer.id)
  const q=identity({customers:[{...customer,name:'New local name'}]},[{key:key(),action:'existing',targetId:customer.id,expectedName:'New local name'}]);expect(q.ready).toBe(true);expect(q.rows[0]).toMatchObject({targetId:customer.id,targetName:'New local name',sourceValues:{name:'原客戶'}})
 })
 it('refuses a stale name, missing target or wrong financial directory',()=>{
  for(const targetId of [customer.id,supplier.id]){const p=identity({customers:[{...customer,name:'Changed'}],suppliers:[supplier]},[{key:key(),action:'existing',targetId,expectedName:'原客戶'}]);expect(p.ready).toBe(false);expect(p.rows[0].issues).toContain('stale-party-choice')}
 })
 it('can identify an unnamed source party only through an explicitly verified existing identity',()=>{
  const s=structuredClone(financial);s.tables=s.tables.filter(t=>t.entity!=='customers');const p=projectOpeningBalanceSource(JSON.stringify(s),cutoff),k=p.parties.find(r=>r.side==='receivable').key
  expect(identity({},[],p).ready).toBe(false);const result=identity({customers:[customer]},[{key:k,action:'existing',targetId:customer.id,expectedName:customer.name}],p);expect(result.ready).toBe(true);expect(result.rows[0].sourceValues.name).toBe('')
 })
 it('keeps permanent source-party mappings and checks their current identity without recreating missing targets',()=>{
  const s=parsed(),context=appendOpeningBalanceContext(null,{storeId:'store',sourceText:JSON.stringify(financial),cutoffDate:cutoff,partyMappings:s.parties.map(p=>({key:p.key,side:p.side,externalId:p.externalId,targetId:p.side==='receivable'?customer.id:supplier.id,targetName:p.name})),customerRevision:0,supplierRevision:0,actor,time:new Date(now).toISOString()})
  const options={context,customers:[customer],suppliers:[supplier]};expect(identity(options).ready).toBe(true);expect(identity(options,[{key:key(),action:'new'}]).rows[0].issues).toContain('source-party-changed');expect(identity({...options,customers:[]}).rows[0].issues).toContain('missing-mapped-party')
  const corrupted=structuredClone(context);corrupted.batches[0].partyMappings[0].targetId='other';expect(()=>identity({...options,context:corrupted})).toThrow()
 })
 it('does not merge two external IDs into one target even with separate explicit selections',()=>{
  const s=structuredClone(financial);s.tables[0].rows.push({externalId:'C0002',values:['原客戶','0900000000']});s.tables[2].rows[1].values[0]='C0002';const source=projectOpeningBalanceSource(JSON.stringify(s),cutoff),choices=source.parties.filter(p=>p.side==='receivable').map(p=>({key:p.key,action:'existing',targetId:customer.id,expectedName:customer.name})),p=identity({customers:[customer]},choices,source)
  expect(p.rows.filter(r=>r.side==='receivable').every(r=>r.issues.includes('duplicate-party-target'))).toBe(true)
 })
 it('blocks deterministic-ID collisions and preserves source namespace across different filenames',()=>{
  const id=openingFinancialCustomerId('store',key()),p=identity({customers:[{id,name:'Unrelated'}]});expect(p.rows[0].issues).toContain('party-id-collision')
  const changed=structuredClone(financial);changed.id='new-filename';expect(identity({},[],projectOpeningBalanceSource(JSON.stringify(changed),cutoff)).rows[0].targetId).toBe(identity().rows[0].targetId)
  changed.source.company+='other';expect(identity({},[],projectOpeningBalanceSource(JSON.stringify(changed),cutoff)).rows[0].targetId).not.toBe(identity().rows[0].targetId)
 })
 it.each(['duplicate','unknown-key','new-target','wrong-action','unknown-field'])('rejects malformed %s choices',kind=>{
  let choices=[{key:key(),action:'new'}]
  if(kind==='duplicate')choices.push({...choices[0]});if(kind==='unknown-key')choices[0].key='unknown';if(kind==='new-target')choices[0].targetId='customer';if(kind==='wrong-action')choices[0].action='auto';if(kind==='unknown-field')choices[0].merge=true
  expect(()=>identity({},choices)).toThrow()
 })
 it('requires a financial supplier selection to agree with its master creation',()=>{
  const s=parsed(),p=s.parties.find(r=>r.side==='payable'),master={entity:'suppliers',externalId:p.externalId,targetId:'planned-supplier',action:'create',sourceValues:{name:p.name},values:{name:p.name},issues:[]},r=identity({masterRows:[master],suppliers:[supplier]},[{key:p.key,action:'existing',targetId:supplier.id,expectedName:supplier.name}])
  expect(r.rows.find(r=>r.side==='payable').issues).toContain('master-party-choice-conflict')
 })
})
