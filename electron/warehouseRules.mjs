export const WAREHOUSE_METHOD='applyWarehouseOperation'
export const WAREHOUSE_PROTOCOL='pos-warehouse/v1'
export const WAREHOUSE_FEATURE='warehouse-v1'
export const WAREHOUSE_SETTING='warehouseVersionFence'
const messages={INPUT:'搬貨資料需要核對，請保留輸入',STALE:'庫存或存放地點已更新，請重新看結果',OWNER:'只有店主能設定存放地點與包裝單位',INACTIVE:'請先核對庫存成本，再使用搬貨',STOCK:'這個地點的可用數量不足',UNIT:'請填正確數量，最多三位小數，換算後須符合基礎單位',HISTORY:'搬貨紀錄需要核對，請保留原編號與資料'}
export const warehouseError=code=>Object.assign(Error(messages[code]||messages.HISTORY),{code:'WAREHOUSE_'+code})
export function warehouseRecord(value,keys){
 if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw warehouseError('INPUT')
 const own=Reflect.ownKeys(value)
 if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)||!Object.getOwnPropertyDescriptor(value,key)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')))throw warehouseError('INPUT')
}
export function warehouseText(value,max=128){if(typeof value!=='string'||!value||value.length>max||value.trim()!==value||value.normalize('NFC')!==value||/[\p{Cc}\p{Cf}]/u.test(value))throw warehouseError('INPUT');return value}
const integer=(value,min=0)=>{if(!Number.isSafeInteger(value)||value<min||value>1e12)throw warehouseError('UNIT');return value}
function decimal(raw){if(typeof raw!=='string'||! /^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/.test(raw))throw warehouseError('UNIT');const [whole,fraction='']=raw.split('.');return {value:BigInt(whole+fraction),scale:10n**BigInt(fraction.length)}}
export function warehouseQuantity(raw,multiplierUnits=1000){const {value,scale}=decimal(raw),total=value*BigInt(integer(multiplierUnits,1));if(total%scale!==0n||total/scale>1000000000000n||total===0n)throw warehouseError('UNIT');return Number(total/scale)}
export function warehouseCommand(raw){
 const actions={location:['locationId','label'],'set-unit':['productId','unit','baseQuantity'],transfer:['productId','unit','quantity','fromLocationId','toLocationId']},action=raw&&Object.getOwnPropertyDescriptor(raw,'action'),extra=action&&Object.hasOwn(action,'value')&&Object.hasOwn(actions,action.value)?actions[action.value]:null
 if(!extra)throw warehouseError('INPUT')
 warehouseRecord(raw,['protocol','id','time','storeId','epoch','expectedStateDigest','action',...extra]);if(raw.protocol!==WAREHOUSE_PROTOCOL||!/^sha256:[a-f0-9]{64}$/.test(raw.expectedStateDigest))throw warehouseError('INPUT')
 for(const key of ['id','storeId','epoch',...extra.filter(key=>!['quantity','baseQuantity'].includes(key))])warehouseText(raw[key],key==='label'?64:128)
 if(!Number.isFinite(Date.parse(raw.time))||typeof raw.time!=='string')throw warehouseError('INPUT')
 if(raw.action==='transfer')decimal(raw.quantity)
 if(raw.action==='set-unit')warehouseQuantity(raw.baseQuantity)
 return structuredClone(raw)
}
export function warehouseDirectory(raw){
 if(raw===undefined)return {version:1,locations:[{id:'main',label:'店面'}],units:[]}
 warehouseRecord(raw,['version','locations','units']);if(raw.version!==1||!Array.isArray(raw.locations)||raw.locations.length<1||raw.locations.length>64||!Array.isArray(raw.units)||raw.units.length>10000)throw warehouseError('HISTORY')
 const ids=new Set(),labels=new Set(),units=new Set()
 for(const row of raw.locations){warehouseRecord(row,['id','label']);warehouseText(row.id);warehouseText(row.label,64);if(ids.has(row.id)||labels.has(row.label.toLocaleLowerCase('en-US')))throw warehouseError('HISTORY');ids.add(row.id);labels.add(row.label.toLocaleLowerCase('en-US'))}
 if(raw.locations[0].id!=='main'||raw.locations[0].label!=='店面')throw warehouseError('HISTORY')
 for(const row of raw.units){warehouseRecord(row,['productId','productUnit','unit','quantityUnits']);for(const key of ['productId','productUnit','unit'])warehouseText(row[key]);integer(row.quantityUnits,1);const key=JSON.stringify([row.productId,row.unit]);if(row.unit===row.productUnit||units.has(key))throw warehouseError('HISTORY');units.add(key)}
 return structuredClone(raw)
}
