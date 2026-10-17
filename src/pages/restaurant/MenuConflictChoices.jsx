import {tr} from '../../i18n'

const labels={name:'名稱',price:'售價',priceDelta:'加減價',capacity:'占用產能',min:'至少選幾份',max:'最多選幾份',defaults:'預選',defaultVariantId:'預設份量',variants:'份量',groups:'選項組',choices:'選項',components:'每份用量',quantity:'每份用量',unit:'單位',qty:'份數',omit:'不使用的原料'}
const row=(list,id)=>list?.find(value=>value.id===id)
function trail(path,menus,products){
 const names=[];let candidates=menus
 for(let i=0;i<path.length;i++){
  const key=path[i]
  if(['offers','variants','groups','choices','components','defaults'].includes(key)&&i+1<path.length){const id=path[++i];candidates=candidates.map(value=>row(value?.[key],id)).filter(Boolean);names.push(candidates.find(value=>value.name)?.name||products.find(value=>value.id===id)?.name||tr(labels[key]||'餐點'))}
  else if(labels[key])names.push(tr(labels[key]))
 }
 return names.join(' · ')
}
function Value({value,products,menu,basis,field}){
 const name=id=>products.find(row=>row.id===id)?.name||menu?.offers.flatMap(offer=>[...offer.variants,...offer.groups.flatMap(group=>group.choices)]).find(row=>row.id===id)?.name||tr('已不存在的商品')
 if(value===undefined||value===null)return <span>{tr('移除')}</span>
 if(typeof value!=='object')return <span>{value===''?tr('尚未填完'):field==='defaultVariantId'||field==='omit'?name(value):String(value)}</span>
 if('quantity'in value&&'unit'in value){const unit=value.unit==='stock'?basis?.[value.id]||tr('原庫存單位'):value.unit==='twJin'?tr('台斤（600g）'):value.unit==='cnJin'?tr('市斤（500g）'):value.unit;return <span>{value.quantity===''?tr('尚未填完'):value.quantity} {unit}</span>}
 if(Array.isArray(value))return value.length?<ul>{value.map((entry,index)=><li key={index}><Value {...{value:entry,products,menu,basis,field}}/></li>)}</ul>:<span>{tr('無')}</span>
 if('row'in value)return <><p>{tr('所選份量或選項')}：{value.row?.name||tr('尚未填完')}{value.selection?' · '+value.selection.qty+' '+tr('份數'):''}</p><Value {...{value:value.row,products,menu,basis}}/></>
 if(Object.keys(value).every(key=>['id','qty'].includes(key)))return <span>{name(value.id)} · {value.qty} {tr('份數')}</span>
 return <dl>{Object.entries(value).filter(([key])=>Object.hasOwn(labels,key)).map(([key,entry])=><div key={key}><dt>{tr(labels[key])}</dt><dd><Value {...{value:entry,products,menu,basis,field:key}}/></dd></div>)}</dl>
}

export default function MenuConflictChoices({conflict,draft,basis,resolution,onChoice,onAll,onApply,busy,headingRef}){
 const selected=key=>resolution.choices.find(row=>row.key===key)?.choice||resolution.policy
 const remaining=conflict.plan.conflicts.filter(row=>!selected(row.key)).length
 return <section data-menu-conflicts className="menu-conflict-choices" aria-labelledby="menu-conflict-title">
  <h4 id="menu-conflict-title" tabIndex={-1} ref={headingRef}>{tr('這項要用哪個？')}</h4>
  <p>{tr('選擇後還不會改店內菜單。')}</p>
  {conflict.plan.conflicts.length>1&&<div className="menu-editor-actions">{['local','remote'].map(choice=><button key={choice} type="button" className="btn btn-ghost" data-menu-conflicts-all={choice} aria-pressed={resolution.policy===choice&&!resolution.choices.length} onClick={()=>onAll(choice)}>{tr(choice==='local'?'全部保留我填的':'全部用店內最新')}</button>)}</div>}
  {conflict.plan.conflicts.map(item=><article key={item.key} data-menu-conflict={item.key} data-menu-conflict-kind={item.kind} className="menu-editor-review">
   <h4>{trail(item.path,[draft,conflict.remote],conflict.products)}</h4>
   <div className="menu-editor-two">{['local','remote'].map(side=><div key={side} className="menu-conflict-value"><strong>{tr(side==='local'?'我填的':'店內最新')}</strong><div>{item[side]&&typeof item[side]==='object'&&item.kind!=='measurement'?<details><summary>{item[side].name||item[side].row?.name||tr('查看完整內容')}</summary><Value value={item[side]} products={conflict.products} menu={side==='local'?draft:conflict.remote} basis={side==='local'?basis:conflict.plan.basis}/></details>:<Value value={item[side]} products={conflict.products} field={item.path.at(-1)} menu={side==='local'?draft:conflict.remote} basis={side==='local'?basis:conflict.plan.basis}/>}</div><button type="button" className="btn btn-ghost" data-menu-conflict-choice={side} aria-pressed={selected(item.key)===side} onClick={()=>onChoice(item.key,side)}>{tr(side==='local'?'保留我填的':'用店內最新')}</button></div>)}</div>
  </article>)}
  <p role="status">{remaining?tr('還有 {0} 項待選擇',{0:remaining}):tr('已選好，可以套用。')}</p>
  <button type="button" className="btn btn-primary" data-menu-conflicts-apply disabled={busy||remaining>0} onClick={onApply}>{busy?tr('核對中…'):tr('套用選擇，再核對')}</button>
 </section>
}
