const {zipSync,strToU8}=require('fflate')
// Original file bytes, built independently of the production mapper. Sparse,
// hidden and formula cells remain present so custody can be checked after use.
const standard=[
 {name:'Products',headers:['Product Code','name','unit','price','stock','InventoryValue'],rows:[['P0001','Original rice','piece','150','12.5','250.01']]},
 {name:'Original receivables',headers:['原單編號','客戶原編號','客戶名稱','原單號','單據種類','原單日期','到期日','未結清金額','幣別','原單總額','以前已付金額'],rows:[['00001','C001','Original customer','AR-001','invoice','2026-10-01','2026-10-31','600.00','TWD','1000.00','400.00'],['00002','C001','Original customer','CR-001','credit','2026-10-02','','-100.00','TWD','100.00','0.00']]},
 {name:'Original payables',hidden:true,headers:['原單編號','供應商原編號','供應商名稱','原單號','單據種類','原單日期','到期日','未結清金額','幣別','原單總額','以前已付金額'],rows:[['00003','S001','Original supplier','AP-001','invoice','2026-10-03','2026-11-01','900.00','TWD','1200.00','300.00'],['00004','S001','Original supplier','SC-001','credit','2026-10-04','','200.00','TWD','200.00','0.00']]}
]
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
module.exports=function financialWorkbook(options={}){
 const sheets=structuredClone(options.sheets||standard),files={},put=(name,text)=>{files[name]=strToU8(text)}
 put('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheets.map((_s,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>')
 put('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="'+rel+'officeDocument" Target="xl/workbook.xml"/></Relationships>')
 put('xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="'+rel.slice(0,-1)+'"><sheets>'+sheets.map((s,i)=>'<sheet name="'+xml(s.name)+'" sheetId="'+(i+1)+'" r:id="sheet'+(i+1)+'"'+(s.hidden?' state="hidden"':'')+'/>').join('')+'</sheets></workbook>')
 put('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_s,i)=>'<Relationship Id="sheet'+(i+1)+'" Type="'+rel+'worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'</Relationships>')
 for(const [index,sheet]of sheets.entries()){
  const rows=[{number:3,values:sheet.headers},...sheet.rows.map((values,i)=>({number:i+6,values}))],cell=(value,column,row)=>{const coordinate=String.fromCharCode(65+column)+row;if(value&&typeof value==='object'&&value.formula)return '<c r="'+coordinate+'"><f>'+xml(value.formula)+'</f><v>'+xml(value.cache)+'</v></c>';return '<c r="'+coordinate+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>'}
  put('xl/worksheets/sheet'+(index+1)+'.xml','<worksheet xmlns="'+ns+'"><sheetData>'+rows.map(row=>'<row r="'+row.number+'">'+row.values.map((value,column)=>cell(value,column,row.number)).join('')+'</row>').join('')+'</sheetData></worksheet>')
 }
 return {name:'original-financial.xlsx',base64:Buffer.from(zipSync(files)).toString('base64')}
}
module.exports.standard=standard
