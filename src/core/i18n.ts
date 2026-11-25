// ============================================================
// 国际化（v0.1.262）：简体中文（源语言）/ 繁体中文 / English / 日本語 / 한국어
// 方案：t('简体中文原文') —— 词条键即简体原文，查 i18nDict 得译文；
// 查不到时回退原文（简体），保证未抽取的长尾文案不报错、只是暂未翻译。
// 语言存于 settings.language（仅本机：云同步推送/备份导出均剥离，拉取/导入保留本机值），
// 同时镜像到 localStorage 供启动时先行生效。
// ============================================================
import { useEffect, useState } from 'react'
import { DICT } from './i18nDict'

export type Lang = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'

export const LANG_OPTIONS: Array<{ value: Lang; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
]

export const LANG_LOCALES: Record<Lang, string> = {
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
}

export const LANG_EVENT = 'acm-lang-changed'
const STORAGE_KEY = 'acm.lang'

function bootLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'zh-TW' || v === 'en' || v === 'ja' || v === 'ko') return v
  } catch { /* ignore */ }
  return 'zh-CN'
}

let current: Lang = bootLang()

export function getLang(): Lang {
  return current
}

export function locale(): string {
  return LANG_LOCALES[current]
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(LANG_EVENT)) } catch { /* ignore */ }
}

/** 翻译：src 为简体中文原文，可含 {name} 占位符，params 按名替换 */
export function t(src: string, params?: Record<string, string | number>): string {
  let out = src
  if (current !== 'zh-CN') {
    const entry = DICT[src]
    const translated = entry?.[current]
    if (translated) out = translated
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v))
  }
  return out
}

/** React 钩子：订阅语言变化，切换时整树重渲染（App 顶层调用一次即可带动全树） */
export function useLang(): Lang {
  const [lang, setLangState] = useState<Lang>(current)
  useEffect(() => {
    const on = () => setLangState(current)
    window.addEventListener(LANG_EVENT, on)
    return () => window.removeEventListener(LANG_EVENT, on)
  }, [])
  return lang
}
