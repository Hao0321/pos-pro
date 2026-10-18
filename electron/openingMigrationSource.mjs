import {decimalUnits} from './decimalUnits.mjs'
import {privateDraftDigest,draftObject,assertPrivateDraftContext} from './privateDrafts.mjs'
import {migrationColumnField} from './migrationColumns.mjs'
import {openingTablesFromSource,openingValuationRateUnits,openingDate} from './openingMigrationTables.mjs'
export {openingDate} from './openingMigrationTables.mjs'

export const OPENING_MIGRATION_PROTOCOL='pos-opening-migration/v1'
export const OPENING_MIGRATION_METHOD='applyOpeningMigration'
export const OPENING_MIGRATION_FEATURE='stock-opening-migration-v1'
export const OPENING_MIGRATION_FENCE='stockOpeningMigrationVersionFence'
export const OPENING_MIGRATION_HEAD='stockOpeningMigrationHead'
export const OPENING_MIGRATION_ACTION='AGENT_OPENING_MIGRATION'
export const OPENING_CLEARING_ACCOUNT='3902'
// A connection-private master request retains the bounded original file. It
// never serializes an expanded workbook back through the Agent JSON limit.
export const OPENING_MASTER_PROTOCOL='pos-opening-master-migration/v1'
export const OPENING_MASTER_SOURCE='pos-opening-master-source/v1'
const bad=message=>{throw Error(message||'期初搬家資料需要核對，原資料仍保留。')}
const names={product:['productexternalid','productid','itemcode','productcode','商品編號','原商品編號'],quantity:['quantity','qty','stock','openingstock','庫存','庫存數量','期初庫存'],value:['value','inventoryvalue','stockvalue','庫存價值','庫存總成本','期初庫存金額'],unitCost:['unitcost','valuationrate','單位成本','庫存單價'],unit:['unit','uom','stockuom','單位','基本單位'],currency:['currency','currencycode','幣別','貨幣'],date:['date','cutoffdate','postingdate','切換日','開帳日'],name:['name','itemname','productname','品名','商品名稱']}
const normalize=s=>s.trim().toLowerCase().replace(/[\s_-]/g,'')
function exactText(value,label){if(typeof value!=='string'||!value.trim()||value.length>128||value.includes('\u0000'))bad(label);return value}
const amount=(raw,precision,label)=>decimalUnits(raw,precision,precision===3?1e12:Number.MAX_SAFE_INTEGER,label)
function columns(table){const map={};table.columns.forEach((label,index)=>{const name=normalize(label),field=Object.keys(names).find(key=>names[key].includes(name));if(field){if(Object.hasOwn(map,field))bad('期初欄位用途重複，請核對來源欄位。');map[field]=index}else if(table.rows.some(row=>row.values[index].trim()))bad('期初資料還有未處理的來源欄位，請先核對用途。')});for(const key of ['product','quantity','unit','currency'])if(!Object.hasOwn(map,key))bad('期初資料缺少原商品編號、數量、單位或幣別。');if(!Object.hasOwn(map,'value')&&!Object.hasOwn(map,'unitCost'))bad('期初資料缺少庫存價值，不能用售價代替成本。');return map}
export function projectOpeningMigrationSource(sourceText,cutoffDate,currency=''){
 openingDate(cutoffDate);const projected=openingTablesFromSource(sourceText,currency)
 if(!projected)bad('請先核對期初欄位與原始資料，原檔仍保留。')
 const {source,origins}=projected
 const opening=[],seen=new Set(),products=new Set(),masters=[],rowsByProduct=new Map()
 for(let tableIndex=0;tableIndex<source.tables.length;tableIndex++){
  const table=source.tables[tableIndex]
  if(['products','suppliers','customers'].includes(table.entity)){masters.push(structuredClone(table));continue}
  if(table.entity!=='opening-stock')bad('這份資料還有帳款或歷史，請先另行對帳，整批尚未保存。')
  const map=columns(table)
  table.rows.forEach((row,rowIndex)=>{
   const externalId=exactText(row.externalId,'請填入期初列的原編號。'),productExternalId=exactText(row.values[map.product],'請填入原商品編號。'),unit=exactText(row.values[map.unit],'請填入原庫存的基本單位。'),currency=row.values[map.currency]
   if(seen.has(externalId)||products.has(productExternalId))bad('期初原編號或商品重複，請先核對，不能重複加庫存。');seen.add(externalId);products.add(productExternalId)
   if(currency!=='TWD')bad('期初幣別需要先核對換算，目前庫存成本帳使用新台幣。')
   if(unit.trim()!==unit||unit.normalize('NFC')!==unit||/[\p{Cc}\p{Cf}]/u.test(unit))bad('請核對原庫存的基本單位。')
   if(Object.hasOwn(map,'date')&&row.values[map.date]!==''&&row.values[map.date]!==cutoffDate)bad('來源日期與切換日不同，請先核對。')
   const quantityUnits=amount(row.values[map.quantity],3,'期初數量需要核對，最多三位小數。'),hasValue=Object.hasOwn(map,'value')&&row.values[map.value]!=='',hasRate=Object.hasOwn(map,'unitCost')&&row.values[map.unitCost]!==''
   let valueCents=hasValue?amount(row.values[map.value],2,'期初庫存價值需要核對，最多兩位小數。'):null
   if(hasRate){const denominator=10n**13n,extended=(BigInt(quantityUnits)*openingValuationRateUnits(row.values[map.unitCost])+denominator/2n)/denominator;if(extended>BigInt(Number.MAX_SAFE_INTEGER))bad('期初庫存價值超過可核對範圍。');if(valueCents!==null&&valueCents!==Number(extended))bad('來源單位成本與庫存總價值不同，請先核對。');valueCents=Number(extended)}
   if(valueCents===null)bad('請填入已核對的庫存價值，空白不是零。');if(quantityUnits===0&&valueCents!==0)bad('零庫存仍有價值，請先核對原帳。')
   const fact={table:tableIndex,row:rowIndex,externalId,productExternalId,unit,currency,quantityUnits,valueCents,sourceName:Object.hasOwn(map,'name')?row.values[map.name]:'',...(origins.has(tableIndex+':'+rowIndex)?{origin:origins.get(tableIndex+':'+rowIndex)}:{})};opening.push(fact);rowsByProduct.set(productExternalId,fact)
  })
 }
 if(!opening.length)bad('請提供要搬入的期初庫存資料。')
 // A source quantity is removed from the child MASTER projection only when the
 // explicitly represented opening row proves the same quantity. The parent
 // retains the complete original text and both roles; no zero is substituted.
 for(const table of masters.filter(row=>row.entity==='products')){
  const stock=table.columns.flatMap((label,index)=>migrationColumnField(label,'products')==='stock'?[index]:[])
  if(stock.length>1)bad('商品庫存欄位重複，請核對來源。')
  if(stock.length){for(const row of table.rows){const count=amount(row.values[stock[0]],3,'商品原庫存數量需要核對。'),fact=rowsByProduct.get(row.externalId);if(count!==0&&!fact||fact&&fact.quantityUnits!==count)bad('商品主檔與期初數量不同，請先核對。')}
   const index=stock[0];table.columns=table.columns.filter((_,i)=>i!==index);table.rows=table.rows.map(row=>({...row,values:row.values.filter((_,i)=>i!==index)}))
  }
 }
 const value=opening.reduce((sum,row)=>sum+BigInt(row.valueCents),0n);if(value>BigInt(Number.MAX_SAFE_INTEGER))bad('期初總價值超過可核對範圍。')
 return {source,opening,totalValueCents:Number(value),masterSource:masters.length?{protocol:OPENING_MASTER_SOURCE,id:'opening-masters-'+privateDraftDigest([source.source,source.id]).slice(0,48),source:structuredClone(source.source),tables:masters}:null}
}
export const openingMigrationId=(source,scope)=>'opening-'+privateDraftDigest([scope.storeId,source.source.system,source.source.company,source.id]).slice(0,48)
export function makeOpeningMigrationInput(sourceText,scope,cutoffDate,choices=[],declaredValue='',currency=''){const projected=projectOpeningMigrationSource(sourceText,cutoffDate,currency);return {protocol:OPENING_MIGRATION_PROTOCOL,id:openingMigrationId(projected.source,scope),sourceText,cutoffDate,choices:structuredClone(choices),declaredValue,scope:structuredClone(scope),...(currency?{currency}:{})}}
export function openingMasterRequest(input,masterSource){
 if(!masterSource)bad()
 return {protocol:OPENING_MASTER_PROTOCOL,id:'migration-'+privateDraftDigest([input.scope.storeId,masterSource.source.system,masterSource.source.company,masterSource.id]).slice(0,48),parentId:input.id,sourceText:input.sourceText,cutoffDate:input.cutoffDate,currency:input.currency||'',choices:structuredClone(input.choices),scope:structuredClone(input.scope)}
}
export function readOpeningMigrationInput(input){
 draftObject(input,['protocol','id','sourceText','cutoffDate','choices','declaredValue','scope','review','currency'],['protocol','id','sourceText','cutoffDate','choices','declaredValue','scope']);assertPrivateDraftContext(input.scope)
 if(input.protocol!==OPENING_MIGRATION_PROTOCOL||!Array.isArray(input.choices)||input.choices.length>5000||typeof input.declaredValue!=='string'||input.currency!==undefined&&!['','TWD'].includes(input.currency))bad()
 const projected=projectOpeningMigrationSource(input.sourceText,input.cutoffDate,input.currency||'');if(input.id!==openingMigrationId(projected.source,input.scope))bad()
 if(input.declaredValue!==''&&amount(input.declaredValue,2,'請核對原報表的庫存總額。')!==projected.totalValueCents)bad('原報表總額與逐列庫存價值不同，請先核對。')
 return {input:structuredClone(input),...projected}
}
