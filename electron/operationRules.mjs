export function moneyValue(value,label,min=0){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>1e9||Math.abs(value-Math.round(value*100)/100)>1e-7)throw Error(label+'需為有效金額，最多兩位小數')
  return value
}
export function quantityValue(value,label,min=0){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>1e9||Math.abs(value-Math.round(value*1000)/1000)>1e-7)throw Error(label+'需為有效數量，最多三位小數')
  return value
}
export function operationHeader(data){
  if(!data||typeof data.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.id)||!Number.isFinite(Date.parse(data.time)))throw Error('異動編號或日期不正確')
}
export function sameCommand(old,data,keys){return keys.every(k=>(old[k]??'')===(data[k]??''))}
export function canonicalSignature(value){return JSON.stringify(sort(value))}
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])):value}
