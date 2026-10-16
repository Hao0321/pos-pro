import {test,expect,vi,afterEach} from 'vitest'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
const require=createRequire(import.meta.url),files=require('../../scripts/delivery/files.cjs'),{download}=require('../../scripts/delivery/tools.cjs'),{outputPath,claim}=require('../../scripts/delivery/build-state.cjs'),{versionFields}=require('../../scripts/delivery/envelope.cjs')
const owned=[]
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'pos-delivery-unit-'));owned.push(root);return root}
afterEach(()=>{vi.unstubAllGlobals();for(const root of owned.splice(0)){if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('pos-delivery-unit-'))throw Error('unsafe test cleanup');fs.rmSync(root,{recursive:true,force:true})}})
test('archive paths reject traversal, Windows devices, alternate streams and ambiguous suffixes',()=>{
 for(const p of ['../a','/root','C:/a','a//b','a/../b','CON.log','a/NUL','a:b','name.','name ','a\u0000b'])expect(()=>files.safePath(p)).toThrow()
 expect(files.safePath('$PLUGINSDIR\\app-64.7z')).toBe('$PLUGINSDIR/app-64.7z')
})
test('a dangling junction is refused even when existsSync follows it and returns false',()=>{
 const root=fixture(),link=path.join(root,'dangling'),target=path.join(root,'missing-target')
 fs.symlinkSync(target,link,'junction');expect(fs.existsSync(link)).toBe(false);expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
 expect(()=>files.noLinks(link)).toThrow(/linked delivery path/)
 expect(()=>files.noLinks(path.join(link,'future-file'))).toThrow(/linked delivery path/)
})
test('archive preflight refuses case duplicates, links, collision and expanded-size abuse',()=>{
 for(const rows of [[{Path:'a'},{Path:'A'}],[{Path:'a','Symbolic Link':'outside'}],[{Path:'a'},{Path:'a/b'}],[{Path:'a',Size:String(1024**3+1)}]])expect(()=>files.validateEntries(rows)).toThrow()
 expect(files.validateEntries([{Path:'a',Folder:'+'},{Path:'a/b',Size:'4'}])).toHaveLength(2)
})
test('closed-world file comparison rejects missing, extra, changed and malformed identities',()=>{
 const row={path:'RecoveryPage-lazy.js',bytes:5,sha256:'a'.repeat(64)}
 files.equalInventory([row],[row])
 for(const actual of [[],[row,{...row,path:'extra'}],[{...row,sha256:'b'.repeat(64)}],[{...row,path:'../outside'}]])expect(()=>files.equalInventory([row],actual)).toThrow()
})
test('current input and native output identities use real bytes rather than file names',()=>{
 const root=fixture(),file=path.join(root,'input');fs.writeFileSync(file,'before');const row=files.identity(file,root)
 files.currentIdentities(root,[row],'input');fs.writeFileSync(file,'after')
 expect(()=>files.currentIdentities(root,[row],'input')).toThrow(/stale/)
})
test('receipt and product versions must agree with the canonical source and runtime',()=>{
 const expected={version:'2.14.1',electronVersion:'44.6.0',sourceRevision:'source'},r={schemaVersion:1,product:'POS Pro',...expected},p={version:expected.version,main:'electron/main.js'}
 versionFields(r,p,expected)
 for(const [receipt,pkg]of [[null,p],[{...r,sourceRevision:'other'},p],[r,{...p,version:'2.14.0'}],[{...r,electronVersion:'other'},p]])expect(()=>versionFields(receipt,pkg,expected)).toThrow()
})
test('pinned tool downloads reject wrong origin, body size and digest before writing or running',async()=>{
 let called=0;vi.stubGlobal('fetch',async()=>{called++;return {ok:true,status:200,body:(async function*(){yield Buffer.from('wrong')})()}})
 await expect(download('https://untrusted.example/tool',{bytes:5,sha256:'0'.repeat(64)})).rejects.toThrow(/origin/);expect(called).toBe(0)
 await expect(download('https://github.com/ip7z/7zip/tool',{bytes:4,sha256:'0'.repeat(64)})).rejects.toThrow(/oversized/)
 await expect(download('https://github.com/ip7z/7zip/tool',{bytes:5,sha256:'0'.repeat(64)})).rejects.toThrow(/digest/)
})
test('tool download redirects cannot switch to an untrusted origin',async()=>{
 vi.stubGlobal('fetch',async()=>({status:302,headers:new Map([['location','https://untrusted.example/tool']])}))
 await expect(download('https://github.com/ip7z/7zip/tool',{bytes:5,sha256:'0'.repeat(64)})).rejects.toThrow(/origin/)
})
test('a build refuses to overwrite a previous generation or escape the release workspace',()=>{
 const root=fixture();fs.mkdirSync(path.join(root,'release'));const output=outputPath(root,null,'2.14.1');expect(output).toBe(path.join(root,'release/2.14.1'))
 fs.mkdirSync(output);fs.writeFileSync(path.join(output,'installer.exe'),'verified generation')
 expect(()=>outputPath(root,null,'2.14.1')).toThrow(/already contains/);expect(()=>outputPath(root,'../outside','2.14.1')).toThrow(/outside/)
 expect(fs.readFileSync(path.join(output,'installer.exe'),'utf8')).toBe('verified generation')
})
test('only one live canonical build owns the workspace and releases only its own lock',()=>{
 const root=fixture(),first=claim(root);expect(()=>claim(root)).toThrow(/still running/);first.release()
 const second=claim(root),file=path.join(root,'.rd/build/canonical-build.lock'),saved=JSON.parse(fs.readFileSync(file));fs.writeFileSync(file,JSON.stringify({...saved,token:'changed'}))
 expect(()=>second.release()).toThrow(/changed/);fs.writeFileSync(file,JSON.stringify(saved));second.release()
})
test('debugging ports use a free dynamic port that Node fetch can actually reach',async()=>{
 const {freePort}=require('../../scripts/delivery/runtime-authority.cjs'),http=require('node:http'),first=await freePort(),port=await freePort([first])
 expect(port).not.toBe(first);expect(port).toBeGreaterThanOrEqual(49152);expect(port).toBeLessThanOrEqual(65535)
 const server=http.createServer((_request,response)=>response.end('owned high-port fixture'))
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
 try{const response=await fetch('http://127.0.0.1:'+port);expect(await response.text()).toBe('owned high-port fixture')}finally{await new Promise(resolve=>server.close(resolve))}
})

