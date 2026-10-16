import {it,expect} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import messages from '../public/i18n/messages.mjs'
import {ACCOUNTS} from '../src/utils/accounting.js'
it('every system chart-of-accounts name has translations while account codes stay stable',()=>{
  expect(Object.entries(ACCOUNTS).filter(([code,row])=>!/^\d{4}$/.test(code)||!Object.hasOwn(messages,row.name))).toEqual([])
})
it('every directly declared interface translation key has all three translations',()=>{
  const files=['src','public/menu','public/scenarios/donburi'].flatMap(dir=>fs.readdirSync(dir,{recursive:true}).filter(f=>/\.(js|jsx|mjs)$/.test(f)).map(f=>path.join(dir,f)))
  const missing=[]
  for(const file of files){const code=fs.readFileSync(file,'utf8');for(const m of code.matchAll(/\btr\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)){
    const raw=m[1],key=raw[0]==='"'?JSON.parse(raw):JSON.parse('"'+raw.slice(1,-1).replace(/\\'/g,"'").replace(/"/g,'\\"')+'"')
    if(/\p{Script=Han}/u.test(key)&&!Object.hasOwn(messages,key))missing.push({file,key})
  }}expect(missing).toEqual([])
})
it('durable transaction controller messages have all three translations',()=>{
  const missing=[]
  for(const file of ['src/utils/financialCommand.js','src/utils/checkoutCoordinator.mjs']){
    for(const match of fs.readFileSync(file,'utf8').matchAll(/(['"])([^'"\r\n]*[\p{Script=Han}][^'"\r\n]*)\1/gu))
      if(!Object.hasOwn(messages,match[2]))missing.push({file,key:match[2]})
  }
  expect(missing).toEqual([])
})
