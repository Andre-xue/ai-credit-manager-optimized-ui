// v0.1.413 客户端直达链接：协议地址生成、scheme 白名单、直达/回落决策的单测。
// Rust open_protocol_url 本身沙箱无 cargo 编译不了，由 CI 把关；这里钉住 TS 侧
// 的纯逻辑 + 对 invoke 的调用参数（仿照 freeGames.test.ts 的假 invoke 模式）。
// 协议实际能不能拉起客户端无头无法验，需 Ethan 真机确认（见 verify413.mjs）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isAllowedProtocolUrl,
  steamClientUrlOfApp,
  steamClientUrlOfDeal,
  epicLauncherUrlOfCheckoutUrl,
  openProtocolUrl,
  openViaClient,
} from './clientLinks'

const CHECKOUT = 'https://www.epicgames.com/store/purchase?highlightColor=0078f2&offers=1-3d6441ab9d4246208bc97d7babf664b5-1f9a12b06b4f437790b6913ad136a08c&orderId&purchaseToken&showNavigation=true'

describe('isAllowedProtocolUrl', () => {
  it('只放行 steam:// 与 com.epicgames.launcher://', () => {
    expect(isAllowedProtocolUrl('steam://store/1238810')).toBe(true)
    expect(isAllowedProtocolUrl('steam://openurl/https://store.steampowered.com/sub/505826/')).toBe(true)
    expect(isAllowedProtocolUrl('com.epicgames.launcher://store/purchase?offers=1-a-b')).toBe(true)
    expect(isAllowedProtocolUrl('https://store.steampowered.com/app/1238810/')).toBe(false)
    expect(isAllowedProtocolUrl('http://example.com/')).toBe(false)
    expect(isAllowedProtocolUrl('epicgames://store/purchase')).toBe(false)
    expect(isAllowedProtocolUrl('')).toBe(false)
    expect(isAllowedProtocolUrl(null as unknown as string)).toBe(false)
  })
  it('含空白或控制字符一律拒绝（防命令注入）', () => {
    expect(isAllowedProtocolUrl('steam://store/1238810 && rm -rf /')).toBe(false)
    expect(isAllowedProtocolUrl('steam://store/1238810\n')).toBe(false)
    expect(isAllowedProtocolUrl('com.epicgames.launcher://store/purchase?x=1\ty=2')).toBe(false)
  })
})

describe('steamClientUrlOfApp', () => {
  it('纯数字 appid → steam://store/<appid>', () => {
    expect(steamClientUrlOfApp('1238810')).toBe('steam://store/1238810')
    expect(steamClientUrlOfApp(' 440 ')).toBe('steam://store/440')
  })
  it('非数字/空 appid 返回 null（不生成坏链接）', () => {
    expect(steamClientUrlOfApp('')).toBeNull()
    expect(steamClientUrlOfApp('abc')).toBeNull()
    expect(steamClientUrlOfApp('12a3')).toBeNull()
  })
})

describe('steamClientUrlOfDeal', () => {
  it('游戏本体走 steam://store/<appid>', () => {
    expect(steamClientUrlOfDeal({ kind: 'game', appid: '1238810', url: 'https://store.steampowered.com/app/1238810/' })).toBe('steam://store/1238810')
  })
  it('合集包走 steam://openurl/<商店 sub 页>（原样地址，不 encode）', () => {
    expect(steamClientUrlOfDeal({ kind: 'package', appid: '505826', url: 'https://store.steampowered.com/sub/505826/' }))
      .toBe('steam://openurl/https://store.steampowered.com/sub/505826/')
  })
  it('合集包的商店地址不是 sub 页时返回 null', () => {
    expect(steamClientUrlOfDeal({ kind: 'package', appid: '505826', url: 'https://store.steampowered.com/app/1238810/' })).toBeNull()
    expect(steamClientUrlOfDeal({ kind: 'package', appid: '505826', url: '' })).toBeNull()
  })
})

