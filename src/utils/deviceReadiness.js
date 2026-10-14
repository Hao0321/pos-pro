export async function readOfflineStatus(nav=globalThis.navigator, Channel=globalThis.MessageChannel, timeout=2500) {
  if(!nav?.serviceWorker?.controller || !Channel)return {complete:false,reason:'尚未完成離線準備。連網開啟一次，再重新檢查。'}
  return new Promise(resolve=>{
    const channel=new Channel()
    const finish=value=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value)}
    const timer=setTimeout(()=>finish({complete:false,reason:'離線檢查未收到回覆，請重新檢查。'}),timeout)
    channel.port1.onmessage=e=>{
      const r=e.data
      if(r?.type!=='POS_OFFLINE_STATUS' || !/^pos-pro-[0-9a-f]{64}$/.test(r.version) || !Number.isSafeInteger(r.total) || r.total<4 || typeof r.complete!=='boolean')return
      finish({complete:r.complete,version:r.version,total:r.total,reason:r.complete?'完整程式已保存，可在此裝置離線收銀。':'離線程式有缺漏，請保持連網並重新開啟後檢查。'})
    }
    try{nav.serviceWorker.controller.postMessage({type:'POS_OFFLINE_STATUS'},[channel.port2])}
    catch{finish({complete:false,reason:'無法查詢離線程式，請重新檢查。'})}
  })
}

export async function inspectBrowserDevice({nav=globalThis.navigator,win=globalThis.window,storage=globalThis.localStorage,offlineCheck=()=>readOfflineStatus(nav)}={}) {
  let writable=false,storageError='',persistent=null,offline
  const key='pos-readiness-probe-'+crypto.randomUUID()
  try {storage.setItem(key,'1');writable=storage.getItem(key)==='1';if(!writable)storageError='資料寫入後無法讀回'}
  catch(error){storageError=error.message||'瀏覽器拒絕保存資料'}
  finally{try{storage.removeItem(key)}catch{}}
  try{if(nav?.storage?.persisted)persistent=await nav.storage.persisted()}catch{}
  try{offline=await offlineCheck()}catch{offline={complete:false,reason:'離線程式尚未確認'}}
  return {mode:'browser-local',secure:win?.isSecureContext===true,transactionLock:typeof nav?.locks?.request==='function',writable,storageError,persistent,offline,online:nav?.onLine!==false}
}

export function deviceChecks(device) {
  if(device.mode==='shared-store')return [
    {id:'transport',status:device.secure?'pass':'blocked',title:'店面 HTTPS 連線',detail:device.secure?'此手機使用店面電腦的共同資料庫。':'請先在手機信任這間店的憑證。'},
    {id:'storage',status:device.writable?'pass':'blocked',title:'交易核對紀錄',detail:device.writable?'已實際寫入並讀回。未確認交易的原單號可留在此手機。':'此手機無法保存核對紀錄，請停止收銀。'},
    {id:'shared-connection',status:device.connected?'pass':'blocked',title:'共同資料庫',detail:device.connected?'已從店面電腦讀到資料。':'連不上店面電腦，請先恢復店面網路。'},
    {id:'offline',status:'review',title:'斷線時的保存',detail:'手機須連到店面電腦才能保存。店面外網可中斷；手機與電腦的區網連線須保持。'},
  ]
  if(device.mode==='desktop-local')return [{id:'runtime',status:'pass',title:'桌面本機收銀',detail:'交易存入這台電腦的資料庫；收銀不需要網路。'}]
  return [
    {id:'transport',status:device.secure&&device.transactionLock?'pass':'blocked',title:'安全交易環境',detail:device.secure&&device.transactionLock?'交易鎖可用，避免不同分頁同時改動。':'請使用 HTTPS 的手機網址與支援的瀏覽器；一般區網 HTTP 無法安全收銀。'},
    {id:'storage',status:device.writable?'pass':'blocked',title:'這台裝置能否保存',detail:device.writable?'已實際寫入並讀回測試資料。':device.storageError||'瀏覽器無法保存資料，請停止收銀。'},
    {id:'offline',status:device.offline?.complete?'pass':'review',title:'斷網後能否重開',detail:device.offline?.reason||'離線程式尚未確認'},
    {id:'retention',status:device.persistent===true?'pass':'review',title:'瀏覽器資料保留',detail:device.persistent===true?'瀏覽器已允許持續保存。仍需另存備份檔。':'持續保存未獲允許或無法確認。請下載備份；清除網站資料仍會刪除本機訂單。'},
  ]
}
