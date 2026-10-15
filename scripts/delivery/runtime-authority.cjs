const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {inside,identity}=require('./files.cjs')
async function freePort(excluded=[]){
  const net=require('node:net'),{randomInt}=require('node:crypto')
  for(let attempt=0;attempt<64;attempt++){
    const port=randomInt(49152,65536);if(excluded.includes(port))continue
    try{return await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(error=>error?reject(error):resolve(port)))})}
    catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error}
  }
  throw Error('No available isolated debugging port in the dynamic range')
}
function authority(current,executable){
  const report=JSON.parse(fs.readFileSync(current.report,'utf8')),expected=report.payload.find(p=>p.path==='POS Pro.exe')
  assert.equal(report.status,'PASS','verified envelope required');assert.ok(expected,'delivered executable absent')
  assert.equal(path.resolve(executable),inside(current.payload,path.join(current.payload,'POS Pro.exe')),'source/build executable cannot substitute for delivered authority')
  assert.deepEqual(identity(executable,current.payload),expected,'delivered executable identity mismatch')
  return expected
}
function profile(run,target,fresh){
  inside(run,target)
  if(fresh)assert.ok(!fs.existsSync(target),'fresh journey inherited an existing profile')
}
function semantic(expected,actual){
  for(const key of ['product','version','electronVersion','sourceRevision','sourceManifestSha256'])assert.equal(actual?.[key],expected[key],'runtime receipt mismatch: '+key)
}
module.exports={authority,profile,semantic,freePort}
