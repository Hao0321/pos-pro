const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),assert=require('node:assert/strict')
const {sha,identity,noLinks,parseListing,inventory,write}=require('./files.cjs')
const release='https://github.com/ip7z/7zip/releases/download/26.04/'
const downloads=[
  {name:'7zr.exe',bytes:602624,sha256:'256feca8e274e5da655e2a284fabafd9f554365eb164862089dacd4e8276d282'},
  {name:'7z2604-x64.exe',bytes:1664082,sha256:'d54bf805f9f3704d1e8db2fa3498ae7ef2df0312b40b558e7c71c734430a665d'},
]
const outputs=[
  {path:'7z.exe',bytes:577536,sha256:'95fff19b73eff77c87c0d7bd32822e43fb90dd2932459f962eb532d8dfb6ba53'},
  {path:'7z.dll',bytes:1907712,sha256:'899cd73d7fc60e1c1c35c7de0f5bed3dc69bfe2cecbd48014d868a347970a0b1'},
  {path:'License.txt',bytes:6031,sha256:'519ac0a4bded9c18ea02e0afb71f663d8c47373bd9facd3ac96a79f51d77765d'},
]
function check(file,pin){const got=identity(file,path.dirname(file));assert.equal(got.bytes,pin.bytes,'tool size mismatch');assert.equal(got.sha256,pin.sha256,'tool digest mismatch')}
async function download(url,pin){
  for(let redirects=0;redirects<6;redirects++){
    const parsed=new URL(url);assert.ok(parsed.protocol==='https:'&&['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname),'untrusted tool download origin')
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(30000)})
    if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location'),url).href;continue}
    assert.ok(response.ok,'tool download failed: '+response.status)
    const chunks=[];let bytes=0
    for await(const part of response.body){bytes+=part.length;assert.ok(bytes<=pin.bytes,'oversized tool download');chunks.push(part)}
    const data=Buffer.concat(chunks);assert.equal(bytes,pin.bytes,'incomplete tool download');assert.equal(sha(data),pin.sha256,'tool download digest mismatch');return data
  }
  throw Error('tool redirect limit')
}
async function provision(root){
  assert.equal(process.platform,'win32','Windows x64 delivery tooling required');assert.equal(process.arch,'x64','x64 delivery tooling required');noLinks(root)
  fs.mkdirSync(root,{recursive:true});const ready=path.join(root,'ready')
  if(fs.existsSync(ready)){for(const pin of outputs)check(path.join(ready,pin.path),pin);assert.equal(inventory(ready).length,outputs.length,'unexpected cached tool file');return path.join(ready,'7z.exe')}
  const work=fs.mkdtempSync(path.join(root,'provision-'))
  for(const pin of downloads){const data=await download(release+pin.name,pin);fs.writeFileSync(path.join(work,pin.name),data,{flag:'wx'});check(path.join(work,pin.name),pin)}
  const bootstrap=path.join(work,'7zr.exe'),archive=path.join(work,'7z2604-x64.exe'),staged=path.join(work,'extracted')
  parseListing(execFileSync(bootstrap,['l','-slt','-sccUTF-8',archive],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024}))
  execFileSync(bootstrap,['x','-y','-sccUTF-8',archive,...outputs.map(p=>p.path),'-o'+staged],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024})
  for(const pin of outputs)check(path.join(staged,pin.path),pin)
  assert.equal(inventory(staged).length,outputs.length,'unexpected extracted tool file');check(bootstrap,downloads[0]);check(archive,downloads[1]);noLinks(ready)
  fs.renameSync(staged,ready)
  write(path.join(work,'receipt.json'),{schemaVersion:1,version:'26.04',officialSource:'https://www.7-zip.org/download.html',release,downloads,outputs,systemInstalled:false})
  return path.join(ready,'7z.exe')
}
function verifyTool(file){
  assert.equal(path.basename(file),'7z.exe','pinned extractor filename required')
  for(const pin of outputs)check(path.join(path.dirname(file),pin.path),pin)
  assert.equal(inventory(path.dirname(file)).length,outputs.length,'unexpected extractor directory file')
}
module.exports={provision,verifyTool,downloads,outputs,download}
