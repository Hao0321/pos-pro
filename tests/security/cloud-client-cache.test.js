import {beforeEach,afterEach,expect,test,vi} from 'vitest'
const sdk=vi.hoisted(()=>({createClient:vi.fn()}))
vi.mock('@supabase/supabase-js',()=>({createClient:sdk.createClient}))
import {getCloudConfig,isCloudEnabled} from '../../src/utils/cloudConfig'
import {saveCloudConfig,clearCloudConfig,getSupabase} from '../../src/utils/supabaseClient'

beforeEach(()=>{
 const values=new Map()
 vi.stubGlobal('localStorage',{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)})
 clearCloudConfig();sdk.createClient.mockReset();sdk.createClient.mockImplementation((url,key)=>({url,key}))
})
afterEach(()=>vi.unstubAllGlobals())

test('reading configured cloud status does not create a client or contact the provider',()=>{
 saveCloudConfig({url:'https://fixture.supabase.co',anonKey:'sb_publishable_fixture'})
 expect(isCloudEnabled()).toBe(true);expect(getCloudConfig().url).toBe('https://fixture.supabase.co');expect(sdk.createClient).not.toHaveBeenCalled()
})
test('explicit client access reuses the client until saved configuration changes',()=>{
 saveCloudConfig({url:'https://first.supabase.co',anonKey:'sb_publishable_first'})
 const first=getSupabase();expect(getSupabase()).toBe(first);expect(sdk.createClient).toHaveBeenCalledTimes(1)
 saveCloudConfig({url:'https://second.supabase.co',anonKey:'sb_publishable_second'})
 expect(getSupabase()).not.toBe(first);expect(sdk.createClient).toHaveBeenCalledTimes(2);expect(getSupabase().url).toBe('https://second.supabase.co')
})
test('clearing cloud settings discards the previous client without creating another',()=>{
 saveCloudConfig({url:'https://fixture.supabase.co',anonKey:'sb_publishable_fixture'});getSupabase();clearCloudConfig()
 expect(getCloudConfig()).toBe(null);expect(isCloudEnabled()).toBe(false);expect(getSupabase()).toBe(null);expect(sdk.createClient).toHaveBeenCalledTimes(1)
})
test('rejected privileged credentials preserve the existing validated settings and client',()=>{
 saveCloudConfig({url:'https://fixture.supabase.co',anonKey:'sb_publishable_fixture'});const client=getSupabase()
 expect(()=>saveCloudConfig({url:'https://fixture.supabase.co',anonKey:'sb_secret_fixture'})).toThrow('禁止')
 expect(getCloudConfig().anonKey).toBe('sb_publishable_fixture');expect(getSupabase()).toBe(client);expect(sdk.createClient).toHaveBeenCalledTimes(1)
})
