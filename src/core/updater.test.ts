import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkReleaseUpdate } from './updater'

afterEach(() => vi.unstubAllGlobals())

const jsonRes = (data: unknown, ok = true, status = 200) => ({
  ok, status,
  json: async () => data,
  text: async () => JSON.stringify(data),
})

const release = (tag: string, names: string[], extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  body: `notes for ${tag}`,
  published_at: '2026-11-18T00:00:00Z',
  assets: names.map(name => ({ name, browser_download_url: `https://x/${name}` })),
  ...extra,
})

const DESKTOP = ['latest.json', 'AI.Credit.Manager_0.1.66_aarch64.dmg', 'AI.Credit.Manager_0.1.66_x64-setup.exe']

describe('检查更新：桌面安装包齐全性判断与回退', () => {
  it('最新版已有桌面安装包时不回退，直接返回最新版', async () => {
    const latest = release('v0.1.68', DESKTOP)
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(latest)))
    const info = await checkReleaseUpdate(true)
    expect(info?.latest).toBe('0.1.68')
    expect(info?.fallback).toBe(false)
    expect(info?.installersReady).toBe(true)
  })

  it('最新版缺桌面包时回退到最近一个带完整安装包的正式版', async () => {
    const latest = release('v0.1.69', ['app-debug.apk'])
    const list = [
      latest,
      release('v0.1.68', ['app-debug.apk']),           // 也没有桌面包
      release('v0.1.67', DESKTOP),                      // 最近一个完整版本
      release('v0.1.66', DESKTOP),
      release('v0.1.70', DESKTOP, { draft: true }),     // 草稿，应忽略
    ]
    const fetchMock = vi.fn(async (url: string) =>
      jsonRes(url.includes('/releases?') ? list : latest),
    )
    vi.stubGlobal('fetch', fetchMock)
    const info = await checkReleaseUpdate(true)
    expect(info?.latest).toBe('0.1.67')
    expect(info?.fallback).toBe(true)
    expect(info?.installersReady).toBe(true)
    expect(info?.releaseUrl).toContain('v0.1.67')
  })

  it('列表里没有任何带桌面包的版本时回报构建中，不误报为可下载', async () => {
    const latest = release('v0.1.69', ['app-debug.apk'])
    // latest 端点返回单个对象、list 端点返回只有无桌面包版本的数组
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      jsonRes(url.includes('/releases?') ? [latest] : latest),
    ))
    const info = await checkReleaseUpdate(true)
    expect(info?.installersReady).toBe(false)
    expect(info?.fallback).toBe(false)
  })

  it('非桌面调用不做齐全性判断，直接返回最新版', async () => {
    const latest = release('v0.1.69', ['app-debug.apk'])
    const fetchMock = vi.fn(async () => jsonRes(latest))
    vi.stubGlobal('fetch', fetchMock)
    const info = await checkReleaseUpdate(false)
    expect(info?.latest).toBe('0.1.69')
    // v0.1.311 起先试 latest.json 直链（此处桩返回的不是清单格式，解析失败回退 API）；关键仍是不拉 releases 列表
    expect((fetchMock.mock.calls as unknown[][]).every(c => !String(c[0]).includes('/releases?'))).toBe(true)
  })

  it('GitHub 403 限流给出明确错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({}, false, 403)))
    const info = await checkReleaseUpdate(true)
    expect(info?.error).toContain('频率限制')
  })
})

import { parseLatestJson, apkUrlForVersion } from './updater'

describe('更新检查走 latest.json 直链（v0.1.311，绕开 GitHub API 限流）', () => {
  it('解析 Tauri 更新清单', () => {
    const r = parseLatestJson(JSON.stringify({ version: '0.1.311', notes: 'notes', pub_date: '2026-11-22T00:00:00Z', platforms: {} }))
    expect(r).toEqual({ version: '0.1.311', notes: 'notes', pubDate: '2026-11-22T00:00:00Z' })
    expect(parseLatestJson('{"version":"v0.1.300"}')?.version).toBe('0.1.300')
    expect(parseLatestJson('not json')).toBeNull()
    expect(parseLatestJson('{}')).toBeNull()
  })
  it('按版本拼 APK 固定资产直链', () => {
    expect(apkUrlForVersion('0.1.311')).toBe('https://github.com/Andre-xue/ai-credit-manager-optimized/releases/download/v0.1.311/app-release.apk')
    expect(apkUrlForVersion('v0.1.311')).toContain('/v0.1.311/')
  })
  it('清单可达时 checkReleaseUpdate 不再走 API（不限流）', async () => {
    const manifest = { version: '0.1.311', notes: 'n', pub_date: '2026-11-22T00:00:00Z', platforms: {} }
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('latest.json')) return { ok: true, status: 200, text: async () => JSON.stringify(manifest), json: async () => manifest }
      throw new Error('API should not be called')
    })
    vi.stubGlobal('fetch', fetchMock)
    const info = await checkReleaseUpdate(false)
    expect(info?.latest).toBe('0.1.311')
    expect(info?.installersReady).toBe(true)
    expect(fetchMock.mock.calls.every(c => String(c[0]).includes('latest.json'))).toBe(true)
  })
})
