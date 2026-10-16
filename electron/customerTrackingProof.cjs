const {randomBytes,createCipheriv,createDecipheriv}=require('node:crypto')
function key(db,create){let secret=db.getSetting('orderReceiptSecret');if(!secret&&create){secret=randomBytes(32).toString('hex');db.setSetting('orderReceiptSecret',secret)}if(typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret))throw Error('原單追蹤資料需要店家核對，請保留原請求編號');return Buffer.from(secret,'hex')}
const aad=order=>Buffer.from(JSON.stringify(['pos-customer-receipt/v1',order.id,order.requestSignature]))
function seal(db,order,token){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(db,true),iv);cipher.setAAD(aad(order));const data=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return {version:1,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')}}
function open(db,order){const p=order.trackingProof;if(!p||p.version!==1)throw Error('原單追蹤資料需要店家核對，請保留原請求編號');const cipher=createDecipheriv('aes-256-gcm',key(db,false),Buffer.from(p.iv,'hex'));cipher.setAAD(aad(order));cipher.setAuthTag(Buffer.from(p.tag,'hex'));return Buffer.concat([cipher.update(Buffer.from(p.data,'hex')),cipher.final()]).toString('utf8')}
module.exports={seal,open}
