import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex} from '@noble/hashes/utils.js'

const words={
 'zh-TW':{prepare:'備餐單',cancel:'取消通知',copy:'補印',notReceipt:'非收據',payment:'收款請看系統',table:'桌號',pickup:'取餐號',preorder:'預訂',walkin:'現場',delivery:'外送',note:'備註',reason:'取消原因',total:'訂單金額',original:'原單',source:'顧客原單'},
 en:{prepare:'Kitchen ticket',cancel:'CANCEL ORDER',copy:'REPRINT',notReceipt:'NOT A RECEIPT',payment:'Check payment in the system',table:'Table',pickup:'Pickup no.',preorder:'Preorder',walkin:'Walk-in',delivery:'Delivery',note:'Note',reason:'Cancellation reason',total:'Order total',original:'Original',source:'Customer order'},
 ja:{prepare:'調理伝票',cancel:'キャンセル通知',copy:'再印刷',notReceipt:'領収書ではありません',payment:'入金はシステムで確認',table:'テーブル',pickup:'受取番号',preorder:'予約',walkin:'店頭',delivery:'配達',note:'備考',reason:'取消理由',total:'注文金額',original:'元の注文',source:'お客様の注文'},
 'zh-CN':{prepare:'备餐单',cancel:'取消通知',copy:'补印',notReceipt:'非收据',payment:'收款请看系统',table:'桌号',pickup:'取餐号',preorder:'预订',walkin:'现场',delivery:'外送',note:'备注',reason:'取消原因',total:'订单金额',original:'原单',source:'顾客原单'},
}
const escape=value=>String(value??'').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,' ')
const width=char=>/[\u0300-\u036f]/u.test(char)?0:char.codePointAt(0)>0x2e7f?2:1
function wrap(value,columns){let result='',line='',length=0;for(const char of Array.from(escape(value))){const n=width(char);if(length+n>columns){result+=line+'\n';line='';length=0}line+=char;length+=n}return result+line+'\n'}
export function validateKitchenPrintFormat(value){
 if(!value||Object.keys(value).sort().join(',')!=='columns,locale,version'||value.version!==1||!Object.hasOwn(words,value.locale)||!Number.isSafeInteger(value.columns)||value.columns<16||value.columns>80)throw Error('備餐單紙張格式需要核對')
 return value
}
export function kitchenTicketBytes(ticket,format){
 validateKitchenPrintFormat(format)
 if(!['pos-kitchen-ticket/v1','pos-kitchen-ticket/v2'].includes(ticket?.protocol)||!['prepare','cancel'].includes(ticket.kind)||!Array.isArray(ticket.items)||ticket.items.length>100)throw Error('備餐單內容需要核對')
 const w=words[format.locale],line=v=>wrap(v,format.columns),big=v=>'\x1d\x21\x11'+line(v)+'\x1d\x21\x00',rule=line('-'.repeat(format.columns))
 let result='\x1b\x40\x1b\x61\x01'+big(w[ticket.kind])
 if(ticket.copy>0)result+=big(w.copy+' #'+ticket.copy)
 result+=line(w.notReceipt)+line(w.payment)+rule+'\x1b\x61\x00'
 if(ticket.tableNum)result+=big(w.table+' '+ticket.tableNum)
 else if(ticket.customer)result+=big(ticket.customer)
 result+=big(w.pickup+' '+String(ticket.pickupNumber).padStart(3,'0'))+line(ticket.day+' '+ticket.slot+' · '+w[ticket.channel])+rule
 for(const item of ticket.items)result+=line(item.name)+big('× '+item.qty)
 result+=rule
 if(ticket.note)result+=line(w.note+': '+ticket.note)
 if(ticket.kind==='cancel'&&ticket.cancelReason)result+=big(w.reason)+line(ticket.cancelReason)
 if(ticket.channel==='delivery'&&ticket.contact)result+=line(ticket.contact)
 result+=line(w.total+' NT$ '+ticket.total)+rule+line(w.original+': '+ticket.entryId)
 if(ticket.sourceOrderId)result+=line(w.source+': '+ticket.sourceOrderId)
 result+='\x1b\x64\x05\x1d\x56\x01'
 const bytes=new TextEncoder().encode(result);if(bytes.length>256*1024)throw Error('備餐單超過列印上限')
 return bytes
}
export const kitchenTicketDigest=(ticket,format)=>bytesToHex(sha256(kitchenTicketBytes(ticket,format)))
