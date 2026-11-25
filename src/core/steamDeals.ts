// 工坊 · Steam 降价（v0.1.399）：Steam 商店公开接口（免 Key）列当前打折游戏。
// 数据源：store.steampowered.com/search/results/?...&specials=1（打折筛选），
// 返回 JSON { success, total_count, results_html }；results_html 是商店列表 HTML，
// 每行自带折扣、原价/现价、好评率 tooltip。价格以 Steam 返回的文本为准，不编造。
// CORS：Steam 接口不返回 Access-Control-Allow-Origin，桌面 WKWebView 前端 fetch
// 会被拦——走 freeGames 的 epicRequest 原生通道（桌面 plugin_http / 安卓
// CapacitorHttp / 网页 fetch），与 Epic 同一套出口。网页版无原生通道时走 fetch，
// 仍会被 CORS 拦，失败原因会明确显示，不静默兜底。
import { epicRequest } from './freeGames'

export interface SteamDeal {
  /** 游戏本体的 appid；合集包时为 sub（package）id */
  appid: string
  /** 'game' 游戏本体 / 'package' 合集包（v0.1.412：搜索结果里的 sub 行 + 本体反查补齐） */
  kind: 'game' | 'package'
  title: string
  url: string
  imageUrl: string
  /** 折扣百分比，如 80 表示 -80% */
  discountPct: number
  /** 原价文本（Steam 返回，如 ¥198.00），无则为空串 */
  originalPrice: string
  /** 现价文本（Steam 返回，如 ¥39.60） */
  finalPrice: string
  /** 现价（分），用于排序 */
  finalPriceCents: number
  /** 好评率，如 95；无评价时为 undefined */
  reviewPct?: number
  /** 评测篇数，如 126948；无评价时为 undefined */
  reviewCount?: number
  /** 评价档位词，如 好评如潮；无评价时为 undefined */
  reviewLabel?: string
  /** 发售日期文本（Steam 返回），如 2021 年 3 月 25 日 */
  released?: string
  /** 合集包包含的游戏名（packagedetails 的 apps）；本体无此字段 */
  contents?: string[]
}

export type SteamSort = 'discount' | 'review' | 'price'

export const STEAM_DEALS_CACHE_KEY = 'acm.steam.deals.v1'
export const STEAM_DEALS_CACHE_TTL_MS = 60 * 60_000
export const STEAM_DEALS_PAGE_SIZE = 100

export interface SteamDealsCache {
  at: number
  /** Steam 返回的打折总数（当前约两万款，大促期间更多） */
  total: number
  items: SteamDeal[]
  /** 已从搜索接口拉到的行数（本体+合集包行；与 items.length 区分：补齐的合集包不占搜索偏移） */
  searchFetched: number
  /** 已反查过合集包的本体 appid（补齐只跑未查过的，避免重复请求） */
  checkedAppids?: string[]
}

/** 去重/列表 key：appid 与 sub id 是两个命名空间，数字可能撞号，必须带 kind */
export function dealKey(d: SteamDeal): string {
  return `${d.kind}:${d.appid}`
}

export function buildSteamSearchUrl(start: number, count = STEAM_DEALS_PAGE_SIZE): string {
  const q = new URLSearchParams({
    query: '',
    start: String(start),
    count: String(count),
    dynamic_data: '',
    sort_by: '_ASC',
    specials: '1',
    infinite: '1',
    cc: 'CN',
    l: 'schinese',
  })
  return `https://store.steampowered.com/search/results/?${q.toString()}`
}

export function storeUrlOf(appid: string): string {
  return `https://store.steampowered.com/app/${appid}/`
}

/** 合集包商店链接（sub 页，不是 app 页） */
export function storeSubUrlOf(packageId: string): string {
  return `https://store.steampowered.com/sub/${packageId}/`
}

/** packagedetails 的 price（单位：分）→ 显示文本，如 22800 CNY → ¥228.00 */
export function formatSteamCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `¥${(cents / 100).toFixed(2)}`
  }
}

/** 解析 data-tooltip-html 里的好评信息（属性值是实体转义过的，先解码）。 */
function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

