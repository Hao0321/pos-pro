import {useEffect,useMemo,useState} from 'react'
import {loadStockSalesState} from '../utils/dataAccess'

export default function useSalesReportView(store,session){
 const {orders,products,members,purchases,sales,supplierState,manualEntries,wasteLog,topups,restaurantConfig,reservationEntries}=store
 const key=useMemo(()=>({}),[orders,products,members,purchases,sales,supplierState,manualEntries,wasteLog,topups,restaurantConfig,reservationEntries,session?.userId,session?.role]),[read,setRead]=useState(null),[refresh,setRefresh]=useState(0)
 useEffect(()=>{const changed=()=>setRefresh(n=>n+1);window.addEventListener('pos-data-refreshed',changed);return()=>window.removeEventListener('pos-data-refreshed',changed)},[])
 useEffect(()=>{const now=new Date(),next=new Date(now);next.setHours(24,0,0,50);const timer=setTimeout(()=>setRefresh(n=>n+1),next-now);return()=>clearTimeout(timer)},[refresh])
 useEffect(()=>{let cancelled=false;loadStockSalesState(session).then(report=>{if(!cancelled)setRead({key,refresh,report})}).catch(error=>{if(!cancelled)setRead({key,refresh,error:error.message})});return()=>{cancelled=true}},[key,refresh])
 const retry=()=>setRefresh(n=>n+1)
 if(read?.key!==key||read?.refresh!==refresh)return {loading:true,retry}
 if(read.error)return {error:read.error,retry}
 return {report:read.report,retry}
}
