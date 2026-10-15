const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),asar=require('@electron/asar')
const {identity,inventory,inside,noLinks,parseListing,equalInventory,currentIdentities,safePath,write,sha}=require('./files.cjs')
const {verifyTool}=require('./tools.cjs')
function list(extractor,archive){
  verifyTool(extractor);noLinks(archive)
  const raw=execFileSync(extractor,['l','-slt','-sccUTF-8',archive],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024})
  return {raw,entries:parseListing(raw)}
}
function extract(extractor,archive,destination,selection){
  assert.ok(!fs.existsSync(destination),'fresh extraction directory required');noLinks(destination)
  fs.mkdirSync(destination,{recursive:false})
  verifyTool(extractor)
  execFileSync(extractor,['x','-y','-sccUTF-8',archive,...selection,'-o'+destination],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2*1024*1024})
  inventory(destination);verifyTool(extractor)
}
function members(directory,prefix='',depth=0){
  assert.ok(depth<64,'ASAR nesting limit')
  return Object.entries(directory.files).flatMap(([name,entry])=>{
    assert.ok(!/[\\/]/.test(name),'invalid ASAR member name');const member=safePath(prefix+name)
    assert.ok(!entry.link,'ASAR links rejected')
    return entry.files?members(entry,member+'/',depth+1):[member]
  })
}
function versionFields(receipt,packaged,{version,electronVersion,sourceRevision}){
  assert.ok(receipt&&receipt.schemaVersion===1,'embedded build receipt missing')
  assert.equal(receipt.product,'POS Pro','receipt product mismatch');assert.equal(receipt.version,version,'receipt version mismatch')
  assert.equal(receipt.electronVersion,electronVersion,'receipt runtime mismatch');assert.equal(receipt.sourceRevision,sourceRevision,'receipt source revision mismatch')
  assert.equal(packaged.version,version,'packaged semantic version mismatch');assert.equal(packaged.main,'electron/main.js','packaged entry mismatch')
}
function verifyPayload({root,payload,expected,inputs,frontend,version,electronVersion,sourceRevision}){
  const actual=inventory(payload);equalInventory(expected,actual,'delivered runtime')
  const archive=inside(payload,path.join(payload,'resources/app.asar')),all=members(asar.getRawHeader(archive).header)
  assert.ok(all.length&&all.length<=80000,'ASAR member limit');const names=new Set()
  for(const member of all){const key=member.normalize('NFC').toLowerCase();assert.ok(!names.has(key),'duplicate ASAR member');names.add(key);assert.ok(!member.endsWith('.map')&&!/^(tests|scripts|\.rd)\//.test(member),'private/development file in product')}
  const read=name=>asar.extractFile(archive,path.normalize(name))
  const receipt=JSON.parse(fs.readFileSync(path.join(payload,'resources/build-receipt.json'),'utf8')),packaged=JSON.parse(read('package.json'))
  versionFields(receipt,packaged,{version,electronVersion,sourceRevision})
  equalInventory(inputs,receipt.inputs,'embedded source inputs');currentIdentities(root,receipt.inputs,'build inputs')
  assert.equal(receipt.sourceManifestSha256,sha(Buffer.from(JSON.stringify(receipt.inputs))),'source manifest digest mismatch')
  equalInventory(frontend,receipt.frontendOutputs,'all frontend chunks');currentIdentities(root,frontend,'frontend outputs')
  currentIdentities(payload,receipt.outputs,'embedded native/ASAR outputs')
  const liveOwned=['LICENSE',...['electron','dist','public/menu','public/i18n'].flatMap(dir=>inventory(path.join(root,dir)).filter(row=>!row.path.endsWith('.map')).map(row=>dir+'/'+row.path))].sort()
  const owned=all.filter(p=>p==='LICENSE'||/^(electron|dist|public\/(menu|i18n))\//.test(p)).sort()
  assert.deepEqual(owned,liveOwned,'application/lazy asset closed-world mismatch')
  for(const file of owned)assert.equal(sha(read(file)),identity(path.join(root,file),root).sha256,'application bytes mismatch: '+file)
  const dependencies=new Set(all.filter(p=>p.includes('node_modules/')&&p.endsWith('/package.json')).map(p=>{const pkg=JSON.parse(read(p));return pkg.name&&pkg.version?pkg.name+'@'+pkg.version:null}).filter(Boolean))
  const sbom=JSON.parse(fs.readFileSync(path.join(payload,'resources/sbom.cdx.json'),'utf8'))
  assert.deepEqual(new Set(sbom.components.map(c=>c.name+'@'+c.version)),dependencies,'SBOM dependency mismatch');assert.ok(sbom.components.every(c=>c.licenses?.length),'missing declared license')
  assert.equal(sbom.metadata.component.version,version,'SBOM version mismatch')
  for(const file of ['resources/THIRD_PARTY_NOTICES.txt','LICENSE.electron.txt','LICENSES.chromium.html'])assert.ok(fs.statSync(path.join(payload,file)).size,'license/notices absent')
  return {actual,receipt,packaged,applicationFiles:owned.length,sbomComponents:dependencies.size,rawReceipt:identity(path.join(payload,'resources/build-receipt.json'),payload)}
}
function verifyEnvelope({root,installer,buildDirectory,run,extractor,inputs,frontend,version,electronVersion,sourceRevision}){
  inside(root,run);assert.ok(!fs.existsSync(run),'fresh verification run required');fs.mkdirSync(run,{recursive:false})
  const original=identity(installer,root),envelope=list(extractor,installer)
  fs.writeFileSync(path.join(run,'envelope-listing.txt'),envelope.raw,{flag:'wx'})
  const selected=envelope.entries.filter(e=>e.Path.replaceAll('\\','/')==='$PLUGINSDIR/app-64.7z');assert.equal(selected.length,1,'exactly one x64 payload required');assert.ok(Number(selected[0].Size)>0,'payload size missing')
  const outer=path.join(run,'envelope');extract(extractor,installer,outer,[selected[0].Path])
  const inner=inside(outer,path.join(outer,'$PLUGINSDIR','app-64.7z')),listing=list(extractor,inner)
  fs.writeFileSync(path.join(run,'payload-listing.txt'),listing.raw,{flag:'wx'})
  const payload=path.join(run,'delivered');extract(extractor,inner,payload,[])
  const verified=verifyPayload({root,payload,expected:inventory(buildDirectory),inputs,frontend,version,electronVersion,sourceRevision})
  assert.deepEqual(identity(installer,root),original,'envelope changed during verification')
  const report={schemaVersion:1,status:'PASS',version,installer:original,payloadRoot:payload,runtimeFiles:verified.actual.length,applicationFiles:verified.applicationFiles,sbomComponents:verified.sbomComponents,rawReceipt:verified.rawReceipt,payload:verified.actual}
  write(path.join(run,'envelope-report.json'),report)
  return {run,payload,report:path.join(run,'envelope-report.json'),verified}
}
module.exports={list,extract,members,versionFields,verifyPayload,verifyEnvelope}