function parseReview(tooltipRaw: string): { pct: number; count: number; label: string } | undefined {
  const text = decodeEntities(tooltipRaw)
  const m = text.match(/([\d,]+)\s*篇用户评测中有\s*(\d+)%\s*为好评/)
  if (!m) return undefined
  const label = text.split('<br>')[0].replace(/<[^>]*>/g, '').trim()
  return { pct: parseInt(m[2], 10), count: parseInt(m[1].replace(/,/g, ''), 10), label }
}

/**
 * 解析 Steam 搜索返回的 results_html：每行一个游戏（.search_result_row）。
 * 定向正则解析（无 DOMParser 依赖：单测跑在 node 环境，且不引入 jsdom）。
 * 拿不到关键字段（appid/标题/折扣）的行直接丢弃；整页一行都解析不出时由调用方报错。
 * 合集包行（v0.1.412）：带 data-ds-packageid（data-ds-appid 是逗号分隔的多个 appid，
 * 无单值可取），链接到 /sub/<id>/，价格/好评/发售日结构与游戏行完全相同，照常解析，
 * kind 记为 'package'，与本体区分开。
 */
export function parseSteamSearchHtml(html: string): SteamDeal[] {
  const out: SteamDeal[] = []
  const rowRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/g
  let row: RegExpExecArray | null
  while ((row = rowRe.exec(html)) !== null) {
    const attrs = row[1]
    if (!/search_result_row/.test(attrs)) continue
    const body = row[2]
    const packageM = attrs.match(/data-ds-packageid="(\d+)"/)
    const appM = attrs.match(/data-ds-appid="(\d+)"/)
    const kind: SteamDeal['kind'] = packageM ? 'package' : 'game'
    const id = packageM ? packageM[1] : appM ? appM[1] : ''
    if (!id) continue
    const titleM = body.match(/<span class="title">([^<]*)<\/span>/)
    const title = titleM ? titleM[1].trim() : ''
    const imgM = body.match(/<div class="search_capsule"><img src="([^"]+)"/)
    const discountM = body.match(/<div class="discount_pct"[^>]*>(-?\d+)%<\/div>/)
    const discountPct = discountM ? Math.abs(parseInt(discountM[1], 10)) : 0
    if (!title || discountPct <= 0) continue
    const origM = body.match(/<div class="discount_original_price">([^<]*)<\/div>/)
    const finalM = body.match(/<div class="discount_final_price">([^<]*)<\/div>/)
    const centsM = body.match(/data-price-final="(\d+)"/)
    const reviewM = body.match(/<span class="search_review_summary[^>]*data-tooltip-html="([^"]*)"/)
    const review = reviewM ? parseReview(reviewM[1]) : undefined
    const releasedM = body.match(/<div class="search_released[^"]*">\s*([^<]*?)\s*<\/div>/)
    out.push({
      appid: id,
      kind,
      title,
      url: kind === 'package' ? storeSubUrlOf(id) : storeUrlOf(id),
      imageUrl: imgM ? imgM[1] : '',
      discountPct,
      originalPrice: origM ? origM[1].trim() : '',
      finalPrice: finalM ? finalM[1].trim() : '',
      finalPriceCents: centsM ? parseInt(centsM[1], 10) : 0,
      reviewPct: review?.pct,
      reviewCount: review?.count,
      reviewLabel: review?.label,
      released: releasedM ? releasedM[1].trim() : undefined,
    })
  }
  return out
}

/** 排序：默认折扣从高到低；同折扣好评率高的在前，再同则现价低的在前。 */
export function sortSteamDeals(deals: SteamDeal[], sort: SteamSort): SteamDeal[] {
  const list = [...deals]
  const reviewOf = (d: SteamDeal) => (d.reviewPct ?? -1)
  if (sort === 'review') {
    list.sort((a, b) => reviewOf(b) - reviewOf(a) || b.discountPct - a.discountPct || a.finalPriceCents - b.finalPriceCents)
  } else if (sort === 'price') {
    list.sort((a, b) => a.finalPriceCents - b.finalPriceCents || b.discountPct - a.discountPct || reviewOf(b) - reviewOf(a))
  } else {
    list.sort((a, b) => b.discountPct - a.discountPct || reviewOf(b) - reviewOf(a) || a.finalPriceCents - b.finalPriceCents)
  }
  return list
}

export function loadSteamCache(): SteamDealsCache | null {
  try {
    const raw = localStorage.getItem(STEAM_DEALS_CACHE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SteamDealsCache
    if (!data || typeof data.at !== 'number' || !Array.isArray(data.items)) return null
    return data
  } catch { return null }
}

export function saveSteamCache(cache: SteamDealsCache): void {
  try { localStorage.setItem(STEAM_DEALS_CACHE_KEY, JSON.stringify(cache)) } catch { /* 忽略 */ }
}

export function isSteamCacheFresh(cache: SteamDealsCache | null): boolean {
  return !!cache && Date.now() - cache.at < STEAM_DEALS_CACHE_TTL_MS
}

/** 网络失败换成中文并点名步骤（与 freeGames 的 toChineseFetchError 同款，Steam 版）。 */
export function toSteamFetchError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e)
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(msg)) {
    return new Error('Steam 降价加载失败：网络请求失败，Steam 商店接口可能被代理/网络拦截，请换个节点再试')
  }
  return e instanceof Error ? e : new Error(msg)
}

