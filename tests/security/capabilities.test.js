import {test,expect} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {validateCapabilities,REQUIRED_IDS} from '../../scripts/check-capabilities.cjs'
const root=process.cwd(),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version
const read=()=>JSON.parse(fs.readFileSync(path.join(root,'product-capabilities.json'),'utf8'))
test('full goal ledger is valid while refusing to declare the unfinished ERP complete',()=>{const ledger=read(),r=validateCapabilities(ledger,{root,version});expect(r.valid).toBe(true);expect(r.open.length).toBe(REQUIRED_IDS.length);expect(r.complete).toBe(false);expect(validateCapabilities(ledger,{root,version,completion:true}).valid).toBe(false)})
test('missing requirements, duplicate IDs, version drift and incomplete blockers cannot pass the goal gate',()=>{for(const edit of [l=>l.requiredIds.pop(),l=>l.capabilities.pop(),l=>l.capabilities[1].id=l.capabilities[0].id,l=>l.productVersion='0.0.0',l=>l.capabilities.find(c=>c.blocker).blocker.owner='']){const l=read();edit(l);expect(validateCapabilities(l,{root,version}).valid).toBe(false)}})
test('a verified label without evidence, changed evidence or private path cannot close an obligation',()=>{for(const evidence of [undefined,[{path:'.rd/private.json',command:'test',sha256:'a'.repeat(64)}],[{path:'package.json',command:'test',sha256:'a'.repeat(64)}]]){const l=read();l.capabilities[0].status='verified';l.capabilities[0].verification={version,productionSourceSha256:'a'.repeat(64),evidence};expect(validateCapabilities(l,{root,version}).valid).toBe(false)}})
