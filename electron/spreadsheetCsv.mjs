// Human-viewing spreadsheet CSV. Data-exchange serializers must remain separate:
// the tab guard is part of the exported text and must not alter stored data.
export function spreadsheetRowsCSV(rows){
  const cell=value=>{
    if(typeof value==='number'){
      if(!Number.isFinite(value))throw Error('匯出資料含有無效數值，請先核對原資料')
      return String(value)
    }
    let text=String(value??'')
    if(/^[\s\u0000-\u001f\uFEFF]*[=+\-@＝＋－＠]/u.test(text))text='\t'+text
    return '"'+text.replace(/"/g,'""')+'"'
  }
  return rows.map(row=>row.map(cell).join(',')).join('\n')
}
