const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),assert=require('node:assert/strict')
const sha=data=>createHash('sha256').update(data).digest('hex')
function noLinks(file){
  let item=path.resolve(file)
  for(;;){
    let entry;try{entry=fs.lstatSync(item)}catch(error){if(error.code!=='ENOENT')throw error}
    if(entry)assert.ok(!entry.isSymbolicLink(),'linked delivery path: '+item)
    const parent=path.dirname(item);if(parent===item)break;item=parent
  }
}
function inside(root,file){
  root=path.resolve(root);file=path.resolve(file)
  assert.ok(file.startsWith(root+path.sep),'delivery path outside owned root')
  noLinks(file);return file
}
function identity(file,root){
  noLinks(file);const fd=fs.openSync(file,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(64*1024)
  try{
    const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile(),'regular file required')
    for(let n;(n=fs.readSync(fd,buffer,0,buffer.length,null))>0;)hash.update(buffer.subarray(0,n))
    const after=fs.fstatSync(fd,{bigint:true});assert.equal(after.size,before.size,'file changed during verification');assert.equal(after.mtimeNs,before.mtimeNs,'file changed during verification')
    return {path:path.relative(root,file).replaceAll('\\','/'),bytes:Number(after.size),sha256:hash.digest('hex')}
  }finally{fs.closeSync(fd)}
}
function files(root){
  noLinks(root)
  return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>{assert.ok(!e.isSymbolicLink(),'linked payload entry');const p=path.join(root,e.name);return e.isDirectory()?files(p):[p]}).sort()
}
const inventory=root=>files(root).map(f=>identity(f,root))
function safePath(value){
  assert.equal(typeof value,'string','archive path required')
  const name=value.replaceAll('\\','/'),parts=name.split('/')
  assert.ok(name&&!name.startsWith('/')&&parts.every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)&&!/[\x00-\x1f:<>"|?*]/.test(p)&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(p)),'unsafe archive entry: '+name)
  return name
}
function validateEntries(entries){
  assert.ok(entries.length&&entries.length<=20000,'archive entry limit')
  const seen=new Map();let bytes=0
  for(const e of entries){
    const name=safePath(e.Path),key=name.normalize('NFC').toLowerCase()
    assert.ok(!seen.has(key),'duplicate archive entry: '+name)
    assert.ok(!/[lL]/.test(e.Attributes||'')&&!e['Symbolic Link']&&!e['Hard Link']&&!e['Reparse Point'],'archive links rejected')
    const size=Number(e.Size||0);assert.ok(Number.isSafeInteger(size)&&size>=0&&size<=1024**3,'archive file size limit');bytes+=size
    seen.set(key,{name,directory:e.Folder==='+'||/^D/.test(e.Attributes||'')})
  }
  assert.ok(bytes<=4*1024**3,'archive expanded size limit')
  for(const [key]of seen){const parts=key.split('/');parts.pop();while(parts.length){const parent=seen.get(parts.join('/'));assert.ok(!parent||parent.directory,'archive file/directory collision');parts.pop()}}
  return entries
}
function parseListing(text){
  const normalized=text.replaceAll('\r\n','\n'),start=normalized.indexOf('\n----------\n')
  assert.ok(start>=0,'archive listing header absent')
  const entries=normalized.slice(start+12).trim().split(/\n\n+/).filter(Boolean).map(block=>{
    const e={};for(const line of block.split('\n')){const i=line.indexOf(' = ');if(i<0)continue;const key=line.slice(0,i);assert.ok(!Object.hasOwn(e,key),'duplicate listing field');e[key]=line.slice(i+3)}return e
  })
  return validateEntries(entries)
}
function rows(value){
  assert.ok(Array.isArray(value)&&value.length,'nonempty inventory required')
  const seen=new Set()
  return value.map(row=>{const name=safePath(row.path),key=name.normalize('NFC').toLowerCase();assert.ok(!seen.has(key),'duplicate inventory entry');seen.add(key);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>=0&&/^[a-f0-9]{64}$/.test(row.sha256),'invalid inventory identity');return {...row,path:name}}).sort((a,b)=>a.path.localeCompare(b.path))
}
function equalInventory(expected,actual,label='payload'){
  assert.deepEqual(rows(actual),rows(expected),label+' missing, unexpected or identity-mismatched files')
}
function currentIdentities(root,declared,label){
  for(const row of rows(declared)){const file=inside(root,path.join(root,row.path));assert.deepEqual(identity(file,root),row,label+' stale bytes: '+row.path)}
}
function write(file,value){noLinks(path.dirname(file));assert.ok(!fs.existsSync(file),'fresh evidence file required');fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'})}
module.exports={sha,noLinks,inside,identity,files,inventory,safePath,validateEntries,parseListing,equalInventory,currentIdentities,write}
