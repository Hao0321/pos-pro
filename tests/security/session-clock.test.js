// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {createSession,getSession,extendSession} from '../../src/utils/security'
beforeEach(()=>sessionStorage.clear())
afterEach(()=>vi.restoreAllMocks())
it('a clock tick during session creation cannot invalidate its own eight-hour session',()=>{
  const base=Date.now();let tick=0;const clock=vi.spyOn(Date,'now').mockImplementation(()=>base+tick++)
  const session=createSession({id:'owner',username:'Owner',role:'owner'});clock.mockRestore()
  expect(session.expiresAt-session.loginAt).toBe(8*60*60*1000)
  expect(getSession()?.userId).toBe('owner')
})
it('an explicit browser-session renewal keeps a valid bounded time window',()=>{
  const base=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(base)
  createSession({id:'owner',username:'Owner',role:'owner'});clock.mockReturnValue(base+1000)
  extendSession();const session=getSession();expect(session?.userId).toBe('owner')
  expect(session.expiresAt-session.loginAt).toBeLessThanOrEqual(8*60*60*1000)
})
