const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {sha,identity,inventory,equalInventory,currentIdentities,write}=require('./files.cjs')
const {list,extract,versionFields}=require('./envelope.cjs')
const runtime=require('./runtime-authority.cjs')
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
// Minimal stored ZIP writer for archive-path fixtures, including names that
// cannot safely be represented as real files on Windows. Never extracts them.
function zip(entries){
  const locals=[],central=[];let offset=0
  for(const [name,value]of entries){
    const file=Buffer.from(name),data=Buffer.from(value),crc=crc32(data),local=Buffer.alloc(30),record=Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(file.length,26)
    record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(file.length,28);record.writeUInt32LE(offset,42)
    locals.push(local,file,data);central.push(record,file);offset+=local.length+file.length+data.length
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16)
  return Buffer.concat([...locals,directory,end])
}
function calibrate(run,extractor){
  assert.ok(!fs.existsSync(run),'fresh calibration root required');fs.mkdirSync(run)
  const fixture=[['POS Pro.exe','fixture opaque program bytes'],['dist/assets/RecoveryPage-fixture.js','fixture lazy module'],['resources/sbom.cdx.json','{"fixture":true}'],['resources/build-receipt.json','{"schemaVersion":1}']]
  const expected=fixture.map(([name,value])=>({path:name,bytes:Buffer.byteLength(value),sha256:sha(Buffer.from(value))}))
  const outcomes=[]
  function archive(name,entries){const file=path.join(run,name+'.zip');fs.writeFileSync(file,zip(entries),{flag:'wx'});return file}
  function check(name,entries){const file=archive(name,entries);list(extractor,file);const dest=path.join(run,name);extract(extractor,file,dest,[]);equalInventory(expected,inventory(dest));return dest}
  function negative(name,fn){let error;try{fn()}catch(e){error=e}assert.ok(error,'negative fixture incorrectly accepted: '+name);outcomes.push({name,status:'REJECTED',error:error.message})}
  const positive=check('positive',fixture)
  const stale=path.join(run,'positive.zip'),originalArchive=identity(stale,run);fs.appendFileSync(stale,'changed envelope')
  negative('stale-envelope',()=>assert.deepEqual(identity(stale,run),originalArchive,'delivery envelope identity mismatch'))
  negative('unsafe-entry',()=>list(extractor,archive('unsafe',[['../outside-marker','not extracted']])))
  negative('duplicate-entry',()=>list(extractor,archive('duplicate',[['same.txt','a'],['SAME.TXT','b']])))
  negative('missing-file',()=>check('missing-lazy',fixture.filter(([name])=>!name.includes('RecoveryPage'))))
  negative('unexpected-file',()=>check('unexpected',[...fixture,['unowned.exe','extra']]))
  negative('identity-mismatch',()=>check('mismatch',fixture.map(([name,value])=>[name,name==='POS Pro.exe'?'modified program bytes':value])))
  negative('missing-sbom',()=>check('missing-sbom',fixture.filter(([name])=>!name.endsWith('sbom.cdx.json'))))
  const source=path.join(run,'source.txt');fs.writeFileSync(source,'current input');const sourceRow=identity(source,run)
  fs.writeFileSync(source,'stale input');negative('stale-build-inputs',()=>currentIdentities(run,[sourceRow],'input'))
  negative('stale-build-outputs',()=>currentIdentities(positive,expected.map(row=>row.path.includes('RecoveryPage')?{...row,sha256:'0'.repeat(64)}:row),'output'))
  const reference={version:'fixture-1',electronVersion:'44.6.0',sourceRevision:'fixture-source'},receipt={schemaVersion:1,product:'POS Pro',...reference},pkg={version:reference.version,main:'electron/main.js'}
  versionFields(receipt,pkg,reference)
  negative('missing-embedded-receipt',()=>versionFields(null,pkg,reference))
  negative('semantic-version-drift',()=>versionFields(receipt,{...pkg,version:'stale-version'},reference))
  const authorityReport=path.join(run,'envelope-report.json');write(authorityReport,{status:'PASS',payload:expected})
  const current={payload:positive,report:authorityReport},exe=path.join(positive,'POS Pro.exe');runtime.authority(current,exe)
  negative('source-journey-substitution',()=>runtime.authority(current,path.join(run,'source.txt')))
  const state=path.join(run,'new-state');runtime.profile(run,state,true);fs.mkdirSync(state)
  negative('inherited-first-run-state',()=>runtime.profile(run,state,true))
  const duplicateA=zip(fixture),duplicateB=zip(fixture);assert.deepEqual(duplicateA,duplicateB,'deterministic fixture archive drift')
  const report={schemaVersion:1,status:'PASS',positive:'actual ZIP listing/extraction and all file identities match',calibrationLayer:'archive parser, real filesystem inventories, embedded receipt APIs and runtime authority/profile boundaries; full NSIS and actual execution verified separately',negativeControls:outcomes,fixtureArchiveSha256:sha(duplicateA),deterministicFixture:true}
  write(path.join(run,'calibration-report.json'),report);return report
}
module.exports={calibrate,zip,crc32}
