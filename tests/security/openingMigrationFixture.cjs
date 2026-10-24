const fs=require('node:fs'),{zipSync,unzipSync,strToU8}=require('fflate'),{makeWorkbookDraft,workbookSheetPlan}=require('../../electron/workbookMigration.mjs')
// Synthetic file data only; formula cells deliberately retain an unsafe cache
// so the UI and production reader must request the independently known fact.
module.exports=function openingWorkbook(rows,{currency='TWD',repairs=[],reportDate=null,source={system:'Original ERP',company:'Original shop'}}={}){
 const files=unzipSync(fs.readFileSync('tests/fixtures/workbook-sources-v1.xlsx')),headers=['Product Code','name','unit','price','stock','InventoryValue','ValuationRate',...(reportDate!==null?['asOfDate']:[])],cell=(r,c,text)=>'<c r="'+String.fromCharCode(65+c)+r+'" t="inlineStr"><is><t>'+text+'</t></is></c>',xmlRows=[{number:3,values:headers},...rows.map((values,i)=>({number:i+6,values:[...values,...(reportDate!==null?[reportDate]:[])]}))]
 files['xl/worksheets/sheet1.xml']=strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+xmlRows.map(r=>'<row r="'+r.number+'">'+r.values.map((value,c)=>value==='FORMULA'?'<c r="'+String.fromCharCode(65+c)+r.number+'"><f>1+1</f><v>2</v></c>':cell(r.number,c,value)).join('')+'</row>').join('')+'</sheetData></worksheet>')
 const file={name:'original.xlsx',base64:Buffer.from(zipSync(files)).toString('base64')},sheet=workbookSheetPlan({file},'1',3);sheet.plan.repairs=repairs
 return makeWorkbookDraft(source,file,currency,[sheet])
}
