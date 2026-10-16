// Keep the startup screen independent of React and the full translation bundle.
const messages = {
  'ERP・點餐・CRM': ['ERP · Ordering · CRM', 'ERP・注文・CRM', 'ERP・点餐・CRM', 29],
  '啟動中...': ['Starting...', '起動中...', '启动中...', 10000],
  '啟動錯誤': ['Unable to start', '起動できませんでした', '启动失败', 10001],
  '程式未能啟動': ['The app could not start.', 'アプリを起動できませんでした。', '程序未能启动', 10002],
  '重新載入': ['Reload', '再読み込み', '重新载入', 1],
}

export function startupText(source, locale) {
  const index = {en: 0, ja: 1, 'zh-CN': 2}[locale]
  return Number.isInteger(index) && Object.hasOwn(messages, source) ? messages[source][index] : source
}

export default messages
