import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {applyBrowserTemplate} from './scenarioTemplates'
import {readRecords,writeRecords} from './browserStorage'
import {prepareScenarioTemplate} from '../../electron/scenarioTemplateRules.mjs'

const owner={role:'owner'},request=()=>({templateId:'donburi-takeaway-v1',operationId:'scenario_fixture_0001',items:{pork:{price:95,cost:40,stock:12},beef:{price:115,cost:50,stock:12},tea:{price:10,cost:4,stock:24}}})
let saved
beforeEach(()=>{saved=new Map();vi.stubGlobal('localStorage',{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)});localStorage.setItem('pos2_products',JSON.stringify([{id:'grocer',name:'原商品',price:30,cost:15,stock:5}]))})
afterEach(()=>vi.unstubAllGlobals())
describe('first scenario template admission and atomic browser save',()=>{
  it('adds ordinary donburi and tea while preserving the existing shop and known costs',()=>{
    const receipt=applyBrowserTemplate(request(),owner),data=readRecords().data
    expect(receipt.success).toBe(true);expect(data.pos2_products).toHaveLength(4)
    expect(data.pos2_products[0]).toEqual({id:'grocer',name:'原商品',price:30,cost:15,stock:5})
    expect(data.pos2_products.find(p=>p.id.endsWith('pork')).name).toBe('日式豬肉丼')
    expect(prepareScenarioTemplate(request()).template.products[0].recipe).not.toHaveProperty('egg')
  })
  it('replays the same receipt after records are reread without restoring stock sold later',()=>{
    const input=request(),first=applyBrowserTemplate(input,owner),current=readRecords()
    writeRecords({pos2_products:current.data.pos2_products.map(p=>p.id.endsWith('pork')?{...p,stock:11}:p)},current.revision)
    const revision=readRecords().revision
    expect(applyBrowserTemplate(input,owner)).toEqual(first);expect(readRecords().revision).toBe(revision)
    expect(readRecords().data.pos2_products.find(p=>p.id.endsWith('pork')).stock).toBe(11)
    expect(()=>applyBrowserTemplate({...input,items:{...input.items,pork:{...input.items.pork,price:1}}},owner)).toThrow(/已套用/)
  })
  it('retains all old records when quota rejects the single atomic save',()=>{
    const before=readRecords();localStorage.setItem=()=>{throw Error('fixture quota')}
    expect(()=>applyBrowserTemplate(request(),owner)).toThrow(/quota/);expect(readRecords()).toEqual(before)
  })
  it('rejects occupied catalogue IDs before adding any other template item',()=>{
    localStorage.setItem('pos2_products',JSON.stringify([{id:'tpl_donburi_v1_beef',name:'自訂品項',price:35,cost:12,stock:7}]))
    const before=readRecords();expect(()=>applyBrowserTemplate(request(),owner)).toThrow(/編號已存在/);expect(readRecords()).toEqual(before)
  })
  it('requires owner authority and does not silently turn absent costs into zero',()=>{
    expect(()=>applyBrowserTemplate(request(),{role:'staff'})).toThrow(/管理員/)
    for(const value of [null,undefined,'',NaN,-1]){const input=request();input.items.beef.cost=value;expect(()=>applyBrowserTemplate(input,owner)).toThrow()}
    expect(readRecords().data.pos2_products).toHaveLength(1)
  })
  it('rejects omitted, unknown or fractional catalogue rows as one failed operation',()=>{
    const missing=request();delete missing.items.tea;expect(()=>applyBrowserTemplate(missing,owner)).toThrow(/全部品項/)
    const fractional=request();fractional.items.pork.stock=1.5;expect(()=>applyBrowserTemplate(fractional,owner)).toThrow(/整數/)
    expect(()=>applyBrowserTemplate({...request(),templateId:'unknown'},owner)).toThrow(/不存在/)
    expect(readRecords().data.pos2_products).toHaveLength(1)
  })
})
