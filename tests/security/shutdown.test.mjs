import {test,expect} from 'vitest'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {EventEmitter} from 'node:events'
import vm from 'node:vm'
const require=createRequire(import.meta.url),shutdown=require('../../electron/shutdown.cjs')
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('SQLite stays open until both network barriers finish; repeated quit closes it once',async()=>{
  const a=deferred(),b=deferred(),events=[]
  const stop=shutdown({stopServices:()=>[()=>a.promise,()=>b.promise],closeDatabase:()=>events.push('db-close')})
  const first=stop();expect(stop()).toBe(first);a.resolve();await tick();expect(events).toEqual([])
  b.resolve();await first;await stop();expect(events).toEqual(['db-close'])
})
test('failed and synchronous service stops preserve SQLite and can be retried',async()=>{
  let fail=true,closed=0,finished=0
  const stop=shutdown({stopServices:()=>[()=>{if(fail)throw Error('owned socket failure')},async()=>{await tick();finished++}],closeDatabase:()=>closed++})
  await expect(stop()).rejects.toThrow('店面連線');expect(finished).toBe(1);expect(closed).toBe(0)
  fail=false;await stop();expect(closed).toBe(1)
})
test('a failed service inventory is handled without closing SQLite',async()=>{
  let closed=false
  const stop=shutdown({stopServices:()=>{throw Error('inventory unavailable')},closeDatabase:()=>{closed=true}})
  await expect(stop()).rejects.toThrow('inventory unavailable');expect(closed).toBe(false)
})

async function mainFixture({lock=true,fail=false,failPrint=false}={}){
  const gates=[deferred(),deferred(),deferred()],events=[],windows=[]
  const app=new EventEmitter();app.requestSingleInstanceLock=()=>lock;app.getPath=()=>'/isolated-profile'
  app.whenReady=()=>Promise.resolve();app.isPackaged=false
  app.quit=()=>{const event={preventDefault(){this.prevented=true}};app.emit('will-quit',event);events.push(event.prevented?'quit-held':'quit-allowed')}
  class Window extends EventEmitter{
    constructor(){super();windows.push(this);this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.session={setPermissionRequestHandler:()=>{}};this.webContents.send=()=>{}}
    loadFile(){}isDestroyed(){return !!this.destroyed}
  }
  const db={getSetting:()=>3080,close:()=>events.push('db-close')}
  const stubs={electron:{app,BrowserWindow:Window,ipcMain:{},shell:{},dialog:{showErrorBox:()=>events.push('error-visible')}},
    './database':()=>{events.push('db-open');return db},
    './sharedStoreServer.cjs':()=>({stop:()=>{events.push('shared-stop');return gates[0].promise}}),
    './kitchenPrintWorker.cjs':()=>({start:()=>events.push('print-start'),stop:()=>{events.push('print-stop');return failPrint?Promise.reject(Error('print drain failed')):gates[2].promise}}),
    './server':()=>({close:()=>{events.push('order-stop');if(fail)return Promise.reject(Error('close failed'));return gates[1].promise}}),
    './ipcSecurity.cjs':{createIpcSecurity:()=>({current:()=>null})},'./ipcHandlers.cjs':()=>{}}
  const source=readFileSync(new URL('../../electron/main.js',import.meta.url),'utf8')
  vm.runInNewContext(source,{require:name=>Object.hasOwn(stubs,name)?stubs[name]:name==='./shutdown.cjs'?shutdown:require(name),__dirname:'/isolated-app/electron',console:{log(){},error(){}}})
  await tick();return {app,gates,events,windows}
}
test.each(['window-all-closed','global-quit'])('%s actually reaches the main-process cleanup barrier',async route=>{
  const f=await mainFixture();if(route==='global-quit')f.app.quit();else f.app.emit('window-all-closed')
  await tick();expect(f.events).toContain('quit-held');expect(f.events).not.toContain('db-close')
  f.gates[0].resolve();await tick();expect(f.events).not.toContain('db-close')
  f.gates[1].resolve();await tick();expect(f.events).not.toContain('db-close');expect(f.events).toContain('print-stop')
  f.gates[2].resolve();await tick();expect(f.events.filter(x=>x==='db-close')).toHaveLength(1);expect(f.events.at(-1)).toBe('quit-allowed')
})
test('failed main-process cleanup retains the database, returns a window and shows recovery',async()=>{
  const f=await mainFixture({fail:true});f.windows[0].destroyed=true;f.windows[0].emit('closed');f.app.emit('window-all-closed');f.gates[0].resolve();f.gates[2].resolve();await tick();await tick()
  expect(f.events).not.toContain('db-close');expect(f.events).not.toContain('quit-allowed');expect(f.events).toContain('error-visible');expect(f.windows).toHaveLength(2)
})

test('a failed kitchen-worker drain retains SQLite and presents shutdown recovery',async()=>{
  const f=await mainFixture({failPrint:true});f.app.quit();f.gates[0].resolve();f.gates[1].resolve();await tick();await tick()
  expect(f.events).toContain('print-stop');expect(f.events).not.toContain('db-close');expect(f.events).not.toContain('quit-allowed');expect(f.events).toContain('error-visible')
})
test('a rejected second instance never initializes a second SQLite database or services',async()=>{
  const f=await mainFixture({lock:false});expect(f.events).not.toContain('db-open');expect(f.windows).toHaveLength(0)
})
