import {WORKBOOK_MAX_BYTES} from '../../electron/workbookZip.mjs'
export function readWorkbookFile(file){
 if(file.size>WORKBOOK_MAX_BYTES)return Promise.reject(Error('Excel 檔案太大，請拆成較小的檔案。'))
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Excel 檔案讀不到，請保留原檔並重新選取。'));reader.onload=()=>{try{const bytes=new Uint8Array(reader.result);if(bytes.length>WORKBOOK_MAX_BYTES)throw Error();let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));resolve({name:file.name,base64:btoa(raw)})}catch{reject(Error('Excel 檔案讀不到，請保留原檔並重新選取。'))}};reader.readAsArrayBuffer(file)})
}
