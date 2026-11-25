// 工坊 · 免费游戏（v0.1.384）：Epic 每周喜加一自动领取。
// v0.1.398：只保留 Epic，GOG / 育碧分组已删（Ethan 拍板；当初只做列表+直达官网，没有自动领取逻辑）。
// Epic 发现用公开 freeGamesPromotions 接口（2026-11-24 实测通）；领取照抄
// node-epicgames-client 的 purchase 流程（quickPurchase → purchaseToken →
// order-preview → confirm-order），参考 Revadike/epicgames-freebies-claimer。
// 全部偏好、领取记录、Epic 设备授权均为仅本机 localStorage，不进云同步/备份；
// 设备授权用保险箱主密码加密（仿照 tokenPool），绝不明文落盘。

import { encryptSecret, decryptSecret } from './crypto'
import { isNativeApp } from './openExternal'

export type FreeGamePlatform = 'epic'

export interface FreeGame {
  platform: FreeGamePlatform
  id: string
  namespace?: string
  title: string
  slug: string
  /** 官网领取页 */
  url: string
  imageUrl?: string
  originalPrice: string
  /** 当前是否免费（Epic：discountPercentage===0 且现价为 0） */
  isFree: boolean
  status: 'free' | 'upcoming'
  startDate: string | null
  endDate: string | null
  offerType?: string
  /** 仅 Epic：基础游戏可直接用 id+namespace 下单；捆绑包/DLC 需手动领 */
  autoClaimable: boolean
}

export interface ClaimRecord {
  at: number
  platform: FreeGamePlatform
  title: string
  outcome: 'claimed' | 'already' | 'error'
  message: string
  /** 领取失败且可去浏览器结账时：浏览器结账链接（仅 Epic 手动结账错误，v0.1.392） */
  checkoutUrl?: string
}

export interface FreeGamesPrefs {
  autoClaim: boolean
  /** 巡查间隔（小时），默认 6 */
  intervalHours: number
  notify: boolean
  captchaRemind: boolean
  epicEnabled: boolean
}

export const PREFS_KEY = 'acm.freegames.prefs.v1'
export const RECORDS_KEY = 'acm.freegames.records.v1'
export const EPIC_AUTH_KEY = 'acm.freegames.epic.v1'
export const CACHE_KEY = 'acm.freegames.cache.v1'
export const GROUPS_KEY = 'acm.freegames.groups.v1'
export const LAST_CHECK_KEY = 'acm.freegames.lastCheck.v1'
export const LAST_ERROR_KEY = 'acm.freegames.lastError.v1'

export const PAGE_SIZE = 8

export const EPIC_LOGIN_URL =
  'https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Fapi%2Fredirect%3FclientId%3D34a02cf8f4414e29b15921876da36f9a%26responseType%3Dcode'

const EPIC_CLIENT_ID = '34a02cf8f4414e29b15921876da36f9a'
const EPIC_CLIENT_SECRET = 'daafbccc737745039dffe53d94fc76cf'
const PROMO_URL =
  'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN'
const TOKEN_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token'
// 创建设备授权（v0.1.387 修正）：旧的设备授权端点已死——prod03 与 prod
// 两个 host 用假 token 探都返回 404 errors.com.epicgames.common.not_found，
// 路由本身不存在。正确端点是 public/account/{account_id}/deviceAuth
// （假 token 探返回 401 invalid_token，说明路由存在、只是在验 token）。
export function deviceAuthUrl(accountId: string): string {
  return `https://account-public-service-prod03.ol.epicgames.com/account/api/public/account/${encodeURIComponent(accountId)}/deviceAuth`
}
// 启动器 UA（v0.1.389）：Epic 官方文档的 token 交换写法带此 UA；
// 2026-11-24 实测设备授权端点返回 403（原因未定，当时 App 没带 UA、也没显示
// errorCode），先给设备授权请求补上，再看 Epic 实际返回的错误码。
export const EPIC_LAUNCHER_UA = 'UELauncher/11.0.1-14907503+++Portal+Release-Live Windows/10.0.0.19041.1.256.64bit'
// 结账页是网页会话页，拿浏览器 UA 去取（v0.1.392）：它只认浏览器 Cookie，
// 不认 Bearer token；非浏览器 UA 还可能撞上 Epic 的机器人检测页。
export const EPIC_WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const QUICK_PURCHASE_URL =
  'https://orderprocessor-public-service-ecomprod01.ol.epicgames.com/orderprocessor/api/shared/accounts/'
const PURCHASE_PAGE_URL = 'https://launcher-website-prod07.ol.epicgames.com/purchase'
const EPIC_STORE_PURCHASE_URL = 'https://www.epicgames.com/store/purchase'
const PCI_BASE = 'https://payment-website-pci.ol.epicgames.com/purchase'
// DLC/捆绑包需按 Revadike 做法走 GraphQL 解析 offerId（getMappingByPageSlug，
// persisted query sha256 5a08e9869c983776596498e0c4052c55f9e54c79e18a303cd5eb9a46be55c7d7）；
// 第一版不自动领这类，只在商店手动领，见 toFreeGame 的 autoClaimable。

export function defaultPrefs(): FreeGamesPrefs {
  return {
    autoClaim: true,
    intervalHours: 6,
    notify: true,
    captchaRemind: true,
    epicEnabled: true,
  }
}

export function loadPrefs(): FreeGamesPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<FreeGamesPrefs> | null
    return v && typeof v === 'object' ? { ...defaultPrefs(), ...v } : defaultPrefs()
  } catch { return defaultPrefs() }
}

export function savePrefs(p: FreeGamesPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* 忽略 */ }
}

export function loadLastCheckAt(): number | null {
  const v = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0)
  return v > 0 ? v : null
}

export function loadLastError(): string | null {
  try { return localStorage.getItem(LAST_ERROR_KEY) } catch { return null }
}

function saveLastCheck(at: number, err: string | null): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(at))
    if (err) localStorage.setItem(LAST_ERROR_KEY, err)
    else localStorage.removeItem(LAST_ERROR_KEY)
  } catch { /* 忽略 */ }
}

/** 下次巡查时间（上次 + 间隔；从未查过则为现在） */
export function nextCheckAt(prefs: FreeGamesPrefs, lastCheck: number | null): number {
  if (!lastCheck) return Date.now()
  return lastCheck + prefs.intervalHours * 3600_000
}

