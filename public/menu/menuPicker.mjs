import {tr,trMessage} from '../i18n/core.mjs'

const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node}
export function createMenuPicker({getMenu,onAdd,isLocked,onChange=()=>{}}){
 let active=null
 function suspend(){if(!active)return;const current=active;active=null;current.overlay.remove();document.removeEventListener('keydown',current.key)}
 function close(){if(!active||active.busy||isLocked())return;const current=active;suspend();current.focus?.focus();onChange(null)}
 function changed(){render();onChange(active?structuredClone(active.selection):null)}
 function render(){
  if(!active)return
  const {offer,selection,panel}=active,variant=offer.variants.find(row=>row.id===selection.variantId),locked=active.busy||isLocked()
  const focused=document.activeElement?.dataset.menuFocus;panel.replaceChildren()
  const header=element('div',undefined,'menu-choice-header'),heading=element('h2',offer.name);heading.id='menu-choice-title';header.append(heading)
  const cancel=element('button','×','menu-choice-close');cancel.type='button';cancel.setAttribute('aria-label',tr('關閉'));cancel.disabled=locked;cancel.onclick=close;header.append(cancel);panel.append(header)
  if(offer.variants.length>1){const field=element('fieldset'),legend=element('legend',tr('份量'));field.append(legend)
   const choices=element('div',undefined,'menu-variant-list')
   for(const row of offer.variants){const button=element('button',row.name+' · NT$ '+row.price,'menu-option-button');button.type='button';button.dataset.menuVariant=row.id;button.dataset.menuFocus='variant-'+row.id;button.setAttribute('aria-pressed',String(row.id===selection.variantId));button.disabled=locked;button.onclick=()=>{if(isLocked())return;selection.variantId=row.id;changed()};choices.append(button)}field.append(choices);panel.append(field)
  }
  let valid=true,price=BigInt(Math.round(variant.price*100));panel.setAttribute('aria-busy',String(active.busy))
  for(const group of offer.groups){
   const chosen=selection.selections.find(row=>row.groupId===group.id),total=chosen.choices.reduce((sum,row)=>sum+row.qty,0),field=element('fieldset'),legend=element('legend',group.name);field.dataset.menuGroup=group.id;field.append(legend)
   if(total<group.min||total>group.max)valid=false
   if(group.min>0&&(group.min!==1||group.max!==1))field.append(element('p',tr('請選擇 {0}～{1} 份',{0:group.min,1:group.max}),'menu-choice-hint'))
   for(const choice of group.choices){
    const qty=chosen.choices.find(row=>row.id===choice.id)?.qty||0;price+=BigInt(Math.round(choice.priceDelta*100))*BigInt(qty)
    const row=element('div',undefined,'menu-choice-row'),label=element('span',choice.name+(choice.priceDelta?' · '+(choice.priceDelta>0?'+':'−')+'NT$ '+Math.abs(choice.priceDelta):''));row.append(label)
    const set=next=>{if(isLocked())return;chosen.choices=chosen.choices.filter(row=>row.id!==choice.id);if(next)chosen.choices.push({id:choice.id,qty:next});changed()}
    if(group.min===1&&group.max===1){const button=element('button',tr(qty?'已選':'選擇'),'menu-option-button');button.type='button';button.dataset.menuChoice=choice.id;button.dataset.menuFocus=group.id+'-'+choice.id;button.setAttribute('aria-pressed',String(qty===1));button.disabled=locked;button.onclick=()=>{if(isLocked())return;chosen.choices=[{id:choice.id,qty:1}];changed()};row.append(button)}
    else{
     const controls=element('div',undefined,'menu-choice-counter'),minus=element('button','−'),count=element('span',String(qty)),plus=element('button','+')
     for(const [button,action,disabled,work]of [[minus,'minus',!qty,()=>set(qty-1)],[plus,'plus',qty>=choice.max||total>=group.max,()=>set(qty+1)]]){button.type='button';button.dataset.menuChoice=choice.id;button.dataset.menuChoiceAction=action;button.dataset.menuFocus=group.id+'-'+choice.id+'-'+action;button.setAttribute('aria-label',tr(action==='plus'?'增加 {0}':'減少 {0}',{0:choice.name}));button.disabled=locked||disabled;button.onclick=work}controls.append(minus,count,plus);row.append(controls)
    }
    field.append(row)
   }
   panel.append(field)
  }
  const quantity=element('div',undefined,'menu-choice-row'),title=element('strong',tr('份數')),counter=element('div',undefined,'menu-choice-counter'),minus=element('button','−'),count=element('span',String(selection.qty)),plus=element('button','+')
  minus.type=plus.type='button';minus.dataset.menuQuantity='minus';plus.dataset.menuQuantity='plus';minus.dataset.menuFocus='quantity-minus';plus.dataset.menuFocus='quantity-plus';minus.setAttribute('aria-label',tr('減少份數'));plus.setAttribute('aria-label',tr('增加份數'));minus.disabled=locked||selection.qty<=1;plus.disabled=locked||selection.qty>=100000;minus.onclick=()=>{if(isLocked())return;selection.qty--;changed()};plus.onclick=()=>{if(isLocked())return;selection.qty++;changed()};counter.append(minus,count,plus);quantity.append(title,counter);panel.append(quantity)
  const total=price*BigInt(selection.qty);if(total<0n||total>100000000000n)valid=false
  const error=element('p',active.error?trMessage(active.error):'', 'menu-choice-error');error.setAttribute('role','alert');panel.append(error)
  const footer=element('div',undefined,'menu-choice-footer'),amount=element('strong',valid?'NT$ '+Number(total)/100:tr('請調整選項')),add=element('button',tr(active.busy?'核對中…':'加入訂單'),'btn-primary');add.type='button';add.dataset.menuAdd='';add.dataset.menuFocus='add';add.disabled=locked||!valid;add.onclick=async()=>{if(!active||active.busy||isLocked())return;const current=active;current.busy=true;current.error='';render();try{await onAdd(structuredClone(selection));if(active!==current)return;current.busy=false;close()}catch(e){if(active!==current)return;current.busy=false;current.error=e.message;render()}};footer.append(amount,add);panel.append(footer)
  if(focused){const next=panel.querySelector('[data-menu-focus="'+CSS.escape(focused)+'"]');if(next&&!next.disabled)next.focus();else panel.focus()}
 }
 function open(offerId,saved=null){
  if(!saved&&isLocked()||active)return false
  const offer=getMenu()?.offers.find(row=>row.id===offerId);if(!offer)return
  const overlay=element('div',undefined,'menu-choice-overlay'),panel=element('section',undefined,'menu-choice-panel');overlay.dataset.menuPicker='';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','menu-choice-title');panel.tabIndex=-1;overlay.append(panel)
  if(saved&&(!offer.variants.some(row=>row.id===saved.variantId)||saved.selections.length!==offer.groups.length||offer.groups.some(group=>{const found=saved.selections.find(row=>row.groupId===group.id);return !found||found.choices.some(choice=>!group.choices.some(row=>row.id===choice.id&&row.max>=choice.qty))})))return false
  const selection=saved?structuredClone(saved):{offerId:offer.id,variantId:offer.defaultVariantId,qty:1,selections:offer.groups.map(group=>({groupId:group.id,choices:structuredClone(group.defaults)}))}
  const key=event=>{if(event.key==='Escape'){event.preventDefault();close()}if(event.key==='Tab'&&active){const nodes=[...panel.querySelectorAll('button:not(:disabled),[tabindex="0"]')],first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}}
  active={offer,selection,overlay,panel,key,busy:false,error:'',focus:document.activeElement};document.body.append(overlay);document.addEventListener('keydown',key);overlay.onclick=event=>{if(event.target===overlay)close()};render();panel.focus();if(!saved)onChange(structuredClone(selection));return true
 }
 return {open,refresh:render,close,suspend,snapshot:()=>active?structuredClone(active.selection):null,restore:selection=>open(selection.offerId,selection)}
}
