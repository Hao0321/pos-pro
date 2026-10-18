import {SaxesParser} from 'saxes'

export const SPREADSHEET_NAMESPACES=['http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://purl.oclc.org/ooxml/spreadsheetml/main']
export const OFFICE_RELATIONSHIP_NAMESPACES=['http://schemas.openxmlformats.org/officeDocument/2006/relationships','http://purl.oclc.org/ooxml/officeDocument/relationships']
export const PACKAGE_RELATIONSHIP_NAMESPACE='http://schemas.openxmlformats.org/package/2006/relationships'
export const CONTENT_TYPE_NAMESPACE='http://schemas.openxmlformats.org/package/2006/content-types'
const fail=()=>{throw Error('Excel 內容格式需要核對，原始檔案仍保留。')}
export function readWorkbookXml(bytes){
 try{
  let encoding='utf-8';if(bytes[0]===255&&bytes[1]===254||bytes[0]===60&&bytes[1]===0)encoding='utf-16le';else if(bytes[0]===254&&bytes[1]===255||bytes[0]===0&&bytes[1]===60)encoding='utf-16be'
  const text=new TextDecoder(encoding,{fatal:true}).decode(bytes),declared=/^\s*<\?xml\s[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i.exec(text)?.[1]?.toLowerCase()
  if(declared&&!((encoding==='utf-8'&&declared==='utf-8')||(encoding.startsWith('utf-16')&&['utf-16',encoding].includes(declared))))fail()
  const parser=new SaxesParser({xmlns:true}),stack=[];let root=null,nodes=0,textSize=0
  parser.on('doctype',fail);parser.on('error',fail);parser.on('processinginstruction',fail)
  parser.on('opentag',tag=>{if(++nodes>100000||stack.length>=64||Object.keys(tag.attributes).length>64)fail();const node={name:tag.local,ns:tag.uri,attributes:Object.values(tag.attributes).filter(a=>a.uri!=='http://www.w3.org/2000/xmlns/').map(a=>({name:a.local,ns:a.uri,value:a.value})),children:[],text:''};if(stack.length)stack.at(-1).children.push(node);else{if(root)fail();root=node}stack.push(node)})
  const append=value=>{textSize+=value.length;if(textSize>2097152)fail();if(stack.length)stack.at(-1).text+=value;else if(value.trim())fail()}
  parser.on('text',append);parser.on('cdata',append);parser.on('closetag',()=>stack.pop());parser.write(text).close();if(!root||stack.length)fail();return root
 }catch{fail()}
}
export const workbookAttribute=(node,name,ns='')=>node.attributes.find(a=>a.name===name&&a.ns===ns)?.value
export const workbookChildren=(node,name,ns=node.ns)=>node.children.filter(c=>c.name===name&&c.ns===ns)
export function workbookChild(node,name,required=false){const rows=workbookChildren(node,name);if(rows.length>1||required&&!rows.length)fail();return rows[0]||null}
export function workbookPartPath(from,target){
 if(typeof target!=='string'||!target||target.length>256||/[\\\x00-\x1f\x7f:%?#]/.test(target))fail()
 const parts=target.startsWith('/')?[]:from.split('/').slice(0,-1)
 for(const part of target.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)fail();parts.pop()}else parts.push(part)}
 if(!parts.length)fail();return parts.join('/')
}