/** 拉一页打折列表（start 偏移，count 每页条数）。 */
export async function fetchSteamDealsPage(start: number, count = STEAM_DEALS_PAGE_SIZE): Promise<{ total: number; items: SteamDeal[] }> {
  let res: { ok: boolean; status: number; text: string }
  try {
    res = await epicRequest(buildSteamSearchUrl(start, count), 'GET', { Accept: 'application/json' })
  } catch (e) {
    throw toSteamFetchError(e)
  }
  if (!res.ok) throw new Error(`Steam 降价加载失败：Steam 商店返回 HTTP ${res.status}`)
  let data: { success?: boolean; total_count?: number; results_html?: string }
  try {
    data = JSON.parse(res.text) as { success?: boolean; total_count?: number; results_html?: string }
  } catch {
    throw new Error('Steam 降价加载失败：Steam 返回的数据不是有效 JSON')
  }
  if (!data || typeof data.results_html !== 'string') {
    throw new Error('Steam 降价加载失败：Steam 返回的数据结构变了（无 results_html）')
  }
  const items = parseSteamSearchHtml(data.results_html)
  const total = data.total_count ?? items.length
  if (items.length === 0 && total > 0) {
    throw new Error('Steam 降价加载失败：拉到了数据但解析不到任何打折游戏（Steam 页面结构可能变了）')
  }
  return { total, items }
}

/** 首屏加载：缓存新鲜（1 小时内）直接用，否则拉第一页并写缓存。 */
export async function loadSteamDeals(force = false): Promise<SteamDealsCache> {
  const cached = loadSteamCache()
  if (!force && isSteamCacheFresh(cached)) return cached as SteamDealsCache
  const { total, items } = await fetchSteamDealsPage(0)
  const next: SteamDealsCache = { at: Date.now(), total, items: sortSteamDeals(items, 'discount'), searchFetched: items.length }
  saveSteamCache(next)
  return next
}

/** 加载更多：拉下一页并入缓存（按 kind:id 去重，重新按折扣排）。 */
export async function loadMoreSteamDeals(): Promise<SteamDealsCache> {
  const cached = loadSteamCache()
  const start = cached?.searchFetched ?? cached?.items.length ?? 0
  const { total, items } = await fetchSteamDealsPage(start)
  const seen = new Set((cached?.items ?? []).map(dealKey))
  const merged = [...(cached?.items ?? []), ...items.filter(d => !seen.has(dealKey(d)))]
  const next: SteamDealsCache = {
    at: Date.now(), total,
    items: sortSteamDeals(merged, 'discount'),
    searchFetched: start + items.length,
    checkedAppids: cached?.checkedAppids,
  }
  saveSteamCache(next)
  return next
}

