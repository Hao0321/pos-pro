const { pathToFileURL } = require('node:url')
const { pbkdf2Sync, timingSafeEqual, randomBytes, randomUUID } = require('node:crypto')
function passwordRecord(value) {
  const p = typeof value === 'string' ? JSON.parse(value) : value
  if (!p || !Array.isArray(p.hash) || p.hash.length !== 32 || !Array.isArray(p.salt) ||
      p.salt.length < 8 || p.salt.length > 128 || !Number.isInteger(p.iter) || p.iter < 1000 || p.iter > 1000000 ||
      [...p.hash,...p.salt].some(n=>!Number.isInteger(n)||n<0||n>255)) throw new Error('帳號密碼紀錄格式錯誤')
  return p
}
function hashPassword(password) {
  const salt = randomBytes(32), iter = 200000
  return JSON.stringify({hash:[...pbkdf2Sync(password,salt,iter,32,'sha256')],salt:[...salt],iter})
}
function verifyPassword(password, stored) {
  try {
    if (typeof password !== 'string' || password.length > 512) return false
    const p = passwordRecord(stored)
    return timingSafeEqual(pbkdf2Sync(password,Buffer.from(p.salt),p.iter,32,'sha256'),Buffer.from(p.hash))
  } catch { return false }
}
const staffChannels = new Set(['db:getProducts','db:addProduct','db:updateProduct','db:findByBarcode',
  'db:getMembers','db:addMember','db:updateMember','db:getOrders','db:getOrderItems','db:checkout','db:checkoutReceipt',
  'db:getCustomerOrders','db:updateOrderStatus','db:getSuppliers','db:getPurchases','db:getPromotions',
  'db:getHeldOrders','db:addHeldOrder','db:deleteHeldOrder','db:getShifts','db:getOpenShift','db:openShift','db:closeShift',
  'db:getCashLog','db:addCashLog','db:getWasteLog','db:addWaste','db:addTopup','db:getTopups','db:writeAuditLog',
  'printer:printReceipt','printer:openCashDrawer','printer:getStatus','barcode:generate','barcode:generateLabel',
  'barcode:printLabels','server:getLocalIP','server:getStatus','settings:get'])
function createIpcSecurity({db,getWindow,rendererPath,now=Date.now}) {
  let session = null, credential = null, failures = 0, lockedUntil = 0
  const expected = pathToFileURL(rendererPath).href
  function trusted(event) {
    const w=getWindow()
    if (!w || w.isDestroyed() || event.sender!==w.webContents || event.senderFrame!==w.webContents.mainFrame)
      throw new Error('拒絕未授權的 IPC 來源')
    const url=new URL(event.senderFrame.url)
    url.hash='';url.search=''
    if (url.href!==expected) throw new Error('拒絕未授權的 IPC 頁面')
  }
  function current() {
    const user=session && db.getUsers().find(u=>u.id===session.userId)
    if (!user || user.password!==credential || user.role!==session.role || now()>=session.expiresAt) {session=null;credential=null}
    return session
  }
  function grant(user) {
    credential=user.password
    session={token:randomBytes(32).toString('hex'),userId:user.id,username:user.username,role:user.role,
      loginAt:now(),expiresAt:now()+8*60*60*1000}
    failures=0;lockedUntil=0
    return {...session}
  }
  function authorize(event,channel,args=[]) {
    trusted(event)
    const s=current()
    if (!s) throw new Error('請先登入，或重新驗證身份')
    if (s.role!=='owner' && !staffChannels.has(channel)) throw new Error('權限不足')
    if (s.role!=='owner' && channel==='settings:get' && !['pointsEarnRate','pointsRedeemRate','birthdayBonus','dailySalesGoal'].includes(args[0]))
      throw new Error('權限不足')
    if(s.role!=='owner' && ['db:addMember','db:updateMember'].includes(channel)){
      const input=channel==='db:addMember'?args[0]:args[1],old=channel==='db:updateMember'?db.getMembers().find(m=>m.id===args[0]):null
      for(const key of ['balance','points','totalSpent','tier','lastBirthdayBonus'])if(input[key]!=null&&input[key]!==(old?.[key]??(key==='tier'?'normal':key==='lastBirthdayBonus'?'':0)))throw new Error('會員點數、儲值與累計消費需經交易異動')
    }
    if (s.role!=='owner' && channel==='db:checkout') {
      const o=args[0]
      if (o?.manualDiscount || o?.items?.some(i=>i.price!==db.getProducts().find(p=>p.id===i.id)?.price))
        throw new Error('員工沒有改價或手動折讓權限')
    }
    return s
  }
  return {
    trusted,authorize,current,
    list(event,legacy=[]) {
      trusted(event)
      if (!db.getUsers().length && Array.isArray(legacy) && legacy.length) {
        const ids=new Set(),names=new Set()
        for (const u of legacy) {
          passwordRecord(u.password)
          if (!u.id || !u.username || !['owner','staff'].includes(u.role) || ids.has(u.id) || names.has(u.username)) throw new Error('舊帳號格式錯誤，請保留備份')
          ids.add(u.id);names.add(u.username)
        }
        if (!legacy.some(u=>u.role==='owner')) throw new Error('舊帳號缺少管理員，請先復原帳號備份')
        db.migrateFromLocalStorage({users:legacy})
      }
      return db.getUsers().map(({id,username,role})=>({id,username,role}))
    },
    setup(event,{username,password}={}) {
      trusted(event)
      if (db.getUsers().length) throw new Error('管理帳號已存在')
      if (typeof username!=='string'||!username.trim()||username.length>100||typeof password!=='string'||password.length<8||password.length>512)
        throw new Error('請填寫管理員名稱及至少 8 字元密碼')
      const user={id:'u'+randomUUID(),username:username.trim(),password:hashPassword(password),role:'owner'}
      db.addUser(user)
      return grant(user)
    },
    login(event,{username,password,newPassword}={}) {
      trusted(event)
      if (now()<lockedUntil) throw new Error('嘗試次數過多，請一分鐘後再試')
      const user=db.getUsers().find(u=>u.username===username)
      if (!user || !['owner','staff'].includes(user.role) || !verifyPassword(password,user.password)) {
        if (++failures>=5) lockedUntil=now()+60000
        throw new Error('帳號或密碼錯誤')
      }
      if (password.length<8) {
        if (typeof newPassword!=='string'||newPassword.length<8||newPassword.length>512||newPassword===password)
          return {needsPasswordChange:true}
        user.password=hashPassword(newPassword);db.updateUser(user.id,{password:user.password})
      }
      return grant(user)
    },
    logout(event) { trusted(event);session=null;credential=null;return true },
    validateUser(data) { passwordRecord(data.password);if (!['owner','staff'].includes(data.role)||typeof data.username!=='string'||!data.username.trim()||data.username.length>100) throw new Error('帳號格式錯誤') },
  }
}
module.exports={createIpcSecurity,verifyPassword,passwordRecord}
