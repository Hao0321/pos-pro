// @vitest-environment jsdom
import {afterEach,test,expect,vi} from 'vitest'
import {render,screen,fireEvent,act,cleanup} from '@testing-library/react'
import SharedDevicesPage from '../../src/pages/SharedDevicesPage'
vi.mock('../../src/utils/dataAccess',()=>({isElectron:true,isSharedStore:false}))
afterEach(()=>{cleanup();vi.useRealTimers();delete window.electronAPI})
test('a departed network address is replaced before starting a shared store',async()=>{
  vi.useFakeTimers();let addresses=['192.168.1.10'];const start=vi.fn(async input=>({running:true,host:input.host,port:3443,url:'https://'+input.host+':3443/shop/',devices:[],addresses,fingerprint:'fixture'}))
  window.electronAPI={shared:{getStatus:async()=>({running:false,addresses,devices:[]}),start}}
  render(<SharedDevicesPage/>);await act(async()=>{})
  addresses=['192.168.1.20'];await act(async()=>{await vi.advanceTimersByTimeAsync(5000)})
  await act(async()=>fireEvent.click(screen.getByText('啟動共用店面')))
  expect(start).toHaveBeenCalledWith({host:'192.168.1.20',port:3443})
})
