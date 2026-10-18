import {useEffect,useState} from 'react'
import useLockedDraft from './useLockedDraft'
import {emptyReceiptDraft,validReceiptDraft} from '../utils/receiptLotDraft.mjs'
import {receiptArchives,keepReceiptArchive} from '../utils/receiptLotArchive.mjs'
import {readPendingFinancial} from '../utils/financialCommand'

// Arrival-only history stays out of the shared stock-form chunk.
export default function useReceiptDraft(key){
 const draft=useLockedDraft(key,{empty:emptyReceiptDraft,valid:validReceiptDraft,maxLength:1000000,message:'到貨草稿讀不到，請保留原輸入',prefix:'pos-receipt-draft:',fileName:'arrival-draft.json'}),[archives,setArchives]=useState([])
 const refresh=()=>{try{setArchives(receiptArchives(localStorage,key))}catch{}}
 useEffect(()=>{setArchives([]);if(key)refresh()},[key,draft.status.ready])
 function keepAndReset(next){
  const old=draft.current();if(!old.ready||old.form.attempted||readPendingFinancial())throw Error('請先核對上一筆操作')
  draft.save();const raw=localStorage.getItem(key)
  try{keepReceiptArchive(localStorage,key,raw,old.form);draft.setForm(next);try{draft.save()}catch(error){draft.setForm(old.form);throw error}}finally{refresh()}
 }
 function downloadArchive(archiveKey){
  if(!receiptArchives(localStorage,key).includes(archiveKey))throw Error('舊稿無法保留，請先下載原輸入')
  const raw=localStorage.getItem(archiveKey);if(raw===null)throw Error('舊稿無法保留，請先下載原輸入')
  const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='arrival-draft-'+archiveKey.slice(-8)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return {...draft,archives,keepAndReset,downloadArchive}
}
