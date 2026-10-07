import { test, expect, vi } from 'vitest'
import fs from 'node:fs'
import { JSDOM } from 'jsdom'
import { exportXLS, exportMultiSheetXLS } from '../../src/utils/exportXLS.js'

test('actual menu renders special identifiers as data and keeps search and cart actions working', async () => {
  const dom = new JSDOM(fs.readFileSync('public/menu/index.html', 'utf8'), { url: 'https://store.invalid/menu/', runScripts: 'outside-only' })
  const malicious = 'p" data-action="resetApp"><img src=x onerror="alert(1)">', name = '<script>bad()</script> & 商品'
  const window = dom.window
  window.setInterval = vi.fn()
  window.fetch = vi.fn(async () => ({ json: async () => ({ success: true, storeName: '店家', categories: ['餐點'],
    products: [{ id: malicious, name, price: 10, stock: 5, unit: '個', category: '餐點' }],
  }) }))
  try {
    window.eval(fs.readFileSync('public/menu/app.js', 'utf8'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const document = window.document, button = document.querySelector('.add-btn')
    expect(button.dataset.pid).toBe(malicious); expect(button.hasAttribute('data-action')).toBe(false)
    expect(document.querySelector('.p-name').textContent).toBe(name)
    expect(document.querySelectorAll('#product-list img, #product-list script, #product-list [onerror]').length).toBe(0)
    button.click(); expect(document.getElementById('cart-badge').textContent).toBe('1')
    expect(document.querySelector('#cart-items [data-action="addToCart"]').dataset.pid).toBe(malicious)
    document.querySelector('#cart-items [data-action="addToCart"]').click()
    expect(document.getElementById('cart-badge').textContent).toBe('2')
    document.querySelector('#cart-items [data-action="removeFromCart"]').click()
    expect(document.getElementById('cart-badge').textContent).toBe('1')
    const search = document.getElementById('search-input'); search.value = '不存在'; search.dispatchEvent(new window.Event('input'))
    expect(document.querySelectorAll('.product-card').length).toBe(0)
    search.value = '商品'; search.dispatchEvent(new window.Event('input')); expect(document.querySelectorAll('.product-card').length).toBe(1)
    expect([...document.querySelectorAll('*')].flatMap(node => [...node.attributes]).some(attribute => /^on[a-z]+$/.test(attribute.name))).toBe(false)
  } finally { window.close() }
})

test('multi-sheet export escapes attribute names and cell markup with string types', async () => {
  const dom = new JSDOM(''), blobs = []
  vi.stubGlobal('document', dom.window.document)
  vi.spyOn(dom.window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob); return 'blob:test' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  try {
    const sheet = 'sheet" ss:Formula="=bad', text = '=HYPERLINK("https://attacker.invalid")<tag>&'
    exportMultiSheetXLS({ [sheet]: [[text, 12, Infinity, '\x00clean']] })
    const xml = new dom.window.DOMParser().parseFromString(await blobs[0].text(), 'application/xml')
    expect(xml.querySelector('parsererror')).toBeNull()
    const worksheet = xml.getElementsByTagName('Worksheet')[0], cells = [...xml.getElementsByTagName('Data')]
    expect(worksheet.getAttribute('ss:Name')).toBe(sheet); expect(worksheet.hasAttribute('ss:Formula')).toBe(false)
    expect(cells[0].textContent).toBe(text); expect(cells[0].getAttribute('ss:Type')).toBe('String')
    expect(cells[1].getAttribute('ss:Type')).toBe('Number'); expect(cells[2].getAttribute('ss:Type')).toBe('String')
    expect(cells[3].textContent).toBe('clean')
    exportXLS([[text, 12]])
    const html = new dom.window.DOMParser().parseFromString(await blobs[1].text(), 'text/html'), cell = html.querySelector('td')
    expect(cell.textContent).toBe(text); expect(cell.hasAttribute('x:str')).toBe(true); expect(html.querySelector('tag')).toBeNull()
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); dom.window.close() }
})
