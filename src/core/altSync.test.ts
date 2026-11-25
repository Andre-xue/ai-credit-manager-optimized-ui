import { describe, expect, it } from 'vitest'
import { contentStamp, davFileUrl, loadWebdavConfig, parsePayload, DEFAULT_WEBDAV, type WebdavConfig } from './altSync'
import { prepareSyncPayload } from './sync'
import type { AppState } from './types'

// vitest 为 node 环境：补一个内存版 localStorage 供配置/保险箱材料读取
const memStore = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => { memStore.set(k, String(v)) },
  removeItem: (k: string) => { memStore.delete(k) },
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size },
}

const baseState = {
  version: 1, accounts: [], quotas: [], checkins: [], benefitMarks: [], usage: [], audit: [],
  settings: { vaultInitialized: false, monthlyBudget: 0, checkinReminder: true, checkinProviders: [], alertDays: 7, defaultUnit: 'credit', backupReminder: true, backupReminderDays: 7, unlockMethod: 'password', uiStyle: 'claude', uiMotion: true, unitPrices: {} },
} as unknown as AppState

describe('altSync.davFileUrl', () => {
  const cfg: WebdavConfig = { ...DEFAULT_WEBDAV }
  it('默认坚果云地址 + 中文路径逐段编码', () => {
    const url = davFileUrl(cfg)
    expect(url.startsWith('https://dav.jianguoyun.com/dav/')).toBe(true)
    expect(url.endsWith('/sync.json')).toBe(true)
    expect(url).not.toContain('魔方')
  })
  it('base 末尾多斜杠与 path 前导斜杠都归一', () => {
    const url = davFileUrl({ ...cfg, url: 'https://example.com/dav///', path: '/a/b.json' })
    expect(url).toBe('https://example.com/dav/a/b.json')
  })
})

describe('altSync 配置与载荷', () => {
  it('无本地配置时返回坚果云默认值', () => {
    localStorage.removeItem('acm.webdav.config.v1')
    const cfg = loadWebdavConfig()
    expect(cfg.url).toBe('https://dav.jianguoyun.com/dav/')
    expect(cfg.enabled).toBe(false)
  })
  it('parsePayload 拒绝非同步数据', () => {
    expect(parsePayload('not json')).toBeNull()
    expect(parsePayload('{"a":1}')).toBeNull()
    expect(parsePayload('{"clientAt":"2026-01-01T00:00:00.000Z","appState":{}}')).not.toBeNull()
  })
})

describe('altSync.contentStamp', () => {
  it('同一状态指纹稳定，状态变化指纹变化', () => {
    const a = contentStamp(baseState)
    expect(contentStamp(baseState)).toBe(a)
    const changed = { ...baseState, settings: { ...baseState.settings, monthlyBudget: 99 } } as AppState
    expect(contentStamp(changed)).not.toBe(a)
  })
  it('仅改网关令牌不影响指纹（令牌不进同步口径）', () => {
    const withToken = { ...baseState, settings: { ...baseState.settings, gatewayToken: 'secret' } } as unknown as AppState
    expect(contentStamp(withToken)).toBe(contentStamp(baseState))
  })
})

describe('sync.prepareSyncPayload', () => {
  it('剥离网关令牌与界面语言', () => {
    const st = { ...baseState, settings: { ...baseState.settings, gatewayToken: 'tok', language: 'en' } } as unknown as AppState
    const p = prepareSyncPayload(st, null)
    expect(p.appState.settings.gatewayToken).toBeUndefined()
    expect(p.appState.settings.language).toBeUndefined()
    expect(p.clientAt).toBeTruthy()
    expect(p.clientId).toBeTruthy()
  })
  it('默认排除本地模型账户，includeLocal 时保留', () => {
    const acct = { id: 'a1', providerId: 'local-ollama', name: 'Ollama', keyCipher: 'x', createdAt: '2026-01-01' }
    const st = { ...baseState, accounts: [acct] } as unknown as AppState
    expect(prepareSyncPayload(st, null).appState.accounts).toHaveLength(0)
    expect(prepareSyncPayload(st, null, { includeLocal: true }).appState.accounts).toHaveLength(1)
  })
  it('远端的 keyBackups 与快照被保留', () => {
    const remote = { keyBackups: [{ id: 'b1' }], stateSnapshots: [{ id: 's1' }] } as never
    const p = prepareSyncPayload(baseState, remote)
    expect(p.keyBackups).toHaveLength(1)
    expect(p.stateSnapshots).toHaveLength(1)
  })
})

import { accountVisionRoutes } from './galleryIndex'
import type { Account } from './types'

describe('galleryIndex.accountVisionRoutes 自有账户看图模型罗列', () => {
  const acct = { id: 'a9', providerId: 'openai', label: 'gpt-4o-mini', encryptedKey: 'x', mode: 'api', createdAt: '', updatedAt: '' } as unknown as Account
  it('只列能看图的模型，排除账户自身配置的模型与纯文本模型', () => {
    const routes = accountVisionRoutes(acct, ['gpt-4o-mini', 'gpt-4o', 'text-embedding-3-small', 'gpt-4.1'])
    expect(routes.map(r => r.key)).toEqual(['acct:a9:gpt-4o'])
    expect(routes[0].label).toContain('gpt-4o')
    expect(routes[0].kind).toBe('account')
  })
  it('没有看图模型时返回空', () => {
    expect(accountVisionRoutes(acct, ['deepseek-chat', 'gpt-4o-mini'])).toEqual([])
  })
})
