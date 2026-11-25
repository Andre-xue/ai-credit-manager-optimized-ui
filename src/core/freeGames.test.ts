import { describe, it, expect } from 'vitest'
import {
  parseEpicPromotions, assertFreeToClaim, buildQuickPurchaseBody,
  sortRecords, pageSlice, pageCount, defaultPrefs, nextCheckAt,
  EPIC_LOGIN_URL, fetchEpicFreeGames,
  toChineseFetchError, sanitizeLoadFailedMessage,
  bindEpicWithAuthCode, claimEpicGame, deviceAuthUrl,
  epicAccessToken, describeDeviceAuthError, loadEpicAuth,
  EPIC_LAUNCHER_UA, EPIC_AUTH_KEY, EPIC_WEB_UA,
  extractPurchaseToken, describePurchasePage,
  buildEpicCheckoutUrl,
  EpicManualCheckoutError, checkoutUrlOf,
  parseOwnedKeys, fetchOwnedEpicKeys, syncOwnedEpicGames, markEpicGameClaimed,
  readRecords, claimedGameIds, CACHE_KEY,
  type FreeGame, type ClaimRecord, type EpicDeviceAuth,
} from './freeGames'

// fixture：按 2026-11-24 晚实测的 freeGamesPromotions 返回结构裁剪
// （注意：TerraScape 当时并不在免费列表里——早先脚本把未过滤的促销都标成
// 免费是误读；以 discountPercentage===0 为准，当时仅 Mark of the Deep 免费）
const EPIC_FIXTURE = {
  data: {
    Catalog: {
      searchStore: {
        elements: [
          {
            title: 'Mark of the Deep', id: '1f9a12b06b4f437790b6913ad136a08c',
            namespace: '3d6441ab9d4246208bc97d7babf664b5', productSlug: null,
            urlSlug: '2fd257a6cd80405a833f9004ff07993a',
            offerType: 'BASE_GAME', categories: [{ path: 'games' }],
            price: { totalPrice: { discountPrice: 0, fmtPrice: { originalPrice: '¥55.00' } } },
            keyImages: [{ type: 'Thumbnail', url: 'https://cdn.example.com/mark.jpg' }],
            promotions: {
              promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-11-19T16:00:00.000Z', endDate: '2026-11-26T16:00:00.000Z', discountSetting: { discountPercentage: 0 } }] }],
              upcomingPromotionalOffers: [],
            },
          },
          {
            title: '火之石', id: 'stone-of-fire-id', namespace: 'stone-ns',
            productSlug: 'fire-stone/home', offerType: 'BASE_GAME', categories: [{ path: 'games' }],
            price: { totalPrice: { discountPrice: 3000, fmtPrice: { originalPrice: '¥30.00' } } },
            keyImages: [],
            promotions: {
              promotionalOffers: [],
              upcomingPromotionalOffers: [{ promotionalOffers: [{ startDate: '2026-11-26T16:00:00.000Z', endDate: '2026-12-03T16:00:00.000Z', discountSetting: { discountPercentage: 0 } }] }],
            },
          },
          {
            title: '某打折游戏', id: 'sale-id', namespace: 'sale-ns',
            productSlug: 'sale-game', offerType: 'BASE_GAME', categories: [{ path: 'games' }],
            price: { totalPrice: { discountPrice: 5000, fmtPrice: { originalPrice: '¥100.00' } } },
            keyImages: [],
            promotions: {
              promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-11-20T16:00:00.000Z', endDate: '2026-11-26T16:00:00.000Z', discountSetting: { discountPercentage: 50 } }] }],
              upcomingPromotionalOffers: [],
            },
          },
        ],
      },
    },
  },
}

function fakeGame(over: Partial<FreeGame> = {}): FreeGame {
  return {
    platform: 'epic', id: 'x1', namespace: 'ns1', title: '测试游戏', slug: 'test-game',
    url: 'https://store.epicgames.com/zh-CN/p/test-game', originalPrice: '¥55.00',
    isFree: true, status: 'free', startDate: null, endDate: '2026-11-26T16:00:00.000Z',
    offerType: 'BASE_GAME', autoClaimable: true, ...over,
  }
}

describe('freeGames.parseEpicPromotions', () => {
  it('当前免费只收 discountPercentage===0 且现价为 0 的（实测仅一款）', () => {
    const { current } = parseEpicPromotions(EPIC_FIXTURE)
    expect(current.map(g => g.title)).toEqual(['Mark of the Deep'])
    expect(current[0].isFree).toBe(true)
    // 真实数据里 productSlug 为空、urlSlug 是 UUID：直达链接用 urlSlug
    expect(current[0].url).toBe('https://store.epicgames.com/zh-CN/p/2fd257a6cd80405a833f9004ff07993a')
    expect(current[0].originalPrice).toBe('¥55.00')
    expect(current[0].endDate).toBe('2026-11-26T16:00:00.000Z')
    expect(current[0].imageUrl).toBe('https://cdn.example.com/mark.jpg')
    // 50% 打折的不算免费
    expect(current.some(g => g.title === '某打折游戏')).toBe(false)
  })
  it('预告进 upcoming，slug 取 productSlug 首段', () => {
    const { upcoming } = parseEpicPromotions(EPIC_FIXTURE)
    expect(upcoming.map(g => g.title)).toEqual(['火之石'])
    expect(upcoming[0].status).toBe('upcoming')
    expect(upcoming[0].isFree).toBe(false)
    expect(upcoming[0].slug).toBe('fire-stone')
    expect(upcoming[0].url).toBe('https://store.epicgames.com/zh-CN/p/fire-stone')
  })
  it('空体/缺字段不抛错', () => {
    expect(parseEpicPromotions(null)).toEqual({ current: [], upcoming: [] })
    expect(parseEpicPromotions({})).toEqual({ current: [], upcoming: [] })
  })
})

describe('freeGames.assertFreeToClaim', () => {
  it('免费基础游戏放行', () => {
    expect(() => assertFreeToClaim(fakeGame())).not.toThrow()
  })
  it('非免费拒绝下单', () => {
    expect(() => assertFreeToClaim(fakeGame({ isFree: false }))).toThrow(/不是免费/)
  })
  it('未开始的预告拒绝下单', () => {
    expect(() => assertFreeToClaim(fakeGame({ status: 'upcoming', isFree: false }))).toThrow()
  })
})

describe('freeGames.buildQuickPurchaseBody', () => {
  it('按 node-epicgames-client 的 quickPurchase 结构出 body', () => {
    const body = buildQuickPurchaseBody(fakeGame({ id: 'abc', namespace: 'ns9' }))
    expect(body).toEqual({
      salesChannel: 'Launcher-purchase-client',
      entitlementSource: 'Launcher-purchase-client',
      returnSplitPaymentItems: false,
      lineOffers: [{ offerId: 'abc', quantity: 1, namespace: 'ns9' }],
    })
  })
})

