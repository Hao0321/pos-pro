// Keep original text at the caller; integer conversion happens only at review.
const patterns={2:/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/,3:/^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/}
export function decimalUnits(raw,precision,maximum,message){
 if(typeof raw!=='string'||![2,3].includes(precision))throw Error(message)
 const text=raw.trim()
 if(text.length>32||!patterns[precision].test(text))throw Error(message)
 const [whole,fraction='']=text.split('.'),value=BigInt((whole||'0')+fraction.padEnd(precision,'0'))
 if(value>BigInt(maximum))throw Error(message)
 return Number(value)
}
