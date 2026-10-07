const {app,BrowserWindow,ipcMain}=require('electron')
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict')
const {pbkdf2Sync}=require('node:crypto')
const temp=process.env.POS_SECURITY_FIXTURE_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'pos-isolated-desktop-'))
app.setPath('userData',temp)
app.disableHardwareAcceleration()
let w,db,mode='normal',acknowledge,checks=0
const rendererPath=path.resolve(__dirname,'../../dist/index.html')
async function js(code){return w.webContents.executeJavaScript(code)}
async function waitFor(expression,label){
  const deadline=Date.now()+10000
  while(Date.now()<deadline){if(await js(expression))return;await new Promise(resolve=>setTimeout(resolve,40))}
  throw new Error('Timed out: '+label+'; '+(await js('document.body.innerText')).slice(0,500))
}
async function click(text){const ok=await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b) return false;b.click();return true})()`);assert.ok(ok,'missing button '+text)}
async function setInput(selector,value){await js(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('missing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
function pass(name){checks++;process.stdout.write('PASS '+name+'\n')}
async function navigatePOS(){await waitFor("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='收銀台')",'navigation');await click('收銀台');await waitFor("document.querySelectorAll('.pos-card').length===1",'product tile')}
async function purchase(){await js("document.querySelector('.pos-card').click()");await waitFor("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='前往結帳 →')",'cart');await click('前往結帳 →');await setInput('input[placeholder="輸入金額"]','100');await click('確認收款')}
app.whenReady().then(async()=>{
  try{
    db=require('../../electron/database.js')(':memory:')
    const proxy=Object.create(db)
    proxy.checkout=(...args)=>{
      const receipt=db.checkout(...args)
      if(mode==='delay')return new Promise(resolve=>{acknowledge=()=>resolve(receipt)})
      if(mode==='lost')throw new Error('Injected lost reply after durable commit')
      return receipt
    }
    w=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{preload:path.resolve(__dirname,'../../electron/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
    w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,cb)=>cb({cancel:true}))
    const security=require('../../electron/ipcSecurity.cjs').createIpcSecurity({db:proxy,getWindow:()=>w,rendererPath})
    require('../../electron/ipcHandlers.cjs')({ipcMain,db:proxy,ipcSecurity:security,getOrderServer:()=>null,getLocalIP:()=> '127.0.0.1'})
    await w.loadFile(rendererPath)
    await waitFor("!!document.querySelector('input[placeholder=\"建立管理員名稱\"]')",'first-owner setup')
    assert.equal(await js("window.electronAPI.db.getProducts().then(()=>false,()=>true)"),true)
    assert.equal(await js("typeof window.require==='undefined' && typeof window.process==='undefined'"),true)
    pass('sandbox preload denies native data before a verified login')
    await setInput('input[placeholder="建立管理員名稱"]','測試管理員');await setInput('input[type="password"]','fixture-password')
    await js("document.querySelector('form').requestSubmit()")
    await waitFor("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='收銀台')",'authenticated app')
    assert.equal(db.getUsers()[0].username,'測試管理員');assert.equal(db.getProducts().length,0)
    pass('actual first-owner form preserves an empty real store without demo sales')
    await js("window.electronAPI.db.addProduct({id:'p',name:'測試商品',price:50,cost:20,stock:5})")
    await js("window.electronAPI.db.openShift({id:'s',cashier:'測試管理員',openCash:100})")
    w.webContents.reload();await waitFor("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='收銀台')",'reload');await navigatePOS()
    mode='delay';await purchase();await waitFor("document.body.innerText.includes('保存中')",'pending acknowledgement')
    assert.equal(db.getOrders().length,1);assert.equal(db.getProducts()[0].stock,4)
    assert.equal(await js("document.body.innerText.includes('結帳完成')"),false)
    await click('確認收款');assert.equal(db.getOrders().length,1)
    acknowledge();await waitFor("document.body.innerText.includes('結帳完成')",'durable checkout completion')
    pass('production cart, preload, IPC and SQLite wait for one acknowledgement and ignore a second click')
    // Reopen the renderer with a committed sale whose reply is lost.
    mode='normal';w.webContents.reload();await waitFor("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='收銀台')",'second reload');await navigatePOS()
    mode='lost';await purchase();await waitFor("document.body.innerText.includes('查詢原交易')",'uncertain sale')
    assert.equal(db.getOrders().length,2);assert.equal(db.getProducts()[0].stock,3)
    mode='normal';w.webContents.reload();await waitFor("document.body.innerText.includes('查詢原交易')",'durable pending journal after reload')
    await click('查詢原交易');await waitFor("!document.body.innerText.includes('查詢原交易')",'reconcile original receipt')
    assert.equal(db.getOrders().length,2);assert.equal(db.getProducts()[0].stock,3)
    pass('lost IPC reply survives renderer reload and reconciles the original sale without another stock deduction')
    const hash=JSON.stringify({salt:Array(32).fill(2),iter:1000,hash:[...pbkdf2Sync('staff-password',Buffer.alloc(32,2),1000,32,'sha256')]})
    db.addUser({id:'staff',username:'員工',role:'staff',password:hash})
    await js("window.electronAPI.auth.logout()")
    const session=await js("window.electronAPI.auth.login({username:'員工',password:'staff-password',role:'owner'})")
    assert.equal(session.role,'staff');assert.equal((await js('window.electronAPI.db.getProducts()')).length,1)
    assert.equal(await js('window.electronAPI.db.getBackups().then(()=>false,()=>true)'),true)
    pass('real IPC retains staff authority despite a forged renderer role and denies backups')
    process.stdout.write(JSON.stringify({success:true,marker:'POS_NATIVE_UI_PASS',tests:checks,electron:process.versions.electron,chrome:process.versions.chrome,sandbox:w.webContents.getLastWebPreferences().sandbox,externalNetwork:false})+'\n')
    app.exit(0)
  }catch(error){process.stderr.write(error.stack+'\n');app.exit(1)}
})
app.on('will-quit',()=>{db?.close();w?.destroy()})
process.on('exit',()=>{
  const resolved=path.resolve(temp),parent=path.resolve(os.tmpdir())
  if(path.dirname(resolved)===parent&&path.basename(resolved).startsWith('pos-isolated-desktop-'))try{fs.rmSync(resolved,{recursive:true,force:true})}catch{}
})
