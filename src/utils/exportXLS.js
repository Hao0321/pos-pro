// 簡易 Excel 匯出（HTML→XLS，無需第三方套件）
// rows: [['標題1','標題2',...], ['資料1','資料2',...], ...]
export function exportXLS(rows, filename = 'export.xls') {
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = [
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">',
    '<head><meta charset="utf-8"></head><body><table border="1" style="border-collapse:collapse">',
    ...rows.map(r => '<tr>' + r.map(c => {
      const v = c == null ? '' : c
      const isNum = typeof v === 'number'
      return `<td${isNum ? ' x:num' : ''}>${esc(v)}</td>`
    }).join('') + '</tr>'),
    '</table></body></html>',
  ].join('')

  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xls') ? filename : filename + '.xls'
  a.click()
  URL.revokeObjectURL(url)
}

// 多工作表（Excel 不支援單一 .xls 檔多工作表 with this method，
// 但透過多個 worksheet 可以達成。為簡化，每張表獨立檔）
export function exportMultiSheetXLS(sheets, filename = 'export.xls') {
  // sheets: { sheetName: [[row...], ...] }
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const sheetXmls = Object.entries(sheets).map(([name, rows]) => `
    <Worksheet ss:Name="${esc(name)}">
      <Table>
        ${rows.map(r => '<Row>' + r.map(c => `<Cell><Data ss:Type="${typeof c === 'number' ? 'Number' : 'String'}">${esc(c)}</Data></Cell>`).join('') + '</Row>').join('')}
      </Table>
    </Worksheet>
  `).join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">${sheetXmls}</Workbook>`

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xls') ? filename : filename + '.xls'
  a.click()
  URL.revokeObjectURL(url)
}
