const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),entry=process.argv[2],file=process.argv[3],packet=JSON.parse(fs.readFileSync(process.argv[4])),init=require(entry),old=require(path.join(path.dirname(entry),'backupEnvelope.mjs'));let db;
try{
 assert.throws(()=>old.readPortableBackup(packet.backup,'sqlite'))
 try{db=init(file)}catch(error){console.log(JSON.stringify({coldOpenRejected:true,error:error.message}));console.log('POS_MIGRATION_BATCH_PRECEDING_PASS');process.exitCode=0;return}
 for(const method of ['getSalesState','getSupplierState'])assert.throws(()=>db[method](packet.owner),undefined,method)
 if(packet.mode==='masters')assert.deepEqual(JSON.parse(JSON.stringify(db.getStockCostState(packet.owner))),packet.expectedLegacyStock);else assert.throws(()=>db.getStockCostState(packet.owner))
 assert.throws(()=>db.setSetting('forbidden-preceding-batch-write','no'));assert.throws(()=>db.updateProduct(packet.productId,{name:'forbidden old edit'}));db.close();console.log('POS_MIGRATION_BATCH_PRECEDING_PASS')
}catch(error){try{db?.close()}catch{}console.error(error.stack);process.exitCode=1}
