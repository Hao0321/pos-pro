import {BROWSER_COLLECTIONS,browserToBook,bookToBrowser} from './recoveryRules.mjs'
import {convertSettingRows} from './settingEncoding.mjs'
import {canonicalSignature} from './operationRules.mjs'

const invalid=()=>Error('備份來源格式需要核對，請保留原檔')
export function detectBookStorage(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw invalid()
 const keys=Object.keys(data),native=new Set([...Object.keys(BROWSER_COLLECTIONS),'_revision']),browser=new Set(Object.values(BROWSER_COLLECTIONS))
 if(Object.hasOwn(data,'products')&&Object.hasOwn(data,'pos2_products'))throw invalid()
 for(const [marker,allowed,storage]of [['products',native,'sqlite'],['pos2_products',browser,'browser']])if(Object.hasOwn(data,marker)){
  if(keys.some(key=>!allowed.has(key)))throw Error('備份含有目前版本不支援的資料，請保留原檔並使用相容版本')
  return storage
 }
 throw invalid()
}
export function convertLogicalBook(book,from,to){
 if(!['sqlite','browser'].includes(from)||!['sqlite','browser'].includes(to))throw invalid()
 return {...structuredClone(book),settings:convertSettingRows(book.settings,from,to)}
}
export function convertStorageBook(data,from,to){
 const book=from==='sqlite'?structuredClone(data):browserToBook(data),converted=convertLogicalBook(book,from,to)
 if(to==='browser')return bookToBrowser(converted)
 delete converted._revision;return converted
}
export function assertConversionReversible(original,converted,from,to){
 const inverse=convertStorageBook(converted,to,from),source=structuredClone(original);delete source._revision
 if(canonicalSignature(source)!==canonicalSignature(inverse))throw invalid()
 return converted
}
