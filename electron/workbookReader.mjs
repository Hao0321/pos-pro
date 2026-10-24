import {readWorkbookZip,workbookBytes} from './workbookZip.mjs'
import {readWorkbookXml,workbookAttribute as attr,workbookChildren as children,workbookChild as child,workbookPartPath,SPREADSHEET_NAMESPACES,OFFICE_RELATIONSHIP_NAMESPACES,PACKAGE_RELATIONSHIP_NAMESPACE,CONTENT_TYPE_NAMESPACE} from './workbookXml.mjs'
import {workbookCell,workbookString,workbookStyles} from './workbookCells.mjs'

const fail=()=>{throw Error('Excel 工作表需要核對，原始檔案仍保留。')}
const relType=(value,type)=>OFFICE_RELATIONSHIP_NAMESPACES.some(prefix=>value===prefix+'/'+type)
const positive=(value,max)=>{if(!/^[1-9]\d{0,9}$/.test(value||''))fail();const n=Number(value);if(n>max)fail();return n}
const bool=value=>{if(value===undefined||value==='0'||value==='false')return false;if(value==='1'||value==='true')return true;fail()}
function xml(files,path){const bytes=files.get(path);if(!bytes)fail();return readWorkbookXml(bytes)}
function relationships(files,part){
 const position=part.lastIndexOf('/'),path=part?(position<0?'':part.slice(0,position+1))+'_rels/'+part.slice(position+1)+'.rels':'_rels/.rels',root=xml(files,path),map=new Map()
 if(root.name!=='Relationships'||root.ns!==PACKAGE_RELATIONSHIP_NAMESPACE)fail()
 for(const row of children(root,'Relationship')){const id=attr(row,'Id'),type=attr(row,'Type'),target=attr(row,'Target'),mode=attr(row,'TargetMode');if(!id||id.length>128||map.has(id)||!type||!target||mode!==undefined&&!['External','Internal'].includes(mode))fail();map.set(id,{type,target,external:mode==='External'})}return map
}
function related(files,part,rels,type,required=false){const rows=[...rels.values()].filter(row=>relType(row.type,type));if(rows.length>1||required&&!rows.length||rows.some(row=>row.external))fail();return rows[0]?workbookPartPath(part,rows[0].target):null}
function coordinate(value){const match=/^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value||'');if(!match)fail();let column=0;for(const c of match[1])column=column*26+c.charCodeAt(0)-64;return {row:positive(match[2],1048576),column:column-1}}
function worksheet(root,context){
 if(root.name!=='worksheet'||!SPREADSHEET_NAMESPACES.includes(root.ns))fail()
 const columns=child(root,'cols'),hiddenColumns=[],columnStyles=new Map()
 for(const node of columns?children(columns,'col'):[]){const min=positive(attr(node,'min'),16384),max=positive(attr(node,'max'),16384),style=attr(node,'style')||'0';if(min>max||!/^\d{1,5}$/.test(style)||!context.styles[Number(style)])fail();for(let c=min-1;c<Math.min(100,max);c++){if(columnStyles.has(c))fail();columnStyles.set(c,style);if(bool(attr(node,'hidden')))hiddenColumns.push(c)}}
 const data=child(root,'sheetData',true),rows=[],seenRows=new Set();let prior=0,cells=0
 for(const rawRow of children(data,'row')){
  const number=attr(rawRow,'r')===undefined?prior+1:positive(attr(rawRow,'r'),1048576);if(number<=prior||seenRows.has(number))fail();seenRows.add(number);prior=number
  const rowStyle=bool(attr(rawRow,'customFormat'))?attr(rawRow,'s')||'0':null,row={number,hidden:bool(attr(rawRow,'hidden')),cells:[]};let column=-1
  for(const rawCell of children(rawRow,'c')){
   if(++cells>500000)fail();const ref=attr(rawCell,'r'),position=ref?coordinate(ref):{row:number,column:column+1};if(position.row!==number||position.column<=column||position.column>16383)fail();column=position.column
   const cell=workbookCell(rawCell,{...context,defaultStyle:rowStyle??columnStyles.get(column)??'0'});if(cell.value||cell.issue){if(column>=100)fail();row.cells.push({...cell,column})}
  }
  if(row.cells.length){rows.push(row);if(rows.length>5020)fail()}
 }
 const merged=child(root,'mergeCells'),merges=[]
 for(const node of merged?children(merged,'mergeCell'):[]){const refs=(attr(node,'ref')||'').split(':');if(refs.length!==2)fail();const from=coordinate(refs[0]),to=coordinate(refs[1]);if(from.row>to.row||from.column>to.column||merges.length>=10000)fail();merges.push({from,to})}
 return {rows,merges,hiddenColumns:[...new Set(hiddenColumns)]}
}
function inspect(base64){
 const files=readWorkbookZip(workbookBytes(base64)),types=xml(files,'[Content_Types].xml')
 if(types.name!=='Types'||types.ns!==CONTENT_TYPE_NAMESPACE||[...files.keys()].some(n=>/vbaproject\.bin$/i.test(n)))fail()
 const overrides=new Map()
 for(const row of children(types,'Override')){const part=attr(row,'PartName'),type=attr(row,'ContentType');if(!part?.startsWith('/')||!type||/macroenabled/i.test(type)||overrides.has(part))fail();overrides.set(part,type)}
 const main=related(files,'',relationships(files,''),'officeDocument',true)
 if(overrides.get('/'+main)!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')fail()
 const workbook=xml(files,main);if(workbook.name!=='workbook'||!SPREADSHEET_NAMESPACES.includes(workbook.ns))fail()
 const rels=relationships(files,main),shared=related(files,main,rels,'sharedStrings'),style=related(files,main,rels,'styles'),strings=[]
 if(shared){const root=xml(files,shared);if(root.name!=='sst'||root.ns!==workbook.ns)fail();for(const row of children(root,'si')){if(strings.length>=50000)fail();strings.push(workbookString(row))}}
 let stylesRoot=null;if(style){stylesRoot=xml(files,style);if(stylesRoot.name!=='styleSheet'||stylesRoot.ns!==workbook.ns)fail()}
 const context={strings,styles:workbookStyles(stylesRoot),date1904:bool(child(workbook,'workbookPr')?attr(child(workbook,'workbookPr'),'date1904'):undefined)},sheetNodes=children(child(workbook,'sheets',true),'sheet'),sheets=[],ids=new Set(),names=new Set()
 if(!sheetNodes.length||sheetNodes.length>50)fail()
 for(const node of sheetNodes){
  const id=attr(node,'sheetId'),name=attr(node,'name'),relId=node.attributes.find(a=>a.name==='id'&&OFFICE_RELATIONSHIP_NAMESPACES.includes(a.ns))?.value,state=attr(node,'state')||'visible',rel=rels.get(relId)
  positive(id,2147483647);if(!name||name.length>128||ids.has(id)||names.has(name.toLowerCase())||!['visible','hidden','veryHidden'].includes(state)||!rel||rel.external||!['worksheet','chartsheet'].some(type=>relType(rel.type,type)))fail();ids.add(id);names.add(name.toLowerCase())
  const part=workbookPartPath(main,rel.target)
  if(relType(rel.type,'chartsheet')){if(!files.has(part)||overrides.get('/'+part)!=='application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml')fail();sheets.push({id,name,state,unsupported:true,rows:[],merges:[],hiddenColumns:[]});continue}
  if(overrides.get('/'+part)!=='application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')fail()
  sheets.push({id,name,state,...worksheet(xml(files,part),context)})
 }
 return {date1904:context.date1904,sheets}
}
let cachedText=null,cachedBook=null
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
export function readWorkbook(base64){
 if(base64===cachedText&&cachedBook)return cachedBook
 const book=freeze(inspect(base64));cachedText=base64;cachedBook=book;return book
}
export function workbookTable(book,sheetId,headerRow){
 const sheet=book.sheets.find(row=>row.id===sheetId),header=sheet?.rows.find(row=>row.number===headerRow);if(!sheet||!header||header.cells.some(c=>c.issue))throw Error('請選擇工作表與欄位名稱所在的列。')
 const data=sheet.rows.filter(row=>row.number>headerRow);if(!data.length||data.length>5000)fail()
 const width=data.reduce((w,row)=>row.cells.reduce((max,c)=>Math.max(max,c.column+1),w),header.cells.reduce((w,c)=>Math.max(w,c.column+1),0)),headers=Array.from({length:width},(_,column)=>header.cells.find(c=>c.column===column)?.value||'')
 if(!headers.some(Boolean)||headers.some(v=>v.length>128))fail()
 const rows=data.map(row=>Array.from({length:width},(_,column)=>row.cells.find(c=>c.column===column)?.value||'')),issues=[]
 data.forEach((row,ri)=>row.cells.forEach(cell=>{if(cell.issue||cell.precisionRisk||cell.foreignCurrency)issues.push({row:ri,column:cell.column,issue:cell.issue,precisionRisk:!!cell.precisionRisk,foreignCurrency:cell.foreignCurrency||null,raw:cell.raw,formula:cell.formula})}))
 for(const merge of sheet.merges)for(const [ri,row]of data.entries())if(row.number>=merge.from.row&&row.number<=merge.to.row)for(let column=merge.from.column;column<=Math.min(width-1,merge.to.column);column++)issues.push({row:ri,column,issue:'merged',precisionRisk:false,foreignCurrency:null,raw:rows[ri][column],formula:null})
 return {headers,rows,issues,physicalRows:data.map(row=>row.number),skippedBeforeHeader:sheet.rows.filter(row=>row.number<headerRow).length,hiddenRows:data.filter(row=>row.hidden).length,hiddenColumns:sheet.hiddenColumns.length,blankRows:Math.max(0,data.at(-1).number-headerRow-data.length)}
}
