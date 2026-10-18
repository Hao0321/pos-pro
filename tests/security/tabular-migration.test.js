import {test,expect} from 'vitest'
import {readDelimitedTable,detectTableDelimiter,suggestTabularPlan,makeTabularDraft,projectTabularDraft} from '../../electron/tabularMigration.mjs'
import {readMigrationDraft} from '../../electron/migrationSource.mjs'
import {makeMasterMigrationInput,previewMasterMigration,readMasterMigrationHistory} from '../../electron/masterMigration.mjs'
import {appendBrowserMasterMigration} from '../../electron/browserMasterMigration.mjs'
import oldLinkBook from '../fixtures/tabular-before-supplier-link.json'
const source={system:' Legacy ',company:'Cafe\u0301 001'},scope={protocol:'pos-private-draft-context/v1',storeId:'table-store',epoch:'epoch',userId:'owner',role:'owner'},actor={userId:'owner',username:'Owner',role:'owner'}
const book=()=>({products:[],members:[],suppliers:[],auditLog:[],settings:[],users:[{id:'owner',username:'Owner',role:'owner'}],stockCostEntries:[],stockCostOperations:[]})
const csv='\uFEFFID,品名,單位,售價,條碼,備註\r\n00001,"Rice, Cafe\u0301",份,0120.00,0047100001,"Line 1\r\nLine ""2"""\r\n'
const draft=(text=csv,plan=null)=>makeTabularDraft(source,{name:'舊系統.csv',text,delimiter:','},plan||suggestTabularPlan(text,','))
const request=document=>makeMasterMigrationInput(JSON.stringify(document),scope)
test('TM1/TM2 real CSV quoting, multiline CRLF, BOM, decomposed Unicode, leading zeros and raw headers survive projection and receipt',()=>{
 const d=draft(),raw=JSON.stringify(d),parsed=readMigrationDraft(raw);expect(parsed.file.text).toBe(csv);expect(parsed.tables[0].rows[0]).toMatchObject({externalId:'00001',values:['00001','Rice, Cafe\u0301','份','0120.00','0047100001','Line 1\r\nLine "2"']})
 const input=request(d),before=book(),review=previewMasterMigration(input,before,scope,actor);expect(review.ready).toBe(true);const result=appendBrowserMasterMigration(before,{...input,review:review.review},scope,actor,'2026-10-18T00:00:00.000Z');expect(result.book.products[0]).toMatchObject({name:'Rice, Cafe\u0301',price:120,barcode:'0047100001',stock:0});expect(JSON.parse(result.receipt.signature).sourceText).toBe(raw);expect(readMasterMigrationHistory(result.book).tabular).toBe(true);expect(result.book.settings).toContainEqual({key:'agentTabularMigrationVersionFence',value:'1'});expect(before.products).toEqual([])
})
test.each([['\t','ID\t姓名\t電話\n0001\tCustomer\t090000001'],[';','ID;姓名;電話\n0001;Customer;090000001']])('TM1 detects %j without changing cell text or inventing IDs',(delimiter,text)=>{expect(detectTableDelimiter(text)).toBe(delimiter);expect(readDelimitedTable(text,delimiter).rows[0]).toEqual(['0001','Customer','090000001'])})
test.each(['ID,name\n1,"unfinished','ID,name\n1,"closed"junk','ID,name\n1,part"quote','ID,name\n1,Name,extra','ID,name\n1','ID,name\n','ID,name\n1,\0name'])('TM2 malformed delimited source is rejected as a whole: %j',text=>{expect(()=>readDelimitedTable(text,',')).toThrow()})
test('TM1 an ambiguous delimiter is not silently guessed',()=>{expect(detectTableDelimiter('ID,name;note\n001,A;B')).toBe('')})
test('TM2 repeated raw headers use positional mappings and explicit repair without changing raw text',()=>{
 const raw='Code,Label,Label,Amount\n0001,Wrong,Preserved,\n',plan={entity:'products',externalId:0,mapping:['','name','','price'],unit:'份',repairs:[{row:0,column:1,value:'Corrected'},{row:0,column:3,value:'120'}]},d=draft(raw,plan),parsed=readMigrationDraft(JSON.stringify(d));expect(parsed.file.text).toBe(raw);expect(parsed.plan.repairs).toEqual(plan.repairs);expect(parsed.tables[0].columns).toEqual(['來源欄 1 · Code','name','來源欄 3 · Label','price','unit']);expect(previewMasterMigration(request(d),book(),scope,actor).ready).toBe(true)
})
test.each(['stock','balance','points','totalSpent','currency'])('TM3 known %s cannot be hidden, renamed or edited into an acceptable balance',field=>{
 const raw='ID,name,unit,price,'+field+'\n0001,Rice,piece,120,'+(field==='currency'?'USD':'5')+'\n',p=suggestTabularPlan(raw,','),d=draft(raw,p);expect(previewMasterMigration(request(d),book(),scope,actor).ready).toBe(false)
 for(const replacement of ['', 'category']){const changed=structuredClone(p);changed.mapping[4]=replacement;expect(()=>readMigrationDraft(JSON.stringify(draft(raw,changed)))).toThrow('必須保留')}
 const changed=structuredClone(p);changed.repairs=[{row:0,column:4,value:field==='currency'?'TWD':'0'}];expect(()=>readMigrationDraft(JSON.stringify(draft(raw,changed)))).toThrow('不能在主檔修成零')
})
test('TM1 empty source facts or source IDs and duplicate IDs cannot turn into default identities',()=>{
 const d=draft();for(const key of ['company','system']){const next={...source,[key]:''};expect(()=>readMigrationDraft(JSON.stringify(makeTabularDraft(next,d.file,d.plan)))).toThrow('請填入')}
 let text='ID,name,unit,price\n,Rice,piece,120\n',view=previewMasterMigration(request(draft(text)),book(),scope,actor);expect(view.rows[0].issues).toContain('missing-source-id');text+='0001,Rice 2,piece,130\n0001,Rice 3,piece,140\n';view=previewMasterMigration(request(draft(text)),book(),scope,actor);expect(view.rows[2].issues).toContain('duplicate-source-id');expect(view.ready).toBe(false)
})
test('TM2 missing price and unit stay missing; explicit source repair and shared unit can complete facts',()=>{
 const raw='ID,name,price\n0001,Rice,\n',plan=suggestTabularPlan(raw,','),d=draft(raw,plan),view=previewMasterMigration(request(d),book(),scope,actor);expect(view.ready).toBe(false);expect(view.rows[0].issues).toEqual(expect.arrayContaining(['missing-unit','invalid-price']))
 plan.unit='份';plan.repairs=[{row:0,column:2,value:'0'}];expect(previewMasterMigration(request(draft(raw,plan)),book(),scope,actor).ready).toBe(true)
})
test('TM2 batch identity binds raw source, source company, mapping and explicit corrections',()=>{
 const d=draft();expect(draft().id).toBe(d.id);for(const change of [x=>x.file.text+='\n',x=>x.source.company='Other',x=>x.plan.repairs=[{row:0,column:3,value:'130'}],x=>x.file.name='Other.csv']){const next=structuredClone(d);change(next);expect(()=>readMigrationDraft(JSON.stringify(next))).toThrow('已變更');expect(makeTabularDraft(next.source,next.file,next.plan).id).not.toBe(d.id)}
})
test('TM3 cells containing formulas, URLs and prototype words remain inert source data',()=>{
 const text='ID,name,unit,price,Extra\n0001,=HYPERLINK(""),piece,120,__proto__\n';expect(()=>readDelimitedTable(text,',')).toThrow();const raw='ID,name,unit,price,Extra\n0001,=1+1,piece,120,https://example.invalid/exfil\n',parsed=projectTabularDraft(draft(raw));expect(parsed.tables[0].rows[0].values[1]).toBe('=1+1');expect(parsed.file.text).toBe(raw)
 const authority={...draft(),confirmed:true};expect(()=>readMigrationDraft(JSON.stringify(authority))).toThrow()
})
test('TM4 deleting the tabular fence invalidates already durable tabular receipts',()=>{
 const input=request(draft()),before=book(),review=previewMasterMigration(input,before,scope,actor),result=appendBrowserMasterMigration(before,{...input,review:review.review},scope,actor,'2026-10-18T00:00:00.000Z');result.book.settings=result.book.settings.filter(row=>row.key!=='agentTabularMigrationVersionFence');expect(()=>readMasterMigrationHistory(result.book)).toThrow()
})

