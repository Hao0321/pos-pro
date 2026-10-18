import {test,expect} from 'vitest'
import {makeMasterMigrationInput,previewMasterMigration,verifyMasterMigration,readMasterMigrationHistory,assertMasterMigrationResult} from '../../electron/masterMigration.mjs'
import {appendBrowserMasterMigration} from '../../electron/browserMasterMigration.mjs'
const actor={userId:'owner',username:'Owner',role:'owner'},scope={protocol:'pos-private-draft-context/v1',storeId:'store',epoch:'epoch',userId:'owner',role:'owner'}
const book=()=>({products:[],members:[],suppliers:[],auditLog:[],settings:[],users:[{id:'owner',username:'Owner',role:'owner'}],stockCostEntries:[],stockCostOperations:[]})
const document=()=>({protocol:'pos-migration-draft/v1',id:'source-0001',source:{system:' Legacy ERP ',company:'Cafe\u0301 001'},tables:[{entity:'products',columns:['Name','barcode','unit','price','cost','supplier_id'],rows:[{externalId:'00001',values:['Rice','0047100001','kg','0100.00','025.50','S0001']}]},{entity:'suppliers',columns:['Name','phone'],rows:[{externalId:'S0001',values:['Supplier','0900000001']}]},{entity:'customers',columns:['Name','phone','newsletter'],rows:[{externalId:'C0001',values:['Alex','0900000002','false']}]}]})
const input=(doc=document(),choices=[])=>makeMasterMigrationInput(JSON.stringify(doc),scope,choices)
function reviewed(request,state){return {...request,review:previewMasterMigration(request,state,scope,actor).review}}
function commit(request,state){const full=reviewed(request,state);return {input:full,...appendBrowserMasterMigration(state,full,scope,actor,new Date().toISOString())}}
test('MM1/MM3 source identity, exact original text, cross-table supplier references and cents survive a single planned import',()=>{
 const before=book(),request=input(),preview=previewMasterMigration(request,before,scope,actor)
 expect(preview.ready).toBe(true);expect(preview.counts).toMatchObject({create:3,blocked:0});expect(preview.rows[2].unused).toEqual(['newsletter'])
 const result=commit(request,before);expect(before.products).toEqual([]);expect(result.book.products[0]).toMatchObject({price:100,cost:25.5,stock:0,barcode:'0047100001',supplierId:result.book.suppliers[0].id});expect(result.book.members[0]).toMatchObject({points:0,balance:0});expect(readMasterMigrationHistory(result.book).receipts[0].signature).toContain('sourceText');expect(assertMasterMigrationResult(result.input,{success:true,receipt:result.receipt}).success).toBe(true)
 expect(previewMasterMigration(result.input,result.book,scope,actor).saved).toEqual(result.receipt)
})
test('MM1 same original IDs in a new batch are unchanged; local edits survive identical source and different companies stay distinct',()=>{
 const initial=commit(input(),book()),doc=document();initial.book.products[0].name='Local rice';doc.id='next-batch'
 const second=commit(input(doc),initial.book);expect(second.receipt.counts.unchanged).toBe(3);expect(second.book.products[0].name).toBe('Local rice');expect(second.book.products).toHaveLength(1)
 doc.id='third-batch';doc.tables[0].rows[0].values[3]='120.00';const third=commit(input(doc),second.book);expect(third.book.products[0]).toMatchObject({name:'Local rice',price:120})
 doc.source.company='Other company';expect(previewMasterMigration(input(doc),second.book,scope,actor).rows.every(row=>row.action==='blocked'||row.action==='create')).toBe(true)
})
test('MM3 local/source conflicts require explicit keep or source, and a changed batch cannot reuse the old ID',()=>{
 const first=commit(input(),book()),doc=document();doc.tables[0].rows[0].values[3]='120.00'
 expect(()=>previewMasterMigration(input(doc),first.book,scope,actor)).toThrow('內容不同')
 doc.id='batch-two';first.book.products[0].price=110
 expect(previewMasterMigration(input(doc),first.book,scope,actor).rows[0].issues).toContain('local-change')
 const choice={table:0,row:0,targetId:first.book.products[0].id,resolution:'keep'},kept=commit(input(doc,[choice]),first.book)
 expect(kept.book.products[0].price).toBe(110);expect(kept.receipt.rows[0].action).toBe('keep')
 choice.resolution='source';const taken=commit(input(doc,[choice]),first.book);expect(taken.book.products[0].price).toBe(120)
})
test('MM1 same name or phone never silently merges people and a product barcode cannot create another SKU',()=>{
 const state=book();state.products=[{id:'local',name:'Different rice',barcode:'0047100001',unit:'kg',price:90}];state.members=[{id:'local-person',name:'Alex',phone:'0900000002'}]
 let view=previewMasterMigration(input(),state,scope,actor);expect(view.ready).toBe(false);expect(view.rows[0].issues).toContain('duplicate-barcode');expect(view.rows[2].issues).toContain('choose-target')
 const choice=[{table:0,row:0,targetId:'local',resolution:'source'},{table:2,row:0,targetId:''}];const result=commit(input(document(),choice),state);expect(result.book.products).toHaveLength(1);expect(result.book.products[0].price).toBe(100);expect(result.book.members).toHaveLength(2)
})
test('MM2 opening stock, stored value, missing supplier IDs, malformed dates and unknown entities prevent the entire batch',()=>{
 for(const change of [d=>{d.tables[0].columns.push('stock');d.tables[0].rows[0].values.push('1')},d=>{d.tables[2].columns.push('balance');d.tables[2].rows[0].values.push('100')},d=>d.tables[0].rows[0].values[5]='MISSING',d=>{d.tables[2].columns.push('birthday');d.tables[2].rows[0].values.push('2026-02-31')},d=>d.tables[0].rows.push(structuredClone(d.tables[0].rows[0])),d=>{d.tables[0].rows.push(structuredClone(d.tables[0].rows[0]));d.tables[0].rows[1].externalId='other'}]){
  const doc=document();change(doc);const state=book(),request=input(doc),view=previewMasterMigration(request,state,scope,actor);expect(view.ready).toBe(false);expect(()=>appendBrowserMasterMigration(state,{...request,review:view.review},scope,actor,new Date().toISOString())).toThrow();expect(state.products).toEqual([])
 }
})
test('MM3 review binds owner, exact scope, raw source, choices and current data; fabricated replies fail',()=>{
 const state=book(),request=reviewed(input(),state);expect(verifyMasterMigration(request,state,scope,actor).receipt).toBe(null)
 for(const changed of [s=>s.members.push({id:'new',name:'Later customer'}),s=>s.products.push({id:'new',name:'Other'})]){const next=structuredClone(state);changed(next);expect(()=>verifyMasterMigration(request,next,scope,actor)).toThrow('重新看')}
 expect(()=>verifyMasterMigration(request,state,{...scope,epoch:'new'},actor)).toThrow('店面');expect(()=>verifyMasterMigration(request,state,scope,{...actor,userId:'fake'})).toThrow('店主');expect(()=>assertMasterMigrationResult(request,{success:true,receipt:{id:request.id}})).toThrow('尚未確認')
})
test('MM4 removing or modifying migration history, its head or count cannot pass complete-book validation',()=>{
 const result=commit(input(),book());for(const change of [s=>s.auditLog=[],s=>s.settings=s.settings.filter(row=>row.key!=='agentMasterMigrationHead'),s=>s.auditLog[0].detail=s.auditLog[0].detail.replace('Rice','Wrong')]){const broken=structuredClone(result.book);change(broken);expect(()=>readMasterMigrationHistory(broken)).toThrow()}
})
test('MM3 omitted source columns retain their baseline, preserve local-only changes and flag a later real conflict',()=>{
 const customer=(id,columns,values)=>({protocol:'pos-migration-draft/v1',id,source:{system:'Legacy',company:'Company'},tables:[{entity:'customers',columns,rows:[{externalId:'00001',values}]}]})
 let state=commit(input(customer('first',['Name','note'],['Customer','Source A'])),book()).book
 state=commit(input(customer('second',['Name'],['Customer'])),state).book;state.members[0].note='Local B'
 const unrelated=customer('third',['Name','note','phone'],['Customer','Source A','0900000001']),view=previewMasterMigration(input(unrelated),state,scope,actor);expect(view.ready).toBe(true)
 state=commit(input(unrelated),state).book;expect(state.members[0]).toMatchObject({note:'Local B',phone:'0900000001'})
 const incoming=customer('fourth',['Name','note'],['Customer','Source C']);expect(previewMasterMigration(input(incoming),state,scope,actor).rows[0].issues).toContain('local-change')
 expect(readMasterMigrationHistory(state).mappings.values().next().value.sourceValues.note).toBe('Source A')
})
test('MM3 an explicit Keep stores both the actual local values and the latest source baseline for future imports',()=>{
 const customer=(id,note)=>({protocol:'pos-migration-draft/v1',id,source:{system:'Legacy',company:'Company'},tables:[{entity:'customers',columns:['Name','note'],rows:[{externalId:'00001',values:['Customer',note]}]}]})
 let state=commit(input(customer('keep-first','Source A')),book()).book;state.members[0].note='Local B'
 const choice={table:0,row:0,targetId:state.members[0].id,resolution:'keep'};state=commit(input(customer('keep-second','Source C'),[choice]),state).book
 const mapping=readMasterMigrationHistory(state).mappings.values().next().value;expect(mapping.applied.note).toBe('Local B');expect(mapping.sourceValues.note).toBe('Source C')
 expect(previewMasterMigration(input(customer('keep-third','Source D')),state,scope,actor).rows[0].issues).toContain('local-change')
 const repeat=commit(input(customer('keep-repeat','Source C')),state);expect(repeat.book.members[0].note).toBe('Local B');expect(repeat.receipt.counts.unchanged).toBe(1)
})
