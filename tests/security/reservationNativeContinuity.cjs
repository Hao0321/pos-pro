const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
module.exports=function(file,root,owner,pass,snapshot){
 const manifest=process.env.POS_PRECEDING_RESERVATION_SOURCE_COPY
 if(!manifest)return {files:0,sourceSha256:null,after(){},close(){}}
 const copy=JSON.parse(fs.readFileSync(manifest));for(const row of copy.manifest)assert.equal(hash(path.join(copy.destination,row.path)),row.sha256)
 const previous=require(path.join(copy.destination,'electron/database.js')),warm=previous(file),control=previous(path.join(root,'supported14.db'))
 try{for(const user of require('../fixtures/lot-count-native-v1.json').book.users)control.addUser(user);control.setSetting('supported-old-writer','yes');assert.equal(control.getSetting('supported-old-writer'),'yes');assert.equal(control.getRestaurantState().entries.length,0)}finally{control.close()}
 assert.equal(warm.getRestaurantState().entries.length,0);pass('a genuine retained format14 source reads the shared shop before activation and its independent normal writer still works')
 return {files:copy.manifest.length,sourceSha256:hash(manifest),after(){
  const before=snapshot();assert.throws(()=>warm.getRestaurantState());assert.throws(()=>warm.exportFullBackup(owner));assert.throws(()=>warm.setSetting('old-reservation-write','blocked'));assert.equal(snapshot(),before)
  let cold;try{cold=previous(file);assert.throws(()=>cold.getRestaurantState());assert.throws(()=>cold.exportFullBackup(owner));assert.throws(()=>cold.setSetting('old-cold-reservation-write','blocked'))}catch(error){assert.match(error.message,/較新功能|相容版本|pos_require_feature|紀錄|回執|備份|預訂/)}finally{cold?.close()}
  assert.equal(snapshot(),before);pass('genuine warm and cold format14 readers refuse the new reservation barrier and old writers leave the complete format15 book unchanged')
 },close(){warm.close()}}
}