// ---------------- 领取记录 ----------------

export function readRecords(): ClaimRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '[]') as ClaimRecord[]
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

export function addRecord(r: ClaimRecord): void {
  try {
    const list = [r, ...readRecords()].slice(0, 200)
    localStorage.setItem(RECORDS_KEY, JSON.stringify(list))
  } catch { /* 忽略 */ }
}

export function clearRecords(): void {
  try { localStorage.removeItem(RECORDS_KEY) } catch { /* 忽略 */ }
}

/** 失败组置顶：失败在前，其次按时间倒序 */
export function sortRecords(records: ClaimRecord[]): ClaimRecord[] {
  return [...records].sort((a, b) => {
    const ae = a.outcome === 'error' ? 0 : 1
    const be = b.outcome === 'error' ? 0 : 1
    if (ae !== be) return ae - be
    return b.at - a.at
  })
}

export function claimedGameIds(): Set<string> {
  const ids = new Set<string>()
  for (const r of readRecords()) {
    if (r.outcome === 'claimed' || r.outcome === 'already') ids.add(`${r.platform}:${r.title}`)
  }
  return ids
}

// ---------------- 分组折叠（本机记忆） ----------------

export function loadClosedGroups(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]') as string[]
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

export function saveClosedGroups(ids: string[]): void {
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify(ids)) } catch { /* 忽略 */ }
}

/** 分页切片：page 从 1 开始 */
export function pageSlice<T>(list: T[], page: number, size = PAGE_SIZE): T[] {
  const p = Math.max(1, page)
  return list.slice((p - 1) * size, p * size)
}

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size))
}

// ---------------- Epic：发现 ----------------

interface EpicPromoElement {
  title: string
  id: string
  namespace: string
  productSlug?: string
  urlSlug?: string
  offerType?: string
  categories?: { path: string }[]
  price?: { totalPrice?: { discountPrice?: number; fmtPrice?: { originalPrice?: string } } }
  keyImages?: { type: string; url: string }[]
  promotions?: {
    promotionalOffers?: { promotionalOffers: { startDate: string; endDate: string; discountSetting: { discountPercentage: number } }[] }[]
    upcomingPromotionalOffers?: { promotionalOffers: { startDate: string; endDate: string; discountSetting: { discountPercentage: number } }[] }[]
  }
}

function epicSlug(e: EpicPromoElement): string {
  return ((e.productSlug || e.urlSlug || e.id) ?? '').split('/')[0]
}

function epicCover(e: EpicPromoElement): string | undefined {
  const imgs = e.keyImages ?? []
  return imgs.find(i => i.type === 'Thumbnail')?.url
    ?? imgs.find(i => i.type === 'DieselStoreFrontWide')?.url
    ?? imgs[0]?.url
}

function toFreeGame(e: EpicPromoElement, status: 'free' | 'upcoming', start: string | null, end: string | null): FreeGame {
  const slug = epicSlug(e)
  const discount = e.price?.totalPrice?.discountPrice
  return {
    platform: 'epic',
    id: e.id,
    namespace: e.namespace,
    title: e.title,
    slug,
    url: `https://store.epicgames.com/zh-CN/p/${slug}`,
    imageUrl: epicCover(e),
    originalPrice: e.price?.totalPrice?.fmtPrice?.originalPrice ?? '',
    isFree: status === 'free' && discount === 0,
    status,
    startDate: start,
    endDate: end,
    offerType: e.offerType,
    // 只有基础游戏能直接用 id+namespace 下单；捆绑包/DLC 需走商店手动领
    autoClaimable: e.offerType === 'BASE_GAME',
  }
}

/** 解析 freeGamesPromotions 返回体：当前免费 + 预告（纯函数，可单测） */
export function parseEpicPromotions(data: unknown): { current: FreeGame[]; upcoming: FreeGame[] } {
  const elements = (data as { data?: { Catalog?: { searchStore?: { elements?: EpicPromoElement[] } } } })
    ?.data?.Catalog?.searchStore?.elements ?? []
  const current: FreeGame[] = []
  const upcoming: FreeGame[] = []
  for (const e of elements) {
    const promos = e.promotions ?? {}
    for (const group of promos.promotionalOffers ?? []) {
      for (const p of group.promotionalOffers ?? []) {
        if (p.discountSetting?.discountPercentage === 0) {
          current.push(toFreeGame(e, 'free', p.startDate ?? null, p.endDate ?? null))
        }
      }
    }
    for (const group of promos.upcomingPromotionalOffers ?? []) {
      for (const p of group.promotionalOffers ?? []) {
        if (p.discountSetting?.discountPercentage === 0) {
          upcoming.push(toFreeGame(e, 'upcoming', p.startDate ?? null, p.endDate ?? null))
        }
      }
    }
  }
  // 同一游戏多条促销去重（取截止最晚的一条）
  const dedupe = (list: FreeGame[]): FreeGame[] => {
    const map = new Map<string, FreeGame>()
    for (const g of list) {
      const prev = map.get(g.id)
      if (!prev || (g.endDate ?? '') > (prev.endDate ?? '')) map.set(g.id, g)
    }
    return [...map.values()]
  }
  return { current: dedupe(current), upcoming: dedupe(upcoming) }
}

export async function fetchEpicFreeGames(): Promise<{ current: FreeGame[]; upcoming: FreeGame[] }> {
  let res: NativeHttpResult
  try {
    // 原生通道（桌面 plugin_http / 安卓 CapacitorHttp）：Epic 不返回 ACAO，
    // 桌面 WKWebView 里前端 fetch 会被 CORS 直接拦掉抛 "Load failed"（2026-11-24 实测）
    res = await epicRequest(PROMO_URL, 'GET', { Accept: 'application/json' })
  } catch (e) {
    throw toChineseFetchError(e, '免费游戏列表加载失败')
  }
  if (!res.ok) throw new Error(`免费游戏列表加载失败：Epic 接口返回 ${res.status}`)
  return parseEpicPromotions(JSON.parse(res.text))
}

// ---------------- Epic：设备授权绑定 ----------------

// 注意：响应字段名用 Record + 字符串取值，避免在源码里写出会被脱敏管道
// 误伤的 `xxx_token:` 字面量（见 2026-11-20 脱敏坑）。
type JsonObj = Record<string, unknown>

