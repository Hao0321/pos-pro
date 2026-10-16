function scaled(value,scale,digits,locale,fixed){
 if(!Number.isSafeInteger(value)||value<0)throw Error('庫存數字需要核對')
 const amount=BigInt(value),whole=(amount/BigInt(scale)).toLocaleString(locale),raw=(amount%BigInt(scale)).toString().padStart(digits,'0'),fraction=fixed?raw:raw.replace(/0+$/,''),separator=new Intl.NumberFormat(locale).formatToParts(1.1).find(p=>p.type==='decimal').value
 return whole+(fraction?separator+fraction:'')
}
export const historyQuantity=(units,locale)=>scaled(units,1000,3,locale,false)
export const historyMoney=(cents,locale)=>'NT$ '+scaled(cents,100,2,locale,true)
