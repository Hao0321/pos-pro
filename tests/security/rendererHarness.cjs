const fs=require('node:fs'),path=require('node:path')
async function js(target,code){
  const result=await target.webContents.executeJavaScript(`(async()=>{try{return {ok:true,value:await (${code})}}catch(e){return {ok:false,error:e.stack}}})()`)
  if(!result.ok)throw Error(result.error+'\nProbe: '+code)
  return result.value
}
async function wait(target,expression,label){
  const end=Date.now()+12000
  while(Date.now()<end){if(await js(target,expression))return;await new Promise(resolve=>setTimeout(resolve,40))}
  throw Error('Timeout '+label+': '+(await js(target,'document.body.innerText')).slice(-2400))
}
async function input(target,selector,value,type='HTMLInputElement',event='input'){
  await wait(target,`(()=>{const element=document.querySelector(${JSON.stringify(selector)});return element&&!element.disabled&&!element.readOnly&&!element.closest('fieldset:disabled')&&!element.closest('[inert]')})()`,'editable input '+selector)
  await js(target,`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${type}.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}))})()`)
}
const select=(target,selector,value)=>input(target,selector,value,'HTMLSelectElement','change')
async function tap(target,selector){
  await js(target,`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`)
  const rect=`(()=>{const element=document.querySelector(${JSON.stringify(selector)}),r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !element.disabled&&!element.closest('[inert]')&&r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&hit&&element.contains(hit)})()`
  await wait(target,rect,'reachable pointer '+selector)
  await wait(target,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),old=window.__salesTap;window.__salesTap={key:${JSON.stringify(selector)},x:r.x,y:r.y};return old?.key===${JSON.stringify(selector)}&&Math.abs(old.x-r.x)<.25&&Math.abs(old.y-r.y)<.25})()`,'stable pointer '+selector)
  const point=await js(target,`(()=>{const element=document.querySelector(${JSON.stringify(selector)}),r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(element.disabled||element.closest('[inert]')||!hit||!element.contains(hit))throw Error('Pointer blocked');return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
  target.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});target.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
}
async function button(target,label){
  await wait(target,`[...document.querySelectorAll('button')].some(element=>element.textContent.trim()===${JSON.stringify(label)})`,'button '+label)
  await js(target,`(()=>{document.querySelector('[data-sales-test-tap]')?.removeAttribute('data-sales-test-tap');const element=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!element)throw Error('Missing button '+${JSON.stringify(label)});element.setAttribute('data-sales-test-tap','')})()`)
  await tap(target,'[data-sales-test-tap]')
}
async function capture(target,root,name){fs.writeFileSync(path.join(root,name+'.png'),(await target.webContents.capturePage()).toPNG())}
module.exports={js,wait,input,select,tap,button,capture}
