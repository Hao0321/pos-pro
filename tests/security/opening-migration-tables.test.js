import {test,expect} from 'vitest'
import openingWorkbook from './openingMigrationFixture.cjs'
import {makeTabularDraft,suggestTabularPlan,readDelimitedTable} from '../../electron/tabularMigration.mjs'
import {projectOpeningMigrationSource,makeOpeningMigrationInput,openingMasterRequest} from '../../electron/openingMigrationSource.mjs'
import {openingSourceCanRoute,openingSourceNeedsCurrency,openingSourceDate,openingSourceFacts,replaceOpeningSourceFact} from '../../electron/openingMigrationTables.mjs'
import {readMasterMigrationInput,makeMasterMigrationInput,previewMasterMigration,assertPublicMasterMigration} from '../../electron/masterMigration.mjs'
import {readMigrationDraft} from '../../electron/migrationSource.mjs'

const source={system:'Original ERP',company:'Original shop'},date='2026-10-18',scope={protocol:'pos-private-draft-context/v1',storeId:'opening-table-shop',epoch:'epoch',userId:'owner',role:'owner'},actor={userId:'owner',username:'Owner',role:'owner'},book=()=>({products:[],members:[],suppliers:[],auditLog:[],settings:[],stockCostEntries:[],stockCostOperations:[],users:[{id:'owner',username:'Owner',role:'owner'}]})
const csv=(text,edit=()=>{})=>{const p=suggestTabularPlan(text,',');if(!p.mapping.includes('unit'))p.unit='piece';edit(p);return JSON.stringify(makeTabularDraft(source,{name:'original.csv',text,delimiter:','},p))}
const basic='ID,name,unit,price,stock,InventoryValue,ValuationRate\r\n00001,Rice,piece,120,12.5,250.01,20\r\n'
const workbook=(rows,options)=>JSON.stringify(openingWorkbook(rows,options))

