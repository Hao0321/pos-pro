// Re-encode the approved ERP artwork for Windows and the web. No drawing or
// creative edits: the canonical generated image is public/brand/erp-logo.png.
const fs = require('node:fs')
const path = require('node:path')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], {
    env, windowsHide: true, encoding: 'utf8', timeout: 30000,
  })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.error) process.stderr.write(result.error.stack + '\n')
  process.exit(result.status === 0 && !result.error && result.stdout.includes('ERP_ICONS_WRITTEN') ? 0 : 1)
} else {
  const { app, nativeImage } = require('electron')
  app.disableHardwareAcceleration()
  app.whenReady().then(() => {
    const root = path.resolve(__dirname, '..')
    const master = nativeImage.createFromPath(path.join(root, 'public/brand/erp-logo.png'))
    const { width, height } = master.getSize()
    if (master.isEmpty() || width !== height || width < 512) throw Error('Square ERP master of at least 512 px required')
    const png = size => master.resize({ width: size, height: size, quality: 'best' }).toPNG()
    for (const [file, size] of [['build/icon.png', 512], ['public/icon-192.png', 192], ['public/icon-512.png', 512], ['public/apple-touch-icon.png', 180]]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), png(size))
    }
    const sizes = [256, 128, 64, 48, 32, 16], buffers = sizes.map(png)
    let offset = 6 + sizes.length * 16
    const ico = Buffer.alloc(offset + buffers.reduce((sum, b) => sum + b.length, 0))
    ico.writeUInt16LE(1, 2); ico.writeUInt16LE(sizes.length, 4)
    buffers.forEach((buffer, i) => {
      const at = 6 + i * 16
      ico[at] = ico[at + 1] = sizes[i] === 256 ? 0 : sizes[i]
      ico.writeUInt16LE(1, at + 4); ico.writeUInt16LE(32, at + 6)
      ico.writeUInt32LE(buffer.length, at + 8); ico.writeUInt32LE(offset, at + 12)
      buffer.copy(ico, offset); offset += buffer.length
    })
    fs.writeFileSync(path.join(root, 'build/icon.ico'), ico)
    console.log('ERP_ICONS_WRITTEN ' + JSON.stringify({ master: 'public/brand/erp-logo.png', sizes: [512, 192, 180, ...sizes] }))
    app.quit()
  }).catch(error => { console.error(error.stack); app.exit(1) })
}
