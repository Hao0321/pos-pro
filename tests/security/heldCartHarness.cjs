const h=require('./memberProfileHarness.cjs');
async function nav(w,locale='zh-TW'){await h.nav(w,'pos',locale);await h.wait(w,'document.querySelector("[data-pos-page]")?.dataset.cartReady==="true"','actual working cart authority ready')}
async function raw(w){return h.js(w,'Object.keys(localStorage).filter(key=>key.startsWith("pos_workspace_draft_v1:")).map(key=>({key,raw:localStorage.getItem(key)})).map(row=>({...row,value:JSON.parse(row.raw)})).find(row=>row.value.kind==="working-cart"&&row.value.state.cartId)||null')}
async function cart(w,locale='zh-TW'){
 const selector='[aria-label='+h.q(h.t('開啟購物車',locale))+']';await h.wait(w,'!!document.querySelector('+h.q(selector)+')||!!document.querySelector("[data-cart-panel]")','actual cart render');if(await h.js(w,'!!document.querySelector('+h.q(selector)+')'))await h.tap(w,selector);await h.wait(w,'!!document.querySelector("[data-cart-panel]")','actual cart panel');
}
async function add(w,count=1,locale='zh-TW'){for(let n=0;n<count;n++)await h.tap(w,'.pos-card');await cart(w,locale);await h.wait(w,'Object.keys(localStorage).some(key=>{try{const row=JSON.parse(localStorage.getItem(key));return row.kind==="working-cart"&&row.state.cart.length>0}catch{return false}})','actual cart durably retained')}
async function closeCart(w,locale='zh-TW'){const selector='[aria-label='+h.q(h.t('關閉購物車',locale))+']';if(await h.js(w,'!!document.querySelector('+h.q(selector)+')'))await h.tap(w,selector)}
async function list(w,locale='zh-TW'){await closeCart(w,locale);await h.tap(w,'[aria-label='+h.q(h.t('取回掛單',locale))+']');await h.wait(w,'!!document.querySelector("[data-held-dialog]")','actual held list')}
function unrelated(book){const b=structuredClone(book);delete b.heldOrders;delete b._revision;b.settings=b.settings.filter(row=>row.key!=='heldCartOperationsV1');b.auditLog=b.auditLog.filter(row=>row.action!=='LOGIN');return b}
module.exports={...h,nav,raw,cart,add,closeCart,list,unrelated};
