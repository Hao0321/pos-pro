import {getDisplayPreferences, initDisplayPreferences, subscribeDisplayPreferences} from '../../public/i18n/preferences.mjs'
import {startupText} from '../../public/i18n/startup.mjs'

export function installStartupScreen(target = window) {
  const root = target.document.getElementById('root')
  if (!root) return () => {}
  const text = source => startupText(source, getDisplayPreferences().locale)
  const paint = () => {
    for (const element of root.querySelectorAll('[data-startup-text]')) {
      element.textContent = text(element.dataset.startupText)
    }
  }
  function report(event) {
    // React removes the splash when it mounts. A later error must never erase
    // the active cart or an unfinished document with a startup fallback.
    if (!root.querySelector('[data-startup-splash], [data-startup-error]')) return
    const panel = target.document.createElement('div')
    panel.dataset.startupError = ''
    panel.setAttribute('role', 'alert')
    panel.style.cssText = 'padding:32px;font-family:system-ui,sans-serif;overflow-wrap:anywhere'
    const title = target.document.createElement('h2')
    title.dataset.startupText = '啟動錯誤'
    const detail = target.document.createElement('pre')
    detail.style.cssText = 'white-space:pre-wrap;font-size:14px'
    if (event.message) detail.textContent = String(event.message)
    else detail.dataset.startupText = '程式未能啟動'
    const retry = target.document.createElement('button')
    retry.type = 'button'
    retry.className = 'btn btn-primary'
    retry.style.cssText = 'min-height:44px;padding:10px 20px'
    retry.dataset.startupText = '重新載入'
    retry.addEventListener('click', () => target.location.reload())
    panel.append(title, detail, retry)
    root.replaceChildren(panel)
    paint()
  }
  initDisplayPreferences()
  paint()
  const stop = subscribeDisplayPreferences(paint)
  target.addEventListener('error', report)
  return () => { stop(); target.removeEventListener('error', report) }
}
