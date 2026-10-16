const {BROWSER_JSON_ENCODING,validateSettingRows,settingValue,nativeSettingText}=require('./settingEncoding.mjs')
module.exports=function databaseSettings(db){
 const get=db.prepare('SELECT key,value,value_encoding,row_id FROM settings WHERE key=?'),all=db.prepare('SELECT key,value,value_encoding,row_id FROM settings'),put=db.prepare('INSERT OR REPLACE INTO settings (key,value,value_encoding,row_id) VALUES (?,?,?,?)')
 function exported(row){
  if(!row)return null
  if(![0,1].includes(row.value_encoding))throw Error('備份設定格式需要核對，請保留原檔')
  return validateSettingRows([{key:row.key,value:row.value,...(row.row_id!==null?{id:row.row_id}:{}),...(row.value_encoding===1?{encoding:BROWSER_JSON_ENCODING}:{})}],'sqlite')[0]
 }
 return {
  getSetting:{get(key){const row=exported(get.get(key));return row?{value:nativeSettingText(row)}:undefined}},
  getTypedSetting:{get(key){const row=exported(get.get(key));return row?{value:settingValue(row,'sqlite')}:undefined}},
  getAllSettings:{all:()=>all.all().map(exported)},
  setSetting:{run(key,value){const old=exported(get.get(key)),encoded=old?.encoding===BROWSER_JSON_ENCODING,row={key,value:encoded?JSON.stringify(value):value==null?null:String(value),...(encoded?{encoding:BROWSER_JSON_ENCODING}:{}),...(old&&Object.hasOwn(old,'id')?{id:old.id}:{})};validateSettingRows([row],'sqlite');return put.run(key,row.value,encoded?1:0,old?.id??null)}},
  setRawSetting:{run(row){validateSettingRows([row],'sqlite');return put.run(row.key,row.value,row.encoding===BROWSER_JSON_ENCODING?1:0,row.id??null)}},
 }
}
