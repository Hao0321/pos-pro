import {withSalesLock,readRecords,writeRecords,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {getBrowserPrivateDraftContext} from './browserPrivateDrafts'
import {browserToBook,bookToBrowser} from '../../electron/recoveryRules.mjs'
import {previewOpeningMigration,verifyOpeningMigration,projectOpeningMigrationBook} from '../../electron/openingMigration.mjs'
import {readOpeningMigrationHistory,assertOpeningMigrationResult} from '../../electron/openingMigrationHistory.mjs'
import {OPENING_CUTOVER_PROTOCOL} from '../../electron/openingCutoverRules.mjs'
import {previewOpeningCutover,verifyOpeningCutover,projectOpeningCutoverBook} from '../../electron/openingCutoverModel.mjs'
import {readOpeningCutoverHistory} from '../../electron/openingCutoverHistory.mjs'
import {assertOpeningCutoverResult} from '../../electron/openingCutoverReceipt.mjs'
import {OPENING_CUTOVER_LOOKUP,lookupOpeningCutover} from '../../electron/openingCutoverLookup.mjs'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'

export async function previewBrowserOpeningMigration(input,actor){await getBrowserPrivateDraftContext(actor);return withSalesLock(()=>{const record=readRecords(),book=browserToBook(record.data),scope=privateDraftContext(readExchangeTextSetting(book.settings,'sharedStoreId'),record.salesEpoch,actor,book.users);if(input?.protocol===OPENING_CUTOVER_LOOKUP){const value=lookupOpeningCutover(input,book,scope,actor);if(!value.found)assertOriginalOperationAvailable('applyOpeningMigration',input.id,record,input);return value}return (input?.protocol===OPENING_CUTOVER_PROTOCOL?previewOpeningCutover:previewOpeningMigration)(input,book,scope,actor)})}
export async function commitBrowserOpeningMigration(input,actor){
 const scope=await getBrowserPrivateDraftContext(actor)
 const combined=input?.protocol===OPENING_CUTOVER_PROTOCOL,history=combined?readOpeningCutoverHistory:readOpeningMigrationHistory,verify=combined?verifyOpeningCutover:verifyOpeningMigration,assertResult=combined?assertOpeningCutoverResult:assertOpeningMigrationResult
 return withSalesLock(()=>{
  let writing=false,before=null,checked=false,existing=false
  try{
   const record=readRecords(),book=browserToBook(record.data);existing=history(book).byId.has(input?.id)
   if(!existing){assertOriginalOperationAvailable('applyOpeningMigration',input.id,record,input);checked=true}
   const verified=verify(input,book,scope,actor)
   if(verified.receipt)return assertResult(input,{success:true,receipt:verified.receipt})
   const time=new Date().toISOString(),planned=combined?projectOpeningCutoverBook(input,verified.preview.plan,book,scope,actor,time):projectOpeningMigrationBook(input,verified.preview,book,scope,actor,time);before=localStorage.getItem(RECORD_KEY);writing=true
   writeRecords(bookToBrowser(planned.book),record.revision,{openingMigration:{input,actor,time}})
   return assertResult(input,{success:true,receipt:history(browserToBook(readRecords().data)).byId.get(input.id)})
  }catch(error){
   if(writing)try{if(localStorage.getItem(RECORD_KEY)!==before)return assertResult(input,{success:true,receipt:history(browserToBook(readRecords().data)).byId.get(input.id)})}catch{return {success:false,committed:null,error:'期初保存結果尚未確認，請保留原編號再核對。'}}
   return {success:false,committed:error.historyUncertain||!checked||existing?null:false,error:error.message}
  }
 })
}
