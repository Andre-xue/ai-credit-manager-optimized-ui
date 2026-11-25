import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AGENT_TOOLS } from '../data/agentTools'

// 内存版 localStorage polyfill（node 环境）
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
;(globalThis as any).localStorage = new MemStorage()

import {
  loadCachedCatalog, setCatalogUrl, getCatalogUrl, currentCatalog,
  fetchCatalog, DEFAULT_CATALOG_URL, getUnseenTools, markCatalogSeen,
} from './agentCatalog'

describe('AI 工具目录实时更新层', () => {
  beforeEach(() => {
    ;(localStorage as any).clear()
    vi.unstubAllGlobals()
  })

  it('无缓存时 currentCatalog 回退内置快照', () => {
    const c = currentCatalog()
    expect(c.fromCache).toBe(false)
    expect(c.tools.length).toBe(AGENT_TOOLS.length)
    expect(c.updatedAt).toBe(null)
  })

  it('自定义数据源 URL 读写与重置', () => {
    expect(getCatalogUrl()).toBe(DEFAULT_CATALOG_URL)
    setCatalogUrl('https://example.com/catalog.json')
    expect(getCatalogUrl()).toBe('https://example.com/catalog.json')
    setCatalogUrl('not-a-url')
    expect(getCatalogUrl()).toBe(DEFAULT_CATALOG_URL)
  })

  it('拉取成功写入缓存并被 currentCatalog 采用', async () => {
    const snapshot = {
      version: 1, updatedAt: new Date().toISOString(), source: 'test',
      tools: [{ ...AGENT_TOOLS[0], usage: 9999, name: 'UpdatedTool' }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => snapshot,
    }))
    const r = await fetchCatalog(true)
    expect(r.ok).toBe(true)
    expect(loadCachedCatalog()?.tools[0].name).toBe('UpdatedTool')
    const c = currentCatalog()
    expect(c.fromCache).toBe(true)
    expect(c.tools[0].usage).toBe(9999)
  })

  it('网络失败返回 ok=false 且不影响内置回退', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const r = await fetchCatalog(true)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('offline')
    expect(currentCatalog().tools.length).toBe(AGENT_TOOLS.length)
  })

  it('数据格式无效视为失败', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ tools: 'not-array' }),
    }))
    const r = await fetchCatalog(true)
    expect(r.ok).toBe(false)
  })

  it('15 分钟内非强制刷新直接复用缓存，不重复请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, updatedAt: new Date().toISOString(), source: 'test', tools: AGENT_TOOLS }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await fetchCatalog(true)          // 强制拉取写入缓存
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await fetchCatalog(false)         // 非强制，命中缓存
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('目录上新提醒：首次只登记不提醒，之后只报新增', () => {
    const base = AGENT_TOOLS.slice(0, 3)
    expect(getUnseenTools(base)).toEqual([])           // 首次运行：登记全部，零提醒
    const withNew = [...base, { ...AGENT_TOOLS[3] }]
    const unseen = getUnseenTools(withNew)
    expect(unseen.map(t => t.id)).toEqual([AGENT_TOOLS[3].id])
    markCatalogSeen(withNew)                            // 用户看过后登记
    expect(getUnseenTools(withNew)).toEqual([])
  })
})
