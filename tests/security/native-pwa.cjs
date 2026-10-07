const {app,BrowserWindow}=require('electron')
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os')
const express=require('express')
const temp=process.env.POS_SECURITY_FIXTURE_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'pos-isolated-pwa-'))
app.setPath('userData',temp);app.disableHardwareAcceleration()
let w,w2,server,checks=0
const js=code=>w.webContents.executeJavaScript(code)
async function waitFor(expression,label){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await js(expression))return;await new Promise(resolve=>setTimeout(resolve,40))}throw new Error('Timed out: '+label+'; '+(await js('document.body.innerText')).slice(0,400))}
async function click(text){assert.ok(await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`),'missing '+text)}
async function input(selector,value){await js(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
const pass=name=>{checks++;process.stdout.write('PASS '+name+'\n')}
app.whenReady().then(async()=>{
  try{
    const http=express();http.use(express.static(path.resolve(__dirname,'../../dist')))
    server=await new Promise((resolve,reject)=>{const s=http.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject)})
    const base='http://127.0.0.1:'+server.address().port+'/'
    w=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}})
    w.webContents.session.webRequest.onBeforeRequest({urls:['https://*/*']},(_d,cb)=>cb({cancel:true}))
    await w.loadURL(base)
    await waitFor("!!document.querySelector('input[placeholder=\"建立管理員名稱\"]')",'browser setup')
    await input('input[placeholder="建立管理員名稱"]','測試管理員');await input('input[type="password"]','fixture-password')
    await js("document.querySelector('form').requestSubmit()")
    await waitFor("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='收銀台')",'browser login')
    assert.equal(await js('typeof window.electronAPI'), 'undefined')
    await js("(()=>{const r=JSON.parse(localStorage.getItem('pos_atomic_records_v1'));r.data.pos2_products=[{id:'p',name:'測試商品',price:50,cost:20,stock:5}];r.data.pos2_shifts=[{id:'s',status:'open'}];r.revision++;localStorage.setItem('pos_atomic_records_v1',JSON.stringify(r))})()")
    await waitFor('navigator.serviceWorker.controller!==null','worker owns complete offline shell')
    assert.equal(await js("caches.keys().then(keys=>keys.some(k=>/^pos-pro-[0-9a-f]{64}$/.test(k)))"),true)
    pass('production browser app installs a content-versioned offline shell with no native bridge')
    w.webContents.session.enableNetworkEmulation({offline:true})
    w.webContents.reload()
    await waitFor("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='收銀台')",'offline reload')
    await click('收銀台');await waitFor("document.querySelectorAll('.pos-card').length===1",'offline catalogue')
    await js("document.querySelector('.pos-card').click()");await click('前往結帳 →');await input('input[placeholder="輸入金額"]','100');await click('確認收款')
    await waitFor("document.body.innerText.includes('結帳完成')",'offline committed receipt')
    const record=await js("JSON.parse(localStorage.getItem('pos_atomic_records_v1'))")
    assert.equal(record.data.pos2_products[0].stock,4);assert.equal(record.data.pos2_orders.length,1)
    pass('real browser checkout commits while network is disabled after an offline reload')
    const session=await js("sessionStorage.getItem('pos_session')")
    w2=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}})
    await w2.loadURL(base)
    await w2.webContents.executeJavaScript(`sessionStorage.setItem('pos_session',${JSON.stringify(session)})`)
    w2.webContents.reload()
    const deadline=Date.now()+10000;let rejected=false
    while(Date.now()<deadline){rejected=await w2.webContents.executeJavaScript("document.body.innerText.includes('另一個 POS 分頁')");if(rejected)break;await new Promise(resolve=>setTimeout(resolve,40))}
    assert.equal(rejected,true);assert.equal((await js("JSON.parse(localStorage.getItem('pos_atomic_records_v1')).data.pos2_orders")).length,1)
    pass('a second actual browser editor is rejected by the Web Lock without overwriting saved sales')
    w2.destroy();w.destroy();await new Promise(resolve=>server.close(resolve))
    process.stdout.write(JSON.stringify({success:true,marker:'POS_PWA_PASS',tests:checks,chrome:process.versions.chrome,offline:true,externalNetwork:false})+'\n')
    app.exit(0)
  }catch(e){process.stderr.write(e.stack+'\n');app.exit(1)}
})
