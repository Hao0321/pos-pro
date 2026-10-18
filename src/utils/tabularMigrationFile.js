export function readTabularText(file){
 if(file.size>80000)return Promise.reject(Error('表格太大，請拆成較小的檔案。'))
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('表格讀不到，請保留原檔並重新選取。'));reader.onload=()=>{try{resolve(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(reader.result))}catch{reject(Error('請將表格另存成 UTF-8 CSV，再選取檔案。'))}};reader.readAsArrayBuffer(file)})
}