test('OM1 CSV keeps exact raw text and physical positions across blank and multiline rows',()=>{
 const raw='\uFEFFID,name,unit,price,stock,InventoryValue\r\n\r\n00001,"Rice\r\nBowl",piece,120,12.5,250.01\r\n\r\n00002,Other,piece,10,0,0\r\n',text=csv(raw),p=projectOpeningMigrationSource(text,date,'TWD')
 expect(JSON.parse(text).file.text).toBe(raw);expect(readDelimitedTable(raw,',')).not.toHaveProperty('physicalRows');expect(readDelimitedTable(raw,',',{physicalRows:true}).physicalRows).toEqual([3,6]);expect(p.opening.map(r=>r.origin.physicalRow)).toEqual([3,6]);expect(p.opening[0]).toMatchObject({productExternalId:'00001',quantityUnits:12500,valueCents:25001,origin:{kind:'csv',headerRow:1,basis:'source-total'}});expect(p.masterSource.tables[0].rows[0].values).toContain('Rice\r\nBowl')
})
test('OM1 owner confirms a missing currency once without overriding a known foreign currency',()=>{
 expect(openingSourceCanRoute(csv(basic))).toBe(true);expect(openingSourceNeedsCurrency(csv(basic))).toBe(true);expect(()=>projectOpeningMigrationSource(csv(basic),date)).toThrow('幣別');expect(projectOpeningMigrationSource(csv(basic),date,'TWD').totalValueCents).toBe(25001)
 const foreign=csv(basic.replace('ValuationRate','ValuationRate,currency').replace('250.01,20','250.01,20,USD'));expect(()=>projectOpeningMigrationSource(foreign,date,'TWD')).toThrow('幣別');expect(openingSourceCanRoute(JSON.stringify({protocol:'pos-migration-draft/v1',id:'raw',source,tables:[{entity:'products',columns:['name','stock','InventoryValue'],rows:[{externalId:'1',values:['A','1','2']}]}]}))).toBe(false)
})
test('OM1 source total wins over rounded display rate; actual high precision rate rounds only once',()=>{
 expect(projectOpeningMigrationSource(csv(basic),date,'TWD').opening[0].valueCents).toBe(25001)
 const text=csv(basic.replace('12.5,250.01,20','1.001,,0.004999999999'));expect(projectOpeningMigrationSource(text,date,'TWD').opening[0].valueCents).toBe(1)
 const exact=csv(basic.replace('12.5,250.01,20','12.5,,20.010000000001'));expect(projectOpeningMigrationSource(exact,date,'TWD').opening[0].valueCents).toBe(25013)
 expect(()=>projectOpeningMigrationSource(csv(basic.replace('12.5,250.01,20','12.5,,20.0000000000001')),date,'TWD')).toThrow('十二位')
})
test('OM1 missing selling price means existing product mapping, never an invented zero-priced master',()=>{
 const text=csv('ID,name,unit,stock,InventoryValue\n00001,Rice,piece,12.5,250.01\n'),p=projectOpeningMigrationSource(text,date,'TWD');expect(p.masterSource).toBeNull();expect(p.opening[0].quantityUnits).toBe(12500)
})
test.each(['warehouse','batchNo','location','expiryDate','balance','points','totalSpent'])('OM1 unsupported %s facts cannot disappear when the stock report has no selling price',header=>{
 const text=csv('ID,name,unit,stock,InventoryValue,'+header+'\n00001,Rice,piece,12.5,250.01,5\n');expect(()=>projectOpeningMigrationSource(text,date,'TWD')).toThrow()
})
test('OM1 raw XLSX bytes, source sheet and physical row survive opening projection',()=>{
 const text=workbook([['00001','Rice','piece','120','12.5','250.01','20']]),p=projectOpeningMigrationSource(text,date);expect(openingSourceNeedsCurrency(text)).toBe(false);expect(p.opening[0]).toMatchObject({quantityUnits:12500,valueCents:25001,origin:{kind:'xlsx',sheetId:'1',headerRow:3,physicalRow:6,basis:'source-total'}});expect(p.masterSource.tables[0].columns).not.toContain('stock');expect(JSON.parse(text).file.base64.length).toBeGreaterThan(100)
})
test('OM1 formulas need an independently supplied fact; cached numeric results are never trusted',()=>{
 const text=workbook([['00001','Rice','piece','120','12.5','FORMULA','']]);expect(()=>projectOpeningMigrationSource(text,date)).toThrow('已核對');const facts=openingSourceFacts(text),fact=facts.find(r=>r.column===5);expect(fact.canEdit).toBe(true);expect(fact.physicalRow).toBe(6);const corrected=replaceOpeningSourceFact(text,fact,'250.01');expect(JSON.parse(corrected).file).toEqual(JSON.parse(text).file);expect(projectOpeningMigrationSource(corrected,date).totalValueCents).toBe(25001)
})
test('OM1 a known zero or positive source amount cannot be repaired into a different number',()=>{
 for(const [original,replacement,column]of [['250.01','0',5],['0','1',5],['12.5','0',4],['20','0',6]]){const raw=basic.replace('12.5,250.01,20',column===5?'12.5,'+original+',20':column===4?original+',250.01,20':'12.5,250.01,'+original),text=csv(raw,p=>p.repairs=[{row:0,column,value:replacement}]);expect(()=>projectOpeningMigrationSource(text,date,'TWD')).toThrow('不能改成')}
})
test.each([['stock','1.0001'],['stock','1e3'],['stock','-1'],['InventoryValue','20.001'],['InventoryValue','999999999999999999']])('OM1 known unsupported %s %s cannot be hidden as a replacement zero',(field,original)=>{
 const column=field==='stock'?4:5,raw='ID,name,unit,price,stock,InventoryValue\nP1,Product,piece,120,'+(field==='stock'?original+',0':'0,'+original)+'\n',text=csv(raw,p=>p.repairs=[{row:0,column,value:'0'}]);expect(()=>projectOpeningMigrationSource(text,date,'TWD')).toThrow('不能改成');const unrepaired=csv(raw),fact=openingSourceFacts(unrepaired).find(r=>r.column===column);expect(fact).toMatchObject({canEdit:false,blocked:true,blockedReason:'range',original});expect(()=>replaceOpeningSourceFact(unrepaired,fact,'0')).toThrow('不能改成')
})
test('OM1 only an explicit unique report date can fill the cut-off; mismatches remain blocked',()=>{
 const raw=basic.replace('ValuationRate','ValuationRate,asOfDate').replace('250.01,20','250.01,20,'+date),text=csv(raw);expect(openingSourceDate(text)).toBe(date);expect(openingSourceDate(csv(basic))).toBe('');expect(()=>projectOpeningMigrationSource(text,'2026-10-17','TWD')).toThrow('日期')
})
test('OM1 an owner can supply a verified unknown report date while the original stays exact',()=>{
 const raw=basic.replace('ValuationRate','ValuationRate,asOfDate').replace('250.01,20','250.01,20,18/10/2026'),text=csv(raw),fact=openingSourceFacts(text).find(r=>r.kind==='date');expect(fact.canEdit).toBe(true);const repaired=replaceOpeningSourceFact(text,fact,date);expect(openingSourceDate(repaired)).toBe(date);expect(projectOpeningMigrationSource(repaired,date,'TWD').totalValueCents).toBe(25001);expect(JSON.parse(repaired).file.text).toBe(raw)
 const known=csv(raw.replace('18/10/2026',date),p=>p.repairs=[{row:0,column:7,value:'2026-10-17'}]);expect(()=>projectOpeningMigrationSource(known,'2026-10-17','TWD')).toThrow('不能改成');expect(projectOpeningMigrationSource(csv(raw.replace('18/10/2026','')),date,'TWD').totalValueCents).toBe(25001)
})
test('OM2 five thousand source rows are not rejected by a second expanded Agent JSON limit',()=>{
 const raw='ID,name,price,stock,InventoryValue\n'+Array.from({length:5000},(_,i)=>String(i).padStart(5,'0')+',A,1,1,1').join('\n'),text=csv(raw),input=makeOpeningMigrationInput(text,scope,date,[],'5000','TWD'),p=projectOpeningMigrationSource(text,date,'TWD'),child=openingMasterRequest(input,p.masterSource)
 expect(new TextEncoder().encode(raw).length).toBeLessThan(80000);expect(new TextEncoder().encode(JSON.stringify(p.masterSource)).length).toBeGreaterThan(250000);expect(p.opening).toHaveLength(5000);expect(readMasterMigrationInput(child).source.tables[0].rows).toHaveLength(5000);expect(child.sourceText).toBe(text);expect(()=>readMigrationDraft(JSON.stringify(p.masterSource))).toThrow();expect(()=>assertPublicMasterMigration(child)).toThrow('一起保存')
})
test('OM2 fresh master imports cannot hide known inventory value as price or repair it to zero',()=>{
 const raw='ID,name,unit,price,InventoryValue\n00001,Rice,piece,120,250.01\n';for(const mapping of ['', 'cost']){const text=csv(raw,p=>p.mapping[4]=mapping),input=makeMasterMigrationInput(text,scope);expect(()=>previewMasterMigration(input,book(),scope,actor)).toThrow(/期初庫存流程|欄位用途/)}
 const text=csv(raw,p=>p.repairs=[{row:0,column:4,value:'0'}]);expect(()=>previewMasterMigration(makeMasterMigrationInput(text,scope),book(),scope,actor)).toThrow('期初庫存流程')
})
