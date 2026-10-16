const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {inside,noLinks,identity}=require('./files.cjs')
function buildArguments(args){
  const options={}
  for(let index=0;index<args.length;index+=2){const flag=args[index],value=args[index+1];assert.ok(['--out','--upgrade-fixtures'].includes(flag)&&typeof value==='string'&&value.length>0&&!value.startsWith('--')&&!Object.hasOwn(options,flag),'Usage: build-installer.cjs [--out release/<fresh-generation>] [--upgrade-fixtures .rd/<verified-fixtures.json>]');options[flag]=value}
  return options
}
function upgradeFixtures(root,requested){
  if(!requested)return []
  const directory=path.join(root,'.rd'),config=inside(directory,path.resolve(root,requested));assert.ok(fs.statSync(config).isFile()&&fs.statSync(config).size<=65536,'bounded upgrade fixture config required')
  const rows=JSON.parse(fs.readFileSync(config,'utf8'));assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<=4,'one to four verified upgrade fixtures required')
  const versions=new Set()
  return rows.map(row=>{
    assert.ok(row&&Object.keys(row).sort().join(',')==='sha256,source,version'&&/^\d+\.\d+\.\d+$/.test(row.version)&&!versions.has(row.version)&&typeof row.source==='string'&&/^[a-f0-9]{64}$/.test(row.sha256),'invalid upgrade fixture identity');versions.add(row.version)
    const source=inside(directory,path.resolve(root,row.source));assert.equal(identity(source,directory).sha256,row.sha256,'upgrade source digest mismatch');noLinks(source+'-wal');assert.ok(!fs.existsSync(source+'-wal')||fs.statSync(source+'-wal').size===0,'closed upgrade source database required');return {...row,source}
  })
}
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
module.exports={outputPath,claim,buildArguments,upgradeFixtures}
