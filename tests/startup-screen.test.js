// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it} from 'vitest'
import fs from 'node:fs'
import {installStartupScreen} from '../src/utils/startupScreen'
import {getDisplayPreferences, setDisplayPreferences} from '../public/i18n/preferences.mjs'
import {startupText} from '../public/i18n/startup.mjs'
import {tr} from '../public/i18n/core.mjs'

let stop
const report = message => window.dispatchEvent(new ErrorEvent('error', {message, cancelable: true}))
beforeEach(() => {
  localStorage.clear()
  setDisplayPreferences({locale: 'zh-TW', style: 'poster'})
  // Use the actual HTML splash so the mounted-screen guard cannot drift.
  const html = new DOMParser().parseFromString(fs.readFileSync('index.html', 'utf8'), 'text/html')
  document.body.replaceChildren(document.importNode(html.getElementById('root'), true))
})
afterEach(() => { stop?.(); stop = null; document.body.replaceChildren() })

it.each([
  ['zh-TW', '啟動中...', '啟動錯誤', '重新載入'],
  ['en', 'Starting...', 'Unable to start', 'Reload'],
  ['ja', '起動中...', '起動できませんでした', '再読み込み'],
  ['zh-CN', '启动中...', '启动失败', '重新载入'],
])('shows the actual splash and startup failure in %s', (locale, loading, title, reload) => {
  setDisplayPreferences({locale, style: 'simple'})
  localStorage.setItem('merchant-fixture', JSON.stringify({name: '首頁', stock: 10, total: 95}))
  const saved = JSON.stringify({...localStorage})
  stop = installStartupScreen()
  expect(document.documentElement.lang).toBe(locale)
  expect(document.documentElement.dataset.uiStyle).toBe('simple')
  expect(document.querySelector('[data-startup-splash]').textContent).toContain(loading)
  report('fixture: connection failed')
  expect(document.querySelector('[role=alert] h2').textContent).toBe(title)
  expect(document.querySelector('button').textContent).toBe(reload)
  expect(document.querySelector('pre').textContent).toBe('fixture: connection failed')
  expect(JSON.stringify({...localStorage})).toBe(saved)
})

it('translates an unknown startup failure live while retaining technical error details as text', () => {
  stop = installStartupScreen()
  report('')
  setDisplayPreferences({locale: 'ja'})
  expect(document.querySelector('pre').textContent).toBe('アプリを起動できませんでした。')
  const detail = '<img src=x onerror=alert(1)> fixture/path/123'
  report(detail)
  setDisplayPreferences({locale: 'en'})
  expect(document.querySelector('h2').textContent).toBe('Unable to start')
  expect(document.querySelector('pre').textContent).toBe(detail)
  expect(document.querySelector('pre img')).toBeNull()
})

it('never replaces an active app or its unfinished input after React has removed the splash', () => {
  stop = installStartupScreen()
  const root = document.getElementById('root')
  root.innerHTML = '<main><input aria-label="Unfinished note"><p>Cart: NT$ 95</p></main>'
  const field = root.querySelector('input')
  field.value = 'Alice <店> original draft'
  field.focus()
  report('fixture error after mount')
  expect(root.querySelector('input')).toBe(field)
  expect(field.value).toBe('Alice <店> original draft')
  expect(document.activeElement).toBe(field)
  expect(root.textContent).toContain('Cart: NT$ 95')
  expect(root.querySelector('[data-startup-error]')).toBeNull()
})

it('releases the error listener and language subscription when disposed', () => {
  stop = installStartupScreen()
  stop(); stop = null
  setDisplayPreferences({locale: 'en'})
  report('fixture after disposal')
  expect(document.querySelector('[data-startup-splash]').textContent).toContain('啟動中...')
  expect(document.querySelector('[data-startup-error]')).toBeNull()
})

it('keeps startup copy consistent with the full catalogue in all supported languages', () => {
  for (const locale of ['zh-TW', 'en', 'ja', 'zh-CN']) {
    for (const key of ['啟動中...', '啟動錯誤', '程式未能啟動', '重新載入', 'ERP・點餐・CRM']) {
      expect(startupText(key, locale)).toBe(tr(key, {}, locale))
    }
  }
  expect(startupText('__proto__', 'en')).toBe('__proto__')
  expect(startupText('啟動中...', 'unsupported')).toBe('啟動中...')
  expect(startupText('啟動中...', '__proto__')).toBe('啟動中...')
  expect(getDisplayPreferences().locale).toBe('zh-TW')
})
