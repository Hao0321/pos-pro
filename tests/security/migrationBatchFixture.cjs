const workbook=require('./financialMigrationFixture.cjs'),{readDelimitedTable}=require('../../electron/tabularMigration.mjs'),{financialFileSuggestedPlan,financialWorkbookSheets}=require('../../electron/financialFileDraft.mjs');
const source={system:'Original batch ERP',company:'Original batch shop'};
let stockBinary,mixedBinary;
function csv(name,headers,rows,entity,delimiter=','){
 const text=[headers,...rows].map(row=>row.map(value=>String(value).includes(delimiter)||/["\r\n]/.test(value)?'"'+String(value).replaceAll('"','""')+'"':value).join(delimiter)).join('\r\n')+'\r\n',file={name,text,delimiter},table=readDelimitedTable(text,delimiter),plan=financialFileSuggestedPlan(table,entity);return {kind:'csv',file,sheets:[{sheetId:'csv',headerRow:0,plan}]}
}
const supplier=()=>csv('original-suppliers.tsv',['Supplier Code','name','phone'],[['000S','Original batch supplier','0909990001']],'suppliers','\t'),customer=()=>csv('original-customers.csv',['Customer Code','name','phone'],[['000C','Original batch customer','0909990002']],'customers');
function masters(){return [csv('original-products.csv',['Product Code','name','unit','price','cost'],[['000P','Original batch product','piece','0150.00','0025.50']],'products'),supplier(),customer()]}
function stock(){const binary=structuredClone(stockBinary??=workbook({sheets:[workbook.standard[0]]}));return [{kind:'xlsx',file:{...binary,name:'original-stock.xlsx'},sheets:financialWorkbookSheets(binary)},supplier()]}
function mixed(){const binary=structuredClone(mixedBinary??=workbook());return [{kind:'xlsx',file:binary,sheets:financialWorkbookSheets(binary)},supplier(),customer()]}
module.exports={source,csv,masters,stock,mixed};
