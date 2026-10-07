import { test, expect } from 'vitest'
import { validateCloudConfig } from '../../src/utils/supabaseClient'
const key=role=>'fixture.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.fixture'
test('public cloud configuration accepts publishable/anon keys over HTTPS',()=>{
  expect(validateCloudConfig({url:'https://fixture.supabase.co',anonKey:'sb_publishable_fixture'})).toBe(true)
  expect(validateCloudConfig({url:'https://fixture.supabase.co',anonKey:key('anon')})).toBe(true)
})
test.each([key('service_role'),'sb_secret_fixture','invalid'])('privileged or malformed cloud keys are rejected',anonKey=>{
  expect(()=>validateCloudConfig({url:'https://fixture.supabase.co',anonKey})).toThrow('禁止')
})
test.each(['http://fixture.supabase.co','https://user:password@fixture.supabase.co'])('unsafe cloud URL %s is rejected',url=>{
  expect(()=>validateCloudConfig({url,anonKey:'sb_publishable_fixture'})).toThrow('HTTPS')
})
