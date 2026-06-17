import { useState, useEffect } from 'react'

// 共用：是否為窄螢幕（手機 / 平板直立）。
// 用 matchMedia 監聽斷點，只有在「跨越斷點」時才更新狀態，
// 不像監聽 resize 那樣每個 pixel 都 setState 造成整頁重渲染（尤其 iOS 捲動時網址列開合會狂觸發 resize）。
export default function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint}px)`
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false

  const [isMobile, setIsMobile] = useState(get)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (e) => setIsMobile(e.matches)
    setIsMobile(mql.matches) // 掛載當下對齊一次
    // 現代瀏覽器用 addEventListener；Safari < 14 fallback addListener
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [query])

  return isMobile
}
