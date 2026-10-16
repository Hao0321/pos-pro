// The companion URL always uses the PC database. It never falls back to a browser store.
export const sharedStoreMode=typeof window!=='undefined'&&window.location.protocol==='https:'&&window.location.pathname.startsWith('/shop/')
if(sharedStoreMode&&!window.electronAPI){
  let csrf='',boot,revision=null,stopped=false,polling=false
  const signal=(name,detail)=>window.dispatchEvent(new CustomEvent(name,{detail}))
  async function post(path,body,token=csrf){
    let response
    try{response=await fetch('/api/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-POS-CSRF':token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)})}
    catch{signal('pos-shared-connection',{connected:false});throw Error('連不上店面電腦。已停止保存；恢復連線後請查詢原交易，勿重新收款。')}
    const value=await response.json()
    if(!response.ok){if(response.status===401&&body.method!=='auth:login')signal('pos-shared-auth-expired');throw Error(value.error||'共用店面連線失敗')}
    if(value.storeId){const old=localStorage.getItem('pos_shared_store_id');if(old&&old!==value.storeId&&(localStorage.getItem('pos_pending_checkout_v1')||localStorage.getItem('pos_pending_financial_v1')||localStorage.getItem('pos_pending_kitchen_print_v1')))throw Error('這個網址的店面資料庫已更換。請回到原店面核對未確認交易，勿重送到新店面。');localStorage.setItem('pos_shared_store_id',value.storeId)}
    signal('pos-shared-connection',{connected:true})
    if(value.csrf)csrf=value.csrf
    if(value.revision!=null){if(revision!=null&&revision!==value.revision)signal('pos-store-changed');revision=value.revision}
    return value
  }
  async function initialize(){
    const fragment=new URLSearchParams(location.hash.slice(1)),pair=fragment.get('pair')
    if(pair){history.replaceState(null,'',location.pathname+location.search);await post('pair',{token:pair},'')}
    else await post('bootstrap',{},'')
  }
  async function rpc(method,...args){await(boot||=initialize().catch(e=>{boot=null;throw e}));const response=await post(method==='db:previewRestore'?'backup-preview':'rpc',{method,args});if(method==='auth:session'&&!response.result)signal('pos-shared-auth-expired');return response.result}
  const dbMethods=['rememberAgentMappings','getAgentContext','getProducts','addProduct','updateProduct','deleteProduct','findByBarcode','getMembers','addMember','updateMember','deleteMember','getOrders','getOrderItems','checkout','checkoutReceipt','refundOrder','getCustomerOrders','updateOrderStatus','getSuppliers','addSupplier','updateSupplier','deleteSupplier','getPurchases','addPurchase','updatePurchase','deletePurchase','getPromotions','addPromotion','updatePromotion','deletePromotion','getManualJournal','addManualEntry','deleteManualEntry','getAuditLogs','writeAuditLog','getHeldOrders','addHeldOrder','deleteHeldOrder','getShifts','getOpenShift','openShift','closeShift','getCashLog','addCashLog','getWasteLog','addWaste','getTopups','addTopup','applyInventoryOperation','applyScenarioTemplate','getScenarioTemplateReceipt','getBackups','createBackup','exportData','getStoreSnapshot']
  const db=Object.fromEntries(dbMethods.map(method=>[method,(...args)=>rpc('db:'+method,...args)]))
  db.getExchangeContext=()=>rpc('db:getExchangeContext')
  db.applyExchangeOperation=input=>rpc('db:applyExchangeOperation',input)
  db.getSalesState=()=>rpc('db:getSalesState')
  db.getStockAccountingState=()=>rpc('db:getStockAccountingState')
  db.getStockSalesState=()=>rpc('db:getStockSalesState')
  db.getStockHistory=input=>rpc('db:getStockHistory',input)
  db.exportFullBackup=()=>rpc('db:exportFullBackup')
  db.getProtectedBackups=()=>rpc('db:getProtectedBackups')
  db.getStocktakeState=()=>rpc('db:getStocktakeState')
  db.getStockSetupAccess=()=>rpc('db:getStockSetupAccess')
  db.getStockSetupState=()=>rpc('db:getStockSetupState')
  db.previewStockSetup=input=>rpc('db:previewStockSetup',input)
  db.applyStockSetupOperation=input=>rpc('db:applyStockSetupOperation',input)
  db.getRefundContext=()=>rpc('db:getRefundContext')
  db.previewRefund=input=>rpc('db:previewRefund',input)
  db.applySalesOperation=input=>rpc('db:applySalesOperation',input)
  db.applyCustomerLedgerOperation=input=>rpc('db:applyCustomerLedgerOperation',input)
  db.getSupplierState=()=>rpc('db:getSupplierState')
  db.applySupplierLedgerOperation=input=>rpc('db:applySupplierLedgerOperation',input)
  for(const method of ['getRecoveryState','applyRecoveryOperation','lookupRecoveryOperation','exportRecoverySource','exportRecoveryDiagnostics','previewRestore','applyRestorePreview','lookupRestorePreview'])db[method]=input=>rpc('db:'+method,input)
  db.getRestaurantState=()=>rpc('db:getRestaurantState')
  db.getTableOrderingContext=()=>rpc('db:getTableOrderingContext')
  db.getCustomerIntakeContext=id=>rpc('db:getCustomerIntakeContext',id)
  db.getKitchenPrintState=()=>rpc('db:getKitchenPrintState')
  db.applyKitchenPrintOperation=input=>rpc('db:applyKitchenPrintOperation',input)
  db.applyRestaurantOperation=input=>rpc('db:applyRestaurantOperation',input)
  for(const method of ['migrateFromLocalStorage','importData','restoreBackup','deleteWaste','addOrder','getUsers','addUser','updateUser','deleteUser'])db[method]=async()=>{throw Error('此項管理操作請在店面電腦執行')}
  const unavailable=async()=>{throw Error('此設備操作請在店面電腦執行')}
  window.electronAPI={sharedStore:true,db,
    auth:{list:()=>rpc('auth:list'),session:()=>rpc('auth:session'),login:input=>rpc('auth:login',input),logout:()=>rpc('auth:logout'),setup:unavailable},
    settings:{get:key=>rpc('settings:get',key),getAll:()=>rpc('settings:getAll'),set:(key,value)=>rpc('settings:set',key,value),setMany:values=>rpc('settings:setMany',values)},
    printer:{getStatus:unavailable,printReceipt:unavailable,openCashDrawer:unavailable,testPrint:unavailable},
    barcode:{generate:unavailable,generateLabel:unavailable,printLabels:unavailable},
    server:{getLocalIP:()=>Promise.resolve(location.hostname),getStatus:()=>rpc('server:getStatus')},
    shared:{getStatus:()=>rpc('shared:getStatus')},
    onNewOrder:callback=>{const handler=e=>callback(e.detail);window.addEventListener('pos-customer-order',handler);return()=>window.removeEventListener('pos-customer-order',handler)},
    onStoreChanged:callback=>{window.addEventListener('pos-store-changed',callback);return()=>window.removeEventListener('pos-store-changed',callback)},
  }
  const poll=async()=>{if(stopped||polling||document.visibilityState==='hidden'||!csrf)return;polling=true;try{await rpc('auth:session')}catch{}finally{polling=false}}
  let timer=setInterval(poll,2000)
  window.addEventListener('pagehide',()=>{stopped=true;clearInterval(timer);timer=null})
  window.addEventListener('pageshow',()=>{stopped=false;if(timer==null)timer=setInterval(poll,2000);poll()})
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll()})
  window.addEventListener('online',poll)
  // A QR link opened in an existing PWA tab may be a fragment-only navigation.
  // Reinitialize before admitting any command for the newly paired store.
  window.addEventListener('hashchange',()=>{if(/^[a-f0-9]{64}$/.test(new URLSearchParams(location.hash.slice(1)).get('pair')||''))location.reload()})
}
