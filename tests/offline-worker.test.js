import {it,expect} from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import {renderOfflineWorker} from '../scripts/offlineWorker.mjs'

const template=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8')
const version='pos-pro-'+'a'.repeat(64)
const core=['./','./index.html','./assets/application.js','./scenarios/donburi/model.mjs','./i18n/catalogue/display-details.mjs']

it.each([['LF','\n'],['CRLF','\r\n']])('renders the full real worker cache manifest with %s checkout line endings',(_label,newline)=>{
  const input=template.replace(/\r?\n/g,newline),result=renderOfflineWorker(input,version,core)
  expect(result.files).toEqual(core)
  expect(JSON.parse(/^const CORE = (.*)\r?$/m.exec(result.source)[1])).toEqual(core)
  expect(result.source).toContain(JSON.stringify(version))
  expect(result.source).not.toContain('__BUILD_VERSION__')
  expect(()=>new vm.Script(result.source)).not.toThrow()
})

it('accepts a declaration at the end of a template without a final newline',()=>{
  const result=renderOfflineWorker("const VERSION = '__BUILD_VERSION__'\nconst CORE = []",version,core)
  expect(result.files).toEqual(core)
  expect(()=>new vm.Script(result.source)).not.toThrow()
})

it.each([
  ['missing version',template.replace("'__BUILD_VERSION__'",'null')],
  ['duplicate version',template+"\nconst OTHER = '__BUILD_VERSION__'"],
  ['missing cache declaration',template.replace(/^const CORE = [^\r\n]*/m,'const OLD_CORE = []')],
  ['duplicate cache declaration',template+'\nconst CORE = []\n'],
])('fails the build for a %s instead of reporting an uninstalled manifest',(_label,broken)=>{
  expect(()=>renderOfflineWorker(broken,version,core)).toThrow(/exactly one/)
})

it.each([
  ['invalid version','pos-pro-placeholder',core],
  ['empty cache',version,[]],
  ['duplicate cache file',version,['./','./']],
  ['nonlocal cache file',version,['https://example.invalid/application.js']],
])('rejects an %s',(_label,nextVersion,nextCore)=>{
  expect(()=>renderOfflineWorker(template,nextVersion,nextCore)).toThrow(/invalid/)
})