test('TM1 selling price is never inferred from origin-agnostic Standard Price; an owner can explicitly map a known fact',()=>{
 const raw='ID,name,unit,Standard Price\n0001,Product,piece,25.00\n',p=suggestTabularPlan(raw,','),d=draft(raw,p),view=previewMasterMigration(request(d),book(),scope,actor);expect(p.mapping[3]).toBe('');expect(view.ready).toBe(false);expect(view.rows[0].issues).toContain('missing-price');p.mapping[3]='price';expect(previewMasterMigration(request(draft(raw,p)),book(),scope,actor).ready).toBe(true)
 const legacy={protocol:'pos-migration-draft/v1',id:'ambiguous',source,tables:[{entity:'products',columns:['name','unit','Standard Price'],rows:[{externalId:'0001',values:['Product','piece','25.00']}]}]};expect(previewMasterMigration(request(legacy),book(),scope,actor).ready).toBe(false)
})
test.each(['庫存量','庫存數量','應收帳款','應付帳款','預收款','預付款','會員儲值','點數餘額','消費總額'])('TM3 common source balance header %s cannot silently become an unused field',header=>{
 const raw='ID,name,unit,price,'+header+'\n0001,Product,piece,120,5\n',p=suggestTabularPlan(raw,','),view=previewMasterMigration(request(draft(raw,p)),book(),scope,actor);expect(p.mapping[4]).not.toBe('');expect(view.rows[0].issues).toContain('needs-ledger-mapping');expect(view.ready).toBe(false);p.mapping[4]='';expect(()=>readMigrationDraft(JSON.stringify(draft(raw,p)))).toThrow('必須保留')
})
test.each([
 ['products','Supplier Code,Product Code,Name,Price,Unit\nS1,P1,Product,120,piece\n',1],
 ['products','Customer Code,Name,Price,Unit\nC1,Product,120,piece\n',-1],
 ['suppliers','Product Code,Supplier Code,Name\nP1,S1,Vendor\n',1],
 ['customers','Supplier Code,Customer Code,Name\nS1,C1,Customer\n',1],
 ['products','商品編號,品名,單位,售價\n001,Product,piece,120\n',0],
 ['suppliers','供應商編號,供應商名稱\n001,Vendor\n',0],
 ['customers','會員編號,姓名\n001,Customer\n',0],
 ['products','ID,name,unit,price\n001,Product,piece,120\n',0],
 ['suppliers','ID,name\n001,Vendor\n',0],
 ['customers','ID,name\n001,Customer\n',0]
])('TM1 source-ID suggestions follow the %s entity and never use a foreign party ID',(entity,text,id)=>{const plan=suggestTabularPlan(text,',',entity);expect(plan.externalId).toBe(id);if(entity==='products'&&text.startsWith('Supplier Code'))expect(plan.mapping[0]).toBe('supplier')})
test('TM2 every supported canonical master field reaches the actual planner, including supplier references and payment terms',()=>{
 const mapped=(name,entity,externalId,fields,values)=>makeTabularDraft(source,{name,text:['Raw ID,'+fields.map((_,i)=>'Raw '+i).join(','),[externalId,...values].join(',')].join('\n')+'\n',delimiter:','},{entity,externalId:0,mapping:['',...fields],unit:'',repairs:[]})
 const apply=(document,state)=>{const input=request(document),view=previewMasterMigration(input,state,scope,actor);expect(view.ready).toBe(true);return appendBrowserMasterMigration(state,{...input,review:view.review},scope,actor,'2026-10-18T00:00:00.000Z').book}
 let state=apply(mapped('vendor.csv','suppliers','S0001',['name','phone','contact','payTerms','note'],['Mapped vendor','090000001','Contact','30 days','Vendor note']),book());expect(state.suppliers[0]).toMatchObject({name:'Mapped vendor',phone:'090000001',contact:'Contact',payTerms:'30 days',note:'Vendor note'});const supplierId=state.suppliers[0].id
 state=apply(mapped('products.csv','products','P0001',['name','barcode','unit','price','cost','category','supplier'],['Mapped product','004710005','piece','120.00','25.50','Bowls','S0001']),state);expect(state.products[0]).toMatchObject({name:'Mapped product',barcode:'004710005',unit:'piece',price:120,cost:25.5,category:'Bowls',supplierId})
 state=apply(mapped('customers.csv','customers','C0001',['name','phone','birthday','note'],['Mapped customer','090000002','2026-10-01','Customer note']),state);expect(state.members[0]).toMatchObject({name:'Mapped customer',phone:'090000002',birthday:'2026-10-01',note:'Customer note'});expect(readMasterMigrationHistory(state).receipts).toHaveLength(3)
})
test('TM2 a genuine earlier ignored supplier field is recovered after decoder repair even with the same raw row digest',()=>{
 const legacy=structuredClone(oldLinkBook),{book:before,scope:oldScope,actor:oldActor,again,supplierId}=legacy;expect(before.products[0].supplierId).toBe('');const input=makeMasterMigrationInput(JSON.stringify(again),oldScope),view=previewMasterMigration(input,before,oldScope,oldActor)
 expect(view.rows[0].sourceDigest).toBe(view.rows[0].prior.sourceDigest);expect(view.rows[0].prior.sourceValues.supplierId).toBeUndefined();expect(view.rows[0].sourceValues.supplierId).toBe(supplierId);expect(view.rows[0].action).toBe('update');expect(view.ready).toBe(true)
 const result=appendBrowserMasterMigration(before,{...input,review:view.review},oldScope,oldActor,'2026-10-18T00:01:00.000Z');expect(result.book.products).toHaveLength(1);expect(result.book.products[0].supplierId).toBe(supplierId);expect(result.book.suppliers).toHaveLength(1);expect(readMasterMigrationHistory(result.book).receipts).toHaveLength(3)
})
test('TM2 newly understood source fields still require a choice when local data changed',()=>{
 const legacy=structuredClone(oldLinkBook),localId='local-vendor';legacy.book.suppliers.push({id:localId,name:'Local vendor'});legacy.book.products[0].supplierId=localId;const input=makeMasterMigrationInput(JSON.stringify(legacy.again),legacy.scope),view=previewMasterMigration(input,legacy.book,legacy.scope,legacy.actor);expect(view.ready).toBe(false);expect(view.rows[0].issues).toContain('local-change');expect(legacy.book.products[0].supplierId).toBe(localId)
})
test('TM2 canonical field decoding does not reinterpret an ambiguous raw Supplier heading in an Agent v1 draft',()=>{const d={protocol:'pos-migration-draft/v1',id:'legacy-supplier-label',source,tables:[{entity:'products',columns:['name','unit','price','Supplier'],rows:[{externalId:'0001',values:['Product','piece','120','A human supplier label']}]}]},view=previewMasterMigration(request(d),book(),scope,actor);expect(view.ready).toBe(true);expect(view.rows[0].unused).toContain('Supplier');expect(view.rows[0].values.supplierId).toBeUndefined()})
test.each([['products','Supplier Name,Product Name,Product Code,Unit,Price\nVendor,Product,P1,piece,120\n',1],['products','Supplier Name,Product Code,Unit,Price\nVendor,P1,piece,120\n',-1],['suppliers','Customer Name,Supplier Name,Supplier Code\nCustomer,Vendor,S1\n',1],['customers','Supplier Name,Customer Name,Customer Code\nVendor,Customer,C1\n',1]])('TM1 the %s name suggestion never selects another kind of party',(entity,text,nameIndex)=>{const plan=suggestTabularPlan(text,',',entity);expect(plan.mapping.indexOf('name')).toBe(nameIndex)})
test('TM1 an Agent product table selects its product name while preserving the supplier-name fact separately',()=>{const d={protocol:'pos-migration-draft/v1',id:'entity-name-context',source,tables:[{entity:'products',columns:['Supplier Name','Product Name','Unit','Price'],rows:[{externalId:'P1',values:['Vendor name','Actual product','piece','120']}]}]},view=previewMasterMigration(request(d),book(),scope,actor);expect(view.ready).toBe(true);expect(view.rows[0].values.name).toBe('Actual product');expect(view.rows[0].unused).toContain('Supplier Name')})
