import {inflateSync} from 'fflate'

export const WORKBOOK_MAX_BYTES=120000
const fail=()=>{throw Error('Excel 檔案讀不到，請保留原檔並核對格式。')}
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0})
export function workbookCrc32(bytes){let n=0xffffffff;for(const byte of bytes)n=crcTable[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0}
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes)
export function workbookBytes(base64){
 if(typeof base64!=='string'||base64.length>Math.ceil(WORKBOOK_MAX_BYTES/3)*4||!base64.length||base64.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))fail()
 try{const raw=atob(base64);if(raw.length>WORKBOOK_MAX_BYTES||btoa(raw)!==base64)fail();return Uint8Array.from(raw,c=>c.charCodeAt(0))}catch{fail()}
}
export function readWorkbookZip(input){
 try{return inspectZip(input)}catch{fail()}
}
function inspectZip(input){
 if(!(input instanceof Uint8Array)||input.length<22||input.length>WORKBOOK_MAX_BYTES)fail()
 const view=new DataView(input.buffer,input.byteOffset,input.byteLength),u16=p=>view.getUint16(p,true),u32=p=>view.getUint32(p,true)
 let end=input.length-22;while(end>=Math.max(0,input.length-65557)&&u32(end)!==0x06054b50)end--
 if(end<0||u32(end)!==0x06054b50||end+22+u16(end+20)!==input.length||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))fail()
 const count=u16(end+10),centralSize=u32(end+12),centralOffset=u32(end+16)
 if(!count||count>256||centralOffset+centralSize!==end)fail()
 const files=new Map(),names=new Set(),ranges=[];let p=centralOffset,total=0
 const extra=(start,length,limit)=>{if(start+length>limit)fail();for(let x=start;x<start+length;){if(x+4>start+length)fail();const id=u16(x),size=u16(x+2);if([1,0x9901,0x7075].includes(id)||x+4+size>start+length)fail();x+=4+size}}
 for(let i=0;i<count;i++){
  if(p+46>end||u32(p)!==0x02014b50||u16(p+6)>=45||u16(p+34))fail()
  const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),compressed=u32(p+20),size=u32(p+24),nameLength=u16(p+28),extraLength=u16(p+30),commentLength=u16(p+32),offset=u32(p+42),next=p+46+nameLength+extraLength+commentLength
  if(flags&~0x080e||![0,8].includes(method)||!nameLength||nameLength>256||next>end||size>1048576||(total+=size)>4194304||(u32(p+38)>>>16&0xf000)===0xa000)fail()
  const nameBytes=input.subarray(p+46,p+46+nameLength),name=utf8(nameBytes)
  const pathParts=name.endsWith('/')?name.slice(0,-1).split('/'):name.split('/')
  if(!(flags&0x0800)&&nameBytes.some(b=>b>127)||/^[\/]|[\\\x00-\x1f\x7f:%?#]/.test(name)||pathParts.some(part=>part==='.'||part==='..'||!part)||names.has(name.toLowerCase()))fail()
  names.add(name.toLowerCase())
  extra(p+46+nameLength,extraLength,end)
  if(offset+30>centralOffset||u32(offset)!==0x04034b50||u16(offset+4)>=45||u16(offset+6)!==flags||u16(offset+8)!==method||u16(offset+26)!==nameLength)fail()
  const localName=input.subarray(offset+30,offset+30+nameLength);if(localName.length!==nameBytes.length||localName.some((v,j)=>v!==nameBytes[j]))fail()
  extra(offset+30+nameLength,u16(offset+28),centralOffset)
  const start=offset+30+nameLength+u16(offset+28),stop=start+compressed;if(start>centralOffset||stop>centralOffset)fail()
  for(const [position,expected]of [[14,crc],[18,compressed],[22,size]])if(u32(offset+position)!==expected&&(!(flags&8)||u32(offset+position)!==0))fail()
  let rangeEnd=stop
  if(flags&8){let d=stop;if(d+4>centralOffset)fail();if(u32(d)===0x08074b50)d+=4;if(d+12>centralOffset||u32(d)!==crc||u32(d+4)!==compressed||u32(d+8)!==size)fail();rangeEnd=d+12}
  ranges.push({start:offset,end:rangeEnd})
  const packed=input.subarray(start,stop),bytes=method===0?packed:inflateSync(packed,{out:new Uint8Array(size+1)})
  if(bytes.length!==size||workbookCrc32(bytes)!==crc||name.endsWith('/')&&size)fail()
  if(!name.endsWith('/'))files.set(name,bytes)
  p=next
 }
 if(p!==end)fail();ranges.sort((a,b)=>a.start-b.start);if(ranges[0].start!==0||ranges.at(-1).end!==centralOffset||ranges.some((row,i)=>i&&row.start!==ranges[i-1].end))fail()
 return files
}