function pickStr(o: JsonObj, key: string): string {
  const v = o[key]
  return typeof v === 'string' ? v : ''
}

/**
 * WKWebView 下网络失败只抛一句英文 "Load failed"（TypeError），不说明哪一步失败
 * （v0.1.385 只包了列表请求，绑定/领取 6 处漏了，Ethan 08:42 实机截图实证）。
 * 所有 Epic fetch 统一经此 helper：网络失败换成中文并点名步骤。
 */
export function toChineseFetchError(e: unknown, step: string): Error {
  const msg = e instanceof Error ? e.message : String(e)
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(msg)) {
    return new Error(`${step}：网络请求失败，Epic 接口可能被代理/网络拦截，请换个节点再试`)
  }
  return e instanceof Error ? e : new Error(msg)
}

/** 兜底：文案里残留的 "Load failed" 一律替换成中文（防以后新增 fetch 再漏）。 */
export function sanitizeLoadFailedMessage(msg: string): string {
  return msg.replace(/load failed/gi, '网络请求失败，Epic 接口可能被代理/网络拦截，请换个节点再试')
}

/**
 * 设备授权失败的错误体解析（v0.1.389）：Epic 返回的 errorCode 之前被吞掉，
 * 只显示 HTTP 状态码（2026-11-24 实机 403 原因未定）。现在把 errorCode 与
 * errorMessage 一并拼进文案，方便对着官方文档查原因。
 */
export function describeDeviceAuthError(status: number, text: string): string {
  let data: JsonObj = {}
  try { data = JSON.parse(text) as JsonObj } catch { /* 非 JSON */ }
  const code = pickStr(data, 'errorCode') || pickStr(data, 'error')
  const msg = pickStr(data, 'errorMessage') || pickStr(data, 'message')
  const detail = [code, msg].filter(Boolean).join('：')
  return detail ? `HTTP ${status}：${detail}` : `HTTP ${status}`
}

export interface NativeHttpResult { ok: boolean; status: number; text: string }

/**
 * 免费游戏模块的 HTTP 出口（v0.1.386）：
 * 桌面走 Rust plugin_http、安卓走 CapacitorHttp（原生栈，无 CORS 限制）；
 * 网页版走 fetch（受目标站点 CORS 限制）。
 * 根因：Epic 接口不返回 Access-Control-Allow-Origin，桌面 WKWebView 里前端
 * fetch 会被 CORS 直接拦掉抛 "Load failed"，换节点也修不好（2026-11-24 实测）。
 * plugin_http 自带 SSRF 校验（validate_proxy_url）：仅放行公网 https 域名，
 * Epic 的域名是公网 https，通过校验；不改弱全局规则。
 */
export async function epicRequest(url: string, method: string, headers: Record<string, string>, body?: string): Promise<NativeHttpResult> {
  const w = typeof window !== 'undefined'
    ? (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<string> } })
    : undefined
  if (w?.__TAURI_INTERNALS__?.invoke) {
    const raw = await w.__TAURI_INTERNALS__.invoke('plugin_http', {
      url, method, headersJson: JSON.stringify(headers), body: body ?? null,
    })
    const parsed = JSON.parse(raw) as { status: number; body: string }
    return { ok: parsed.status >= 200 && parsed.status < 300, status: parsed.status, text: parsed.body }
  }
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({ url, method, headers, data: body, responseType: 'text' })
    return { ok: res.status >= 200 && res.status < 300, status: res.status, text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '') }
  }
  const res = await fetch(url, { method, headers, body })
  return { ok: res.ok, status: res.status, text: await res.text() }
}

function basicAuth(): string {
  return 'Basic ' + btoa(`${EPIC_CLIENT_ID}:${EPIC_CLIENT_SECRET}`)
}

async function postForm(url: string, params: Record<string, string>, bearer?: string, step = 'Epic 请求失败'): Promise<JsonObj> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: bearer ? `Bearer ${bearer}` : basicAuth(),
  }
  let res: NativeHttpResult
  try {
    res = await epicRequest(url, 'POST', headers, new URLSearchParams(params).toString())
  } catch (e) {
    throw toChineseFetchError(e, step)
  }
  const text = res.text
  let data: JsonObj = {}
  try { data = JSON.parse(text) as JsonObj } catch { /* 非 JSON */ }
  if (!res.ok) {
    const code = pickStr(data, 'errorCode') || pickStr(data, 'error') || `HTTP ${res.status}`
    // 授权码失效（Ethan 2026-11-24 实证：Epic 返回 authorization_code_not_found，
    // HTTP 400）：授权码只能用一次、有效期很短，原文错误码用户看不懂，换成中文
    if (code.includes('authorization_code_not_found') || code.includes('invalid_grant')) {
      throw new Error('授权码已失效或已被使用（授权码只能用一次、有效期很短），请重新登录获取新码再绑定')
    }
    throw new Error(`Epic 登录失败：${code}`)
  }
  return data
}

export interface EpicDeviceAuth {
  accountId: string
  deviceId: string
  secret: string
  displayName?: string
  /** 换 token 时 Epic 一并返回的 refresh token（v0.1.389 起加密存下，仅本机） */
  refreshToken?: string
  /** 登录路线：device=设备授权（优先），refresh=refresh_token 兜底 */
  authMode?: 'device' | 'refresh'
  /** v0.1.404 起随兜底授权一起加密存本机（只存本机、主密码加密），绑定卡重进后可展开查看失败原因 */
  deviceAuthError?: string
}

/** 加密保存 Epic 授权（设备授权与 refresh token 同一个密文，只存本机） */
async function saveEpicAuth(auth: EpicDeviceAuth, pwd: string): Promise<void> {
  const cipher = await encryptSecret(JSON.stringify(auth), pwd)
  try { localStorage.setItem(EPIC_AUTH_KEY, JSON.stringify({ cipher })) } catch { /* 忽略 */ }
}

/**
 * 用浏览器登录后得到的 authorization code 换 token，再创建设备授权。
 * v0.1.389：① 设备授权请求补启动器 UA；② 失败时把 Epic 的 errorCode 显示出来；
 * ③ 建不出设备授权时改走 refresh_token 登录（启动器客户端官方支持此流程），
 * 当场验一次换得到 access 才算绑定成功，否则不留一个看着已绑定、实际领不了的状态。
 */
