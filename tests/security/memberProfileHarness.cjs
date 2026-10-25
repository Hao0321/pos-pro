const h=require('./tableKitchenHarness.cjs'),{MEMBER_PROFILE_JOURNAL,readMemberProfileJournal}=require('../../electron/memberProfile.mjs');
const q=JSON.stringify;
async function nav(w,key='members',locale='zh-TW'){
 const menu='[aria-label='+q(h.t('開啟功能選單',locale))+']';if(await h.js(w,'!!document.querySelector('+q(menu)+')'))await h.tap(w,menu);
 if(!await h.js(w,'!!document.querySelector("[data-nav='+key+']")?.getClientRects().length'))await h.button(w,h.t('全部功能',locale));
 await h.tap(w,'[data-nav='+key+']');await h.wait(w,'document.querySelector("main")?.dataset.view==='+q(key),'actual member view '+key);
 if(key==='members')await h.wait(w,'!!document.querySelector("[data-member-profile-ready=true]")','actual member draft authority ready');
}
const epoch=(w,value)=>h.js(w,'window.__memberProfileEpoch='+q(value));
const raw=w=>h.js(w,'Object.keys(localStorage).filter(k=>k.startsWith("pos_workspace_draft_v1:")).map(key=>({key,raw:localStorage.getItem(key)})).map(row=>{try{return {...row,value:JSON.parse(row.raw)}}catch{return row}}).find(row=>row.value?.kind==="member-profile"&&row.value.context.epoch===window.__memberProfileEpoch)||null');
async function dialog(w){await h.wait(w,'!!document.querySelector("[data-member-profile-dialog]")&&document.querySelector("[data-member-profile-field=name]")?.matches(":enabled")','actual editable member form');await h.js(w,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');await new Promise(resolve=>setTimeout(resolve,80))}
async function open(w,id=null){if(await h.js(w,'!!document.querySelector("[data-member-close]")?.getClientRects().length'))await h.tap(w,'[data-member-close]');await h.tap(w,id?'[data-member-edit='+id+']':'[data-member-new]');await dialog(w)}
async function resume(w){await h.wait(w,'document.querySelector("[data-member-profile-resume]")?.matches(":enabled")','member continuation ready');await h.tap(w,'[data-member-profile-resume]');await dialog(w)}
async function field(w,key,value){if(['birthday','note'].includes(key)&&!await h.js(w,'document.querySelector("[data-member-profile-more]").open'))await h.tap(w,'[data-member-profile-more] summary');await h.input(w,'[data-member-profile-field='+key+']',value);await h.wait(w,'Object.keys(localStorage).some(k=>{try{const v=JSON.parse(localStorage.getItem(k));return v.kind==="member-profile"&&v.context.epoch===window.__memberProfileEpoch&&v.state.form['+q(key)+']==='+q(value)+'}catch{return false}})','exact member raw input retained')}
async function close(w){await h.tap(w,'[data-member-profile-close]');await h.wait(w,'!document.querySelector("[data-member-profile-dialog]")','member form set aside')}
async function saved(w){await h.wait(w,'!document.querySelector("[data-member-profile-dialog]")&&!document.querySelector("[data-member-profile-resume]")','member original save confirmed');await h.wait(w,'!Object.keys(localStorage).some(k=>{try{const v=JSON.parse(localStorage.getItem(k));return v.kind==="member-profile"&&v.context.epoch===window.__memberProfileEpoch}catch{return false}})','member draft cleared after authority acknowledgement')}
function unrelated(book){const result=structuredClone(book);delete result.members;delete result._revision;result.settings=result.settings.filter(row=>row.key!==MEMBER_PROFILE_JOURNAL);return result}
const journal=db=>readMemberProfileJournal(db.getSetting(MEMBER_PROFILE_JOURNAL));
module.exports={...h,nav,epoch,raw,dialog,open,resume,field,close,saved,unrelated,journal};