describe('freeGames.sortRecords', () => {
  it('失败组置顶，其余按时间倒序', () => {
    const recs: ClaimRecord[] = [
      { at: 100, platform: 'epic', title: 'A', outcome: 'claimed', message: 'ok' },
      { at: 300, platform: 'epic', title: 'B', outcome: 'error', message: '验证码' },
      { at: 200, platform: 'epic', title: 'C', outcome: 'claimed', message: 'ok' },
      { at: 400, platform: 'epic', title: 'D', outcome: 'error', message: '登录失效' },
    ]
    expect(sortRecords(recs).map(r => r.title)).toEqual(['D', 'B', 'C', 'A'])
  })
})

describe('freeGames pagination', () => {
  it('每页 8 条切片与页数', () => {
    const list = Array.from({ length: 20 }, (_, i) => i)
    expect(pageSlice(list, 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(pageSlice(list, 3)).toEqual([16, 17, 18, 19])
    expect(pageCount(20)).toBe(3)
    expect(pageCount(0)).toBe(1)
    expect(pageCount(8)).toBe(1)
    expect(pageCount(9)).toBe(2)
  })
})

describe('freeGames prefs', () => {
  it('默认每 6 小时巡查、自动领取开启', () => {
    const p = defaultPrefs()
    expect(p.autoClaim).toBe(true)
    expect(p.intervalHours).toBe(6)
    expect(p.epicEnabled).toBe(true)
  })
  it('下次检查 = 上次 + 间隔；从未查过则为现在', () => {
    const p = defaultPrefs()
    expect(nextCheckAt(p, 1_000_000)).toBe(1_000_000 + 6 * 3600_000)
    expect(nextCheckAt(p, null)).toBeLessThanOrEqual(Date.now())
  })
})

describe('freeGames EPIC_LOGIN_URL', () => {
  it('必须是 OAuth 授权地址（带 redirectUrl 到 id/api/redirect），不是 /id/login/welcome', () => {
    // 2026-11-24 实机：旧地址缺 redirectUrl，Epic 把登录跳到 /id/login/welcome
    // 并直接报「无法完成登陆」，连账号密码都没法输（v0.1.385 修）
    expect(EPIC_LOGIN_URL).not.toContain('/id/login/welcome')
    expect(EPIC_LOGIN_URL).toContain('www.epicgames.com/id/login?redirectUrl=')
    const u = new URL(EPIC_LOGIN_URL)
    const redirect = u.searchParams.get('redirectUrl') ?? ''
    expect(redirect).toContain('www.epicgames.com/id/api/redirect')
    expect(redirect).toContain('clientId=34a02cf8f4414e29b15921876da36f9a')
    expect(redirect).toContain('responseType=code')
  })
})

describe('freeGames bindEpicWithAuthCode', () => {
  it('换 token 时 form 体带 token_type=eg1（legendary 做法；缺了 Epic 会拒）', async () => {
    const { webcrypto } = await import('node:crypto')
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
    if (!(globalThis as unknown as Record<string, unknown>).localStorage) {
      const m = new Map<string, string>()
      ;(globalThis as unknown as Record<string, unknown>).localStorage = {
        getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
        setItem: (k: string, v: string) => { m.set(k, v) },
        removeItem: (k: string) => { m.delete(k) },
        clear: () => m.clear(),
      }
    }
    const calls: Array<{ url: string; body: string }> = []
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      const u = String(url)
      calls.push({ url: u, body: String(init?.body ?? '') })
      if (u.includes('/oauth/token')) {
        return { ok: true, text: async () => JSON.stringify({ access_token: 'AT', account_id: 'ACC' }), json: async () => ({}) }
      }
      return { ok: true, text: async () => JSON.stringify({ deviceId: 'D', secret: 'S', accountId: 'ACC' }), json: async () => ({ deviceId: 'D', secret: 'S', accountId: 'ACC' }) }
    }) as typeof fetch
    try {
      const { initVault } = await import('./crypto')
      await initVault('testpwd8')
      const { bindEpicWithAuthCode } = await import('./freeGames')
      const auth = await bindEpicWithAuthCode('CODE123', 'testpwd8')
      expect(auth.accountId).toBe('ACC')
      expect(auth.deviceId).toBe('D')
      const tokCall = calls.find(c => c.url.includes('/oauth/token'))
      expect(tokCall).toBeDefined()
      const params = new URLSearchParams(tokCall!.body)
      expect(params.get('grant_type')).toBe('authorization_code')
      expect(params.get('code')).toBe('CODE123')
      expect(params.get('token_type')).toBe('eg1')
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('freeGames fetchEpicFreeGames 报错文案', () => {
  it('网络失败（WKWebView 只抛英文 Load failed）要换成中文并提示换节点', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new TypeError('Load failed') }) as typeof fetch
    try {
      await expect(fetchEpicFreeGames()).rejects.toThrow(/免费游戏列表加载失败/)
      await expect(fetchEpicFreeGames()).rejects.toThrow(/换个节点/)
    } finally {
      globalThis.fetch = origFetch
    }
  })
  it('接口非 200 要写清状态码', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => ({ ok: false, status: 403, text: async () => '{}', json: async () => ({}) })) as unknown as typeof fetch
    try {
      await expect(fetchEpicFreeGames()).rejects.toThrow(/免费游戏列表加载失败：Epic 接口返回 403/)
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

// v0.1.386：385 只包了列表请求，绑定/领取 6 处 fetch 漏包，Ethan 实机点
// 「确认绑定」仍弹英文 "Load failed"。共用 helper + notify 兜底，一处都不能漏。
describe('freeGames toChineseFetchError', () => {
  it('Load failed 换成中文并点名步骤', () => {
    const e = toChineseFetchError(new TypeError('Load failed'), 'Epic 绑定失败')
    expect(e.message).toContain('Epic 绑定失败')
    expect(e.message).toContain('换个节点')
    expect(e.message).not.toContain('Load failed')
  })
  it('Failed to fetch 同样换中文', () => {
    expect(toChineseFetchError(new TypeError('Failed to fetch'), 'Epic 下单失败').message).toContain('换个节点')
  })
  it('非网络错误原样透传（不乱改业务报错）', () => {
    expect(toChineseFetchError(new Error('Epic 授权码无效或已过期'), 'Epic 绑定失败').message)
      .toBe('Epic 授权码无效或已过期')
  })
})

describe('freeGames sanitizeLoadFailedMessage', () => {
  it('残留的 Load failed 只替换该片段，步骤名保留', () => {
    const out = sanitizeLoadFailedMessage('Epic 确认订单失败：Load failed')
    expect(out).toContain('Epic 确认订单失败')
    expect(out).toContain('换个节点')
    expect(out).not.toContain('Load failed')
  })
  it('干净文案原样不动', () => {
    expect(sanitizeLoadFailedMessage('Epic 已绑定，自动领取已就绪')).toBe('Epic 已绑定，自动领取已就绪')
  })
})

describe('freeGames bindEpicWithAuthCode 网络失败', () => {
  it('换 token 请求被拦（Load failed）要报中文绑定失败，不含英文', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new TypeError('Load failed') }) as typeof fetch
    try {
      await expect(bindEpicWithAuthCode('CODE123', 'testpwd8')).rejects.toThrow(/Epic 绑定失败/)
      await expect(bindEpicWithAuthCode('CODE123', 'testpwd8')).rejects.toThrow(/换个节点/)
      await expect(bindEpicWithAuthCode('CODE123', 'testpwd8')).rejects.not.toThrow(/Load failed/)
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('freeGames bindEpicWithAuthCode 授权码失效映射（v0.1.387）', () => {
  it('authorization_code_not_found / invalid_grant 映射成中文，不吐错误码原文；其他错误码保持原样', async () => {
    const origFetch = globalThis.fetch
    const stubToken400 = (code: string) => {
      globalThis.fetch = (async () => ({
        ok: false, status: 400,
        text: async () => JSON.stringify({ errorCode: code }),
        json: async () => ({ errorCode: code }),
      })) as unknown as typeof fetch
    }
    try {
      stubToken400('errors.com.epicgames.account.oauth.authorization_code_not_found')
      await expect(bindEpicWithAuthCode('OLDCODE', 'testpwd8')).rejects.toThrow(/授权码已失效或已被使用/)
      await expect(bindEpicWithAuthCode('OLDCODE', 'testpwd8')).rejects.toThrow(/重新登录获取新码再绑定/)
      await expect(bindEpicWithAuthCode('OLDCODE', 'testpwd8')).rejects.not.toThrow(/authorization_code_not_found/)
      stubToken400('invalid_grant')
      await expect(bindEpicWithAuthCode('OLDCODE', 'testpwd8')).rejects.toThrow(/授权码已失效或已被使用/)
      stubToken400('errors.com.epicgames.account.invalid_client')
      await expect(bindEpicWithAuthCode('OLDCODE', 'testpwd8')).rejects.toThrow(/Epic 登录失败：errors\.com\.epicgames\.account\.invalid_client/)
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('freeGames claimEpicGame 网络失败', () => {
  it('quickPurchase 请求被拦（Load failed）要报中文下单失败，不含英文', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new TypeError('Load failed') }) as typeof fetch
    try {
      await expect(claimEpicGame('AT', 'ACC', fakeGame())).rejects.toThrow(/Epic 下单失败/)
      await expect(claimEpicGame('AT', 'ACC', fakeGame())).rejects.toThrow(/换个节点/)
      await expect(claimEpicGame('AT', 'ACC', fakeGame())).rejects.not.toThrow(/Load failed/)
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

// v0.1.386：Epic 不返回 ACAO，桌面 WKWebView 里前端 fetch 被 CORS 直接拦掉
// （换节点修不好）。全部 Epic 请求改走原生通道：桌面 plugin_http / 安卓 CapacitorHttp。
// 以下单测用假的 window.__TAURI_INTERNALS__.invoke 断言调用参数与旧 fetch 一致，
// 并确认桌面通道下 fetch 根本不会被调用。真机上原生通道本身仍待 Ethan 实机验。
function stubTauriInvoke(fn: (cmd: string, args: Record<string, unknown>) => Promise<string>) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
  const invoke = async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args })
    return fn(cmd, args)
  }
  ;(globalThis as unknown as Record<string, unknown>).window = { __TAURI_INTERNALS__: { invoke } }
  return calls
}
function unStubWindow() {
  delete (globalThis as unknown as Record<string, unknown>).window
}
function pluginEnvelope(status: number, body: string): string {
  return JSON.stringify({ status, body, headers: {} })
}

describe('freeGames epicRequest 桌面通道', () => {
  it('列表请求走 plugin_http（URL/方法/头与旧 fetch 一致），fetch 不被调用', async () => {
    const calls = stubTauriInvoke(async () => pluginEnvelope(200, JSON.stringify(EPIC_FIXTURE)))
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('桌面通道下不应走 fetch') }) as typeof fetch
    try {
      const res = await fetchEpicFreeGames()
      expect(res.current.map(g => g.title)).toContain('Mark of the Deep')
      expect(calls).toHaveLength(1)
      expect(calls[0].cmd).toBe('plugin_http')
      expect(String(calls[0].args.url)).toContain('freeGamesPromotions')
      expect(calls[0].args.method).toBe('GET')
      expect(JSON.parse(String(calls[0].args.headersJson))).toEqual({ Accept: 'application/json' })
      expect(calls[0].args.body).toBeNull()
    } finally {
      globalThis.fetch = origFetch
      unStubWindow()
    }
  })
  it('plugin_http 返回非 200 时状态码原样透传', async () => {
    stubTauriInvoke(async () => pluginEnvelope(403, '{}'))
    try {
      await expect(fetchEpicFreeGames()).rejects.toThrow(/免费游戏列表加载失败：Epic 接口返回 403/)
    } finally {
      unStubWindow()
    }
  })
})

describe('freeGames bindEpicWithAuthCode 桌面通道', () => {
  it('换 token 与创建设备授权都走 plugin_http，form 体与头与旧 fetch 一致', async () => {
    const { webcrypto } = await import('node:crypto')
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
    if (!(globalThis as unknown as Record<string, unknown>).localStorage) {
      const m = new Map<string, string>()
      ;(globalThis as unknown as Record<string, unknown>).localStorage = {
        getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
        setItem: (k: string, v: string) => { m.set(k, v) },
        removeItem: (k: string) => { m.delete(k) },
        clear: () => m.clear(),
      }
    }
    const calls = stubTauriInvoke(async (_cmd, args) => {
      const u = String(args.url)
      if (u.includes('/oauth/token')) return pluginEnvelope(200, JSON.stringify({ access_token: 'AT', account_id: 'ACC' }))
      return pluginEnvelope(200, JSON.stringify({ deviceId: 'D', secret: 'S', accountId: 'ACC' }))
    })
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('桌面通道下不应走 fetch') }) as typeof fetch
    try {
      const { initVault } = await import('./crypto')
      await initVault('testpwd8')
      const auth = await bindEpicWithAuthCode('CODE123', 'testpwd8')
      expect(auth.accountId).toBe('ACC')
      expect(auth.deviceId).toBe('D')
      expect(calls).toHaveLength(2)
      const tokCall = calls[0]
      expect(String(tokCall.args.url)).toContain('/oauth/token')
      expect(tokCall.args.method).toBe('POST')
      expect(JSON.parse(String(tokCall.args.headersJson))['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(JSON.parse(String(tokCall.args.headersJson)).Authorization).toMatch(/^Basic /)
      const params = new URLSearchParams(String(tokCall.args.body))
      expect(params.get('grant_type')).toBe('authorization_code')
      expect(params.get('code')).toBe('CODE123')
      expect(params.get('token_type')).toBe('eg1')
      const daCall = calls[1]
      expect(String(daCall.args.url)).toBe('https://account-public-service-prod03.ol.epicgames.com/account/api/public/account/ACC/deviceAuth')
      expect(JSON.parse(String(daCall.args.headersJson)).Authorization).toBe('Bearer AT')
    } finally {
      globalThis.fetch = origFetch
      unStubWindow()
    }
  })
})

describe('freeGames deviceAuthUrl（v0.1.387）', () => {
  it('拼出的地址含 accountId、host 为 prod03', () => {
    expect(deviceAuthUrl('ACC-123')).toBe('https://account-public-service-prod03.ol.epicgames.com/account/api/public/account/ACC-123/deviceAuth')
    expect(deviceAuthUrl('a/b c')).toContain('/public/account/a%2Fb%20c/deviceAuth')
  })
  it('旧端点不再出现在源码里', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('./freeGames.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('account/api/oauth/device/auth')
    expect(src).toContain('account/api/public/account/')
  })
})

describe('freeGames claimEpicGame 桌面通道', () => {
  it('quickPurchase 走 plugin_http，Bearer 头与下单体与旧 fetch 一致', async () => {
    const calls = stubTauriInvoke(async (_cmd, args) => {
      if (String(args.url).includes('quickPurchase')) {
        return pluginEnvelope(200, JSON.stringify({ quickPurchaseStatus: 'SUCCESS', orderId: 'OID-1' }))
      }
      return pluginEnvelope(200, '{}')
    })
    try {
      const orderId = await claimEpicGame('AT', 'ACC', fakeGame())
      expect(orderId).toBe('OID-1')
      expect(calls).toHaveLength(1)
      expect(String(calls[0].args.url)).toContain('quickPurchase')
      expect(calls[0].args.method).toBe('POST')
      expect(JSON.parse(String(calls[0].args.headersJson)).Authorization).toBe('Bearer AT')
      const body = JSON.parse(String(calls[0].args.body))
      expect(body.lineOffers[0].offerId).toBe('x1')
      expect(body.lineOffers[0].namespace).toBe('ns1')
    } finally {
      unStubWindow()
    }
  })
})

// v0.1.389：Epic 绑定 403 诊断（显示 errorCode）+ refresh_token 兜底 + 启动器 UA
async function setupTestVault389() {
  const { webcrypto } = await import('node:crypto')
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
  if (!(globalThis as unknown as Record<string, unknown>).localStorage) {
    const m = new Map<string, string>()
    ;(globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, v) },
      removeItem: (k: string) => { m.delete(k) },
      clear: () => m.clear(),
    }
  }
  const { initVault } = await import('./crypto')
  await initVault('testpwd8')
  testStorage389().removeItem(EPIC_AUTH_KEY)
}
function testStorage389() {
  return (globalThis as unknown as { localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } }).localStorage
}

describe('freeGames describeDeviceAuthError（v0.1.389）', () => {
  it('errorCode + errorMessage 都拼进文案', () => {
    expect(describeDeviceAuthError(403, JSON.stringify({ errorCode: 'errors.com.epicgames.account.device_auth.forbidden', errorMessage: 'not allowed' })))
      .toBe('HTTP 403：errors.com.epicgames.account.device_auth.forbidden：not allowed')
  })
  it('非 JSON 体只剩状态码', () => {
    expect(describeDeviceAuthError(403, '<html>forbidden</html>')).toBe('HTTP 403')
  })
  it('只有 error 字段也取', () => {
    expect(describeDeviceAuthError(500, JSON.stringify({ error: 'server_error' }))).toBe('HTTP 500：server_error')
  })
})

describe('freeGames bindEpicWithAuthCode 403 诊断与 refresh 兜底（v0.1.389）', () => {
  it('设备授权 403 时错误信息带上 Epic 的 errorCode，不再只显示状态码；且不留假绑定', async () => {
    await setupTestVault389()
    const origFetch = globalThis.fetch
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = []
    globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
      const u = String(url)
      calls.push({ url: u, headers: init?.headers ?? {}, body: String(init?.body ?? '') })
      if (u.includes('/oauth/token')) {
        // 换 token 成功，但不给 refresh token：兜底走不通，必须把 errorCode 抛出来
        return { ok: true, text: async () => JSON.stringify({ access_token: 'AT', account_id: 'ACC' }), json: async () => ({}) }
      }
      return {
        ok: false, status: 403,
        text: async () => JSON.stringify({ errorCode: 'errors.com.epicgames.account.device_auth.forbidden', errorMessage: 'Device auth not allowed for this client' }),
        json: async () => ({}),
      }
    }) as typeof fetch
    try {
      await expect(bindEpicWithAuthCode('CODE123', 'testpwd8')).rejects.toThrow(/创建设备授权失败/)
      await expect(bindEpicWithAuthCode('CODE123', 'testpwd8')).rejects.toThrow(/errors\.com\.epicgames\.account\.device_auth\.forbidden/)
      await expect(bindEpicWithAuthCode('CODE123', 'testpwd8')).rejects.toThrow(/HTTP 403/)
      expect(testStorage389().getItem(EPIC_AUTH_KEY)).toBeNull()
      // 设备授权请求带启动器 UA（v0.1.389 新增）
      const daCall = calls.find(c => c.url.includes('deviceAuth'))
      expect(daCall).toBeDefined()
      expect(daCall!.headers['User-Agent']).toBe(EPIC_LAUNCHER_UA)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it('设备授权 403 但换 token 时拿到 refresh_token：改走 refresh_token 登录，绑定成功并标出原因', async () => {
    await setupTestVault389()
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      const u = String(url)
      const body = String(init?.body ?? '')
      if (u.includes('/oauth/token') && body.includes('grant_type=authorization_code')) {
        return { ok: true, text: async () => JSON.stringify({ access_token: 'AT', account_id: 'ACC', refresh_token: 'RT1' }), json: async () => ({}) }
      }
      if (u.includes('/oauth/token') && body.includes('grant_type=refresh_token')) {
        return { ok: true, text: async () => JSON.stringify({ access_token: 'AT2', account_id: 'ACC' }), json: async () => ({}) }
      }
      return {
        ok: false, status: 403,
        text: async () => JSON.stringify({ errorCode: 'errors.com.epicgames.account.device_auth.forbidden' }),
        json: async () => ({}),
      }
    }) as typeof fetch
    try {
      const auth = await bindEpicWithAuthCode('CODE123', 'testpwd8')
      expect(auth.authMode).toBe('refresh')
      expect(auth.refreshToken).toBe('RT1')
      expect(auth.deviceAuthError).toContain('errors.com.epicgames.account.device_auth.forbidden')
      const stored = await loadEpicAuth('testpwd8')
      expect(stored?.authMode).toBe('refresh')
      expect(stored?.refreshToken).toBe('RT1')
      // v0.1.404：兜底原因随授权加密存本机，绑定卡重进后可展开查看
      expect(stored?.deviceAuthError).toContain('errors.com.epicgames.account.device_auth.forbidden')
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it('refresh_token 兜底也换不到 access：不留假绑定，存过的授权要清掉', async () => {
    await setupTestVault389()
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      const u = String(url)
      const body = String(init?.body ?? '')
      if (u.includes('/oauth/token') && body.includes('grant_type=authorization_code')) {
        return { ok: true, text: async () => JSON.stringify({ access_token: 'AT', account_id: 'ACC', refresh_token: 'RT1' }), json: async () => ({}) }
      }
      if (u.includes('/oauth/token') && body.includes('grant_type=refresh_token')) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ errorCode: 'invalid_grant' }), json: async () => ({}) }
      }
      return { ok: false, status: 403, text: async () => JSON.stringify({ errorCode: 'errors.com.epicgames.account.device_auth.forbidden' }), json: async () => ({}) }
    }) as typeof fetch
    try {
      await expect(bindEpicWithAuthCode('CODE123', 'testpwd8')).rejects.toThrow(/创建设备授权失败/)
      await expect(bindEpicWithAuthCode('CODE123', 'testpwd8')).rejects.toThrow(/兜底登录也失败/)
      expect(testStorage389().getItem(EPIC_AUTH_KEY)).toBeNull()
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('freeGames epicAccessToken refresh 路线（v0.1.389）', () => {
  it('设备授权模式：先走 device_auth，拿到新 refresh_token 时加密存下', async () => {
    await setupTestVault389()
    const origFetch = globalThis.fetch
    const bodies: string[] = []
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(String(init?.body ?? ''))
      return { ok: true, text: async () => JSON.stringify({ access_token: 'AT2', refresh_token: 'RT2' }), json: async () => ({}) }
    }) as typeof fetch
    try {
      const auth: EpicDeviceAuth = { accountId: 'ACC', deviceId: 'D', secret: 'S', refreshToken: 'RT1', authMode: 'device' }
      const { access } = await epicAccessToken(auth, 'testpwd8')
      expect(access).toBe('AT2')
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toContain('grant_type=device_auth')
      const stored = await loadEpicAuth('testpwd8')
      expect(stored?.refreshToken).toBe('RT2')
      expect(stored?.authMode).toBe('device')
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it('设备授权失效（401）时自动用 refresh_token 兜底重试，成功后路线切到 refresh', async () => {
    await setupTestVault389()
    const origFetch = globalThis.fetch
    const bodies: string[] = []
    let n = 0
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      const body = String(init?.body ?? '')
      bodies.push(body)
      n++
      if (n === 1) {
        return { ok: false, status: 401, text: async () => JSON.stringify({ errorCode: 'errors.com.epicgames.account.invalid_token' }), json: async () => ({}) }
      }
      return { ok: true, text: async () => JSON.stringify({ access_token: 'AT3', refresh_token: 'RT3' }), json: async () => ({}) }
    }) as typeof fetch
    try {
      const auth: EpicDeviceAuth = { accountId: 'ACC', deviceId: 'D', secret: 'S', refreshToken: 'RT1', authMode: 'device' }
      const { access } = await epicAccessToken(auth, 'testpwd8')
      expect(access).toBe('AT3')
      expect(bodies).toHaveLength(2)
      expect(bodies[0]).toContain('grant_type=device_auth')
      expect(bodies[1]).toContain('grant_type=refresh_token')
      expect(bodies[1]).toContain('refresh_token=RT1')
      const stored = await loadEpicAuth('testpwd8')
      expect(stored?.authMode).toBe('refresh')
      expect(stored?.refreshToken).toBe('RT3')
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it('refresh 模式直接走 refresh_token 授权，不先试设备授权', async () => {
    await setupTestVault389()
    const origFetch = globalThis.fetch
    const bodies: string[] = []
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(String(init?.body ?? ''))
      return { ok: true, text: async () => JSON.stringify({ access_token: 'AT4' }), json: async () => ({}) }
    }) as typeof fetch
    try {
      const auth: EpicDeviceAuth = { accountId: 'ACC', deviceId: '', secret: '', refreshToken: 'RT1', authMode: 'refresh' }
      const { access } = await epicAccessToken(auth, 'testpwd8')
      expect(access).toBe('AT4')
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toContain('grant_type=refresh_token')
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it('refresh token 也失效：报登录失效请重新绑定，不吐授权码文案', async () => {
    await setupTestVault389()
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: false, status: 400,
      text: async () => JSON.stringify({ errorCode: 'invalid_grant' }),
      json: async () => ({}),
    })) as unknown as typeof fetch
    try {
      const auth: EpicDeviceAuth = { accountId: 'ACC', deviceId: '', secret: '', refreshToken: 'RT-DEAD', authMode: 'refresh' }
      await expect(epicAccessToken(auth, 'testpwd8')).rejects.toThrow(/Epic 登录失效，请重新绑定账号/)
      await expect(epicAccessToken(auth, 'testpwd8')).rejects.not.toThrow(/授权码/)
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('freeGames bindEpicWithAuthCode 桌面通道 UA（v0.1.389）', () => {
  it('创建设备授权经 plugin_http 发出时带启动器 UA；设备授权成功时 refresh_token 一并存下', async () => {
    await setupTestVault389()
    const calls = stubTauriInvoke(async (_cmd, args) => {
      const u = String(args.url)
      if (u.includes('/oauth/token')) return pluginEnvelope(200, JSON.stringify({ access_token: 'AT', account_id: 'ACC', refresh_token: 'RT1' }))
      return pluginEnvelope(200, JSON.stringify({ deviceId: 'D', secret: 'S', accountId: 'ACC' }))
    })
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('桌面通道下不应走 fetch') }) as typeof fetch
    try {
      const auth = await bindEpicWithAuthCode('CODE123', 'testpwd8')
      expect(auth.authMode).toBe('device')
      expect(auth.refreshToken).toBe('RT1')
      expect(auth.deviceAuthError).toBeUndefined()
      const daCall = calls.find(c => String(c.args.url).includes('deviceAuth'))
      expect(daCall).toBeDefined()
      expect(JSON.parse(String(daCall!.args.headersJson))['User-Agent']).toBe(EPIC_LAUNCHER_UA)
      const stored = await loadEpicAuth('testpwd8')
      expect(stored?.refreshToken).toBe('RT1')
      expect(stored?.deviceId).toBe('D')
    } finally {
      globalThis.fetch = origFetch
      unStubWindow()
    }
  })
})

// v0.1.392：修 Epic 领游戏拿不到 purchaseToken
// 根因（2026-11-24 实测）：结账页是网页会话页，无 Cookie 时 GET 直接 302 到 /login，
// 只发 Bearer token 必然拿不到 token（node-epicgames-client 能拿到是因为它的 HTTP
// 客户端带持久 Cookie jar；本 App 原生通道没有）。修法：取页时把 access token 以
// Epic 网站登录 Cookie（EPIC_BEARER_TOKEN）形式带上 + 浏览器 UA；再试商店站内页；
// 两处都拿不到就抛手动结账错误（带浏览器结账链接），不静默。
describe('freeGames extractPurchaseToken（v0.1.392）', () => {
  it('id 在前、value 在后能取到', () => {
    expect(extractPurchaseToken('<input id="purchaseToken" type="hidden" value="PT-ABC123">')).toBe('PT-ABC123')
  })
  it('value 在前、id 在后也能取到', () => {
    expect(extractPurchaseToken("<input value='PT-XYZ' id='purchaseToken'>")).toBe('PT-XYZ')
  })
  it('登录跳转页里没有 token', () => {
    expect(extractPurchaseToken('Found. Redirecting to /login?state=%2Fpurchase-login%3FshowNavigation%3Dtrue')).toBe('')
  })
})

describe('freeGames describePurchasePage（v0.1.392）', () => {
  it('302 跳登录页要明说没带浏览器登录态，不认 Bearer', () => {
    const d = describePurchasePage(302, 'Found. Redirecting to /login?state=%2Fpurchase-login%3FshowNavigation%3Dtrue')
    expect(d).toMatch(/登录页|登录跳转/)
    expect(d).toMatch(/Cookie/)
    expect(d).toMatch(/Bearer/)
  })
  it('200 的登录页 HTML 同样识别为登录页', () => {
    expect(describePurchasePage(200, '<html><body>purchase-login form</body></html>')).toMatch(/登录页/)
  })
  it('人机验证页单独说明', () => {
    expect(describePurchasePage(200, '<html>Attention Required! cf-challenge</html>')).toMatch(/人机验证/)
  })
  it('其他情况报状态码与页面长度', () => {
    expect(describePurchasePage(200, '<html>ok</html>')).toMatch(/HTTP 200/)
  })
})

describe('freeGames 浏览器结账链接（v0.1.392）', () => {
  it('buildEpicCheckoutUrl 按 claabs 格式出 offers=1-命名空间- offerId', () => {
    expect(buildEpicCheckoutUrl(fakeGame({ id: '1f9a12b06b4f437790b6913ad136a08c', namespace: '3d6441ab9d4246208bc97d7babf664b5' })))
      .toBe('https://www.epicgames.com/store/purchase?highlightColor=0078f2&offers=1-3d6441ab9d4246208bc97d7babf664b5-1f9a12b06b4f437790b6913ad136a08c&orderId&purchaseToken&showNavigation=true')
  })
  it('v0.1.396 回归：兜底链接就是商店结账页本身，不再包 id/login 跳转（启动器客户端没登记商店页当 redirectUrl，包了就报无效客户端）', () => {
    const u = buildEpicCheckoutUrl(fakeGame({ id: 'x1', namespace: 'ns1' }))
    expect(u).toBe('https://www.epicgames.com/store/purchase?highlightColor=0078f2&offers=1-ns1-x1&orderId&purchaseToken&showNavigation=true')
    expect(u).not.toContain('id/login')
    expect(u).not.toContain('client_id')
  })
  it('checkoutUrlOf 只从手动结账错误里取链接，普通错误返回 undefined', () => {
    const err = new EpicManualCheckoutError('拿不到 token', 'https://example.com/checkout')
    expect(checkoutUrlOf(err)).toBe('https://example.com/checkout')
    expect(err.name).toBe('EpicManualCheckoutError')
    expect(checkoutUrlOf(new Error('普通错'))).toBeUndefined()
    expect(checkoutUrlOf(null)).toBeUndefined()
  })
})

describe('freeGames claimEpicGame purchaseToken 两次尝试（v0.1.392）', () => {
  const loginRedirectBody = 'Found. Redirecting to /login?state=%2Fpurchase-login%3FshowNavigation%3Dtrue'
  const tokenPage = '<html><body><form><input id="purchaseToken" type="hidden" value="PT-1"></form></body></html>'
  const previewOk = JSON.stringify({ order: { namespace: 'ns1', country: null, countryName: null, offers: ['x1'], orderResponse: { totalPrice: 0 }, syncToken: 'SYNC-1' } })
  const confirmOk = JSON.stringify({ data: { confirmation: 'CONF-1' } })

  it('两次取页都是登录跳转：抛手动结账错误，带结账链接与登录页诊断；取页请求带 Cookie 形态的 token 与浏览器 UA', async () => {
    const calls = stubTauriInvoke(async (_cmd, args) => {
      const u = String(args.url)
      if (u.includes('quickPurchase')) return pluginEnvelope(200, JSON.stringify({ quickPurchaseStatus: 'CHECKOUT' }))
      return pluginEnvelope(302, loginRedirectBody)
    })
    try {
      const p = claimEpicGame('AT', 'ACC', fakeGame())
      await expect(p).rejects.toThrow(/没给到 purchaseToken/)
      await expect(p).rejects.toThrow(/登录页/)
      let caught: unknown
      try { await p } catch (e) { caught = e }
      expect(caught).toBeInstanceOf(EpicManualCheckoutError)
      // v0.1.396：手动结账链接就是商店结账页直链，不再包 id/login（包了报无效客户端）
      expect(checkoutUrlOf(caught)).toBe('https://www.epicgames.com/store/purchase?highlightColor=0078f2&offers=1-ns1-x1&orderId&purchaseToken&showNavigation=true')
      // 两次取页：启动器内嵌页 + 商店站内页
      const pageCalls = calls.filter(c => String(c.args.url).includes('/purchase'))
      expect(pageCalls).toHaveLength(2)
      expect(String(pageCalls[0].args.url)).toContain('launcher-website-prod07.ol.epicgames.com/purchase')
      expect(String(pageCalls[1].args.url)).toContain('www.epicgames.com/store/purchase')
      for (const pc of pageCalls) {
        const h = JSON.parse(String(pc.args.headersJson)) as Record<string, string>
        expect(h.Authorization).toBe('Bearer AT')
        expect(h.Cookie).toBe('EPIC_BEARER_TOKEN=AT')
        expect(h['User-Agent']).toBe(EPIC_WEB_UA)
      }
    } finally {
      unStubWindow()
    }
  })

  it('第一次取页拿到 token：继续 order-preview/confirm-order，走完领成功', async () => {
    const calls = stubTauriInvoke(async (_cmd, args) => {
      const u = String(args.url)
      if (u.includes('quickPurchase')) return pluginEnvelope(200, JSON.stringify({ quickPurchaseStatus: 'CHECKOUT' }))
      if (u.includes('launcher-website-prod07')) return pluginEnvelope(200, tokenPage)
      if (u.includes('order-preview')) return pluginEnvelope(200, previewOk)
      if (u.includes('confirm-order')) return pluginEnvelope(200, confirmOk)
      return pluginEnvelope(200, '{}')
    })
    try {
      const orderId = await claimEpicGame('AT', 'ACC', fakeGame())
      expect(orderId).toBe('CONF-1')
      // 拿到 token 就不去试第二处
      const pageGets = calls.filter(c => String(c.args.url).includes('launcher-website-prod07') || String(c.args.url).includes('www.epicgames.com/store/purchase'))
      expect(pageGets).toHaveLength(1)
      const preview = calls.find(c => String(c.args.url).includes('order-preview'))!
      expect(JSON.parse(String(preview.args.headersJson))['x-requested-with']).toBe('PT-1')
      const confirm = calls.find(c => String(c.args.url).includes('confirm-order'))!
      expect(JSON.parse(String(confirm.args.headersJson))['x-requested-with']).toBe('PT-1')
      expect(JSON.parse(String(confirm.args.body)).syncToken).toBe('SYNC-1')
    } finally {
      unStubWindow()
    }
  })

  it('第一次取页是登录跳转、第二次商店站内页拿到 token：照样走完领成功', async () => {
    const calls = stubTauriInvoke(async (_cmd, args) => {
      const u = String(args.url)
      if (u.includes('quickPurchase')) return pluginEnvelope(200, JSON.stringify({ quickPurchaseStatus: 'CHECKOUT' }))
      if (u.includes('launcher-website-prod07')) return pluginEnvelope(302, loginRedirectBody)
      if (u.includes('www.epicgames.com/store/purchase')) return pluginEnvelope(200, tokenPage)
      if (u.includes('order-preview')) return pluginEnvelope(200, previewOk)
      if (u.includes('confirm-order')) return pluginEnvelope(200, confirmOk)
      return pluginEnvelope(200, '{}')
    })
    try {
      const orderId = await claimEpicGame('AT', 'ACC', fakeGame())
      expect(orderId).toBe('CONF-1')
      const pageGets = calls.filter(c => String(c.args.url).includes('launcher-website-prod07') || String(c.args.url).includes('www.epicgames.com/store/purchase'))
      expect(pageGets).toHaveLength(2)
    } finally {
      unStubWindow()
    }
  })
})

describe('freeGames 只保留 Epic（v0.1.398）', () => {
  it('默认偏好里没有 GOG/育碧开关', () => {
    const prefs = defaultPrefs()
    expect('gogEnabled' in prefs).toBe(false)
    expect('ubiEnabled' in prefs).toBe(false)
    expect(prefs.epicEnabled).toBe(true)
  })
})

// v0.1.405：浏览器手动领的游戏同步进 App 显示已入库。
// 先试 Epic 库房接口（library-service，legendary 同款）查已购，不通再试授权
// 接口；两路都查不到时给手动「已领过」标记按钮。库房接口在沙箱里没法用真账
// 号验证（library-service 连接被服务端挂断，见 freeGames.ts 注释），以下
// 单测用 stub 的 invoke 钉住请求参数与解析/对照逻辑；真机仍需 Ethan 实机验。
function ensureLocalStorage() {
  if (!(globalThis as unknown as Record<string, unknown>).localStorage) {
    const m = new Map<string, string>()
    ;(globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, v) },
      removeItem: (k: string) => { m.delete(k) },
      clear: () => m.clear(),
    }
  } else {
    ;(globalThis.localStorage as Storage).clear()
  }
}

describe('freeGames parseOwnedKeys（v0.1.405）', () => {
  it('库房 records 形态：抽 namespace:catalogItemId，去重、跳过缺字段的', () => {
    const keys = parseOwnedKeys({
      records: [
        { namespace: 'ns1', catalogItemId: 'id1', title: 'A' },
        { namespace: 'ns1', catalogItemId: 'id1' },
        { namespace: 'ns2', catalogItemId: 'id2' },
        { namespace: 'ns3' },
        { catalogItemId: 'id4' },
        'not-an-object',
      ],
      responseMetadata: { count: 6 },
    })
    expect([...keys].sort()).toEqual(['ns1:id1', 'ns2:id2'])
  })
  it('授权接口数组形态：entitlementName 的 ns:id 形态也认', () => {
    const keys = parseOwnedKeys([
      { entitlementName: 'ns9:id9', entitlementType: 'EXECUTABLE' },
      { namespace: 'ns8', catalogItemId: 'id8' },
      { entitlementName: 'no-colon' },
    ])
    expect([...keys].sort()).toEqual(['ns8:id8', 'ns9:id9'])
  })
  it('空体/非对象返回空集，不抛错', () => {
    expect(parseOwnedKeys(null).size).toBe(0)
    expect(parseOwnedKeys({}).size).toBe(0)
    expect(parseOwnedKeys('oops').size).toBe(0)
  })
})

describe('freeGames fetchOwnedEpicKeys（v0.1.405）', () => {
  it('库房接口 200：走 plugin_http、Bearer 头，返回已购键', async () => {
    const calls = stubTauriInvoke(async () => pluginEnvelope(200, JSON.stringify({
      records: [{ namespace: '3d6441ab9d4246208bc97d7babf664b5', catalogItemId: '1f9a12b06b4f437790b6913ad136a08c' }],
    })))
    try {
      const res = await fetchOwnedEpicKeys('AT', 'ACC')
      expect(res.source).toBe('library')
      expect(res.keys.has('3d6441ab9d4246208bc97d7babf664b5:1f9a12b06b4f437790b6913ad136a08c')).toBe(true)
      expect(calls).toHaveLength(1)
      expect(String(calls[0].args.url)).toContain('library-service.live.on.epicgames.com/library/api/public/items')
      expect(JSON.parse(String(calls[0].args.headersJson)).Authorization).toBe('Bearer AT')
    } finally { unStubWindow() }
  })
  it('库房接口 403 时改走授权接口', async () => {
    const calls = stubTauriInvoke(async (_cmd, args) => {
      const u = String(args.url)
      if (u.includes('library-service')) return pluginEnvelope(403, '{}')
      if (u.includes('entitlement-public-service')) return pluginEnvelope(200, JSON.stringify([
        { namespace: 'nsE', catalogItemId: 'idE' },
      ]))
      return pluginEnvelope(404, '{}')
    })
    try {
      const res = await fetchOwnedEpicKeys('AT', 'ACC-1')
      expect(res.source).toBe('entitlements')
      expect(res.keys.has('nsE:idE')).toBe(true)
      expect(calls.some(c => String(c.args.url).includes('/entitlement/api/account/ACC-1/entitlements'))).toBe(true)
    } finally { unStubWindow() }
  })
  it('两路都失败时抛错，原因写明两路状态并提示手动标记', async () => {
    stubTauriInvoke(async (_cmd, args) => {
      const u = String(args.url)
      if (u.includes('library-service')) return pluginEnvelope(403, '{}')
      return pluginEnvelope(500, '{}')
    })
    try {
      await expect(fetchOwnedEpicKeys('AT', 'ACC')).rejects.toThrow(/库房查询失败/)
      await expect(fetchOwnedEpicKeys('AT', 'ACC')).rejects.toThrow(/已领过/)
    } finally { unStubWindow() }
  })
  it('库房接口 401 直接报登录失效，不再试授权接口', async () => {
    const calls = stubTauriInvoke(async () => pluginEnvelope(401, '{}'))
    try {
      await expect(fetchOwnedEpicKeys('AT', 'ACC')).rejects.toThrow(/登录失效/)
      expect(calls).toHaveLength(1)
    } finally { unStubWindow() }
  })
  it('分页：第一页 100 条、第二页 1 条，全部合并', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ namespace: 'ns', catalogItemId: `id${i}` }))
    const calls = stubTauriInvoke(async (_cmd, args) => {
      const u = String(args.url)
      if (u.includes('start=100')) return pluginEnvelope(200, JSON.stringify({ records: [{ namespace: 'ns', catalogItemId: 'id100' }] }))
      return pluginEnvelope(200, JSON.stringify({ records: page1 }))
    })
    try {
      const res = await fetchOwnedEpicKeys('AT', 'ACC')
      expect(res.keys.size).toBe(101)
      expect(calls).toHaveLength(2)
    } finally { unStubWindow() }
  })
})

describe('freeGames markEpicGameClaimed（v0.1.405）', () => {
  it('第一次标记写一条 already 记录，第二次返回 false、不重复写', () => {
    ensureLocalStorage()
    expect(markEpicGameClaimed('Mark of the Deep')).toBe(true)
    const recs = readRecords()
    expect(recs).toHaveLength(1)
    expect(recs[0].outcome).toBe('already')
    expect(recs[0].message).toMatch(/手动标记已领过/)
    expect(markEpicGameClaimed('Mark of the Deep')).toBe(false)
    expect(readRecords()).toHaveLength(1)
    expect(claimedGameIds().has('epic:Mark of the Deep')).toBe(true)
  })
  it('空标题不写记录', () => {
    ensureLocalStorage()
    expect(markEpicGameClaimed('   ')).toBe(false)
    expect(readRecords()).toHaveLength(0)
  })
})

describe('freeGames syncOwnedEpicGames（v0.1.405）', () => {
  async function seedBoundAuth() {
    const { webcrypto } = await import('node:crypto')
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
    ensureLocalStorage()
    const { initVault } = await import('./crypto')
    await initVault('testpwd8')
    stubTauriInvoke(async (_cmd, args) => {
      const u = String(args.url)
      if (u.includes('/oauth/token')) return pluginEnvelope(200, JSON.stringify({ access_token: 'AT', account_id: 'ACC', refresh_token: 'RT' }))
      if (u.includes('library-service')) return pluginEnvelope(200, JSON.stringify({
        records: [{ namespace: '3d6441ab9d4246208bc97d7babf664b5', catalogItemId: '1f9a12b06b4f437790b6913ad136a08c' }],
      }))
      if (u.includes('freeGamesPromotions')) return pluginEnvelope(200, JSON.stringify(EPIC_FIXTURE))
      return pluginEnvelope(200, JSON.stringify({ deviceId: 'D', secret: 'S', accountId: 'ACC' }))
    })
    await bindEpicWithAuthCode('CODE123', 'testpwd8')
  }

  it('库房命中本周免费游戏：补 already 记录，第二次同步不再重复', async () => {
    await seedBoundAuth()
    try {
      const games = parseEpicPromotions(EPIC_FIXTURE).current
      expect(games.map(g => g.title)).toContain('Mark of the Deep')
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), epicCurrent: games, epicUpcoming: [] }))
      const res = await syncOwnedEpicGames('testpwd8')
      expect(res.synced).toEqual(['Mark of the Deep'])
      expect(res.ownedCount).toBe(1)
      expect(res.source).toBe('library')
      const recs = readRecords()
      expect(recs.some(r => r.title === 'Mark of the Deep' && r.outcome === 'already' && /浏览器领取/.test(r.message))).toBe(true)
      const res2 = await syncOwnedEpicGames('testpwd8')
      expect(res2.synced).toEqual([])
      expect(res2.alreadyKnown).toEqual(['Mark of the Deep'])
      expect(readRecords().filter(r => r.title === 'Mark of the Deep')).toHaveLength(1)
    } finally { unStubWindow() }
  })
  it('缓存没列表时先拉一份新的再对照', async () => {
    await seedBoundAuth()
    try {
      const res = await syncOwnedEpicGames('testpwd8')
      expect(res.synced).toEqual(['Mark of the Deep'])
    } finally { unStubWindow() }
  })
  it('未解锁保险箱时抛错，不碰 Epic 接口', async () => {
    ensureLocalStorage()
    await expect(syncOwnedEpicGames('')).rejects.toThrow(/解锁保险箱/)
  })
  it('未绑定 Epic 时抛错，提示先绑定', async () => {
    ensureLocalStorage()
    await expect(syncOwnedEpicGames('testpwd8')).rejects.toThrow(/绑定 Epic/)
  })
})
