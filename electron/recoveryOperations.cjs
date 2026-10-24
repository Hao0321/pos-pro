const {randomUUID,createHash}=require('node:crypto')
const {canonicalSignature}=require('./operationRules.mjs')
const {signature:checkoutSignature,PROTOCOL}=require('./checkoutContract.cjs')
const {refundSignature}=require('./refundSafety.cjs')
const {RECOVERY_PROTOCOL,recoveryStoreId,materialSignature,protectedRestoreBook,recoverySummary,operationRecords,pendingOperation,originalMatches,recoveryOperationId}=require('./recoveryRules.mjs')
const {createCompleteBackup,readPortableBackup,backupProtectionSummary}=require('./backupEnvelope.mjs')
const {convertLogicalBook}=require('./storageConversion.mjs')
const {bookToBrowser}=require('./recoveryRules.mjs')
const {mergeRecoveryGraphs,validateRecoveryGraph}=require('./recoveryGraph.mjs')
const {recoveryBook,recoveryBoundaryMatches,retainRecoveryFeatures}=require('./recoveryBook.mjs')
const {STOCK_COMPAT_SETTING}=require('./stockCompatibility.mjs')
const sha=value=>createHash('sha256').update(typeof value==='string'?value:canonicalSignature(value)).digest('hex')
const proof={checkoutSignature,refundSignature}

