import useLockedDraft from './useLockedDraft'
import {physicalQuantityUnits} from '../../electron/physicalStocktake.mjs'
const empty=()=>({productId:'',locationId:'main',kind:'shelf',counts:[],agentText:''})
const valid=form=>form&&Object.keys(form).length===5&&['productId','locationId','kind','agentText'].every(key=>typeof form[key]==='string')&&form.agentText.length<=65536&&['shelf','quarantined'].includes(form.kind)&&Array.isArray(form.counts)&&form.counts.length<=10000&&new Set(form.counts.map(row=>row.key)).size===form.counts.length&&form.counts.every(row=>row&&Object.keys(row).length===4&&['key','raw','digest','epoch'].every(key=>typeof row[key]==='string'&&row[key].length<=1024))
export default function useLotCountDraft(key){
 const draft=useLockedDraft(key,{empty,valid,maxLength:1000000,message:"批次草稿讀不到，請保留原資料",prefix:"pos-lot-count-draft:",fileName:"lot-count-draft.json"})
 function finish(request){const {form:value,ready}=draft.current();if(!ready||request.action!=='count')return;const matches=row=>request.counts.some(count=>{try{return /^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(row.raw.trim())&&count.key===row.key&&physicalQuantityUnits(Number(row.raw))===count.quantityUnits&&row.digest===request.expectedStateDigest&&row.epoch===request.epoch}catch{return false}}),next={...value,counts:value.counts.filter(row=>!matches(row))};if(next.counts.length===value.counts.length)return;if(!next.counts.length)next.agentText='';draft.setForm(next);try{draft.save()}catch{}}
 return {...draft,finish}
}
