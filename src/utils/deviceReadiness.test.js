import {test,expect,vi} from 'vitest'
import {readOfflineStatus,inspectBrowserDevice,deviceChecks} from './deviceReadiness'
function channel(){return class {constructor(){this.port1={close:vi.fn()};this.port2={close:vi.fn(),peer:this.port1}}}}
const offline={complete:true,reason:'fixture complete'}
test('device readiness measures successful writes separately from persistence permission',async()=>{
  const data=new Map([['existing','sale']]),storage={setItem:(k,v)=>data.set(k,v),getItem:k=>data.get(k),removeItem:k=>data.delete(k)}
  const d=await inspectBrowserDevice({storage,nav:{locks:{request(){}},storage:{persisted:async()=>false}},win:{isSecureContext:true},offlineCheck:async()=>offline})
  expect(d.writable).toBe(true);expect(deviceChecks(d).find(c=>c.id==='retention').status).toBe('review');expect(data).toEqual(new Map([['existing','sale']]))
})
test('quota/security denial does not alter existing sales and is never reported as ready',async()=>{
  const storage={setItem(){throw Error('fixture quota')},getItem(){return 'saved'},removeItem:vi.fn()}
  const d=await inspectBrowserDevice({storage,nav:{locks:{request(){}},storage:{persisted:async()=>true}},win:{isSecureContext:true},offlineCheck:async()=>offline})
  expect(d.writable).toBe(false);expect(deviceChecks(d).find(c=>c.id==='storage').status).toBe('blocked')
})
test('plain LAN HTTP and missing transaction locks remain blocked despite a writable store',()=>{
  expect(deviceChecks({mode:'browser-local',secure:false,transactionLock:false,writable:true,offline}).find(c=>c.id==='transport').status).toBe('blocked')
})
test.each([true,false])('binds offline readiness to a complete current worker response: %s',async complete=>{
  const nav={serviceWorker:{controller:{postMessage(_message,[port]){port.peer.onmessage({data:{type:'POS_OFFLINE_STATUS',version:'pos-pro-'+'a'.repeat(64),total:19,complete}})}}}}
  expect((await readOfflineStatus(nav,channel(),30)).complete).toBe(complete)
})
test('an old/unknown worker response and timeout cannot masquerade as offline ready',async()=>{
  const nav={serviceWorker:{controller:{postMessage(_message,[port]){port.peer.onmessage({data:{type:'POS_OFFLINE_STATUS',version:'old',total:19,complete:true}})}}}}
  expect((await readOfflineStatus(nav,channel(),10)).complete).toBe(false)
  expect((await readOfflineStatus({})).complete).toBe(false)
})
