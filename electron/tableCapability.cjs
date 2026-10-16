const {createHmac,timingSafeEqual}=require('node:crypto')
const {normalizeTableOrdering}=require('./tableOrdering.mjs')
const signed=(secret,storeId,table)=>createHmac('sha256',secret).update(JSON.stringify(['pos-table-order/v1',storeId,table.id,table.label])).digest('hex')
function resolveTable(db,config,input){
 if(!Object.hasOwn(input,'table')&&!Object.hasOwn(input,'key'))return null
 const table=config.enabled&&config.tableOrdering&&normalizeTableOrdering(config.tableOrdering).enabled&&config.tableOrdering.tables.find(t=>t.id===input.table),secret=db.getSetting('orderTrackingSecret'),storeId=db.getSetting('sharedStoreId')
 if(!table||typeof input.key!=='string'||!/^[a-f0-9]{64}$/.test(input.key)||typeof secret!=='string'||!secret||typeof storeId!=='string'||!storeId||!timingSafeEqual(Buffer.from(input.key),Buffer.from(signed(secret,storeId,table))))throw Error('這張桌碼已失效，請向店家確認')
 return {id:table.id,label:table.label}
}
module.exports={signed,resolveTable}
