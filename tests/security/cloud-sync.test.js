import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { browserStorage, writeRecords, readRecords, RECORD_KEY } from '../../src/utils/browserStorage'
const fixture=vi.hoisted(()=>({client:null}))
vi.mock('../../src/utils/supabaseClient',()=>({getSupabase:()=>fixture.client,isCloudEnabled:()=>true}))
import { pushAll, pullAll, SYNC_TABLES } from '../../src/utils/cloudSync'
let map,queries,uploads,authenticated,onRead
beforeEach(()=>{
  map=new Map();queries=[];uploads=[];authenticated=true;onRead=null
  vi.stubGlobal('localStorage',{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)})
  writeRecords({pos2_products:[{id:'p',name:'before',price:10,stock:1}],pos_users:[{id:'private-owner',password:'local-only'}]})
  fixture.client={auth:{getUser:async()=>({data:{user:authenticated?{id:'cloud-owner'}:null}})},from:table=>{
    queries.push(table)
    return {upsert:async rows=>{uploads.push({table,rows});return {}},select:()=>({order:()=>({range:async()=>{
      onRead?.();onRead=null;return {data:table==='products'?[{id:'p',name:'cloud',price:10,stock:2}]:[]}
    }})})}
  }}
})
afterEach(()=>vi.unstubAllGlobals())
test('application sync rejects anonymous identity before any business-table query',async()=>{
  authenticated=false;await expect(pushAll()).rejects.toThrow('禁止匿名');await expect(pullAll()).rejects.toThrow('禁止匿名');expect(queries).toEqual([])
})
test('cloud upload omits employee credential tables and preserves local credentials on pull',async()=>{
  expect(SYNC_TABLES.some(t=>t.cloud==='users')).toBe(false);await pushAll();expect(JSON.stringify(uploads)).not.toContain('local-only')
  await pullAll();expect(readRecords().data.pos_users[0].password).toBe('local-only');expect(readRecords().data.pos2_products[0].name).toBe('cloud')
  expect(map.has('pos_pre_cloud_backup')).toBe(true)
})
test('a local mutation during cloud download cancels replacement and preserves the new local sale state',async()=>{
  onRead=()=>writeRecords({pos2_products:[{id:'p',name:'changed-locally',stock:5}]})
  await expect(pullAll()).rejects.toThrow('本機資料已改變');expect(readRecords().data.pos2_products[0].name).toBe('changed-locally')
})
test('malformed local data is reported instead of uploading empty collections',async()=>{
  map.set(RECORD_KEY,'broken');await expect(pushAll()).rejects.toThrow();expect(uploads).toEqual([])
})