export async function bindEpicWithAuthCode(code: string, pwd: string): Promise<EpicDeviceAuth> {
  const clean = code.trim()
  if (!clean) throw new Error('请先粘贴授权码')
  if (!pwd) throw new Error('请先解锁保险箱')
  const tok = await postForm(TOKEN_URL, { grant_type: 'authorization_code', code: clean, token_type: 'eg1' }, undefined, 'Epic 绑定失败')
  const access = pickStr(tok, 'access_token')
  const accountId = pickStr(tok, 'account_id')
  const refreshToken = pickStr(tok, 'refresh_token')
  if (!access || !accountId) throw new Error('Epic 授权码无效或已过期，请重新登录获取')
  let res: NativeHttpResult
  try {
    res = await epicRequest(deviceAuthUrl(accountId), 'POST', {
      Authorization: `Bearer ${access}`,
      'User-Agent': EPIC_LAUNCHER_UA,
    })
  } catch (e) {
    throw toChineseFetchError(e, 'Epic 绑定失败')
  }
  let deviceAuthError = ''
  let deviceId = ''
  let secret = ''
  let daAccountId = accountId
  if (res.ok) {
    let da: JsonObj = {}
    try { da = JSON.parse(res.text) as JsonObj } catch { /* 非 JSON */ }
    deviceId = pickStr(da, 'deviceId')
    secret = pickStr(da, 'secret')
    daAccountId = pickStr(da, 'accountId') || accountId
    if (!deviceId || !secret) deviceAuthError = '返回缺少 deviceId/secret'
  } else {
    deviceAuthError = describeDeviceAuthError(res.status, res.text)
  }
  if (deviceId && secret) {
    const auth: EpicDeviceAuth = {
      accountId: daAccountId, deviceId, secret,
      refreshToken: refreshToken || undefined, authMode: 'device',
    }
    await saveEpicAuth(auth, pwd)
    return auth
  }
  // 设备授权建不出：没有 refresh token 就只能报错（带上 Epic 的 errorCode）
  if (!refreshToken) {
    throw new Error(`创建设备授权失败（${deviceAuthError}），请稍后重试或重新绑定`)
  }
  const fallbackAuth: EpicDeviceAuth = { accountId, deviceId: '', secret: '', refreshToken, authMode: 'refresh', deviceAuthError: deviceAuthError || undefined }
  await saveEpicAuth(fallbackAuth, pwd)
  try {
    await epicAccessToken(fallbackAuth, pwd)
  } catch (e) {
    unbindEpic()
    const msg = e instanceof Error ? e.message : 'Epic 登录失效'
    throw new Error(`创建设备授权失败（${deviceAuthError}），refresh_token 兜底登录也失败：${msg}。请重新登录获取新码再绑定`)
  }
  return { ...fallbackAuth, deviceAuthError }
}

export function hasEpicAuth(): boolean {
  try { return !!JSON.parse(localStorage.getItem(EPIC_AUTH_KEY) ?? 'null')?.cipher } catch { return false }
}

export async function loadEpicAuth(pwd: string): Promise<EpicDeviceAuth | null> {
  try {
    const raw = JSON.parse(localStorage.getItem(EPIC_AUTH_KEY) ?? 'null') as { cipher?: string } | null
    if (!raw?.cipher || !pwd) return null
    return JSON.parse(await decryptSecret(raw.cipher, pwd)) as EpicDeviceAuth
  } catch { return null }
}

export function unbindEpic(): void {
  try { localStorage.removeItem(EPIC_AUTH_KEY) } catch { /* 忽略 */ }
}

/**
 * 设备授权换 access token（登录态失效时抛错，提示重新绑定）。
 * v0.1.389：① 有 refresh token 时按 authMode 选路线（refresh 模式直接走
 * refresh_token 授权）；② 设备授权失效时（401/invalid_grant 等）自动用已存的
 * refresh token 兜底重试一次，成功则把登录路线切到 refresh，不必打扰用户重新绑定；
 * ③ Epic 每次换 token 会轮换 refresh token，拿到新的就加密存下（需传 pwd），
 * 否则兜底路线只能用一次。
 */
export async function epicAccessToken(auth: EpicDeviceAuth, pwd?: string): Promise<{ access: string; accountId: string }> {
  const useRefreshFirst = auth.authMode === 'refresh' || !auth.deviceId || !auth.secret
  const deviceParams: Record<string, string> = {
    grant_type: 'device_auth',
    account_id: auth.accountId,
    device_id: auth.deviceId,
    secret: auth.secret,
    token_type: 'eg1',
  }
  const refreshParams: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken ?? '',
    token_type: 'eg1',
  }
  const isAuthFailure = (e: unknown): boolean =>
    /401|invalid|unauthorized|失效/.test(e instanceof Error ? e.message : String(e))
  try {
    let tok: JsonObj
    let fellBackToRefresh = false
    if (useRefreshFirst) {
      if (!auth.refreshToken) throw new Error('Epic 登录失效，请重新绑定账号')
      tok = await postForm(TOKEN_URL, refreshParams, undefined, 'Epic 登录失败')
    } else if (auth.refreshToken) {
      try {
        tok = await postForm(TOKEN_URL, deviceParams, undefined, 'Epic 登录失败')
      } catch (e) {
        // 设备授权可能被 Epic 吊销：refresh token 仍有效时直接兜底，不打扰用户
        if (!isAuthFailure(e)) throw e
        tok = await postForm(TOKEN_URL, refreshParams, undefined, 'Epic 登录失败')
        fellBackToRefresh = true
      }
    } else {
      tok = await postForm(TOKEN_URL, deviceParams, undefined, 'Epic 登录失败')
    }
    const access = pickStr(tok, 'access_token')
    if (!access) throw new Error('Epic 登录失效')
    const newRefresh = pickStr(tok, 'refresh_token')
    if (pwd && (newRefresh || fellBackToRefresh)) {
      await saveEpicAuth(
        {
          ...auth,
          refreshToken: newRefresh || auth.refreshToken,
          authMode: fellBackToRefresh ? 'refresh' : auth.authMode,
        },
        pwd,
      )
    }
    return { access, accountId: auth.accountId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Epic 登录失效'
    if (/401|失效|invalid|unauthorized/i.test(msg)) throw new Error('Epic 登录失效，请重新绑定账号')
    throw e
  }
}

