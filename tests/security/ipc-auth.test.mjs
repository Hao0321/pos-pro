import { test, expect } from 'vitest'
import { createRequire } from 'node:module'
import { pbkdf2Sync } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const require=createRequire(import.meta.url),{createIpcSecurity}=require('../../electron/ipcSecurity.cjs')
const password=value=>JSON.stringify({salt:Array(32).fill(9),iter:1000,hash:[...pbkdf2Sync(value,Buffer.alloc(32,9),1000,32,'sha256')]})
function fixture(users=[]){
  const saved=users.map(u=>({...u})),rendererPath='D:/fixture/dist/index.html',frame={url:pathToFileURL(rendererPath).href},contents={mainFrame:frame}
  const db={getUsers:()=>saved,getProducts:()=>[{id:'p',price:10}],addUser:u=>saved.push(u),updateUser:(id,data)=>Object.assign(saved.find(u=>u.id===id),data),migrateFromLocalStorage:({users})=>saved.push(...users)}
  const security=createIpcSecurity({db,getWindow:()=>({isDestroyed:()=>false,webContents:contents}),rendererPath}),event={sender:contents,senderFrame:frame}
  return {saved,security,event}
}
test('first owner chooses credentials, no second bootstrap can overwrite them',()=>{
  const f=fixture();expect(f.security.setup(f.event,{username:'自訂店主',password:'custom-pass'}).role).toBe('owner')
  expect(()=>f.security.setup(f.event,{username:'attacker',password:'whatever'})).toThrow('已存在')
})
test('privileged IPC rejects unauthenticated callers and forged frame or page origins',()=>{
  const f=fixture();expect(()=>f.security.authorize(f.event,'db:exportData')).toThrow('登入')
  f.security.setup(f.event,{username:'owner',password:'owner-pass'})
  expect(()=>f.security.authorize({...f.event,senderFrame:{url:f.event.senderFrame.url}},'db:exportData')).toThrow('來源')
  f.event.senderFrame.url='https://attacker.invalid';expect(()=>f.security.authorize(f.event,'db:exportData')).toThrow('頁面')
})
test('native session uses stored credentials and role, revoking changes and denying staff backups and manual discounts',()=>{
  const f=fixture([{id:'staff',username:'staff',password:password('staff-pass'),role:'staff'}])
  f.security.login(f.event,{username:'staff',password:'staff-pass',role:'owner'})
  expect(f.security.authorize(f.event,'db:getProducts').role).toBe('staff')
  for(const channel of ['db:exportData','db:deleteUser','db:refundOrder','settings:set'])expect(()=>f.security.authorize(f.event,channel)).toThrow('權限')
  expect(()=>f.security.authorize(f.event,'settings:get',['orderTrackingSecret'])).toThrow('權限')
  expect(()=>f.security.authorize(f.event,'db:checkout',[{manualDiscount:1}])).toThrow('權限')
  f.saved[0].password=password('changed-pass');expect(f.security.current()).toBeNull()
})
test('legacy account import preserves custom names, roles and hashes and login listing hides credentials',()=>{
  const f=fixture(),legacy=[{id:'owner-custom',username:'自己',password:password('custom-pass'),role:'owner'}]
  expect(f.security.list(f.event,legacy)).toEqual([{id:'owner-custom',username:'自己',role:'owner'}]);expect(f.saved).toEqual(legacy)
  expect(f.security.list(f.event,[{id:'overwrite'}])).toHaveLength(1)
})
test('invalid legacy accounts cannot create a replacement empty/default account store',()=>{
  const f=fixture();expect(()=>f.security.list(f.event,[{id:'broken',username:'broken',password:'broken',role:'owner'}])).toThrow();expect(f.saved).toHaveLength(0)
})
test('known short legacy passwords require a real password upgrade before granting native access',()=>{
  const f=fixture([{id:'o',username:'o',role:'owner',password:password('1234')}])
  expect(f.security.login(f.event,{username:'o',password:'1234'})).toEqual({needsPasswordChange:true});expect(f.security.current()).toBeNull()
  expect(f.security.login(f.event,{username:'o',password:'1234',newPassword:'new-strong-pass'}).role).toBe('owner')
  expect(f.saved[0].password).not.toBe(password('1234'))
})
test('repeated credential failures enforce the native cooldown',()=>{
  const f=fixture([{id:'o',username:'o',role:'owner',password:password('owner-pass')}])
  for(let n=0;n<5;n++)expect(()=>f.security.login(f.event,{username:'o',password:'wrong'})).toThrow('錯誤')
  expect(()=>f.security.login(f.event,{username:'o',password:'owner-pass'})).toThrow('一分鐘')
})
