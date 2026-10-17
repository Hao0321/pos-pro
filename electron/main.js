const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const os = require('os')

let mainWindow = null
let db = null
let orderServer = null
let ipcSecurity = null
let sharedStore = null
let kitchenPrintWorker = null
let closing = false
let shutdownComplete = false
const stop = require('./shutdown.cjs')({
  stopServices: () => [() => kitchenPrintWorker?.stop(), () => sharedStore?.stop(), () => orderServer?.close()],
  closeDatabase: () => { if (db) { db.close(); db = null } },
})
const rendererPath = path.resolve(__dirname, '../dist/index.html')

// 單一實例鎖定
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function getLocalIP() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'POS Pro｜ERP・點餐・CRM',
    icon: path.join(__dirname, '../dist/icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === mainWindow?.webContents && !!ipcSecurity?.current() && permission === 'media' &&
      details.mediaTypes?.length > 0 && details.mediaTypes.every(type => type === 'video'))
  })
  // 載入 renderer
  const isDev = !app.isPackaged
  if (isDev) {
    // 生產模式用 build 好的 dist
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ===== 初始化 =====
if (gotLock) app.whenReady().then(async () => {
  // 初始化 SQLite 資料庫
  const initDatabase = require('./database')
  const dbPath = path.join(app.getPath('userData'), 'pos-data.db')
  db = initDatabase(dbPath)
  sharedStore=require('./sharedStoreServer.cjs')({db,distRoot:path.resolve(__dirname,'../dist'),certificateRoot:path.join(app.getPath('userData'),'shared-store'),orderingStatus:()=>({running:orderServer?.isRunning?.()===true,ip:getLocalIP(),port:orderServer?.getActualPort?.()||null,tunnelUrl:orderServer?.getTunnelUrl?.()||null}),onChanged:()=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('store:changed')}})
  kitchenPrintWorker=require('./kitchenPrintWorker.cjs')({db,onError:error=>console.error('[POS] 廚房送印結果需核對:',error.message)})
  kitchenPrintWorker.start()

  // 啟動顧客點餐伺服器
  try {
    const startOrderServer = require('./server')
    const serverPort = db.getSetting('serverPort') || '3080'
    orderServer = startOrderServer(parseInt(serverPort), db, () => mainWindow)
  } catch (err) {
    console.log('[POS] 點餐伺服器啟動失敗，POS 功能正常:', err.message)
  }

  ipcSecurity = require('./ipcSecurity.cjs').createIpcSecurity({ db, getWindow: () => mainWindow, rendererPath })

  // 註冊所有 IPC handlers
  registerIpcHandlers()

  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})

// app.quit() does not emit window-all-closed. All normal quit paths must pass
// the same network barriers before SQLite closes; failure keeps data open.
app.on('will-quit', event => {
  if (shutdownComplete) return
  event.preventDefault()
  if (closing) return
  closing = true
  stop().then(() => { shutdownComplete = true; app.quit() }).catch(error => {
    closing = false
    console.error('[POS] 安全關閉未完成:', error)
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    dialog.showErrorBox('尚未安全關閉', '有連線還沒停止，系統已保留資料並回到畫面。請稍後再關閉一次。')
  })
})

app.on('activate', () => {
  if (mainWindow === null && !closing && !shutdownComplete) createWindow()
})

// ===== IPC Handlers =====
function registerIpcHandlers() {
  return require('./ipcHandlers.cjs')({ipcMain,db,ipcSecurity,getOrderServer:()=>orderServer,getLocalIP,sharedStore})
}
