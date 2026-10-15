const day=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value}
export function nextQuickQuestion(draft,context){
  if(!draft?.items?.length)return {field:'products',action:'先選商品',message:'先選你要的商品，再確認這張單。'}
  if(draft.kind==='purchase'){
    if(!context.suppliers.some(s=>s.id===draft.supplierId))return {field:'supplier',action:'下一步：選供應商',message:context.suppliers.length?'這張單要向哪一家叫貨？':'還沒有供應商，請先到廠商管理新增。'}
    if(!day(draft.date))return {field:'date',action:'下一步：選叫貨日期',message:'這張單要記在哪一天？'}
  }
  if(draft.kind==='restaurant'){
    if(!context.restaurantEnabled)return null
    if(!['preorder','walkin','delivery'].includes(draft.channel))return {field:'channel',action:'下一步：選交付方式',message:'客人要自取，還是外送？'}
    if(!day(draft.day))return {field:'day',action:'下一步：選取餐日期',message:'客人哪一天取餐？'}
    if(!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(draft.slot||''))return {field:'slot',action:'下一步：選取餐時間',message:'客人幾點取餐？每 15 分鐘一個時段。'}
    if(draft.channel!=='walkin'&&!draft.contact?.trim())return {field:'contact',action:'下一步：填聯絡方式',message:'留一個可以找到客人的電話或聯絡方式。'}
    if(draft.channel==='delivery'&&!draft.note?.trim())return {field:'note',action:'下一步：填外送地址',message:'要送到哪裡？請在備註填地址。'}
  }
  return null
}
