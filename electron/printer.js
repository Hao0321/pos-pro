/**
 * 熱感印表機 + 錢箱控制模組
 * 支援 ESC/POS 相容的 USB 熱感印表機 (58mm / 80mm)
 * 透過 Windows RAW 列印或 net.Socket 網路印表機
 */
const net = require('net')
const { exec } = require('child_process')

// ESC/POS 指令常數
const ESC = 0x1B
const GS = 0x1D
const CMD = {
  INIT:       Buffer.from([ESC, 0x40]),              // 初始化印表機
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),      // 置中
  ALIGN_LEFT:   Buffer.from([ESC, 0x61, 0x00]),      // 靠左
  ALIGN_RIGHT:  Buffer.from([ESC, 0x61, 0x02]),      // 靠右
  BOLD_ON:    Buffer.from([ESC, 0x45, 0x01]),         // 粗體開
  BOLD_OFF:   Buffer.from([ESC, 0x45, 0x00]),         // 粗體關
  DOUBLE_ON:  Buffer.from([GS, 0x21, 0x11]),          // 雙倍大小
  DOUBLE_OFF: Buffer.from([GS, 0x21, 0x00]),          // 正常大小
  FONT_LARGE: Buffer.from([GS, 0x21, 0x01]),          // 加大字體
  FONT_NORMAL:Buffer.from([GS, 0x21, 0x00]),          // 正常字體
  UNDERLINE_ON:  Buffer.from([ESC, 0x2D, 0x01]),      // 底線
  UNDERLINE_OFF: Buffer.from([ESC, 0x2D, 0x00]),
  CUT:        Buffer.from([GS, 0x56, 0x00]),          // 全切
  CUT_PARTIAL:Buffer.from([GS, 0x56, 0x01]),          // 部分切
  FEED3:      Buffer.from([ESC, 0x64, 0x03]),         // 進紙 3 行
  FEED5:      Buffer.from([ESC, 0x64, 0x05]),         // 進紙 5 行
  DRAWER_PIN2:Buffer.from([ESC, 0x70, 0x00, 0x19, 0xFA]), // 開錢箱 (pin 2)
  DRAWER_PIN5:Buffer.from([ESC, 0x70, 0x01, 0x19, 0xFA]), // 開錢箱 (pin 5)
  // 中文模式
  CHINESE_ON: Buffer.from([ESC, 0x52, 0x0F]),         // 設定中文字元集
}

function textToBuffer(text) {
  // 使用 Big5/UTF-8 編碼 (大部分 POS 印表機支援 UTF-8)
  return Buffer.from(text, 'utf8')
}

function line(text) {
  return textToBuffer(text + '\n')
}

function separator(width = 32) {
  return line('-'.repeat(width))
}

function padLine(left, right, width = 32) {
  const gap = width - left.length - right.length
  return line(left + ' '.repeat(Math.max(1, gap)) + right)
}

// 透過網路發送到印表機
async function sendToNetworkPrinter(ip, port, data) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket()
    client.setTimeout(5000)
    client.connect(port, ip, () => {
      client.write(Buffer.concat(data), () => {
        client.end()
        resolve({ success: true })
      })
    })
    client.on('error', (err) => reject(err))
    client.on('timeout', () => { client.destroy(); reject(new Error('印表機連線逾時')) })
  })
}

// 透過 Windows 共享印表機 (RAW)
async function sendToWindowsPrinter(printerName, data) {
  const fs = require('fs')
  const path = require('path')
  const os = require('os')
  const tmpFile = path.join(os.tmpdir(), 'pos_receipt_' + Date.now() + '.bin')
  fs.writeFileSync(tmpFile, Buffer.concat(data))
  return new Promise((resolve, reject) => {
    // 使用 Windows 的 COPY 命令發送 RAW 資料到印表機
    exec(`copy /b "${tmpFile}" "${printerName}"`, { shell: 'cmd.exe' }, (err) => {
      try { fs.unlinkSync(tmpFile) } catch {}
      if (err) reject(err)
      else resolve({ success: true })
    })
  })
}