// ---------------- Epic：领取 ----------------

/** 下单前安全校验：必须是当前免费（折扣 0% 且现价 0），非免费绝不下单 */
export function assertFreeToClaim(game: FreeGame): void {
  if (!game.isFree) throw new Error(`「${game.title}」当前不是免费，拒绝下单`)
  if (game.status !== 'free') throw new Error(`「${game.title}」还没开始免费`)
}

/** quickPurchase 请求体（纯函数，可单测） */
export function buildQuickPurchaseBody(game: FreeGame): Record<string, unknown> {
  return {
    salesChannel: 'Launcher-purchase-client',
    entitlementSource: 'Launcher-purchase-client',
    returnSplitPaymentItems: false,
    lineOffers: [{ offerId: game.id, quantity: 1, namespace: game.namespace }],
  }
}

function isCaptchaError(text: string): boolean {
  return /captcha/i.test(text)
}

function describeEpicError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (isCaptchaError(msg)) return 'Epic 要求验证码：请在浏览器打开商店手动领取一次，验证通过后可恢复自动领取（Clash 出口 IP 也可能触发风控）'
  if (/401|登录失效|重新绑定/.test(msg)) return 'Epic 登录失效，请重新绑定账号'
  return msg
}

interface OrderInfo {
  namespace: string
  country: string | null
  countryName: string | null
  offers: string[]
  orderResponse: { totalPrice: number }
  syncToken: string
}

/**
 * 从结账页 HTML 里取 #purchaseToken（纯函数，可单测）。
 * 注意：v0.1.392 之前这一步只拿 Bearer token 去取页，Epic 直接 302 到登录页，
 * 页里自然没有 token——不是 Epic 没给，是请求没带浏览器登录态。
 */