test('upgrade arguments reject duplicate or incomplete options and a fixture cannot escape its private root or change identity',()=>{
 const {buildArguments,upgradeFixtures}=require('../../scripts/delivery/build-state.cjs'),root=fixture(),directory=path.join(root,'.rd');fs.mkdirSync(directory)
 expect(buildArguments(['--upgrade-fixtures','.rd/upgrade.json','--out','release/candidate'])).toEqual({'--upgrade-fixtures':'.rd/upgrade.json','--out':'release/candidate'})
 for(const args of [['--out'],['--out','release/a','--out','release/b'],['--publish','yes'],['--out','--upgrade-fixtures']])expect(()=>buildArguments(args)).toThrow(/Usage/)
 const source=path.join(directory,'old.db'),config=path.join(directory,'upgrade.json');fs.writeFileSync(source,'verified closed fixture');const sha256=files.identity(source,directory).sha256,entry={version:'2.15.1',source:'.rd/old.db',sha256};fs.writeFileSync(config,JSON.stringify([entry]));expect(upgradeFixtures(root,'.rd/upgrade.json')).toEqual([{...entry,source}])
 fs.writeFileSync(source+'-wal','open write');expect(()=>upgradeFixtures(root,'.rd/upgrade.json')).toThrow(/closed/);fs.unlinkSync(source+'-wal')
 fs.writeFileSync(source,'changed original');expect(()=>upgradeFixtures(root,'.rd/upgrade.json')).toThrow(/digest/)
 fs.writeFileSync(config,JSON.stringify([{...entry,source:'../outside.db'}]));expect(()=>upgradeFixtures(root,'.rd/upgrade.json')).toThrow(/outside/)
})