// ---------------- 合集包补齐（v0.1.412） ----------------
// 搜索接口只返回它认为的打折合集包行（实测 21,398 款里只有 73 行），
// 有的合集包不在搜索索引里——例如战地风云 5 决定版（sub 505826）：
// packagedetails 与 sub 页都显示 -95%（¥228.00→¥11.40），但全量扫
// 214 页搜索结果也找不到它。所以对折扣最高的本体再反查一次：
// appdetails（filters=packages，只返回 packages 字段）拿合集包 id，
// 再逐个调 packagedetails 拿结构化价格；没有价格/不打折的不要（不编造）。
// 多 id 批量调 appdetails/packagedetails 会被 Steam 直接返回 null（2026-11-24
// 沙箱实测：单 id 通、2 个 id 即 null），所以必须逐个调、控制并发，
// 只查折扣最高的 30 款本体、每款最多 5 个合集包、每轮最多补 20 个合集包，
// 查过的 appid 记进缓存不再重复查；补齐跑在后台，不挡首屏列表。

export const STEAM_ENRICH_POOL_SIZE = 30
export const STEAM_ENRICH_MAX_PACKAGES_PER_APP = 5
export const STEAM_ENRICH_MAX_NEW_PACKAGES = 20
const STEAM_ENRICH_CONCURRENCY = 4

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (it: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let idx = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

function buildAppDetailsUrl(appid: string): string {
  const q = new URLSearchParams({ appids: appid, filters: 'packages', cc: 'CN', l: 'schinese' })
  return `https://store.steampowered.com/api/appdetails?${q.toString()}`
}

function buildPackageDetailsUrl(packageId: string): string {
  const q = new URLSearchParams({ packageids: packageId, cc: 'CN', l: 'schinese' })
  return `https://store.steampowered.com/api/packagedetails?${q.toString()}`
}

/** 一个本体的合集包 id 列表（appdetails filters=packages）。失败抛错，由调用方按个跳过。 */
export async function fetchAppPackageIds(appid: string): Promise<number[]> {
  let res: { ok: boolean; status: number; text: string }
  try {
    res = await epicRequest(buildAppDetailsUrl(appid), 'GET', { Accept: 'application/json' })
  } catch (e) {
    throw toSteamFetchError(e)
  }
  if (!res.ok) throw new Error(`Steam 降价加载失败：Steam 商店返回 HTTP ${res.status}`)
  let data: Record<string, { success?: boolean; data?: { packages?: unknown } }>
  try {
    data = JSON.parse(res.text) as Record<string, { success?: boolean; data?: { packages?: unknown } }>
  } catch {
    throw new Error('Steam 降价加载失败：Steam 返回的数据不是有效 JSON')
  }
  const entry = data?.[appid]
  const pkgs = entry?.data?.packages
  if (!Array.isArray(pkgs)) return []
  return pkgs.filter((p): p is number => typeof p === 'number')
}

/**
 * packagedetails → 合集包卡片。价格必须真实存在且确实打折（initial > final，
 * discount_percent > 0），否则返回 null（无价/不打折的合集包不列、不编造）。
 * packagedetails 没有好评数据，合集包的好评字段留空（界面显示“暂无评价”）；
 * 封面用本体卡片的图（同一款游戏的 capsule，Steam 自带）。
 */
export function parsePackageDetails(packageId: string, data: unknown, imageUrl = ''): SteamDeal | null {
  const d = (data ?? {}) as {
    name?: unknown; apps?: unknown; price?: unknown; release_date?: unknown
  }
  const name = typeof d.name === 'string' ? d.name.trim() : ''
  if (!name) return null
  const price = (d.price ?? {}) as { currency?: unknown; initial?: unknown; final?: unknown; discount_percent?: unknown }
  const initial = typeof price.initial === 'number' ? price.initial : 0
  const final = typeof price.final === 'number' ? price.final : 0
  const discount = typeof price.discount_percent === 'number' ? price.discount_percent : 0
  const currency = typeof price.currency === 'string' ? price.currency : 'CNY'
  if (initial <= 0 || final < 0 || initial <= final || discount <= 0) return null
  const apps = Array.isArray(d.apps) ? d.apps : []
  const contents = apps
    .map(a => (a as { name?: unknown }).name)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
  const released = (d.release_date as { date?: unknown } | undefined)?.date
  return {
    appid: packageId,
    kind: 'package',
    title: name,
    url: storeSubUrlOf(packageId),
    imageUrl,
    discountPct: discount,
    originalPrice: formatSteamCents(initial, currency),
    finalPrice: formatSteamCents(final, currency),
    finalPriceCents: final,
    released: typeof released === 'string' && released ? released : undefined,
    contents: contents.length > 0 ? contents : undefined,
  }
}

/** 一个合集包的 packagedetails；无价/不打折返回 null，网络失败抛错。 */
export async function fetchPackageDeal(packageId: string, imageUrl = ''): Promise<SteamDeal | null> {
  let res: { ok: boolean; status: number; text: string }
  try {
    res = await epicRequest(buildPackageDetailsUrl(packageId), 'GET', { Accept: 'application/json' })
  } catch (e) {
    throw toSteamFetchError(e)
  }
  if (!res.ok) throw new Error(`Steam 降价加载失败：Steam 商店返回 HTTP ${res.status}`)
  let data: Record<string, { success?: boolean; data?: unknown }>
  try {
    data = JSON.parse(res.text) as Record<string, { success?: boolean; data?: unknown }>
  } catch {
    throw new Error('Steam 降价加载失败：Steam 返回的数据不是有效 JSON')
  }
  const entry = data?.[packageId]
  if (!entry?.success) return null
  return parsePackageDetails(packageId, entry.data, imageUrl)
}

export interface SteamEnrichResult {
  cache: SteamDealsCache
  /** 本轮新补进来的合集包数 */
  added: number
  /** 补齐是否因网络失败而完全没跑成（主列表不受影响，界面只作提示） */
  failed: boolean
}

/**
 * 后台补齐合集包：取缓存里折扣最高的 30 款本体（未查过的），逐个反查合集包，
 * 有真实折扣价的并入缓存。单次失败只跳过该款，不中断整轮；全部失败时 failed=true。
 */
export async function enrichSteamPackages(cache: SteamDealsCache): Promise<SteamEnrichResult> {
  const checked = new Set(cache.checkedAppids ?? [])
  const pool = sortSteamDeals(cache.items.filter(d => d.kind === 'game'), 'discount')
    .filter(d => !checked.has(d.appid))
    .slice(0, STEAM_ENRICH_POOL_SIZE)
  if (pool.length === 0) return { cache, added: 0, failed: false }
  let anyError = false
  const packageIds = new Set<number>()
  await mapWithConcurrency(pool, STEAM_ENRICH_CONCURRENCY, async (game) => {
    try {
      const ids = await fetchAppPackageIds(game.appid)
      ids.slice(0, STEAM_ENRICH_MAX_PACKAGES_PER_APP).forEach(id => packageIds.add(id))
    } catch {
      anyError = true
    }
  })
  const existing = new Set(cache.items.filter(d => d.kind === 'package').map(d => d.appid))
  const fresh = [...packageIds].filter(id => !existing.has(String(id))).slice(0, STEAM_ENRICH_MAX_NEW_PACKAGES)
  const deals: SteamDeal[] = []
  if (fresh.length > 0) {
    const found = await mapWithConcurrency(fresh, STEAM_ENRICH_CONCURRENCY, async (id) => {
      try {
        return await fetchPackageDeal(String(id), '')
      } catch {
        anyError = true
        return null
      }
    })
    for (const deal of found) {
      if (!deal) continue
      // 封面：用包内第一款游戏在缓存里的 capsule（找不到就留空，走占位图标，不乱配图）
      const firstApp = deal.contents?.[0]
      const game = firstApp
        ? cache.items.find(d => d.kind === 'game' && d.title === firstApp)
        : undefined
      if (game?.imageUrl) deal.imageUrl = game.imageUrl
      deals.push(deal)
    }
  }
  const next: SteamDealsCache = {
    ...cache,
    items: sortSteamDeals([...cache.items, ...deals], 'discount'),
    checkedAppids: [...checked, ...pool.map(d => d.appid)],
  }
  saveSteamCache(next)
  return { cache: next, added: deals.length, failed: anyError && deals.length === 0 && fresh.length > 0 }
}
