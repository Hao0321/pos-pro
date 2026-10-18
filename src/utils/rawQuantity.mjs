// Preserve raw form text; convert base units only at explicit review.
export function readBaseUnits(raw,message){
 const text=raw.trim()
 if(!/^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(text)||text.length>32)throw Error(message)
 const [whole,fraction='']=text.split('.'),value=BigInt((whole||'0')+fraction.padEnd(3,'0'))
 if(value>1000000000000n)throw Error(message)
 return Number(value)
}
