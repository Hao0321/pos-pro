/**
 * 條碼產生與標籤列印模組
 * 使用 ESC/POS 內建條碼指令直接在印表機上產生條碼
 * 預覽用 SVG 在 renderer 端由 JsBarcode 處理
 */

/**
 * 產生條碼文字（給無條碼商品自動產生）
 */
function generateBarcodeText(product) {
  if (product.barcode) return product.barcode
  // 用商品 ID 的後 8 位產生唯一條碼（時間戳後幾位才是不同的部分）
  const digits = product.id.replace(/\D/g, '')
  const code = digits.slice(-8).padStart(8, '0')
  return 'P' + code
}

/**
 * 產生條碼資料（回傳文字與格式，由 renderer 或印表機處理實際渲染）
 */
function generateBarcode(text, options = {}) {
  const barcodeText = text || ''
  return {
    success: true,
    text: barcodeText,
    format: options.format || 'CODE128',
  }
}

/**
 * 產生標籤資料
 */
function generateLabel(product) {
  const barcodeText = generateBarcodeText(product)
  return {
    success: true,
    barcodeText,
    product: {
      name: product.name,
      price: product.price,
      unit: product.unit || '個',
    },
  }
}

/**
 * 批次列印標籤到熱感印表機（使用 ESC/POS 內建條碼指令）
 */
async function printLabels(products, copies = 1, settings = {}) {
  const net = require('net')
  const { exec } = require('child_process')
  const fs = require('fs')
  const path = require('path')
  const os = require('os')

  const results = []

  for (const product of products) {
    const barcodeText = generateBarcodeText(product)
    const data = []

    for (let c = 0; c < copies; c++) {
      // 初始化
      data.push(Buffer.from([0x1B, 0x40]))
      // 置中
      data.push(Buffer.from([0x1B, 0x61, 0x01]))
      // 雙倍高度 - 品名
      data.push(Buffer.from([0x1D, 0x21, 0x01]))
      data.push(Buffer.from(product.name + '\n', 'utf8'))
      // 正常大小
      data.push(Buffer.from([0x1D, 0x21, 0x00]))
      // 價格
      data.push(Buffer.from('$' + product.price + ' / ' + (product.unit || '個') + '\n', 'utf8'))
      data.push(Buffer.from('\n', 'utf8'))

      // ESC/POS 條碼設定
      data.push(Buffer.from([0x1D, 0x48, 0x02])) // HRI 顯示在條碼下方
      data.push(Buffer.from([0x1D, 0x68, 0x50])) // 條碼高度 80
      data.push(Buffer.from([0x1D, 0x77, 0x02])) // 條碼寬度 2

      // CODE128 列印
      data.push(Buffer.from([0x1D, 0x6B, 0x49])) // Print CODE128
      const bcBuf = Buffer.from(barcodeText, 'ascii')
      data.push(Buffer.from([bcBuf.length]))
      data.push(bcBuf)

      data.push(Buffer.from('\n\n\n', 'utf8'))
      // 部分切紙
      data.push(Buffer.from([0x1D, 0x56, 0x01]))
    }

    try {
      await sendToPrinter(settings, data)
      results.push({ id: product.id, success: true })
    } catch (err) {
      results.push({ id: product.id, success: false, error: err.message })
    }
  }

  return { success: true, results }
}

async function sendToPrinter(settings, data) {
  const net = require('net')
  const { exec } = require('child_process')
  const fs = require('fs')
  const path = require('path')
  const os = require('os')

  const type = settings.printerType || 'network'
  if (type === 'network') {
    const ip = settings.printerIP || '192.168.1.100'
    const port = parseInt(settings.printerPort || '9100')
    return new Promise((resolve, reject) => {
      const client = new net.Socket()
      client.setTimeout(5000)
      client.connect(port, ip, () => {
        client.write(Buffer.concat(data), () => { client.end(); resolve() })
      })
      client.on('error', reject)
      client.on('timeout', () => { client.destroy(); reject(new Error('timeout')) })
    })
  } else {
    const tmpFile = path.join(os.tmpdir(), 'pos_label_' + Date.now() + '.bin')
    fs.writeFileSync(tmpFile, Buffer.concat(data))
    return new Promise((resolve, reject) => {
      exec(`copy /b "${tmpFile}" "${settings.printerName}"`, { shell: 'cmd.exe' }, (err) => {
        try { fs.unlinkSync(tmpFile) } catch {}
        if (err) reject(err); else resolve()
      })
    })
  }
}

module.exports = { generateBarcode, generateLabel, printLabels }
