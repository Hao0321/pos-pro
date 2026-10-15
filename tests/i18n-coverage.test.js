import {it,expect} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import messages from '../public/i18n/messages.mjs'
it('every directly declared interface translation key has all three translations',()=>{
  const files=['src','public/menu','public/scenarios/donburi'].flatMap(dir=>fs.readdirSync(dir,{recursive:true}).filter(f=>/\.(js|jsx|mjs)$/.test(f)).map(f=>path.join(dir,f)))
  const missing=[]
  for(const file of files){const code=fs.readFileSync(file,'utf8');for(const m of code.matchAll(/\btr\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)){
    const raw=m[1],key=raw[0]==='"'?JSON.parse(raw):JSON.parse('"'+raw.slice(1,-1).replace(/\\'/g,"'").replace(/"/g,'\\"')+'"')
    if(/\p{Script=Han}/u.test(key)&&!Object.hasOwn(messages,key))missing.push({file,key})
  }}expect(missing).toEqual([])
})
