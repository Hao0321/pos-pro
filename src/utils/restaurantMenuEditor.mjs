import {convertedQuantity} from '../../electron/costPricing.mjs'
import {normalizeRestaurantMenu,RESTAURANT_MENU_PROTOCOL} from '../../electron/restaurantMenu.mjs'

const aliases={kg:'kg','公斤':'kg','千克':'kg',g:'g','公克':'g','克':'g',mg:'mg','毫克':'mg',L:'L',l:'L','公升':'L','升':'L',mL:'mL',ml:'mL','毫升':'mL',twJin:'twJin','台斤':'twJin','臺斤':'twJin',cnJin:'cnJin','市斤':'cnJin'}
const mass=['kg','g','mg','twJin','cnJin'],volume=['L','mL'],newId=prefix=>prefix+'-'+crypto.randomUUID()
const unitCode=product=>product&&Object.hasOwn(aliases,product.unit)?aliases[product.unit]:null
function decimal(raw,places,signed=false){if(typeof raw!=='string')throw Error('請填完整數字，不要留白或輸入算式');const text=raw.trim();if(!new RegExp('^'+(signed?'-?':'')+'\\d+'+(places?'(?:\\.\\d{1,'+places+'})?':'')+'$').test(text))throw Error('請填完整數字，不要留白或輸入算式');return text.replace(/^(-?)0+(?=\d)/,'$1')}
function exact(value,places=6){const n=BigInt(value.numerator),d=BigInt(value.denominator),factor=10n**BigInt(places);if(n*factor%d)throw Error('原料用量太細，請改用較小單位再設定。');const scaled=n*factor/d,negative=scaled<0n,amount=negative?-scaled:scaled;return (negative?'-':'')+(amount/factor)+((amount%factor)?'.'+(amount%factor).toString().padStart(places,'0').replace(/0+$/,''):'')}
export function menuEditorUnits(product){const code=unitCode(product);return code?(mass.includes(code)?mass:volume):['stock']}
export function menuEditorQuantity(qty,product){const code=unitCode(product),unit=code==='kg'?'g':code==='L'?'mL':code||'stock',negative=qty<0,value=String(Math.abs(qty)),text=code?exact(convertedQuantity(value,code,unit)):value;return {quantity:(negative?'-':'')+text,unit}}
export function compileMenuQuantity(row,product,signed=false){
 if(!product)throw Error('請選擇現有商品或原料')
 const raw=decimal(row.quantity,6,signed),negative=raw.startsWith('-'),absolute=negative?raw.slice(1):raw,code=unitCode(product)
 if(!menuEditorUnits(product).includes(row.unit))throw Error('單位不能直接換算，請確認重量、容量或件數')
 const value=code?convertedQuantity(absolute,row.unit,code):(()=>{const [whole,fraction='']=absolute.split('.');return {numerator:whole+fraction,denominator:(10n**BigInt(fraction.length)).toString()}})(),n=BigInt(value.numerator),d=BigInt(value.denominator)
 if(n<=0n||n*1000n%d||n*1000n/d>1000000000000n)throw Error('原料用量太細，請改用較小單位再設定。')
 return Number((negative?-1n:1n)*(n*1000n/d))/1000
}
export function menuEditorComponent(product,qty=1){return {id:product.id,...menuEditorQuantity(qty,product)}}
export function changeMenuEditorUnit(row,unit,product){const qty=compileMenuQuantity(row,product,true),code=unitCode(product);if(!menuEditorUnits(product).includes(unit))throw Error('單位不能直接換算，請確認重量、容量或件數');return {...row,unit,quantity:(qty<0?'-':'')+(code?exact(convertedQuantity(String(Math.abs(qty)),code,unit)):String(Math.abs(qty)))}}
export function menuEditorOffer(product,name){const variantId=newId('size');return {id:newId('meal'),productId:product.id,name:product.name,defaultVariantId:variantId,variants:[{id:variantId,name,price:String(product.price),capacity:'1',components:[menuEditorComponent(product)]}],groups:[]}}
export function menuEditorGroup(name,required=false){return {id:newId('group'),name,min:required?'1':'0',max:'1',defaults:[],choices:[]}}
export function menuEditorChoice(product){return {id:newId('choice'),name:product.name,priceDelta:String(product.price),max:'1',components:[menuEditorComponent(product)],omit:[]}}
export function menuEditorDraft(menu,products){
 const component=row=>({...row,...menuEditorQuantity(row.qty,products.find(product=>product.id===row.id))}),value=structuredClone(menu||{protocol:RESTAURANT_MENU_PROTOCOL,offers:[]})
 value.offers=value.offers.map(offer=>({...offer,variants:offer.variants.map(variant=>({...variant,price:String(variant.price),capacity:String(variant.capacity),components:variant.components.map(component)})),groups:offer.groups.map(group=>({...group,min:String(group.min),max:String(group.max),defaults:group.defaults.map(row=>({...row,qty:String(row.qty)})),choices:group.choices.map(choice=>({...choice,priceDelta:String(choice.priceDelta),max:String(choice.max),components:choice.components.map(component),omit:[...(choice.omit||[])]}))}))}));return value
}
export function compileMenuEditor(draft,products){
 const number=(raw,places,signed=false)=>Number(decimal(raw,places,signed)),integer=raw=>number(raw,0),components=(rows,signed=false)=>rows.map(row=>({id:row.id,qty:compileMenuQuantity(row,products.find(product=>product.id===row.id),signed)}))
 if(!draft.offers.length)throw Error('先加入一道要賣的餐點')
 const menu={protocol:RESTAURANT_MENU_PROTOCOL,offers:draft.offers.map(offer=>({...offer,variants:offer.variants.map(variant=>({...variant,price:number(variant.price,2),capacity:integer(variant.capacity),components:components(variant.components)})),groups:offer.groups.map(group=>{
  if(!group.choices.length)throw Error('請先加入至少一個選項')
  return {...group,min:integer(group.min),max:integer(group.max),defaults:group.defaults.map(row=>({...row,qty:integer(row.qty)})),choices:group.choices.map(choice=>({...choice,priceDelta:number(choice.priceDelta,2,true),max:integer(choice.max),components:components(choice.components,true)}))}
 })}))}
 return normalizeRestaurantMenu(menu,products)
}
export function expandMenuEditorComponents(rows,products,recipes){
 const totals=new Map()
 for(const row of rows){const qty=compileMenuQuantity(row,products.find(product=>product.id===row.id),true),scaled=BigInt(Math.round(qty*1000));for(const part of recipes[row.id]||[{id:row.id,qty:1}]){const amount=scaled*BigInt(Math.round(part.qty*1000));if(amount%1000n)throw Error('原料用量太細，請改用較小單位再設定。');totals.set(part.id,(totals.get(part.id)||0n)+amount/1000n)}}
 return [...totals].filter(([,amount])=>amount!==0n).map(([id,amount])=>menuEditorComponent(products.find(product=>product.id===id),Number(amount)/1000))
}