export function extractPurchaseToken(html: string): string {
  const m = /id=["']purchaseToken["'][^>]*value=["']([^"']+)["']/.exec(html)
    ?? /value=["']([^"']+)["'][^>]*id=["']purchaseToken["']/.exec(html)
  return m?.[1] ?? ''
}

/**
 * 取结账页拿到的到底是什么页面（纯函数，可单测）：失败原因必须说明白，
 * 不能只报一句「没给到 purchaseToken」。
 */
export function describePurchasePage(status: number, html: string): string {
  if (status === 302 || /purchase-login/.test(html) || /\/login\?state=/.test(html)) {
    return `取到的不是结账页，是 Epic 登录页（HTTP ${status}）：本次请求没有带上浏览器登录态，Epic 网页结账只认浏览器 Cookie，不认 Bearer token`
  }
  if (/cf-challenge|attention required|just a moment|cf-turnstile|hcaptcha|recaptcha/i.test(html)) {
    return `Epic 返回了人机验证页（HTTP ${status}），请在浏览器打开商店手动领取一次`
  }
  if (status >= 400) return `取结账页失败（HTTP ${status}）`
  return `取到的页面里没有 purchaseToken（HTTP ${status}，页面 ${html.length} 字节）`
}

/**
 * 浏览器结账页（claabs/epicgames-freegames-node 的 generateCheckoutUrl 同款格式）：
 * 在用户自己的浏览器里打开，Epic 网页登录态在，登录后点一下就能领。
 *
 * v0.1.396：兜底链接直接打开商店结账页，不再包 id/login 跳转。
 * 2026-11-24 实机：包跳转的版本在 Ethan 浏览器报「无效客户端 / 客户未知的
 * 重定向 URL」——启动器客户端 34a02cf8… 只登记了 id/api/redirect 这一个跳转
 * 地址（绑定登录用的就是它），Epic 不认商店页当 redirectUrl。claabs 能包是
 * 因为它用的是商店网页客户端 875a3b57…，登记的跳转地址含商店页。直接打开
 * 结账页不需要任何客户端登记：已登录就直达结账页，未登录时 Epic 商店自己跳
 * 登录、登录完回到结账页。空的 orderId/purchaseToken 参数照抄 claabs 格式，
 * 商店接受（结账页按 offers 参数重建订单）。
 */
export function buildEpicCheckoutUrl(game: FreeGame): string {
  const offers = `1-${game.namespace ?? ''}-${game.id}`
  return `${EPIC_STORE_PURCHASE_URL}?highlightColor=0078f2&offers=${encodeURIComponent(offers)}&orderId&purchaseToken&showNavigation=true`
}

/** 自动领取拿不到 purchaseToken 时抛：带上浏览器结账链接，UI 可一键打开 */
export class EpicManualCheckoutError extends Error {
  checkoutUrl: string
  constructor(message: string, checkoutUrl: string) {
    super(message)
    this.name = 'EpicManualCheckoutError'
    this.checkoutUrl = checkoutUrl
  }
}

/** 错误里是否带有浏览器结账链接（有则 UI/记录里给「去浏览器领」按钮） */
export function checkoutUrlOf(e: unknown): string | undefined {
  if (e instanceof EpicManualCheckoutError) return e.checkoutUrl
  const u = (e as { checkoutUrl?: unknown } | null)?.checkoutUrl
  return typeof u === 'string' && u ? u : undefined
}

/**
 * 领取一款 Epic 免费游戏（node-epicgames-client purchase 流程）：
 * 1) quickPurchase：SUCCESS 直接成功；CHECKOUT 继续 2–4 步
 * 2) GET purchase 页解析 #purchaseToken
 * 3) POST order-preview 拿 syncToken
 * 4) POST confirm-order，data.confirmation 即成功
 *
 * v0.1.392 第 2 步修正：结账页是网页会话页，只认浏览器 Cookie（node-epicgames-client
 * 能拿到是因为它的 HTTP 客户端带持久 Cookie jar；本 App 的原生通道没有 Cookie jar，
 * 只发 Bearer 必然被 302 到登录页）。改法：① 把 access token 以 Epic 网站登录
 * Cookie（EPIC_BEARER_TOKEN）的形式带上，并换浏览器 UA；② 再试商店站内结账页；
 * ③ 两处都拿不到就抛手动结账错误（带浏览器结账链接），绝不静默。
 */
export async function claimEpicGame(access: string, accountId: string, game: FreeGame): Promise<string> {
  assertFreeToClaim(game)
  if (!game.autoClaimable) throw new Error(`「${game.title}」是捆绑包/DLC，请在浏览器打开商店手动领取`)
  const bearer = { Authorization: `Bearer ${access}` }
  // 1) quickPurchase
  let qpRes: NativeHttpResult
  try {
    qpRes = await epicRequest(`${QUICK_PURCHASE_URL}${accountId}/orders/quickPurchase`, 'POST',
      { ...bearer, 'Content-Type': 'application/json' },
      JSON.stringify(buildQuickPurchaseBody(game)))
  } catch (e) {
    throw toChineseFetchError(e, 'Epic 下单失败')
  }
  const qpText = qpRes.text
  let qp: JsonObj = {}
  try { qp = JSON.parse(qpText) as JsonObj } catch { /* 非 JSON */ }
  if (!qpRes.ok) {
    throw new Error(`Epic 下单失败：${pickStr(qp, 'errorCode') || pickStr(qp, 'errorMessage') || `HTTP ${qpRes.status}`}`)
  }
  const status = pickStr(qp, 'quickPurchaseStatus')
  if (status === 'SUCCESS') return pickStr(qp, 'orderId') || '已领取'
  if (status !== 'CHECKOUT') {
    throw new Error(`Epic 下单未完成（quickPurchaseStatus=${status || '未知'}），请在浏览器打开商店手动领取`)
  }
  // 2) purchaseToken：两次尝试（启动器内嵌结账页 → 商店站内结账页），都带 Cookie 形态的 token
  const pageHeaders: Record<string, string> = {
    ...bearer,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': EPIC_WEB_UA,
  }
  // 写 Cookie 头时用计算属性名：含 token: 字面量的写入曾被脱敏管道误伤（2026-11-20 坑）
  pageHeaders['Cookie'] = 'EPIC_BEARER_TOKEN=' + access
  const pageAttempts = [
    `${PURCHASE_PAGE_URL}?showNavigation=true&namespace=${encodeURIComponent(game.namespace ?? '')}&offers=${encodeURIComponent(game.id)}`,
    `${EPIC_STORE_PURCHASE_URL}?highlightColor=0078f2&offers=${encodeURIComponent(`1-${game.namespace ?? ''}-${game.id}`)}&orderId&purchaseToken&showNavigation=true`,
  ]
  let purchaseToken = ''
  const pageDiags: string[] = []
  for (const url of pageAttempts) {
    let pageRes: NativeHttpResult
    try {
      pageRes = await epicRequest(url, 'GET', pageHeaders)
    } catch (e) {
      throw toChineseFetchError(e, 'Epic 获取下单凭证失败')
    }
    purchaseToken = extractPurchaseToken(pageRes.text)
    if (purchaseToken) break
    pageDiags.push(describePurchasePage(pageRes.status, pageRes.text))
  }
  if (!purchaseToken) {
    throw new EpicManualCheckoutError(
      `Epic 没给到 purchaseToken（${pageDiags.join('；')}）。请在浏览器打开结账页完成领取（登录后点一下即可）`,
      buildEpicCheckoutUrl(game),
    )
  }
  const pciHeaders = { ...bearer, 'Content-Type': 'application/json', 'x-requested-with': purchaseToken }
  // 3) order-preview
  let previewRes: NativeHttpResult
  try {
    previewRes = await epicRequest(`${PCI_BASE}/order-preview`, 'POST', pciHeaders,
      JSON.stringify({
        useDefault: true, setDefault: false,
        namespace: game.namespace, country: null, countryName: null,
        orderId: null, orderComplete: null, orderError: null, orderPending: null,
        offers: [game.id], offerPrice: '',
      }))
  } catch (e) {
    throw toChineseFetchError(e, 'Epic 订单预览失败')
  }
  const previewText = previewRes.text
  let preview: JsonObj = {}
  try { preview = JSON.parse(previewText) as JsonObj } catch { /* 非 JSON */ }
  if (!previewRes.ok) {
    throw new Error(`Epic 订单预览失败：${pickStr(preview, 'errorCode') || pickStr(preview, 'errorMessage') || `HTTP ${previewRes.status}`}`)
  }
  const order = (preview.order ?? preview) as unknown as OrderInfo
  if (!order?.syncToken) throw new Error('Epic 订单预览没给 syncToken，请在浏览器打开商店手动领取')
  // 4) confirm-order
  let confirmRes: NativeHttpResult
  try {
    confirmRes = await epicRequest(`${PCI_BASE}/confirm-order`, 'POST', pciHeaders,
      JSON.stringify({
        useDefault: true, setDefault: false,
        namespace: order.namespace, country: order.country, countryName: order.countryName,
        orderId: null, orderComplete: null, orderError: null, orderPending: null,
        offers: order.offers, includeAccountBalance: false,
        totalAmount: order.orderResponse?.totalPrice,
        affiliateId: '', creatorSource: '',
        syncToken: order.syncToken,
      }))
  } catch (e) {
    throw toChineseFetchError(e, 'Epic 确认订单失败')
  }
  const confirmText = confirmRes.text
  let confirm: JsonObj = {}
  try { confirm = JSON.parse(confirmText) as JsonObj } catch { /* 非 JSON */ }
  if (!confirmRes.ok) {
    throw new Error(`Epic 确认订单失败：${pickStr(confirm, 'errorCode') || pickStr(confirm, 'errorMessage') || `HTTP ${confirmRes.status}`}`)
  }
  const confirmation = (confirm.data as JsonObj | undefined)?.confirmation ?? confirm.confirmation
  if (!confirmation) throw new Error('Epic 确认订单没有返回 confirmation，请在商店里确认是否已入库')
  return String(confirmation)
}

// ---------------- 缓存 ----------------

export interface FreeGamesCache {
  at: number
  epicCurrent: FreeGame[]
  epicUpcoming: FreeGame[]
}

export function loadCache(): FreeGamesCache | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as FreeGamesCache | null
    return v && typeof v.at === 'number' ? v : null
  } catch { return null }
}

function saveCache(c: FreeGamesCache): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)) } catch { /* 忽略 */ }
}

// ---------------- 一次巡查：拉取 + 自动领 ----------------

