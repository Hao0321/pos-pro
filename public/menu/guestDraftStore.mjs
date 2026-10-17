import {GUEST_DRAFT_DB,GUEST_STAGE_PREFIX,newGuestId,isGuestScope,assertGuestState,assertGuestProof,assertGuestRecord,assertGuestStage,guestIntent,guestRecordFromStage,guestStageKey,safeGuestSource} from './guestDraftShape.mjs'
const LOST='GUEST_WRITER_LOST',lost=()=>Object.assign(Error('另一個分頁正在點餐，離開該頁後會自動接回。'),{code:LOST})
const storageError=()=>Error('還沒保存好，請先別關閉頁面。')
export function createGuestWorkspace({scopeId,mode,onAcquire=()=>{},onState=()=>{},indexedDB=globalThis.indexedDB,storage=globalThis.localStorage,now=()=>Date.now(),ttl=6000,pollMs=400}){
 if(!isGuestScope(scopeId)||!['ordinary','menu'].includes(mode))throw Error('點餐來源需要核對')
 const owner=newGuestId(),pending=new Set(),transactions=new Set();let db=null,lease=null,active=false,paused=false,closed=false,acquiring=false,timer=null,record=null,source=null,documentId=newGuestId(),op=0,lastState=null,lastError=null,corrupt=false,retained=false,sequence=0,heartbeatAt=0,status='loading'
 const owned=()=>active&&!paused&&!closed&&lease?.owner===owner&&lease.expiresAt>now()
 const emit=next=>{status=next;onState({status,owned:owned(),corrupt,retained,pending:pending.size,error:lastError?.message||''})}
 function transaction(names,body){return new Promise((resolve,reject)=>{
  let tx,result,failure
  try{try{tx=db.transaction(names,'readwrite',{durability:'strict'})}catch(error){if(error.name!=='TypeError')throw error;tx=db.transaction(names,'readwrite')}}catch(error){reject(error);return}
  const fail=error=>{failure=error;try{tx.abort()}catch{reject(error)}}
  transactions.add(tx);tx.oncomplete=()=>{transactions.delete(tx);resolve(result)};tx.onabort=()=>{transactions.delete(tx);reject(failure||tx.error||storageError())};tx.onerror=()=>{}
  const get=(store,key,consume)=>{const request=tx.objectStore(store).get(key);request.onsuccess=()=>{try{consume(request.result)}catch(error){fail(error)}}}
  try{body({tx,get,put:(store,value)=>tx.objectStore(store).put(value),remove:(store,key)=>tx.objectStore(store).delete(key),done:value=>{result=value},fail})}catch(error){fail(error)}
 })}
 const matches=current=>current?.owner===owner&&current.fence===lease?.fence
 function readStage(key){try{const bytes=storage.getItem(key);if(bytes===null)return null;try{return {key,bytes,value:assertGuestStage(JSON.parse(bytes))}}catch{return {key,bytes,invalid:true}}}catch{return null}}
 function stageSources(scope=scopeId){const sources=[];try{for(let index=0;index<storage.length;index++){const key=storage.key(index);if(key?.startsWith(GUEST_STAGE_PREFIX+scope+':')){const value=readStage(key);if(value)sources.push(value)}}}catch{}return sources}
 function removeStage(stage){if(!stage)return;try{if(storage.getItem(stage.key)===stage.bytes)storage.removeItem(stage.key)}catch{}}
 const releaseKey=value=>'pos_guest_writer_release_v1:'+value
 function readRelease(value){try{const key=releaseKey(value.owner),bytes=storage.getItem(key),hint=JSON.parse(bytes);return hint?.owner===value.owner&&hint.fence===value.fence&&hint.scopeId===value.scopeId?{key,bytes}:null}catch{return null}}
 function markLost(error){active=false;sequence++;lastError=error;emit('waiting')}
 async function acquire(){
  if(!db||paused||closed||acquiring||owned())return
  acquiring=true;let consumed=null,released=null,invalidStage=false
  try{
   const result=await transaction(['leases','drafts'],({get,put,done})=>{
    get('leases','writer',old=>{
     released=old?readRelease(old):null
     if(old&&old.owner!==owner&&old.expiresAt>now()&&!released){done(null);return}
     const next={id:'writer',owner,scopeId,fence:(Number.isSafeInteger(old?.fence)?old.fence:0)+1,expiresAt:now()+ttl};if(!Number.isSafeInteger(next.fence))throw storageError()
     const load=()=>get('drafts',scopeId,value=>{put('leases',next);done({lease:next,source:value})})
     const staged=old?.owner&&old?.scopeId?readStage(guestStageKey(old.scopeId,old.owner)):null
     if(staged?.invalid){invalidStage=old.scopeId===scopeId;load();return}
     if(!staged||staged.value.detached||staged.value.owner!==old.owner||staged.value.fence!==old.fence||staged.value.scopeId!==old.scopeId){load();return}
     get('drafts',old.scopeId,previous=>{
      if(previous)try{assertGuestRecord(previous,old.scopeId)}catch{load();return}
      const value=staged.value,canPromote=!previous||previous.documentId===value.documentId&&(previous.writer.fence<value.fence||previous.writer.fence===value.fence&&previous.writer.owner===value.owner&&previous.writer.op<value.op)
      if(canPromote)put('drafts',guestRecordFromStage(value,previous))
      if(canPromote||previous?.documentId===value.documentId&&previous.signature===value.signature)consumed=staged
      load()
     })
    })
   })
   if(!result){emit('waiting');return}
   lease=result.lease;if(paused||closed){await pause();return}active=true;heartbeatAt=now();sequence++;source=result.source??null;record=null;corrupt=false;lastError=null
   if(source)try{record=assertGuestRecord(source,scopeId);if(record.state.mode!==mode)throw storageError()}catch{corrupt=true;record=null}
   if(invalidStage&&!record)corrupt=true
   documentId=record?.documentId||newGuestId();lastState=record?structuredClone(record.state):null;op=0;removeStage(consumed);removeStage(released);retained=stageSources().length>0
   const token={owner,fence:lease.fence,sequence};emit('owned')
   Promise.resolve(onAcquire({record:record?structuredClone(record):null,corrupt,retained,token})).catch(error=>{if(isCurrent(token)){lastError=error;emit('error')}})
  }catch(error){lastError=error;emit(error.code===LOST?'waiting':'error')}
  finally{acquiring=false}
 }
 function isCurrent(token){return owned()&&token?.owner===owner&&token.fence===lease.fence&&token.sequence===sequence}
 function renew(){if(!owned()||now()-heartbeatAt<1500)return;heartbeatAt=now();const token={...lease};transaction(['leases'],({get,put,done})=>get('leases','writer',current=>{if(current?.owner!==token.owner||current.fence!==token.fence)throw lost();const next={...current,expiresAt:now()+ttl};put('leases',next);done(next)})).then(next=>{if(active&&lease?.fence===next.fence)lease=next}).catch(error=>{if(active&&lease?.fence===token.fence)markLost(error)})}
 async function start(){
  try{
   if(!indexedDB)throw storageError()
   db=await new Promise((resolve,reject)=>{const request=indexedDB.open(GUEST_DRAFT_DB,1);let finished=false;request.onupgradeneeded=()=>{const value=request.result;if(!value.objectStoreNames.contains('drafts'))value.createObjectStore('drafts',{keyPath:'scopeId'});if(!value.objectStoreNames.contains('leases'))value.createObjectStore('leases',{keyPath:'id'})};request.onblocked=()=>{finished=true;reject(storageError())};request.onerror=()=>{finished=true;reject(request.error||storageError())};request.onsuccess=()=>{if(finished)request.result.close();else{finished=true;resolve(request.result)}}})
   db.onversionchange=()=>{pause();db.close();lastError=storageError();emit('error')}
   timer=setInterval(()=>{if(paused||closed)return;if(owned())renew();else acquire()},pollMs);await acquire()
  }catch(error){lastError=error;emit('error')}
 }
 function save(state){
  const value=structuredClone(assertGuestState(state));if(value.mode!==mode)throw storageError();lastState=value;const currentOp=++op,token=lease?{...lease}:null,capturedId=documentId
  const staged=token?{version:1,scopeId,documentId:capturedId,owner,fence:token.fence,op:currentOp,detached:!owned(),state:value,signature:guestIntent(value)}:null
  let stage=null
  if(staged){const key=guestStageKey(scopeId,owner),bytes=JSON.stringify(staged);try{storage.setItem(key,bytes);if(storage.getItem(key)!==bytes)throw storageError();stage={key,bytes,value:staged}}catch{lastError=storageError()}}
  const promise=!owned()||corrupt?Promise.reject(corrupt?storageError():lost()):transaction(['leases','drafts'],({get,put,done})=>get('leases','writer',current=>{
   if(current?.owner!==owner||current.fence!==token.fence)throw lost()
   get('drafts',scopeId,previous=>{
    if(previous){assertGuestRecord(previous,scopeId);if(previous.documentId!==capturedId||previous.writer.fence>token.fence)throw lost();if(previous.writer.fence===token.fence&&previous.writer.owner===owner&&previous.writer.op>=currentOp){done(previous);return}}
    const next=guestRecordFromStage(staged,previous);put('drafts',next);put('leases',{...current,expiresAt:now()+ttl});done(next)
   })
  }))
  pending.add(promise);emit('saving')
  promise.then(next=>{removeStage(stage);if(active&&lease?.fence===token?.fence&&documentId===capturedId){record=next;source=next;lease.expiresAt=now()+ttl;if(currentOp===op)lastError=null}}).catch(error=>{if(currentOp===op)lastError=error;if(error.code===LOST)markLost(error)}).finally(()=>{pending.delete(promise);emit(lastError?'retained':owned()?'ready':'waiting')})
  return promise
 }
 async function flush(){while(pending.size)await Promise.allSettled([...pending]);if(!owned()||corrupt||!record||!lastState||safeGuestSource(record.state)!==safeGuestSource(lastState))throw lastError||storageError();return record}
 function proof(){if(!record||!lastState||record.signature!==guestIntent(lastState))throw storageError();return {scopeId,documentId:record.documentId,signature:record.signature}}
 async function runWriter(consume,{clearProof}={}){
  if(!owned())throw lost();if(clearProof)assertGuestProof(clearProof)
  const token={...lease};let result
  try{result=await transaction(['leases','drafts'],({get,put,remove,done})=>get('leases','writer',current=>{
   if(current?.owner!==owner||current.fence!==token.fence)throw lost()
   const finish=cleared=>{const value=consume();if(value&&typeof value.then==='function')throw storageError();put('leases',{...current,expiresAt:now()+ttl});done({value,cleared})}
   if(clearProof)get('drafts',clearProof.scopeId,raw=>{let matching=false;try{const saved=assertGuestRecord(raw,clearProof.scopeId);matching=saved.documentId===clearProof.documentId&&saved.signature===clearProof.signature}catch{}if(matching)remove('drafts',clearProof.scopeId);finish(matching)})
   else finish(false)
  }))}catch(error){if(error.code===LOST)markLost(error);throw error}
  if(active&&lease?.fence===token.fence)lease.expiresAt=now()+ttl
  if(clearProof){for(const stage of stageSources(clearProof.scopeId))if(!stage.invalid&&stage.value.documentId===clearProof.documentId&&stage.value.signature===clearProof.signature)removeStage(stage);if(result.cleared&&clearProof.scopeId===scopeId){record=null;source=null;lastState=null;documentId=newGuestId();lastError=null}}
  return result.value
 }
 async function reset(){
  if(!owned())throw lost();const expected=safeGuestSource(source),stages=stageSources();await transaction(['leases','drafts'],({get,put,remove})=>get('leases','writer',current=>{if(!matches(current))throw lost();get('drafts',scopeId,raw=>{if(safeGuestSource(raw??null)!==expected)throw storageError();remove('drafts',scopeId);put('leases',{...current,expiresAt:now()+ttl})})}));for(const stage of stages)removeStage(stage);source=null;record=null;lastState=null;documentId=newGuestId();corrupt=false;retained=false;lastError=null;emit('ready')
 }
 function pause(){paused=true;active=false;sequence++;const token=lease?{...lease}:null;if(token)try{storage.setItem(releaseKey(owner),JSON.stringify({owner,fence:token.fence,scopeId:token.scopeId}))}catch{}for(const tx of [...transactions])try{tx.abort()}catch{}emit('paused');return Promise.resolve()}
 function resume(){if(closed)return;paused=false;active=false;emit('waiting');if(!db)return start();return acquire()}
 function exportSource(){return {protocol:'pos-guest-draft-export/v1',scopeId,record:source,stages:stageSources().map(({key,bytes})=>({key,bytes})),currentInput:lastState}}
 async function close(){await pause();closed=true;clearInterval(timer);while(pending.size)await Promise.allSettled([...pending]);db?.close()}
 return {start,save,flush,proof,runWriter,reset,pause,resume,close,isCurrent,exportSource,get owned(){return owned()},get currentToken(){return lease?{owner,fence:lease.fence,sequence}:null},get documentId(){return documentId},get state(){return {status,corrupt,retained,error:lastError?.message||''}},get record(){return record?structuredClone(record):null}}
}
