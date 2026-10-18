import {validReceiptDraft} from './receiptLotDraft.mjs'
import {keepDraftArchive} from './draftArchive.mjs'
export {keptDrafts as receiptArchives} from './draftArchive.mjs'
export function keepReceiptArchive(storage,key,raw,form,valid=validReceiptDraft){
 return keepDraftArchive(storage,key,raw,form,valid)
}
