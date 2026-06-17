/**
 * POS Pro Icon Generator v4
 * 金棕底 + 白色購物袋 + 置中金色 P
 */
const { Jimp } = require('jimp')
const fs = require('fs')
const path = require('path')

const SIZE = 256

async function generateIcon() {
  const img = new Jimp({ width: SIZE, height: SIZE, color: 0x00000000 })

  const WHITE = 0xFFFFFFFF
  const GOLD = 0xD4A84FFF

  function setP(x, y, color) {
    if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) img.setPixelColor(color, x, y)
  }

  function fillRect(x1, y1, w, h, color) {
    for (let y = y1; y < y1 + h && y < SIZE; y++)
      for (let x = x1; x < x1 + w && x < SIZE; x++)
        if (x >= 0 && y >= 0) setP(x, y, color)
  }

  // === 漸層圓角背景 ===
  const R = 48
  for (let y = 8; y < 248; y++) {
    for (let x = 8; x < 248; x++) {
      const lx = x - 8, ly = y - 8, w = 240, h = 240
      let inside = true
      if (lx < R && ly < R) inside = (R-lx)*(R-lx)+(R-ly)*(R-ly) <= R*R
      else if (lx>=w-R && ly<R) inside = (lx-w+R+1)*(lx-w+R+1)+(R-ly)*(R-ly) <= R*R
      else if (lx<R && ly>=h-R) inside = (R-lx)*(R-lx)+(ly-h+R+1)*(ly-h+R+1) <= R*R
      else if (lx>=w-R && ly>=h-R) inside = (lx-w+R+1)*(lx-w+R+1)+(ly-h+R+1)*(ly-h+R+1) <= R*R
      if (!inside) continue
      const t = (x + y) / (SIZE * 2)
      const rc = Math.round(0x8B + (0x5E - 0x8B) * t)
      const gc = Math.round(0x73 + (0x4A - 0x73) * t)
      const bc = Math.round(0x55 + (0x32 - 0x55) * t)
      setP(x, y, ((rc<<24)|(gc<<16)|(bc<<8)|0xFF)>>>0)
    }
  }

  // === 白色購物袋 ===
  const bagCX = 128, bagTopY = 95, bagBotY = 218

  for (let y = bagTopY; y < bagBotY; y++) {
    const t = (y - bagTopY) / (bagBotY - bagTopY)
    const halfW = Math.round(42 + t * 22)
    let cutoff = 0
    if (y > bagBotY - 20) {
      const d = y - (bagBotY - 20)
      cutoff = Math.round(d * d * 0.08)
    }
    for (let x = bagCX - halfW + cutoff; x <= bagCX + halfW - cutoff; x++) {
      setP(x, y, WHITE)
    }
  }

  // 提把
  for (let deg = 0; deg < 180; deg++) {
    const rad = deg * Math.PI / 180
    for (let t = -4; t <= 4; t++) {
      const rx = 28 + t * 0.05
      const ry = 24 + t * 0.05
      const x = Math.round(bagCX + Math.cos(Math.PI + rad) * rx)
      const y = Math.round(bagTopY - 2 + Math.sin(Math.PI + rad) * ry)
      for (let dx = -2; dx <= 2; dx++) setP(x + dx, y, WHITE)
    }
  }

  // === 金色 P 字母（像素精確，置中在袋子上）===
  // P 的整體尺寸: 寬36 高50
  // 袋子可見範圍 Y: 95~218，中心 Y ≈ 156
  // P 置中: left = 128 - 18 = 110, top = 156 - 25 = 131
  const PX = 110  // P 左邊起點
  const PY = 126  // P 上方起點
  const TH = 10   // 筆劃粗細

  // P 的豎線（左邊）: 整個高度
  fillRect(PX, PY, TH, 50, GOLD)

  // P 的上橫線
  fillRect(PX + TH, PY, 18, TH, GOLD)

  // P 的中橫線
  fillRect(PX + TH, PY + 20, 18, TH, GOLD)

  // P 的右弧（用右邊豎線近似）
  fillRect(PX + TH + 18, PY, TH, 30, GOLD)

  // 把右邊弧度做得圓一點：右上角和右下角削掉
  // 右上角圓弧
  for (let dy = 0; dy < 6; dy++) {
    for (let dx = 0; dx < 6 - dy; dx++) {
      setP(PX + TH + 18 + TH - 1 - dx, PY + dy, 0x00000000)
    }
  }
  // 右下角圓弧
  for (let dy = 0; dy < 6; dy++) {
    for (let dx = 0; dx < 6 - dy; dx++) {
      setP(PX + TH + 18 + TH - 1 - dx, PY + 30 - 1 - dy, 0x00000000)
    }
  }

  // 用圓弧補右側，讓 P 更圓潤
  const arcCX = PX + TH + 18
  const arcCY = PY + 15
  const arcR = 15
  for (let deg = -90; deg <= 90; deg++) {
    const rad = deg * Math.PI / 180
    for (let thick = 0; thick < TH; thick++) {
      const r = arcR - thick * 0.05
      const ax = Math.round(arcCX + Math.cos(rad) * r)
      const ay = Math.round(arcCY + Math.sin(rad) * r)
      setP(ax, ay, GOLD)
      setP(ax + 1, ay, GOLD)
    }
  }

  // === 儲存 ===
  const pngPath = path.join(__dirname, '../build/icon.png')
  const icoPath = path.join(__dirname, '../build/icon.ico')
  await img.write(pngPath)
  console.log('PNG saved:', pngPath)

  const sizes = [256, 128, 64, 48, 32, 16]
  const pngBuffers = []
  for (const s of sizes) {
    const resized = img.clone().resize({ w: s, h: s })
    pngBuffers.push(await resized.getBuffer('image/png'))
  }
  function buildIco(bufs) {
    const count = bufs.length, headerSize = 6 + count * 16
    let offset = headerSize
    const entries = bufs.map(buf => {
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20)
      const e = { w: w>=256?0:w, h: h>=256?0:h, size: buf.length, offset }
      offset += buf.length; return e
    })
    const ico = Buffer.alloc(offset)
    ico.writeUInt16LE(0,0); ico.writeUInt16LE(1,2); ico.writeUInt16LE(count,4)
    entries.forEach((e,i) => {
      const p = 6+i*16
      ico.writeUInt8(e.w,p); ico.writeUInt8(e.h,p+1)
      ico.writeUInt8(0,p+2); ico.writeUInt8(0,p+3)
      ico.writeUInt16LE(1,p+4); ico.writeUInt16LE(32,p+6)
      ico.writeUInt32LE(e.size,p+8); ico.writeUInt32LE(e.offset,p+12)
    })
    bufs.forEach((buf,i) => buf.copy(ico, entries[i].offset))
    return ico
  }
  fs.writeFileSync(icoPath, buildIco(pngBuffers))
  console.log('ICO saved:', icoPath)
}

generateIcon().catch(e => { console.error(e); process.exit(1) })