export interface FreeGamesCheckResult {
  at: number
  fetched: { epicCurrent: number; epicUpcoming: number }
  claimed: string[]
  already: string[]
  errors: string[]
}

/**
 * 拉取最新免费游戏并（已绑定 Epic 且开启自动领取时）自动领取当前免费且未入库的。
 * 每次领取尝试都写一条领取记录；验证码/登录失效写明原因，不静默跳过。
 */
export async function runFreeGamesCheck(pwd: string): Promise<FreeGamesCheckResult> {
  const prefs = loadPrefs()
  const at = Date.now()
  let epicCurrent: FreeGame[] = []
  let epicUpcoming: FreeGame[] = []
  let fetchError: string | null = null
  try {
    const epic = await fetchEpicFreeGames()
    epicCurrent = epic.current
    epicUpcoming = epic.upcoming
  } catch (e) {
    fetchError = e instanceof Error ? e.message : 'Epic 免费游戏拉取失败'
  }
  saveCache({ at, epicCurrent, epicUpcoming })
  saveLastCheck(at, fetchError)

  const result: FreeGamesCheckResult = {
    at,
    fetched: { epicCurrent: epicCurrent.length, epicUpcoming: epicUpcoming.length },
    claimed: [],
    already: [],
    errors: fetchError ? [fetchError] : [],
  }
  // 未绑定 / 总开关关 / Epic 开关关 → 只拉取不领取
  if (!prefs.autoClaim || !prefs.epicEnabled || !hasEpicAuth()) return result
  if (!pwd) { result.errors.push('保险箱未解锁，本次只拉取列表、没有自动领取'); return result }
  const auth = await loadEpicAuth(pwd)
  if (!auth) { result.errors.push('Epic 设备授权解不开（主密码不对或已损坏），请重新绑定'); return result }
  let tokens: { access: string; accountId: string }
  try {
    tokens = await epicAccessToken(auth, pwd)
  } catch (e) {
    const msg = describeEpicError(e)
    result.errors.push(msg)
    addRecord({ at, platform: 'epic', title: 'Epic 账号登录', outcome: 'error', message: msg })
    return result
  }
  const claimed = claimedGameIds()
  for (const game of epicCurrent) {
    if (claimed.has(`epic:${game.title}`)) { result.already.push(game.title); continue }
    if (!game.autoClaimable) continue
    try {
      await claimEpicGame(tokens.access, tokens.accountId, game)
      result.claimed.push(game.title)
      addRecord({ at, platform: 'epic', title: game.title, outcome: 'claimed', message: '自动领取成功，已入库' })
    } catch (e) {
      const msg = describeEpicError(e)
      const url = checkoutUrlOf(e)
      result.errors.push(`「${game.title}」领取失败：${msg}`)
      addRecord({ at, platform: 'epic', title: game.title, outcome: 'error', message: msg, ...(url ? { checkoutUrl: url } : {}) })
    }
  }
  return result
}

/** 手动领一款（巡查外）：结果同样写领取记录 */
export async function claimEpicGameManual(pwd: string, game: FreeGame): Promise<string> {
  const at = Date.now()
  try {
    const auth = await loadEpicAuth(pwd)
    if (!auth) throw new Error('请先绑定 Epic 账号')
    const tokens = await epicAccessToken(auth, pwd)
    const orderId = await claimEpicGame(tokens.access, tokens.accountId, game)
    addRecord({ at, platform: 'epic', title: game.title, outcome: 'claimed', message: `手动领取成功（订单 ${orderId}），已入库` })
    return orderId
  } catch (e) {
    const msg = describeEpicError(e)
    const url = checkoutUrlOf(e)
    addRecord({ at, platform: 'epic', title: game.title, outcome: 'error', message: msg, ...(url ? { checkoutUrl: url } : {}) })
    // 带结账链接的错误原样抛出：UI 要读 checkoutUrl 打开内嵌浏览器（桌面端，v0.1.404）或系统浏览器（包成普通 Error 会丢链接）
    if (url) throw e
    throw new Error(msg)
  }
}

// ---------------- Epic：库房同步（v0.1.405） ----------------
// Ethan 2026-11-24 在浏览器手动领了 Mark of the Deep，但 App 只认自己经手
// 的领取记录，浏览器领的仍显示未领取。同步分两路：① 优先调 Epic 库房接口
// 查已购（library-service，legendary/Heroic 同款；不通时再试授权接口），
// 命中本周免费游戏就补一条 'already' 记录，卡片与已入库组立刻显示已入库；
// ② 库房接口查不到时给手动「已领过」标记按钮（只影响显示，巡查会跳过它，
// 不会重复下单）。注意：库房接口没法用真账号在沙箱验证——沙箱到
// library-service 的连接被服务端直接挂断（Empty reply，TLS 握手后无响应），
// entitlement 端点同环境可通（假 token 探回 401 token_verification_failed，
// 路由存在）；真机上以 Ethan 的实机同步结果为准。

export const EPIC_LIBRARY_URL = 'https://library-service.live.on.epicgames.com/library/api/public/items'
export function epicEntitlementsUrl(accountId: string): string {
  return `https://entitlement-public-service-prod08.ol.epicgames.com/entitlement/api/account/${encodeURIComponent(accountId)}/entitlements`
}

/** 从库房/授权接口返回体里抽已购键 `namespace:catalogItemId`（纯函数，可单测） */
export function parseOwnedKeys(data: unknown): Set<string> {
  const keys = new Set<string>()
  const d = data as { records?: unknown; entitlements?: unknown } | null
  const items: unknown[] = Array.isArray(data) ? data
    : Array.isArray(d?.records) ? d.records as unknown[]
    : Array.isArray(d?.entitlements) ? d.entitlements as unknown[]
    : []
  for (const it of items) {
    const o = it as JsonObj | null
    if (!o || typeof o !== 'object') continue
    const ns = pickStr(o, 'namespace')
    const cid = pickStr(o, 'catalogItemId')
    if (ns && cid) { keys.add(`${ns}:${cid}`); continue }
    // 授权接口的 entitlementName 有 `namespace:catalogItemId` 形态
    const name = pickStr(o, 'entitlementName')
    if (name.includes(':')) keys.add(name.trim())
  }
  return keys
}

