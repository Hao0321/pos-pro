import {workbookAttribute as attr,workbookChildren as children,workbookChild as child} from './workbookXml.mjs'

const fail=()=>{throw Error('Excel 儲存格需要核對，原始檔案仍保留。')}
const dateFormats=new Set([14,15,16,17,22]),timeFormats=new Set([18,19,20,21,45,46,47])
export const workbookText=value=>value.replace(/_x([0-9a-fA-F]{4})_/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)))
export function workbookDecimal(raw){
 const match=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d{1,4}))?$/.exec(raw);if(!match||raw.length>2048)fail()
 const sign=match[1]==='-'?'-':'',whole=match[2],fraction=match[3]||'',exponent=Number(match[4]||0),point=whole.length+exponent,digits=whole+fraction
 if(Math.abs(exponent)>1024)fail()
 const value=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point)
 const normalized=value.replace(/^0+(?=\d)/,''),compact=normalized.includes('.')?normalized.replace(/0+$/,'').replace(/\.$/,''):normalized
 if(compact.length+sign.length>2048)fail();return (sign&&/[1-9]/.test(compact)?sign:'')+compact
}
function excelDate(raw,date1904){
 if(!/^\d+(?:\.0+)?$/.test(raw))return null
 const days=Number(raw);if(!Number.isSafeInteger(days)||days<0||days>2958465||!date1904&&(days===0||days===60))return null
 const value=new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:31)+(days-(!date1904&&days>60?1:0))*86400000)
 if(!Number.isFinite(value.getTime())||value.getUTCFullYear()>9999)return null
 return value.toISOString().slice(0,10)
}
export function workbookString(node){
 let value='';for(const item of node.children){if(item.ns!==node.ns)continue;if(item.name==='t')value+=workbookText(item.text);else if(item.name==='r')for(const text of children(item,'t'))value+=workbookText(text.text)}
 if(value.length>2048||!value.isWellFormed()||value.includes('\0'))fail();return value
}
export function workbookStyles(root){
 if(!root)return [{id:0,format:'General'}]
 const custom=new Map(),formats=child(root,'numFmts')
 for(const row of formats?children(formats,'numFmt'):[]){const id=attr(row,'numFmtId'),format=attr(row,'formatCode');if(!/^\d{1,5}$/.test(id||'')||Number(id)<164||typeof format!=='string'||format.length>512||custom.has(Number(id)))fail();custom.set(Number(id),format)}
 const base=child(root,'cellStyleXfs'),baseFormats=base?children(base,'xf').map(row=>attr(row,'numFmtId')||'0'):['0']
 const xfs=child(root,'cellXfs',true),styles=children(xfs,'xf').map(row=>{const parent=attr(row,'xfId')||'0';if(!/^\d{1,5}$/.test(parent)||!baseFormats[Number(parent)])fail();const apply=attr(row,'applyNumberFormat');if(apply!==undefined&&!['0','1','false','true'].includes(apply))fail();const value=['0','false'].includes(apply)?baseFormats[Number(parent)]:attr(row,'numFmtId')||baseFormats[Number(parent)];if(!/^\d{1,5}$/.test(value))fail();const id=Number(value);if(id>=164&&!custom.has(id))fail();return {id,format:custom.get(id)||''}})
 if(!styles.length||styles.length>10000)fail();return styles
}
export function workbookCell(node,{strings,styles,date1904,defaultStyle='0'}){
 const raw=child(node,'v')?.text??'',formula=child(node,'f'),inline=child(node,'is'),type=attr(node,'t')||'n',styleValue=attr(node,'s')??defaultStyle
 if(!/^\d{1,5}$/.test(styleValue)||!styles[Number(styleValue)]||raw.length>2048||formula?.text.length>2048)fail()
 const style=styles[Number(styleValue)],result={value:'',raw,type,format:style.format,formatId:style.id,issue:null,numeric:false,formula:formula?.text??null,cached:formula?raw:null}
 if(formula){result.value='='+(formula.text||'[shared formula]');result.issue='formula';return result}
 if(type==='s'){if(!/^\d{1,8}$/.test(raw)||Number(raw)>=strings.length)fail();result.value=strings[Number(raw)]}
 else if(type==='inlineStr'){if(!inline||raw)fail();result.value=workbookString(inline)}
 else if(type==='str')result.value=workbookText(raw)
 else if(type==='b'){if(!['0','1'].includes(raw))fail();result.value=raw==='1'?'TRUE':'FALSE'}
 else if(type==='e'){result.value=raw;result.issue='error'}
 else if(type==='d'){result.value=raw;const date=/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?Z?)?$/.exec(raw);if(date&&Number.isFinite(Date.parse(date[1]+'T00:00:00Z'))&&new Date(date[1]+'T00:00:00Z').toISOString().slice(0,10)===date[1])result.value=date[1];else result.issue='date'}
 else if(type==='n'){
  if(!raw){result.value='';return result}
  result.numeric=true;let value
  try{value=workbookDecimal(raw)}catch{result.value=raw;result.issue='format';return result}
  const format=style.format.replace(/\[[^\]]*\]|"[^"]*"|\\./g,''),date=dateFormats.has(style.id)||/[yd]/i.test(format)&&/[md]/i.test(format)&&!/[hs]/i.test(format)
  if(style.format.includes(';')||/\[[<=>]/.test(style.format)){result.value=value;result.issue='format'}
  else if(date){result.value=excelDate(value,date1904)||raw;if(!excelDate(value,date1904))result.issue='date'}
  else if(timeFormats.has(style.id)||[9,10].includes(style.id)||/[hs]/i.test(format)||format.includes('%')){result.value=value;result.issue='format'}
  else if(/^0{2,128}$/.test(style.format)){if(/^-?\d+$/.test(value))result.value=(value.startsWith('-')?'-':'')+value.replace(/^-/,'').padStart(style.format.length,'0');else{result.value=value;result.issue='format'}}
  else{result.value=value;const obvious=['','General','0','0.00','#,##0','#,##0.00','0.00E+00','##0.0E+0'];if(style.id>=164&&!obvious.includes(style.format)&&!/^0{1,128}$/.test(style.format)&&!/[\$¥￥€£₩]/.test(style.format)||style.id>=23&&style.id<=36||style.id>=50&&style.id<164)result.issue='format'}
  result.precisionRisk=value.replace(/^-|\..*$/g,'').length>15||value.replace(/[-.]/g,'').replace(/^0+|0+$/g,'').length>15
  const currency=/\b(USD|EUR|GBP|JPY|CNY|RMB|HKD|AUD|CAD|KRW)\b/i.exec(style.format);result.foreignCurrency=currency?.[1]?.toUpperCase()||null
 }else fail()
 if(result.value.length>2048||result.value.includes('\0'))fail();return result
}