describe('epicLauncherUrlOfCheckoutUrl', () => {
  it('浏览器结账页只换 origin，路径与参数原样保留', () => {
    expect(epicLauncherUrlOfCheckoutUrl(CHECKOUT)).toBe(
      'com.epicgames.launcher://store/purchase?highlightColor=0078f2&offers=1-3d6441ab9d4246208bc97d7babf664b5-1f9a12b06b4f437790b6913ad136a08c&orderId&purchaseToken&showNavigation=true',
    )
  })
  it('不是 Epic 结账页时返回 null', () => {
    expect(epicLauncherUrlOfCheckoutUrl('https://store.epicgames.com/zh-CN/p/mark-of-the-deep')).toBeNull()
    expect(epicLauncherUrlOfCheckoutUrl('https://www.epicgames.com/store/free-games')).toBeNull()
    expect(epicLauncherUrlOfCheckoutUrl('https://example.com/store/purchase?offers=1-a-b')).toBeNull()
    expect(epicLauncherUrlOfCheckoutUrl('')).toBeNull()
  })
})

describe('openProtocolUrl / openViaClient（假 Tauri invoke）', () => {
  let invoke: ReturnType<typeof vi.fn>
  let origWindow: unknown
  beforeEach(() => {
    invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'open_protocol_url') return (globalThis as unknown as Record<string, unknown>).__mockProtocolOk !== false
      if (cmd === 'open_url') return undefined
      return undefined
    })
    origWindow = (globalThis as unknown as Record<string, unknown>).window
    ;(globalThis as unknown as Record<string, unknown>).window = { __TAURI_INTERNALS__: { invoke } }
  })
  afterEach(() => {
    ;(globalThis as unknown as Record<string, unknown>).window = origWindow
    delete (globalThis as unknown as Record<string, unknown>).__mockProtocolOk
  })

  it('桌面端：调 open_protocol_url，成功返回 ok', async () => {
    const r = await openProtocolUrl('steam://store/1238810')
    expect(r.ok).toBe(true)
    expect(invoke).toHaveBeenCalledWith('open_protocol_url', { url: 'steam://store/1238810' })
  })
  it('桌面端：Rust 返回 false（没装客户端）→ ok=false 且带真实原因', async () => {
    ;(globalThis as unknown as Record<string, unknown>).__mockProtocolOk = false
    const r = await openProtocolUrl('steam://store/1238810')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/未安装/)
  })
  it('桌面端：不支持的 scheme 不调 invoke，直接拒绝', async () => {
    const r = await openProtocolUrl('https://store.steampowered.com/app/1238810/')
    expect(r.ok).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })
  it('直达成功时不走浏览器；直达失败时回落浏览器并带原因', async () => {
    const ok = await openViaClient('steam://store/1238810', 'https://store.steampowered.com/app/1238810/')
    expect(ok.via).toBe('client')
    expect(invoke).not.toHaveBeenCalledWith('open_url', expect.anything())
    ;(globalThis as unknown as Record<string, unknown>).__mockProtocolOk = false
    invoke.mockClear()
    const fb = await openViaClient('steam://store/1238810', 'https://store.steampowered.com/app/1238810/')
    expect(fb.via).toBe('web')
    expect(fb.reason).toMatch(/未安装/)
    expect(invoke).toHaveBeenCalledWith('open_url', { url: 'https://store.steampowered.com/app/1238810/' })
  })
  it('非桌面端（无 __TAURI_INTERNALS__）：不尝试协议，直接回落浏览器', async () => {
    ;(globalThis as unknown as Record<string, unknown>).window = { open: vi.fn(() => null), location: { href: '' } }
    invoke.mockClear()
    const r = await openViaClient('steam://store/1238810', 'https://store.steampowered.com/app/1238810/')
    expect(r.via).toBe('web')
    expect(r.reason).toMatch(/只在桌面端可用/)
    expect(invoke).not.toHaveBeenCalled()
  })
})