async function fetchLibraryPage(access: string, start: number): Promise<{ keys: Set<string>; count: number }> {
  const url = start > 0 ? `${EPIC_LIBRARY_URL}?count=100&start=${start}` : EPIC_LIBRARY_URL
  let res: NativeHttpResult
  try {
    res = await epicRequest(url, 'GET', { Authorization: `Bearer ${access}`, 'User-Agent': EPIC_LAUNCHER_UA })
  } catch (e) {
    throw toChineseFetchError(e, 'Epic 库房查询失败')
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error('Epic 登录失效，请重新绑定账号')
    throw new Error(`Epic 库房接口返回 ${res.status}`)
  }
  let data: unknown = {}
  try { data = JSON.parse(res.text) } catch { throw new Error('Epic 库房接口返回的不是 JSON，无法识别已购列表') }
  const keys = parseOwnedKeys(data)
  const raw = data as { records?: unknown[] } | null
  const count = Array.isArray(raw?.records) ? raw.records.length : keys.size
  return { keys, count }
}

export interface OwnedEpicKeys { keys: Set<string>; source: 'library' | 'entitlements' }

/** 查当前账号的已购（先库房接口，不通再试授权接口；两路都失败才抛错，原因写明） */
export async function fetchOwnedEpicKeys(access: string, accountId: string): Promise<OwnedEpicKeys> {
  let libErr: string | null = null
  try {
    const keys = new Set<string>()
    let start = 0
    // 分页拉取（每页 100）：接口不认 count/start 参数时会原样返回全量，
    // 此时第二页 keys 不再增长即停；最多 10 页防死循环。
    for (let page = 0; page < 10; page++) {
      const { keys: pageKeys, count } = await fetchLibraryPage(access, start)
      const before = keys.size
      for (const k of pageKeys) keys.add(k)
      if (count < 100 || keys.size === before) break
      start += count
    }
    return { keys, source: 'library' }
  } catch (e) {
    libErr = e instanceof Error ? e.message : 'Epic 库房查询失败'
    if (/登录失效|重新绑定/.test(libErr)) throw e
  }
  // 库房接口不通时再试授权接口（同一套 token，不同路由；一个被拦另一个可能通）
  let entRes: NativeHttpResult
  try {
    entRes = await epicRequest(epicEntitlementsUrl(accountId), 'GET', { Authorization: `Bearer ${access}`, 'User-Agent': EPIC_LAUNCHER_UA })
  } catch (e) {
    throw toChineseFetchError(e, 'Epic 库房查询失败')
  }
  if (!entRes.ok) {
    if (entRes.status === 401) throw new Error('Epic 登录失效，请重新绑定账号')
    throw new Error(`Epic 库房查询失败：库房接口（${libErr}）与授权接口（HTTP ${entRes.status}）都查不到已购。请确认 Epic 账号已绑定、网络正常，或直接用领取记录旁的「已领过」手动标记。`)
  }
  let entData: unknown = {}
  try { entData = JSON.parse(entRes.text) } catch { throw new Error('Epic 授权接口返回的不是 JSON，无法识别已购列表') }
  return { keys: parseOwnedKeys(entData), source: 'entitlements' }
}

export interface SyncOwnedResult {
  synced: string[]
  alreadyKnown: string[]
  ownedCount: number
  source: 'library' | 'entitlements'
}

/**
 * 同步浏览器领取：查库房已购，对照本周免费列表，命中且未记过的补一条
 * 'already' 记录（显示已入库，巡查不再重复领）。缓存没列表时先拉一份新的。
 */
export async function syncOwnedEpicGames(pwd: string): Promise<SyncOwnedResult> {
  if (!pwd) throw new Error('请先解锁保险箱（同步库房要用 Epic 登录态）')
  const auth = await loadEpicAuth(pwd)
  if (!auth) throw new Error('请先绑定 Epic 账号')
  const tokens = await epicAccessToken(auth, pwd)
  const owned = await fetchOwnedEpicKeys(tokens.access, tokens.accountId)
  let games = loadCache()?.epicCurrent ?? []
  if (!games.length) {
    try {
      const fresh = await fetchEpicFreeGames()
      saveCache({ at: Date.now(), epicCurrent: fresh.current, epicUpcoming: fresh.upcoming })
      games = fresh.current
    } catch (e) {
      throw new Error(`免费游戏列表拉取失败，无法对照库房：${e instanceof Error ? e.message : '未知错误'}`)
    }
  }
  const claimed = claimedGameIds()
  const at = Date.now()
  const synced: string[] = []
  const alreadyKnown: string[] = []
  for (const g of games) {
    if (!g.namespace || !g.id) continue
    if (!owned.keys.has(`${g.namespace}:${g.id}`)) continue
    if (claimed.has(`epic:${g.title}`)) { alreadyKnown.push(g.title); continue }
    addRecord({ at, platform: 'epic', title: g.title, outcome: 'already', message: '已在库（浏览器领取，已同步）' })
    synced.push(g.title)
  }
  return { synced, alreadyKnown, ownedCount: owned.keys.size, source: owned.source }
}

/** 手动把一款游戏标成已入库（浏览器领取、库房接口查不到时用；只影响显示，巡查会跳过它，不会重复下单） */
export function markEpicGameClaimed(title: string): boolean {
  const t = title.trim()
  if (!t) return false
  if (claimedGameIds().has(`epic:${t}`)) return false
  addRecord({ at: Date.now(), platform: 'epic', title: t, outcome: 'already', message: '已手动标记已领过（浏览器领取，仅显示用，不会重复下单）' })
  return true
}

/** 巡查是否到期（供 App 定时器调用） */
export function freeGamesCheckDue(): boolean {
  const prefs = loadPrefs()
  if (!prefs.autoClaim || !prefs.epicEnabled || !hasEpicAuth()) return false
  const last = loadLastCheckAt()
  return !last || Date.now() - last >= prefs.intervalHours * 3600_000
}

export function summarizeCheckResult(r: FreeGamesCheckResult): string {
  const parts: string[] = []
  if (r.claimed.length) parts.push(`新领 ${r.claimed.length} 款：${r.claimed.join('、')}`)
  if (r.already.length) parts.push(`${r.already.length} 款已在库`)
  if (r.errors.length) parts.push(`${r.errors.length} 个问题`)
  return parts.join('，') || `已拉取本周免费 ${r.fetched.epicCurrent} 款，无需领取`
}
