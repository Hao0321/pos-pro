// 商品分類預設清單 — 雜貨店常見類別
// 不強制使用，使用者可以自訂任何分類字串（datalist 仍支援自由輸入）
export const DEFAULT_CATEGORIES = [
  '雜貨',
  '生鮮',
  '冷凍',
  '蔬果',
  '調味料',
  '米糧',
  '乾貨',
  '豆類',
  '粉類',
  '飲料',
  '零食',
  '糖果',
  '肉品',
  '海鮮',
  '日用品',
  '清潔用品',
  '紙類',
]

// 每個分類的 icon emoji + 顯示色（給 UI 用）
export const CATEGORY_META = {
  '雜貨':     { icon: '🛒', color: 'var(--text-secondary)' },
  '生鮮':     { icon: '🐟', color: 'var(--blue)' },
  '冷凍':     { icon: '❄️',  color: 'var(--blue)' },
  '蔬果':     { icon: '🥬', color: 'var(--green)' },
  '調味料':   { icon: '🧂', color: 'var(--amber)' },
  '米糧':     { icon: '🌾', color: 'var(--gold)' },
  '乾貨':     { icon: '🥜', color: 'var(--gold)' },
  '豆類':     { icon: '🫘', color: 'var(--gold)' },
  '粉類':     { icon: '🌾', color: 'var(--gold)' },
  '飲料':     { icon: '🥤', color: 'var(--teal)' },
  '零食':     { icon: '🍪', color: 'var(--purple)' },
  '糖果':     { icon: '🍬', color: 'var(--pink)' },
  '肉品':     { icon: '🥩', color: 'var(--red)' },
  '海鮮':     { icon: '🦐', color: 'var(--blue)' },
  '日用品':   { icon: '🧴', color: 'var(--text-secondary)' },
  '清潔用品': { icon: '🧼', color: 'var(--teal)' },
  '紙類':     { icon: '🧻', color: 'var(--text-secondary)' },
}

// 合併 preset + 使用者已建立的分類，去重後回傳完整清單
export function mergeCategories(existing = []) {
  const set = new Set([...DEFAULT_CATEGORIES, ...existing.filter(Boolean)])
  return Array.from(set)
}

// 按分類分組商品 — 用於 dropdown optgroup 或 supplier 詳情頁
// 回傳 [{ category: '雜貨', products: [...] }, ...]，未分類的歸到「未分類」最後
export function groupByCategory(products) {
  const groups = new Map()
  for (const p of products) {
    const cat = p.category || '未分類'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat).push(p)
  }
  const sorted = []
  // 先依 DEFAULT_CATEGORIES 順序
  for (const c of DEFAULT_CATEGORIES) {
    if (groups.has(c)) {
      sorted.push({ category: c, products: groups.get(c) })
      groups.delete(c)
    }
  }
  // 其餘自訂分類
  for (const [c, products] of groups) {
    if (c !== '未分類') sorted.push({ category: c, products })
  }
  // 未分類墊底
  if (groups.has('未分類')) sorted.push({ category: '未分類', products: groups.get('未分類') })
  return sorted
}
