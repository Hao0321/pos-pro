const https=require('node:https'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {randomBytes,randomUUID,timingSafeEqual}=require('node:crypto')
const {verifyPassword,authorizeActor}=require('./ipcSecurity.cjs')
const snapshot=require('./storeSnapshot.cjs')
const businessKeys=new Set(['pointsEarnRate','pointsRedeemRate','birthdayBonus','dailySalesGoal','storeName','storePhone','storeAddress','receiptFooter'])
const readMethods=['getKitchenPrintState','getProducts','findByBarcode','getMembers','getOrders','getOrderItems','checkoutReceipt','getCustomerOrders','getSuppliers','getPurchases','getPromotions','getManualJournal','getAuditLogs','getHeldOrders','getShifts','getOpenShift','getCashLog','getWasteLog','getTopups','getBackups','exportData','getScenarioTemplateReceipt']
const writeMethods=['applyKitchenPrintOperation','addProduct','updateProduct','deleteProduct','addMember','updateMember','deleteMember','checkout','refundOrder','updateOrderStatus','addSupplier','updateSupplier','deleteSupplier','addPurchase','updatePurchase','deletePurchase','addPromotion','updatePromotion','deletePromotion','addManualEntry','deleteManualEntry','writeAuditLog','addHeldOrder','deleteHeldOrder','openShift','closeShift','addCashLog','addWaste','addTopup','createBackup']
const exposed=new Set([...readMethods,...writeMethods].map(k=>'db:'+k))
const random=()=>randomBytes(32).toString('hex')
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b))
function privateIPv4(host){const n=host.split('.').map(Number);return n.length===4&&n.every((v,i)=>Number.isInteger(v)&&v>=0&&v<=255&&String(v)===host.split('.')[i])&&(n[0]===10||n[0]===192&&n[1]===168||n[0]===172&&n[1]>=16&&n[1]<=31)}
function addresses(){return [...new Set(Object.values(os.networkInterfaces()).flat().filter(i=>i?.family==='IPv4'&&!i.internal&&privateIPv4(i.address)).map(i=>i.address))]}
module.exports=function sharedStore({db,distRoot,certificateRoot,onChanged=()=>{},now=Date.now,allowLoopback=false,stockSetupEnabled=false,orderingStatus=()=>null}){
  let server=null,host='',port=0,cert=null,revision=0,startTask=null,stopTask=null,stopServer=null,stopping=false
  const devices=new Map(),pairs=new Map(),attempts=new Map()
  function storeIdentity(){let id=db.getSetting('sharedStoreId');if(!id){id=randomUUID();db.setSetting('sharedStoreId',id)}return id}
  function changed(){revision++;onChanged()}
  // Every native and companion mutation participates in the same revision stream.
  for(const name of Object.keys(db).filter(k=>/^(add|update|delete|set|apply|rememberAgentMappings$|checkout$|refundOrder$|openShift$|closeShift$|importData$|restoreBackup$|migrateFromLocalStorage$)/.test(k))){
    const original=db[name];db[name]=function(...args){const result=original.apply(db,args);if(result?.success!==false)changed();return result}
  }
  const status=()=>({running:!stopping&&!!server?.listening,addresses:addresses(),host,port,url:!stopping&&server?.listening?`https://${host}:${port}/shop/`:null,fingerprint:cert?.fingerprint||null,validTo:cert?.validTo||null,devices:[...devices].map(([id,d])=>({id,username:d.session?.username||'尚未登入',role:d.session?.role||'',pairedAt:d.pairedAt})),revision})
  function current(device){
    const s=device.session,user=s&&db.getUsers().find(u=>u.id===s.userId)
    if(!user||user.password!==device.credential||user.role!==s.role||now()>=s.expiresAt){device.session=null;device.credential=null}
    return device.session
  }
  function sessionFor(req){const cookie=/\bpos_device=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1],device=devices.get(cookie);if(!device||now()>=device.expiresAt||device.storeId!==storeIdentity()){if(cookie)devices.delete(cookie);throw Object.assign(Error('請在店面電腦產生新連結，重新配對手機'),{status:401})}return device}
  function reply(res,statusCode,value){res.writeHead(statusCode,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))}
  function admit(req){
    const expected=`${host}:${port}`
    if(req.headers.host!==expected)throw Object.assign(Error('店面網址不符'),{status:403})
    if(req.method==='POST'&&(req.headers.origin!==`https://${expected}`||req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))throw Object.assign(Error('拒絕其他網站的請求'),{status:403})
  }
  async function body(req,limit=1024*1024){
    if(req.headers['content-type']!=='application/json')throw Object.assign(Error('請使用 JSON 請求'),{status:415})
    const tooLarge=()=>Object.assign(Error(limit===1024*1024?'請求過大，請分批操作':'備份太大，請保留原檔並在店面電腦核對'),{status:413})
    if(Number(req.headers['content-length'])>limit)throw tooLarge()
    let size=0,chunks=[]
    for await(const chunk of req){size+=chunk.length;if(size>limit)throw tooLarge();chunks.push(chunk)}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  function throttle(req){const id=req.socket.remoteAddress,old=attempts.get(id);if(!old||now()-old.start>60000){attempts.set(id,{start:now(),count:1});return}if(++old.count>10)throw Object.assign(Error('嘗試次數過多，請一分鐘後再試'),{status:429})}
  async function dispatch(device,method,args){
    if(method==='auth:list')return db.getUsers().map(({id,username,role})=>({id,username,role}))
    if(method==='auth:session')return current(device)
    if(method==='auth:logout'){device.session=null;device.credential=null;return true}
    if(method==='auth:login'){
      const input=args[0]||{},user=db.getUsers().find(u=>u.username===input.username)
      if(!user||!['owner','staff'].includes(user.role)||!verifyPassword(input.password,user.password))throw Object.assign(Error('帳號或密碼錯誤'),{status:401})
      if(input.password.length<8)throw Error('請先在店面電腦更新至少 8 字元密碼')
      const grantedAt=now();device.credential=user.password;device.session={userId:user.id,username:user.username,role:user.role,loginAt:grantedAt,expiresAt:grantedAt+8*3600000};return device.session
    }
    const actor=current(device);if(!actor)throw Object.assign(Error('請重新登入店面帳號'),{status:401})
    authorizeActor(db,actor,method,args)
    if(method==='db:getStoreSnapshot')return snapshot(db,actor)
    if(method==='db:getRestaurantState')return db.getRestaurantState()
    if(method==='db:getRestaurantMenuQuote')return db.getRestaurantMenuQuote(args[0],actor)
    if(method==='db:getRestaurantMenuSetupPreview')return db.getRestaurantMenuSetupPreview(args[0],actor)
    if(method==='db:getRestaurantAgentPreview')return db.getRestaurantAgentPreview(args[0],actor)
    if(method==='db:getAgentContext')return db.getAgentContext(actor)
    if(method==='db:getPrivateDraftContext')return db.getPrivateDraftContext(actor)
    if(method==='db:lookupPrivateDraftOriginal')return db.lookupPrivateDraftOriginal(args[0],actor)
    if(method==='db:getExchangeContext')return db.getExchangeContext(actor)
    if(method==='db:applyExchangeOperation')return db.applyExchangeOperation(args[0],actor)
    if(method==='db:getSalesState')return db.getSalesState(actor)
    if(method==='db:getRecoveryState')return db.getRecoveryState(args[0],actor)
    if(method==='db:previewRestore')return db.previewRestore(args[0],actor)
    if(method==='db:applyRestorePreview')return db.applyRestorePreview(args[0],actor)
    if(method==='db:lookupRestorePreview')return db.lookupRestorePreview(args[0],actor)
    if(method==='db:applyRecoveryOperation')return db.applyRecoveryOperation(args[0],actor)
    if(method==='db:lookupRecoveryOperation')return db.lookupRecoveryOperation(args[0],actor)
    if(method==='db:exportRecoverySource')return db.exportRecoverySource(args[0],actor)
    if(method==='db:exportFullBackup')return db.exportFullBackup(actor)
    if(method==='db:getProtectedBackups')return db.getProtectedBackups(actor)
    if(method==='db:getStocktakeState')return db.getStocktakeState(actor)
    if(method==='db:getStockSetupAccess')return {enabled:stockSetupEnabled===true}
    if(method==='db:getStockSetupState'){if(!stockSetupEnabled)throw Error('成本設定尚未開放新保存，請保留原編號核對');return db.getStockSetupState(actor)}
    if(method==='db:previewStockSetup'){if(!stockSetupEnabled)throw Error('成本設定尚未開放新保存，請保留原編號核對');return db.previewStockSetup(args[0],actor)}
    if(method==='db:applyStockSetupOperation')return db.applyStockSetupOperation(args[0],actor,{allowNew:stockSetupEnabled===true})
    if(method==='db:getRefundContext')return db.getRefundContext(actor)
    if(method==='db:previewRefund')return db.previewRefund(args[0],actor)
    if(method==='db:exportRecoveryDiagnostics')return db.exportRecoveryDiagnostics(actor)
    if(method==='db:getStockAccountingState')return db.getStockAccountingState(actor)
    if(method==='db:getStockHistory')return db.getStockHistory(args[0],actor)
    if(method==='db:getStockSalesState')return db.getStockSalesState(actor)
    if(method==='db:applySalesOperation')return db.applySalesOperation(args[0],actor)
    if(method==='db:applyCustomerLedgerOperation')return db.applyCustomerLedgerOperation(args[0],actor)
    if(method==='db:getSupplierState')return db.getSupplierState(actor)
    if(method==='db:applySupplierLedgerOperation')return db.applySupplierLedgerOperation(args[0],actor)
    if(method==='db:rememberAgentMappings')return db.rememberAgentMappings(args[0],actor)
    if(method==='db:applyRestaurantOperation')return db.applyRestaurantOperation(args[0],actor)
    if(method==='db:getTableOrderingContext')return db.getTableOrderingContext(actor)
    if(method==='db:getCustomerIntakeContext')return db.getCustomerIntakeContext(args[0],actor)
    if(method==='db:getKitchenPrintState')return db.getKitchenPrintState(actor)
    if(method==='db:applyKitchenPrintOperation')return db.applyKitchenPrintOperation(args[0],actor)
    if(method==='db:applyInventoryOperation')return db.applyInventoryOperation(args[0],actor)
    if(method==='db:applyScenarioTemplate')return db.applyScenarioTemplate(args[0],actor)
    if(method==='shared:getStatus')return {running:true,host,port,revision,shared:true}
    if(method==='server:getStatus')return orderingStatus()||{running:false,ip:host,port,shared:true}
    if(method==='settings:get'){if(!businessKeys.has(args[0]))throw Error('此項設定請在店面電腦查閱');return db.getSetting(args[0])}
    if(method==='settings:getAll')return Object.fromEntries([...businessKeys].map(k=>[k,db.getSetting(k)]))
    if(method==='settings:set'||method==='settings:setMany'){
      const values=method==='settings:set'?{[args[0]]:args[1]}:args[0]
      if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(k=>!businessKeys.has(k)))throw Error('此項設定請在店面電腦操作')
      return db.setSettings(values)
    }
    if(!exposed.has(method))throw Error('此項操作請在店面電腦執行')
    const name=method.slice(3)
    if(name==='updateProduct'&&Object.hasOwn(args[1]||{},'stock')&&!Object.hasOwn(args[1],'_expectedStock'))throw Error('修改庫存須帶入原庫存，請重新核對')
    if(name==='updateSupplier'&&Object.hasOwn(args[1]||{},'catalog')&&!Object.hasOwn(args[1],'_expectedCatalog'))throw Error('修改貨源須帶入原目錄，請重新核對')
    if(name==='writeAuditLog'){args[0]={...args[0],userId:actor.userId,username:actor.username,role:actor.role}}
    if(name==='getScenarioTemplateReceipt')return db[name](args[0],actor)
    if(name==='checkout')return db.checkout(args[0],args[1],args[2],actor)
    if(name==='refundOrder')return db.refundOrder(args[0],args[1],actor)
    if(['addProduct','addWaste','deleteProduct','addManualEntry','deleteManualEntry'].includes(name))return db[name](args[0],actor)
    if(['updateProduct','updateOrderStatus'].includes(name))return db[name](args[0],args[1],actor)
    return db[name](...args)
  }
  async function handle(req,res){
    try{
      if(stopping)throw Object.assign(Error('店面正在關閉，請稍後重試'),{status:503})
      admit(req)
      const pathname=new URL(req.url,`https://${host}:${port}`).pathname
      if(pathname.startsWith('/api/')){
        if(req.method!=='POST')return reply(res,405,{error:'請使用 POST'})
        const backupPreview=pathname==='/api/backup-preview'
        if(backupPreview){
          // The larger file route is owner-only BEFORE reading its body. Device,
          // CSRF, current credentials and role are checked again after upload.
          const device=sessionFor(req),actor=current(device)
          if(!actor)throw Object.assign(Error('請重新登入店面帳號'),{status:401})
          if(!equal(req.headers['x-pos-csrf'],device.csrf))throw Object.assign(Error('請重新整理以驗證連線'),{status:403})
          authorizeActor(db,actor,'db:previewRestore',[])
        }
        const input=await body(req,backupPreview?64*1024*1024+65536:1024*1024)
        if(stopping)throw Object.assign(Error('店面正在關閉，請稍後重試'),{status:503})
        if(!input||typeof input!=='object'||Array.isArray(input))throw Error('請求格式錯誤')
        if(pathname==='/api/pair'){
          throttle(req)
          const expiry=typeof input.token==='string'?pairs.get(input.token):null
          if(!expiry||now()>expiry)throw Object.assign(Error('配對連結已失效，請在電腦重新產生'),{status:401})
          if(devices.size>=50)throw Error('配對裝置已滿，請在電腦撤銷不用的裝置')
          pairs.delete(input.token);const id=random(),device={storeId:storeIdentity(),csrf:random(),pairedAt:now(),expiresAt:now()+86400000,session:null,credential:null};devices.set(id,device)
          res.setHeader('Set-Cookie',`pos_device=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`)
          return reply(res,200,{success:true,csrf:device.csrf,revision,storeId:device.storeId})
        }
        const device=sessionFor(req)
        if(pathname==='/api/bootstrap')return reply(res,200,{success:true,csrf:device.csrf,revision,storeId:device.storeId})
        if(!equal(req.headers['x-pos-csrf'],device.csrf))throw Object.assign(Error('請重新整理以驗證連線'),{status:403})
        if(!['/api/rpc','/api/backup-preview'].includes(pathname)||typeof input.method!=='string'||!Array.isArray(input.args)||input.args.length>4||backupPreview&&(input.method!=='db:previewRestore'||input.args.length!==1))throw Error('請求格式錯誤')
        if(input.method==='auth:login')throttle(req)
        const result=await dispatch(device,input.method,input.args)
        return reply(res,200,{result,revision,storeId:device.storeId})
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return reply(res,405,{error:'方法不支援'})
      if(pathname==='/certificate.cer'){res.writeHead(200,{'Content-Type':'application/pkix-cert','Content-Disposition':'attachment; filename="POS-Store.cer"','Cache-Control':'no-store'});return res.end(cert.certificate)}
      if(pathname==='/'){res.writeHead(302,{Location:'/shop/'});return res.end()}
      let relative=decodeURIComponent(pathname.replace(/^\/shop\//,'/')).replace(/^\//,'')
      if(!relative||relative==='index.html')relative='index.html'
      if(relative.split('/').some(p=>!p||p==='.'||p==='..')||relative.includes('\\')||relative.includes(':'))throw Object.assign(Error('頁面不存在'),{status:404})
      const root=path.resolve(distRoot),file=path.resolve(root,relative)
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile())throw Object.assign(Error('頁面不存在'),{status:404})
      const ext=path.extname(file),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'}[ext]
      if(!mime)throw Object.assign(Error('檔案不存在'),{status:404})
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"})
      if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res)
    }catch(error){if(!res.headersSent)reply(res,error.status||400,{error:error.message});else res.destroy()}
  }
  return {
    status,changed,
    start(input={}){
      if(stopTask)return Promise.reject(Error('共用店面正在停止，請稍後再啟動'))
      if(startTask)return startTask
      stopping=false
      startTask=(async()=>{
      if(server?.listening)return status()
      const selected=input.host
      if(!(allowLoopback&&selected==='127.0.0.1')&&!addresses().includes(selected))throw Error('請選擇這台電腦目前的私人網路位址')
      const requested=input.port??3443
      if(!Number.isInteger(requested)||requested< (allowLoopback?0:1024)||requested>65535)throw Error('連接埠需介於 1024 到 65535')
      cert=require('./sharedCertificate.cjs')(path.join(certificateRoot,selected),selected);host=selected
      const candidate=https.createServer({pfx:cert.pfx,passphrase:cert.passphrase,minVersion:'TLSv1.2'},handle)
      const stopCandidate=require('./serverShutdown.cjs')(candidate)
      candidate.requestTimeout=20000;candidate.headersTimeout=10000;candidate.keepAliveTimeout=5000
      try{await new Promise((resolve,reject)=>{candidate.once('error',reject);candidate.listen(requested,host,resolve)})}
      catch(error){await stopCandidate();throw error}
      server=candidate;stopServer=stopCandidate;port=server.address().port
      if(stopping)throw Error('共用店面已取消啟動')
      return status()
      })().finally(()=>{startTask=null})
      return startTask
    },
    stop(){
      if(stopTask)return stopTask
      stopping=true;pairs.clear();devices.clear()
      stopTask=(async()=>{
        if(startTask)await startTask.catch(()=>{})
        if(server){await stopServer();server=null;stopServer=null}
        return status()
      })().finally(()=>{stopTask=null})
      return stopTask
    },
    pair(){if(stopping||!server?.listening)throw Error('請先啟動共用店面');for(const [token,expiry]of pairs)if(now()>expiry)pairs.delete(token);if(pairs.size>=50)throw Error('請先使用或等待現有配對連結失效');const token=random();pairs.set(token,now()+300000);return {url:`https://${host}:${port}/shop/#pair=${token}`,expiresAt:now()+300000,fingerprint:cert.fingerprint}},
    revoke(id){devices.delete(id);return status()},
    certificate(){if(!cert)throw Error('請先啟動共用店面');return cert.certificate.toString('base64')},
  }
}
