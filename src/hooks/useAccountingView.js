import {useEffect,useMemo,useState} from 'react'
import {loadStockAccountingState} from '../utils/dataAccess'
// The report is one backend snapshot, not a mix of independently loaded pages.
// A dependency change hides the previous result immediately, before refetch.
export default function useAccountingView(store,session){
 const {orders,products,purchases,sales,supplierState,manualEntries,wasteLog,topups,restaurantConfig}=store
 const key=useMemo(()=>({}),[orders,products,purchases,sales,supplierState,manualEntries,wasteLog,topups,restaurantConfig,session?.userId,session?.role]),[read,setRead]=useState(null),[refresh,setRefresh]=useState(0)
 useEffect(()=>{const changed=()=>setRefresh(value=>value+1);window.addEventListener('pos-data-refreshed',changed);return()=>window.removeEventListener('pos-data-refreshed',changed)},[])
 useEffect(()=>{let cancelled=false;loadStockAccountingState().then(report=>{if(!cancelled)setRead({key,refresh,report})}).catch(error=>{if(!cancelled)setRead({key,refresh,error:error.message})});return()=>{cancelled=true}},[key,refresh])
 if(read?.key!==key||read?.refresh!==refresh)return {loading:true,journals:[]}
 if(read.error)return {loading:false,error:read.error,journals:[]}
 return {loading:false,report:read.report,journals:read.report.status==='active'?read.report.journals:store.allJournal||[]}
}