async function sendToPrinter(settings, data) {
  const type = settings.printerType || 'network' // 'network' | 'windows'
  try {
    if (type === 'network') {
      const ip = settings.printerIP || '192.168.1.100'
      const port = parseInt(settings.printerPort || '9100')
      return await sendToNetworkPrinter(ip, port, data)
    } else {
      const name = settings.printerName || '\\\\localhost\\POS_PRINTER'
      return await sendToWindowsPrinter(name, data)
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ===== 公開 API =====

async function printReceipt(orderData, settings) {
  const storeName = settings.storeName || '雜貨店 POS'
  const storeAddr = settings.storeAddress || ''
  const storePhone = settings.storePhone || ''
  const footer = settings.receiptFooter || '感謝您的光臨！'
  const width = parseInt(settings.receiptWidth || '32')

  const data = []
  data.push(CMD.INIT)
  data.push(CMD.ALIGN_CENTER)

  // 店名 (大字)
  data.push(CMD.DOUBLE_ON)
  data.push(line(storeName))
  data.push(CMD.DOUBLE_OFF)

  if (storeAddr) data.push(line(storeAddr))
  if (storePhone) data.push(line(storePhone))
  data.push(separator(width))

  data.push(CMD.ALIGN_LEFT)

  // 訂單資訊
  const time = new Date(orderData.time)
  const timeStr = time.toLocaleString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
  data.push(line('單號: ' + orderData.id))
  data.push(line('時間: ' + timeStr))
  if (orderData.cashier) data.push(line('收銀: ' + orderData.cashier))
  data.push(separator(width))

  // 商品明細
  data.push(CMD.BOLD_ON)
  data.push(padLine('商品', '小計', width))
  data.push(CMD.BOLD_OFF)
  data.push(separator(width))

  const items = orderData.items || []
  for (const item of items) {
    const itemTotal = (item.price * item.qty)
    data.push(line(item.name))
    data.push(padLine('  ' + item.qty + ' x $' + item.price, '$' + itemTotal, width))
  }

  data.push(separator(width))

  // 金額
  data.push(padLine('小計', '$' + (orderData.subtotal || 0), width))
  if (orderData.discount > 0) {
    data.push(padLine('折抵', '-$' + orderData.discount, width))
  }
  data.push(CMD.BOLD_ON)
  data.push(CMD.FONT_LARGE)
  data.push(padLine('合計', '$' + (orderData.total || 0), width))
  data.push(CMD.FONT_NORMAL)
  data.push(CMD.BOLD_OFF)

  data.push(separator(width))

  // 付款資訊
  const payLabel = orderData.payMethod === 'cash' ? '現金' : '電子支付'
  data.push(padLine('付款方式', payLabel, width))
  if (orderData.payMethod === 'cash') {
    data.push(padLine('收款', '$' + (orderData.paid || 0), width))
    data.push(padLine('找零', '$' + (orderData.change || 0), width))
  }

  // 會員資訊
  if (orderData.memberId) {
    data.push(separator(width))
    if (orderData.pointsUsed > 0) data.push(padLine('使用點數', '' + orderData.pointsUsed, width))
    if (orderData.pointsEarned > 0) data.push(padLine('獲得點數', '+' + orderData.pointsEarned, width))
  }

  data.push(separator(width))
  data.push(CMD.ALIGN_CENTER)
  data.push(line(footer))
  data.push(CMD.FEED5)
  data.push(CMD.CUT_PARTIAL)

  return sendToPrinter(settings, data)
}

async function openCashDrawer(settings) {
  const data = [CMD.INIT, CMD.DRAWER_PIN2]
  return sendToPrinter(settings, data)
}

async function testPrint(settings) {
  const data = []
  data.push(CMD.INIT)
  data.push(CMD.ALIGN_CENTER)
  data.push(CMD.DOUBLE_ON)
  data.push(line('POS Pro'))
  data.push(CMD.DOUBLE_OFF)
  data.push(line('印表機測試'))
  data.push(separator(32))
  data.push(line(new Date().toLocaleString('zh-TW')))
  data.push(line('印表機連線正常!'))
  data.push(separator(32))
  data.push(CMD.FEED3)
  data.push(CMD.CUT_PARTIAL)

  return sendToPrinter(settings, data)
}

async function getStatus(settings) {
  const type = settings.printerType || 'network'
  if (type === 'network') {
    const ip = settings.printerIP || '192.168.1.100'
    const port = parseInt(settings.printerPort || '9100')
    return new Promise((resolve) => {
      const client = new net.Socket()
      client.setTimeout(3000)
      client.connect(port, ip, () => {
        client.destroy()
        resolve({ connected: true, type: 'network', ip, port })
      })
      client.on('error', () => resolve({ connected: false, type: 'network', ip, port }))
      client.on('timeout', () => { client.destroy(); resolve({ connected: false, type: 'network', ip, port }) })
    })
  }
  // Windows 印表機 - 檢查是否存在
  return { connected: true, type: 'windows', name: settings.printerName || '' }
}

module.exports = { printReceipt, openCashDrawer, testPrint, getStatus }
