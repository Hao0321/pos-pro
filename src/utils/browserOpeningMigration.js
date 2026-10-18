import {withSalesLock,readRecords,writeRecords,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {getBrowserPrivateDraftContext} from './browserPrivateDrafts'
import {browserToBook,bookToBrowser} from '../../electron/recoveryRules.mjs'
import {previewOpeningMigration,verifyOpeningMigration,projectOpeningMigrationBook} from '../../electron/openingMigration.mjs'
import {readOpeningMigrationHistory,assertOpeningMigrationResult} from '../../electron/openingMigrationHistory.mjs'

export async function previewBrowserOpeningMigration(input,actor){const scope=await getBrowserPrivateDraftContext(actor);return withSalesLock(()=>previewOpeningMigration(input,browserToBook(readRecords().data),scope,actor))}
export async function commitBrowserOpeningMigration(input,actor){
 const scope=await getBrowserPrivateDraftContext(actor)
 return withSalesLock(()=>{
  let writing=false,before=null,checked=false,existing=false
  try{
   const record=readRecords(),book=browserToBook(record.data);existing=readOpeningMigrationHistory(book).byId.has(input?.id);const verified=verifyOpeningMigration(input,book,scope,actor);checked=true
   if(verified.receipt)return assertOpeningMigrationResult(input,{success:true,receipt:verified.receipt})
   assertOriginalOperationAvailable('applyOpeningMigration',input.id,record,input)
   const time=new Date().toISOString(),planned=projectOpeningMigrationBook(input,verified.preview,book,scope,actor,time);before=localStorage.getItem(RECORD_KEY);writing=true
   writeRecords(bookToBrowser(planned.book),record.revision,{openingMigration:{input,actor,time}})
   return assertOpeningMigrationResult(input,{success:true,receipt:readOpeningMigrationHistory(browserToBook(readRecords().data)).byId.get(input.id)})
  }catch(error){
   if(writing)try{if(localStorage.getItem(RECORD_KEY)!==before)return assertOpeningMigrationResult(input,{success:true,receipt:readOpeningMigrationHistory(browserToBook(readRecords().data)).byId.get(input.id)})}catch{return {success:false,committed:null,error:'期初保存結果尚未確認，請保留原編號再核對。'}}
   return {success:false,committed:error.historyUncertain||!checked||existing?null:false,error:error.message}
  }
 })
}
