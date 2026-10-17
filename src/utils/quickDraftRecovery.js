import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {assertReceipt} from './financialCommand'
import {assertImportedPurchaseSource} from '../../electron/quickPurchaseOriginal.mjs'

export function verifyQuickOriginal(original,document=null){
 if(original?.protocol!=='pos-private-draft-original/v1'||original.status!=='matched'||!['create','purchase-create'].includes(original.action)||!original.result?.receipt)throw Error('保存結果尚未確認，請保留原編號核對。')
 const request=JSON.parse(original.result.receipt.signature),kind=original.action==='purchase-create'?'purchase-create':'restaurant'
 if(original.id!==request.id||request.kind!==kind||privateDraftDigest(request)!==original.digest||kind==='restaurant'&&request.action!=='create')throw Error('原單資料需要核對')
 assertReceipt(kind,request,original.result)
 if(document&&(kind!=='purchase-create'||original.sourceMatch!==assertImportedPurchaseSource(document,request)))throw Error('原單資料需要核對')
 return {kind,request,result:original.result}
}
