// v0.1.397 内嵌浏览器自动领：hash 结果解析、文案、记录回落的单测。
// 注意：Rust 注入脚本（lib.rs 的 AUTO_CLAIM_JS）本身无法在 vitest 里跑，
// 它的行为由无头验证 verify397.mjs 对着模拟 Epic 结账页实测；这里只覆盖
// TS 侧的纯逻辑 + 记录回落（396 手动兜底不断是底线）。
import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseEpicBrowserOutcome,
  epicBrowserOutcomeText,
  recordEpicBrowserOutcome,
  isEpicBrowserSupported,
  claimFailureFallback,
  EPIC_BROWSER_STATUS_KEY,
  loadEpicBrowserStatus,
  saveEpicBrowserStatus,
} from './epicBrowser'
import { readRecords, clearRecords, RECORDS_KEY } from './freeGames'

function ensureLocalStorage(): Map<string, string> {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.localStorage) {
    const m = new Map<string, string>()
    g.localStorage = {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, v) },
      removeItem: (k: string) => { m.delete(k) },
      clear: () => m.clear(),
    }
    return m
  }
  const ls = g.localStorage as { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void }
  ls.removeItem(RECORDS_KEY)
  ls.removeItem(EPIC_BROWSER_STATUS_KEY)
  return new Map()
}

describe('parseEpicBrowserOutcome', () => {
  it('从完整结账 URL 的 hash 里解析结果', () => {
    expect(parseEpicBrowserOutcome('https://www.epicgames.com/store/purchase?offers=1-ns-x#epic-claim=claimed')).toBe('claimed')
    expect(parseEpicBrowserOutcome('https://www.epicgames.com/store/purchase#epic-claim=challenge')).toBe('challenge')
    expect(parseEpicBrowserOutcome('#epic-claim=clicked')).toBe('clicked')
    expect(parseEpicBrowserOutcome('#epic-claim=needs-manual')).toBe('needs-manual')
    expect(parseEpicBrowserOutcome('#epic-claim=login')).toBe('login')
    expect(parseEpicBrowserOutcome('#epic-claim=timeout')).toBe('timeout')
  })
  it('没有标记或不认识的值返回 null', () => {
    expect(parseEpicBrowserOutcome('https://www.epicgames.com/store/purchase?offers=1-ns-x')).toBeNull()
    expect(parseEpicBrowserOutcome('#epic-claim=bogus')).toBeNull()
    expect(parseEpicBrowserOutcome('')).toBeNull()
    expect(parseEpicBrowserOutcome(null)).toBeNull()
    expect(parseEpicBrowserOutcome(undefined)).toBeNull()
  })
})

describe('epicBrowserOutcomeText', () => {
  it('每个结果都有中文文案，未知结果给默认文案', () => {
    for (const o of ['clicked', 'claimed', 'needs-manual', 'challenge', 'login', 'timeout']) {
      const t = epicBrowserOutcomeText(o)
      expect(t.length).toBeGreaterThan(5)
      expect(t).toMatch(/内嵌浏览器/)
    }
    expect(epicBrowserOutcomeText('bogus')).toContain('内嵌浏览器')
  })
})

describe('recordEpicBrowserOutcome', () => {
  beforeEach(() => { ensureLocalStorage(); clearRecords() })

  it('claimed 写领取成功记录', () => {
    expect(recordEpicBrowserOutcome('claimed', 'Mark of the Deep')).toBe(true)
    const rs = readRecords()
    expect(rs).toHaveLength(1)
    expect(rs[0].outcome).toBe('claimed')
    expect(rs[0].title).toBe('Mark of the Deep')
  })

  it('clicked 是中间态，不写记录', () => {
    expect(recordEpicBrowserOutcome('clicked', 'Mark of the Deep')).toBe(false)
    expect(readRecords()).toHaveLength(0)
  })

  it('失败结果写 error 记录并保留 checkoutUrl（396 手动兜底不断）', () => {
    const url = 'https://www.epicgames.com/store/purchase?highlightColor=0078f2&offers=1-ns-x&orderId&purchaseToken&showNavigation=true'
    for (const o of ['needs-manual', 'challenge', 'login', 'timeout']) {
      expect(recordEpicBrowserOutcome(o, 'Mark of the Deep', url)).toBe(true)
    }
    const rs = readRecords()
    expect(rs).toHaveLength(4)
    for (const r of rs) {
      expect(r.outcome).toBe('error')
      expect(r.checkoutUrl).toBe(url)
      expect(r.message).toContain('去浏览器领')
    }
    expect(rs.find(r => r.message.includes('人机验证'))).toBeTruthy()
    expect(rs.find(r => r.message.includes('没登录'))).toBeTruthy()
  })

  it('失败记录没带 checkoutUrl 时不写 checkoutUrl 字段', () => {
    recordEpicBrowserOutcome('challenge', 'Mark of the Deep')
    expect(readRecords()[0].checkoutUrl).toBeUndefined()
  })
})

describe('epicBrowserStatus 持久化', () => {
  it('保存后能读回', () => {
    ensureLocalStorage()
    saveEpicBrowserStatus('内嵌浏览器遇到人机验证，请在窗口内完成验证后再手动点领取')
    expect(loadEpicBrowserStatus()).toContain('人机验证')
  })
})

describe('isEpicBrowserSupported', () => {
  it('非桌面环境（vitest node）返回 false', () => {
    expect(isEpicBrowserSupported()).toBe(false)
  })
})

describe('claimFailureFallback（v0.1.404）', () => {
  it('非桌面（无 Tauri）直接走系统浏览器', () => {
    expect(claimFailureFallback()).toBe('external')
  })
  it('桌面（有 __TAURI_INTERNALS__）先走 App 内嵌浏览器', () => {
    const g = globalThis as unknown as Record<string, unknown>
    const prev = g.window
    g.window = { __TAURI_INTERNALS__: {} }
    try {
      expect(claimFailureFallback()).toBe('in-app')
    } finally {
      if (prev === undefined) delete g.window
      else g.window = prev
    }
  })
})
