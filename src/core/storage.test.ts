import { describe, it, expect, beforeEach } from 'vitest'
import { loadStoragePrefs, saveStoragePrefs, storageDir, DEFAULT_STORAGE_PREFS } from './storagePrefs'
import { serializeApiKeyRows, apiKeyFileName, type ApiKeyRow } from './apiKeyStorage'
import { buildArchiveMarkdown, archiveFileName } from './archiveExport'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
;(globalThis as any).localStorage = new MemStorage()

beforeEach(() => { (globalThis as any).localStorage.clear() })

describe('storagePrefs', () => {
  it('默认全关，storageDir 返回 null', () => {
    const p = loadStoragePrefs()
    expect(p.enabled).toBe(false)
    expect(storageDir('apikey', p)).toBeNull()
    expect(storageDir('ai', p)).toBeNull()
  })

  it('总开关+子类开关+目录齐备才生效，互不影响', () => {
    const p = structuredClone(DEFAULT_STORAGE_PREFS)
    p.enabled = true
    p.apikey.dir = '/data/keys'
    p.ai.dir = '/data/ai'
    p.media.enabled = false
    p.media.dir = '/data/media'
    saveStoragePrefs(p)
    const loaded = loadStoragePrefs()
    expect(storageDir('apikey', loaded)).toBe('/data/keys')
    expect(storageDir('ai', loaded)).toBe('/data/ai')
    expect(storageDir('media', loaded)).toBeNull()
    expect(storageDir('apikey', { ...loaded, enabled: false })).toBeNull()
  })
})

describe('apiKeyStorage serializers', () => {
  const rows: ApiKeyRow[] = [
    { platform: 'DeepSeek', label: '主力', key: 'sk-abc|123', apiUrl: 'https://api.deepseek.com', note: 'a<b', updatedAt: '2026-11-21' },
    { platform: 'Kimi', label: '备用', key: 'sk-def', apiUrl: '', note: '', updatedAt: '' },
  ]
  const now = new Date(2026, 10, 21, 22, 0)

  it('md 表格转义竖线', () => {
    const md = serializeApiKeyRows(rows, 'plain', 'md', now)
    expect(md).toContain('sk-abc\\|123')
    expect(md).toContain('| DeepSeek | 主力 |')
    expect(apiKeyFileName('md')).toBe('apikeys.md')
  })

  it('json 结构完整', () => {
    const parsed = JSON.parse(serializeApiKeyRows(rows, 'cipher', 'json', now))
    expect(parsed.kind).toBe('apikey-storage')
    expect(parsed.keys).toHaveLength(2)
    expect(parsed.keys[0].platform).toBe('DeepSeek')
  })

  it('txt 逐条列出', () => {
    const txt = serializeApiKeyRows(rows, 'plain', 'txt', now)
    expect(txt).toContain('[1] DeepSeek · 主力')
    expect(txt).toContain('API Key：sk-def')
  })

  it('html 转义尖括号且为完整页面', () => {
    const html = serializeApiKeyRows(rows, 'plain', 'html', now)
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('a&lt;b')
    expect(html).not.toContain('a<b')
  })
})

describe('archiveExport', () => {
  const session = {
    id: 's1', title: '如何学习 Rust', updatedAt: 1,
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Rust 怎么入门？', at: 1 },
      { role: 'assistant', content: '先看官方教程。', at: 2 },
    ],
  }
  it('一问一答 md：用户/AI 区块分明，跳过 system', () => {
    const md = buildArchiveMarkdown(session, new Date(2026, 10, 21, 22, 30))
    expect(md).toContain('# 如何学习 Rust')
    expect(md).toContain('## 👤 用户')
    expect(md).toContain('## 🤖 AI 助手')
    expect(md).not.toContain('sys')
    expect(md.indexOf('## 👤 用户')).toBeLessThan(md.indexOf('## 🤖 AI 助手'))
  })
  it('文件名安全且带时间', () => {
    const name = archiveFileName({ ...session, title: 'a/b:c' }, new Date(2026, 10, 21, 22, 30))
    expect(name).toBe('归档-a b c-20261121-2230.md')
  })
})
