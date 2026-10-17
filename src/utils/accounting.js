// Shared accounting logic is also used by native inventory opening previews.
export * from '../../electron/accountingCore.mjs'

export function downloadCSV(content, filename) {
  const BOM  = '\uFEFF'  // UTF-8 BOM for Excel
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
