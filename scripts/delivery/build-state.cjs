const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {inside,noLinks}=require('./files.cjs')
function outputPath(root,requested,version){
  const output=inside(path.join(root,'release'),path.resolve(root,requested||path.join('release',version)))
  assert.ok(!fs.existsSync(output)||fs.readdirSync(output).length===0,'installer output already contains a generation; choose a fresh output directory')
  return output
}
function claim(root){
  const directory=path.join(root,'.rd/build');noLinks(directory);fs.mkdirSync(directory,{recursive:true})
  const file=inside(directory,path.join(directory,'canonical-build.lock'))
  if(fs.existsSync(file)){
    const previous=JSON.parse(fs.readFileSync(file,'utf8'));assert.ok(Number.isSafeInteger(previous.pid)&&previous.pid>0&&previous.root===root&&previous.kind==='canonical-installer-build','unknown build lock owner')
    let dead=false;try{process.kill(previous.pid,0)}catch(error){if(error.code==='ESRCH')dead=true;else throw error}
    assert.ok(dead,'another canonical installer build is still running')
    fs.renameSync(file,inside(directory,path.join(directory,'abandoned-lock-'+randomUUID()+'.json')))
  }
  const token=randomUUID(),record={kind:'canonical-installer-build',pid:process.pid,root,token,startedAt:new Date().toISOString()}
  fs.writeFileSync(file,JSON.stringify(record),{flag:'wx'})
  const invocation=fs.mkdtempSync(path.join(directory,'invocation-'))
  return {invocation,release(){noLinks(file);const saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(saved.token,token,'build lock changed');assert.equal(saved.pid,process.pid,'build lock owner changed');fs.unlinkSync(file)}}
}
module.exports={outputPath,claim}
