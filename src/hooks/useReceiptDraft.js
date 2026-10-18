import useArchivedDraft from './useArchivedDraft'
import {emptyReceiptDraft,validReceiptDraft} from '../utils/receiptLotDraft.mjs'

// Arrival-only history stays out of the shared stock-form chunk.
export default function useReceiptDraft(key){
 return useArchivedDraft(key,{empty:emptyReceiptDraft,valid:validReceiptDraft,maxLength:1000000,message:'到貨草稿讀不到，請保留原輸入',prefix:'pos-receipt-draft:',fileName:'arrival-draft.json'})
}
