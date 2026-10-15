const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async function check({js,wait,click,renderer,backup,journal,profile}){
  const original=JSON.parse(journal),id=original.request.id
  assert.equal(original.kind,'sales');assert.equal(original.request.action,'pay');assert.equal(original.request.amount,5)
  const before=await js('window.electronAPI.db.exportData()')
  await js('document.querySelector("[data-nav=settings]").click()');await click('備份還原')
  await wait('document.body.innerText.includes("Delivered recovery before payment")','delivered saved backup')
  await js(`(()=>{const card=[...document.querySelectorAll('.card')].find(e=>e.innerText.includes('Delivered recovery before payment')&&[...e.querySelectorAll('button')].some(b=>b.textContent.trim()==='還原'));if(!card)throw Error('backup absent');[...card.querySelectorAll('button')].find(b=>b.textContent.trim()==='還原').click()})()`)
  await wait('!!document.querySelector("[data-restore-ack]:not(:disabled)")','exact delivered restore preview')
  assert.equal(await js('!!document.querySelector("[data-restore-preview] [role=table]")'),true)
  await js('document.querySelector("[data-restore-ack]").click()');await click('確認還原')
  await wait('(async()=>!(await window.electronAPI.db.getSalesState()).documents[0].payments.length&&!document.querySelector("[data-restore-preview]"))()','exact delivered protected older restore')
  assert.equal((await js('window.electronAPI.db.getCashLog()')).length,before.cashLog.length-1)
  // Reinsert only the verbatim journal captured from the real payment's
  // DOMStorage event. This simulates a surviving journal, NOT a network fault.
  // The independent private-HTTPS native fixture actually loses the response.
  await js('localStorage.setItem("pos_pending_financial_v1",'+JSON.stringify(journal)+')')
  await renderer.send('Page.reload');await renderer.event('Page.loadEventFired')
  await wait('!!document.querySelector("[data-recovery-open]")','packaged original recovery entry after reload')
  await js('document.querySelector("[data-recovery-open]").click()');await wait('!!document.querySelector("[data-recovery-source]")','exact delivered lazy recovery guide')
  assert.equal(await js('document.querySelector("[data-recovery-original]").textContent'),id)
  await js('document.querySelector("[data-recovery-ack]").click()');await js('document.querySelector("[data-recovery-restore]").click()')
  await wait('!localStorage.getItem("pos_pending_financial_v1")&&!!document.querySelector(".recovery-notice")&&!document.querySelector("[data-recovery-original]")','packaged original confirmed')
  const after=await js('window.electronAPI.db.exportData()')
  for(const key of ['products','members','orders','purchases','salesDocuments','salesOperations','cashLog','restaurantOrders','restaurantOperations','memberTopups','wasteLog'])assert.deepEqual(after[key],before[key],key+' must survive recovery exactly')
  assert.equal(after.salesDocuments[0].payments.filter(p=>p.id===id).length,1);assert.equal(after.cashLog.filter(p=>p.id===id||p.id===after.salesDocuments[0].payments[0].cashLogId).length>1,false)
  const state=await js('window.electronAPI.db.getRecoveryState('+JSON.stringify(original)+')');assert.equal(state.active,'matched')
  fs.writeFileSync(path.join(profile,'delivered-recovery-evidence.json'),JSON.stringify({schemaVersion:1,originalId:id,capturedVerbatimJournal:original,simulation:'actual UI payment journal captured via DOMStorage, then reinserted after an actual protected older restore; not network reply loss',pendingCleared:true,sourceCount:state.sources.length,cashBefore:before.cashLog.length,cashAfter:after.cashLog.length,paymentCount:after.salesDocuments[0].payments.length,stock:after.products[0].stock},null,2))
}
