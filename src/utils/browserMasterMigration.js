import {withSalesLock,readRecords,writeRecords,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {getBrowserPrivateDraftContext} from './browserPrivateDrafts'
import {browserToBook,bookToBrowser} from '../../electron/recoveryRules.mjs'
import {previewMasterMigration,assertMasterMigrationResult,verifyMasterMigration,readMasterMigrationHistory} from '../../electron/masterMigration.mjs'
import {appendBrowserMasterMigration} from '../../electron/browserMasterMigration.mjs'

export async function previewBrowserMasterMigration(input,actor){
  const scope=await getBrowserPrivateDraftContext(actor)
  return withSalesLock(()=>previewMasterMigration(input,browserToBook(readRecords().data),scope,actor))
}
export async function commitBrowserMasterMigration(input,actor){
  const scope=await getBrowserPrivateDraftContext(actor)
  return withSalesLock(()=>{
    let writing=false,before=null,checked=false,existing=false
    try{
      const record=readRecords(),book=browserToBook(record.data);existing=readMasterMigrationHistory(book).byId.has(input.id);checked=true
      const prior=verifyMasterMigration(input,book,scope,actor)
      if(prior.receipt)return assertMasterMigrationResult(input,{success:true,receipt:prior.receipt})
      checked=true;assertOriginalOperationAvailable('applyMasterMigration',input.id,record,input)
      const time=new Date().toISOString(),planned=appendBrowserMasterMigration(book,input,scope,actor,time)
      before=localStorage.getItem(RECORD_KEY);writing=true
      writeRecords(bookToBrowser(planned.book),record.revision,{masterMigration:{input,scope,actor,time}})
      return assertMasterMigrationResult(input,{success:true,receipt:readMasterMigrationHistory(browserToBook(readRecords().data)).byId.get(input.id)})
    }catch(error){
      if(writing)try{if(localStorage.getItem(RECORD_KEY)!==before)return assertMasterMigrationResult(input,{success:true,receipt:readMasterMigrationHistory(browserToBook(readRecords().data)).byId.get(input.id)})}catch{return {success:false,committed:null,error:'搬入結果尚未確認，請保留原編號再核對。'}}
      return {success:false,committed:error.historyUncertain||!checked||existing?null:false,error:error.message}
    }
  })
}
