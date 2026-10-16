// @vitest-environment jsdom
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {renderHook,act,waitFor,cleanup} from '@testing-library/react'
import useKitchenPrinting from '../../src/hooks/useKitchenPrinting'

const api=vi.hoisted(()=>({load:vi.fn(),submit:vi.fn(),retry:vi.fn(),pending:vi.fn()}))
vi.mock('../../src/utils/dataAccess',()=>({loadKitchenPrintState:api.load}))
vi.mock('../../src/utils/kitchenPrintClient',()=>({readKitchenPrintPending:api.pending,submitKitchenPrint:api.submit,retryKitchenPrint:api.retry,kitchenPrintErrorMessage:error=>error.message}))
const actor={userId:'owner',role:'owner'},state={protocol:'pos-kitchen-print-state/v1',storeId:'shop',actor,jobs:[]}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
beforeEach(()=>{vi.resetAllMocks();api.load.mockResolvedValue(state);api.pending.mockReturnValue(null)})
afterEach(()=>cleanup())

test('a rejected print stays busy until the coalesced authoritative worklist refresh finishes, and never resubmits during reload',async()=>{
 const source=vi.fn().mockResolvedValue({storeId:'shop'}),{result}=renderHook(()=>useKitchenPrinting(actor,source))
 await waitFor(()=>expect(result.current.sourceReady).toBe(true))
 const first=deferred(),second=deferred();source.mockImplementationOnce(()=>first.promise).mockImplementationOnce(()=>second.promise)
 let loading,joined,action,settled=false
 act(()=>{loading=result.current.reload();joined=result.current.reload();loading.then(()=>{settled=true})})
 expect(joined).toBe(loading)
 await waitFor(()=>expect(source).toHaveBeenCalledTimes(2))
 api.submit.mockRejectedValue(Error('工作單已更新，請重新核對目前餐點。'))
 act(()=>{action=result.current.act({action:'request',entryId:'meal'})})
 await waitFor(()=>expect(api.submit).toHaveBeenCalledTimes(1))
 expect(result.current.busy).toBe(true);expect(result.current.error).toBe('')
 await act(async()=>{first.resolve({storeId:'shop'});await first.promise})
 await waitFor(()=>expect(source).toHaveBeenCalledTimes(3))
 expect(settled).toBe(false);expect(result.current.busy).toBe(true);expect(result.current.error).toBe('')
 await act(async()=>{second.resolve({storeId:'shop'});await action})
 expect(settled).toBe(true);expect(result.current.busy).toBe(false);expect(result.current.sourceReady).toBe(true)
 expect(result.current.error).toBe('工作單已更新，請重新核對目前餐點。');expect(api.submit).toHaveBeenCalledTimes(1);expect(api.retry).not.toHaveBeenCalled()
})

test('an unavailable or different-store source disables current-meal actions until a matching source is read again',async()=>{
 const source=vi.fn().mockResolvedValue({storeId:'shop'}),{result}=renderHook(()=>useKitchenPrinting(actor,source))
 await waitFor(()=>expect(result.current.sourceReady).toBe(true))
 for(const value of [null,{storeId:'replacement-shop'}]){
  source.mockResolvedValue(value)
  await act(async()=>{expect(await result.current.reload()).toBe(false)})
  expect(result.current.sourceReady).toBe(false);expect(result.current.error).toBe('工作單尚未讀取完成，請稍後再試。')
 }
 source.mockResolvedValue({storeId:'shop'})
 await act(async()=>{expect(await result.current.reload()).toBe(true)})
 expect(result.current.sourceReady).toBe(true);expect(result.current.error).toBe('');expect(api.submit).not.toHaveBeenCalled();expect(api.retry).not.toHaveBeenCalled()
})