module.exports=function installRecovery(db,api,replaceAllTx,recordShapes){
  db.exec(`CREATE TABLE IF NOT EXISTS recovery_snapshots (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor_id TEXT NOT NULL, store_id TEXT NOT NULL,
    data TEXT NOT NULL, sha256 TEXT NOT NULL, after_material TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_original_ids (method TEXT NOT NULL, operation_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL, PRIMARY KEY(method,operation_id,snapshot_id));
    CREATE TABLE IF NOT EXISTS recovery_previews (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_events (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL,
      signature TEXT NOT NULL, receipt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_source_formats (snapshot_id TEXT PRIMARY KEY, storage TEXT NOT NULL CHECK(storage IN ('sqlite','browser')));`)
  const insertIndex=db.prepare('INSERT OR IGNORE INTO recovery_original_ids VALUES (?,?,?)')
  const graphStore=require('./recoveryGraphStorage.cjs')(db),graphOptions=graphStore.options
  function retainFeatures(book,features){return retainRecoveryFeatures(book,features)}
  const material=book=>sha(materialSignature(book))
  const owner=actor=>{
    if(actor?.role!=='owner'||!api.getUsers().some(user=>user.id===actor.userId&&user.role==='owner'&&user.username===actor.username))throw Error('權限不足')
    return actor
  }
  const internalActor=()=>{const user=api.getUsers().find(u=>u.role==='owner');return {role:'owner',userId:user?.id||'internal-local-system',username:user?.username||''}}
  function prior(id,signature,actor){
    const old=db.prepare('SELECT * FROM recovery_events WHERE id=?').get(id)
    if(!old)return null
    if(old.signature!==signature||old.actor_id!==actor.userId&&actor.role!=='owner')throw Error('復原編號已存在且內容不同')
    return JSON.parse(old.receipt)
  }
  function replace(id,source,expectedRevision,actor,signature,extra={},transfer=null){
    const old=prior(id,signature,actor);if(old)return old
    const current=api.exportData()
    if(current._revision!==expectedRevision)throw Error('帳本已更新，請重新查看還原預覽')
    if(transfer?.expectedProtectionRevision&&transfer.expectedProtectionRevision!==graphStore.revision())throw Error('帳本已更新，請重新查看還原預覽')
    if(transfer?.protection)mergeRecoveryGraphs(graphStore.read(),transfer.protection,'sqlite',graphOptions)
    const features=[...new Set([...graphStore.features(),...(transfer?.features||[])])],next=retainFeatures(protectedRestoreBook(current,source),features),snapshotId='rescue-'+randomUUID(),data=JSON.stringify(current)
    // This outer transaction contains the preimage, history fence, replacement,
    // sales epoch and the immutable acknowledgement. A late failure rolls all back.
    db.prepare('INSERT INTO recovery_snapshots VALUES (?,?,?,?,?,?,?)').run(snapshotId,new Date().toISOString(),actor.userId,recoveryStoreId(current),data,sha(data),'pending')
    for(const record of operationRecords(current))insertIndex.run(record.method,record.id,snapshotId)
    replaceAllTx(next)
    recordShapes.capture(next,recordShapes.raw(()=>api.exportData()))
    const restored=api.exportData()
    db.prepare('UPDATE recovery_snapshots SET after_material=? WHERE id=?').run(material(restored),snapshotId)
    const receipt={protocol:RECOVERY_PROTOCOL,success:true,id,sourceId:snapshotId,revision:restored._revision,storeId:recoveryStoreId(restored),...extra}
    db.prepare('INSERT INTO recovery_events VALUES (?,?,?,?)').run(id,actor.userId,signature,JSON.stringify(receipt))
    if(transfer?.protection)graphStore.merge(transfer.protection)
    graphStore.install(features)
    return receipt
  }
  function preview(input,actor){
    if(!input||!['backup','import','protected'].includes(input.kind))throw Error('還原來源不正確')
    const current=api.exportData()
    let data,label
    if(input.kind==='backup'){
      const backup=db.prepare('SELECT data,label FROM backups WHERE id=?').get(input.id)
      if(!backup)throw Error('備份不存在')
      data=JSON.parse(backup.data);label=backup.label
    }else if(input.kind==='protected'){
      const source=readSource(input.id)
      if(source.store_id!==recoveryStoreId(current))throw Error('店面不符')
      if(!recoveryBoundaryMatches(source.after_material,current,'sqlite',graphStore.digest,source.storage))throw Error('還原後已有新的營運資料')
      data=api.exportRecoverySource(input.id,actor);label='還原前的副本'
    }else{data=input.data;label='匯入備份'}
    if(Buffer.byteLength(JSON.stringify(data),'utf8')>64*1024*1024)throw Error('備份太大，請保留原檔並在店面電腦核對')
    const incoming=readPortableBackup(data,'sqlite',graphOptions),target=retainFeatures(protectedRestoreBook(current,incoming.book),incoming.features),id='restore-'+randomUUID(),now=Date.now(),currentGraph=graphStore.read()
    recordShapes.assertSupported(target)
    if(incoming.protection)mergeRecoveryGraphs(currentGraph,incoming.protection,'sqlite',graphOptions)
    const transfer={protection:incoming.protection,features:incoming.features,expectedProtectionRevision:graphStore.digest(currentGraph)}
    db.prepare('DELETE FROM recovery_previews WHERE json_extract(data,\'$.expiresAt\')<?').run(now)
    if(db.prepare('SELECT count(*) AS n FROM recovery_previews p WHERE NOT EXISTS (SELECT 1 FROM recovery_events e WHERE e.id=p.id)').get().n>=20)throw Error('還原預覽過多，請稍後再試')
    const row={id,actorId:actor.userId,kind:input.kind,backupId:input.id||null,label,expectedRevision:current._revision,
      targetHash:sha({target,transfer}),target,transfer,protectionSummary:backupProtectionSummary(incoming),storeId:recoveryStoreId(target),originStoreId:recoveryStoreId(current),expiresAt:now+15*60*1000}
    db.prepare('INSERT INTO recovery_previews VALUES (?,?)').run(id,JSON.stringify(row))
    return {protocol:RECOVERY_PROTOCOL,id,label,kind:row.kind,backupId:row.backupId,expectedRevision:current._revision,storeId:row.storeId,originStoreId:row.originStoreId,
      current:recoverySummary(current),target:recoverySummary(target),protection:row.protectionSummary,expiresAt:row.expiresAt}
  }
  function confirm(previewId,actor){
    const signature=canonicalSignature({kind:'restore-preview',previewId})
    return db.transaction(()=>{
      const old=prior(previewId,signature,actor);if(old)return old
      const saved=db.prepare('SELECT data FROM recovery_previews WHERE id=?').get(previewId)
      if(!saved)throw Error('還原預覽已失效，請重新查看')
      const row=JSON.parse(saved.data)
      if(row.actorId!==actor.userId||row.expiresAt<Date.now()||sha({target:row.target,transfer:row.transfer})!==row.targetHash)throw Error('還原預覽已失效，請重新查看')
      return replace(previewId,row.target,row.expectedRevision,actor,signature,{},row.transfer)
    })()
  }
  function readSource(id){
    const row=db.prepare('SELECT * FROM recovery_snapshots WHERE id=?').get(id)
    if(!row)throw Error('保護副本需要核對，原資料已保留')
    const storage=db.prepare('SELECT storage FROM recovery_source_formats WHERE snapshot_id=?').get(id)?.storage||'sqlite',data=JSON.parse(row.data)
    if((storage==='sqlite'?sha(row.data):canonicalSignature(data))!==row.sha256)throw Error('保護副本需要核對，原資料已保留')
    return {...row,storage,book:recoveryBook(data,storage,graphOptions).book}
  }
  api.previewRestore=(input,actor)=>preview(input,owner(actor))
  api.applyRestorePreview=(previewId,actor)=>confirm(previewId,owner(actor))
  api.lookupRestorePreview=(previewId,actor)=>{
    owner(actor);const receipt=prior(previewId,canonicalSignature({kind:'restore-preview',previewId}),actor)
    return {protocol:RECOVERY_PROTOCOL,success:true,id:previewId,found:!!receipt,receipt}
  }
  api.restoreBackup=(id,options,actor)=>{
    if(actor){
      owner(actor);if(!options?.previewId)throw Error('請先查看還原預覽')
      const saved=db.prepare('SELECT data FROM recovery_previews WHERE id=?').get(options.previewId),row=saved&&JSON.parse(saved.data)
      if(row?.kind!=='backup'||row.backupId!==id)throw Error('還原預覽與備份不符')
      return confirm(options.previewId,actor)
    }
    // Private native callers retain their synchronous interface. Renderer/RPC
    // callers always receive a verified actor and must use an explicit preview.
    const trusted=internalActor();return confirm(preview({kind:'backup',id},trusted).id,trusted)
  }
  api.importData=(data,expectedRevision,actor)=>{
    if(actor){owner(actor);if(!expectedRevision)throw Error('請先查看還原預覽')}
    if(!data||typeof data!=='object'||Array.isArray(data)||!Object.values(data).some(Array.isArray))throw Error('備份格式錯誤')
    return db.transaction(()=>{
      const current=api.exportData();if(expectedRevision&&expectedRevision!==current._revision)throw Error('本機資料已改變，已取消覆蓋')
      if(require('./stockCompatibility.mjs').hasStockCostHistory(current)||require('./stockCompatibility.mjs').hasStockCostHistory(data))throw Error('成本帳請使用完整備份還原預覽，不能部分同步')
      if(graphStore.features().includes('cross-storage-v1'))throw Error('保護紀錄請使用完整備份搬移，不能部分同步；手機共用店面可照常使用。')
      const who=actor||internalActor(),id='import-'+randomUUID()
      // The legacy cloud projection imports named collections. Full backup/file
      // restores use previewRestore instead and replace the complete business book.
      const projected={...current,...data,salesDocuments:data.salesDocuments??[],salesOperations:data.salesOperations??[],customerEntries:data.customerEntries??[],customerOperations:data.customerOperations??[],supplierEntries:data.supplierEntries??[],supplierOperations:data.supplierOperations??[]}
      return replace(id,projected,current._revision,who,canonicalSignature({kind:'import',id,hash:sha(data)}))
    })()
  }
  api.getRecoveryState=(pending,actor)=>{
    owner(actor);const operation=pendingOperation(pending),current=api.exportData(),revision=sha({book:current._revision,protection:graphStore.revision()})
    const records=operationRecords(current),active=records.find(row=>row.method===operation.method&&row.id===operation.id)
    const rows=db.prepare(`SELECT s.id FROM recovery_snapshots s JOIN recovery_original_ids i ON i.snapshot_id=s.id
      WHERE i.method=? AND i.operation_id=? ORDER BY s.created_at DESC,s.id DESC`).all(operation.method,operation.id)
    const sources=rows.map(({id})=>{
      const source=readSource(id),record=operationRecords(source.book).find(row=>row.method===operation.method&&row.id===operation.id)
      const matches=!!record&&originalMatches(record,operation,proof),sameStore=source.store_id===recoveryStoreId(current)
      const unchanged=recoveryBoundaryMatches(source.after_material,current,'sqlite',graphStore.digest,source.storage)
      return {id:source.id,createdAt:source.created_at,operationId:operation.id,matches,canRecover:!active&&matches&&sameStore&&unchanged,
        reason:active?'目前帳本已有這個原編號':!matches?'原編號內容不同':!sameStore?'店面不符':!unchanged?'還原後已有新的營運資料':'可以找回原紀錄',summary:recoverySummary(source.book)}
    })
    return {protocol:RECOVERY_PROTOCOL,operationId:operation.id,storeId:recoveryStoreId(current),revision,summary:recoverySummary(current),
      active:active?originalMatches(active,operation,proof)?'matched':'different':'missing',sources}
  }
  api.applyRecoveryOperation=(input,actor)=>{
    owner(actor)
    if(typeof input?.id!=='string'||!/^recovery-[A-Za-z0-9_-]{1,128}$/.test(input.id)||typeof input.sourceId!=='string'||typeof input.expectedRevision!=='string')throw Error('復原請求需要核對')
    const signature=canonicalSignature(input)
    return db.transaction(()=>{
      const old=prior(input.id,signature,actor);if(old)return old
      const state=api.getRecoveryState(input.pending,actor),source=state.sources.find(row=>row.id===input.sourceId)
      if(state.revision!==input.expectedRevision)throw Error('帳本已更新，請重新核對復原內容')
      if(!source?.canRecover)throw Error('已有新資料或原編號內容不符，請保留兩份帳本核對')
      const saved=readSource(source.id)
      return replace(input.id,convertLogicalBook(saved.book,saved.storage,'sqlite'),api.exportData()._revision,actor,signature,{restoredSourceId:source.id,originalOperationId:state.operationId})
    })()
  }
  api.lookupRecoveryOperation=(input,actor)=>{
    owner(actor);const receipt=prior(input?.id,canonicalSignature(input),actor)
    return {protocol:RECOVERY_PROTOCOL,success:true,id:input.id,found:!!receipt,receipt}
  }
  api.exportFullBackup=actor=>{if(actor)owner(actor);return db.transaction(()=>createCompleteBackup(api.exportData(),graphStore.read(),'sqlite',{...graphOptions,features:graphStore.features()}))()}
  api.getProtectedBackups=actor=>{owner(actor);return db.transaction(()=>{
    const current=api.exportData(),graph=validateRecoveryGraph(graphStore.read(),'sqlite',graphOptions)
    return [...graph.snapshots.values()].map(row=>{const sameStore=row.storeId===recoveryStoreId(current),unchanged=recoveryBoundaryMatches(row.afterMaterial,current,'sqlite',graphStore.digest,row.source.storage);return {id:row.id,createdAt:row.createdAt,summary:recoverySummary(row.source.book),canRestore:sameStore&&unchanged,reason:!sameStore?'店面不符':!unchanged?'還原後已有新的營運資料':'可以找回原紀錄'}}).sort((a,b)=>Number(b.canRestore)-Number(a.canRestore)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))
  })()}
  api.exportRecoverySource=(id,actor)=>{owner(actor);return db.transaction(()=>{const saved=readSource(id),book=saved.storage==='browser'?bookToBrowser(saved.book):saved.book;return createCompleteBackup(book,graphStore.read(),saved.storage,{...graphOptions,features:graphStore.features()})})()}
  api.exportRecoveryDiagnostics=actor=>{
    owner(actor)
    // Read raw rows without parsing the damaged business or recovery JSON.
    // Explicitly diagnostic: it must never be accepted as a normal backup.
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    return {format:'pos-recovery-diagnostics/v1',importable:false,createdAt:new Date().toISOString(),storage:'sqlite',
      tables:tables.map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()}))}
  }

  // Index all original formal IDs at the same boundary as every supported
  // restore. A missing historical receipt is uncertain, never a new payment.
  const descriptors={
    applyLotOperation:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM stock_cost_operations WHERE id=?').get(canonicalSignature(['applyLotOperation',id]))},
    applyWarehouseOperation:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM stock_cost_operations WHERE id=?').get(canonicalSignature(['applyWarehouseOperation',id]))},
    applyStockCostOperation:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM stock_cost_operations WHERE id=?').get(canonicalSignature(['applyStockCostOperation',id]))},
    addProduct:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM products WHERE id=?').get(id)},
    checkout:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM orders WHERE id=?').get(id)},
    refundOrder:{id:a=>a[1]?.id,active:id=>db.prepare('SELECT 1 FROM orders WHERE id=?').get(id)},
    addTopup:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM member_topups WHERE id=?').get(id)},
    addCashLog:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM cash_log WHERE id=?').get(id)},
    addWaste:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM waste_log WHERE id=?').get(id)},
    addManualEntry:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM manual_journal WHERE id=?').get(id)},
    addPurchase:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM purchases WHERE id=?').get(id)},
    openShift:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM shifts WHERE id=?').get(id)},
    closeShift:{id:a=>a[0],active:id=>db.prepare("SELECT 1 FROM shifts WHERE id=? AND status='closed'").get(id)},
    applyInventoryOperation:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM audit_log WHERE id=?').get('stock-operation:'+id)},
    applyExchangeOperation:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM audit_log WHERE id=?').get('exchange:'+id)},
    applyRestaurantOperation:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM restaurant_operations WHERE id=?').get(id)},
    applySalesOperation:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM sales_operations WHERE id=?').get(id)},
    applyCustomerLedgerOperation:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM customer_operations WHERE id=?').get(id)},
    applySupplierLedgerOperation:{id:a=>a[0]?.id,active:id=>db.prepare('SELECT 1 FROM supplier_operations WHERE id=?').get(id)},
    applyScenarioTemplate:{id:a=>a[0]?.operationId,active:(_id,a)=>db.prepare('SELECT 1 FROM audit_log WHERE id=?').get('scenario-template:'+a[0]?.templateId)},
  }
  for(const [method,descriptor] of Object.entries(descriptors)){
    const original=api[method]
    api[method]=function(...args){
      if(method.startsWith('apply')&&(!args[1]||!['owner','staff'].includes(args[1].role)||['applyStockCostOperation','applySalesOperation','applyCustomerLedgerOperation','applySupplierLedgerOperation','applyExchangeOperation','applyScenarioTemplate'].includes(method)&&args[1].role!=='owner'))return original.apply(api,args)
      return db.transaction(()=>{
        const id=recoveryOperationId(descriptor.id(args))
        if(typeof id!=='string')return original.apply(api,args)
        const known=typeof id==='string'&&db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get(method,id)
        let available=!!descriptor.active(id,args)
        if(known&&available&&['applyLotOperation','applyWarehouseOperation','applyStockCostOperation','addProduct','checkout','refundOrder','addTopup','addCashLog','addWaste','applyInventoryOperation','applyExchangeOperation','applyRestaurantOperation','applySalesOperation','applyCustomerLedgerOperation','applySupplierLedgerOperation'].includes(method)){
          const active=operationRecords(api.exportData()).find(row=>row.method===method&&row.id===id)
          const request=method==='refundOrder'?{...args[1],refundOf:args[0]}:args[0]
          available=!!active&&originalMatches(active,{method,id,request},proof)
        }
        if(known&&!available)return {success:false,committed:null,...(method==='checkout'?{protocol:PROTOCOL,orderId:id}:{}),errorCode:'RECOVERY_REQUIRED',error:'原編號曾經保存，目前帳本無法確認這筆內容。請使用復原引導核對。'}
        return original.apply(api,args)
      })()
    }
  }
  return api
}
