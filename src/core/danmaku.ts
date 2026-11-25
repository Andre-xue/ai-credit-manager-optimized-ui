// 弹幕（v0.1.409）：按片名匹配公开弹幕库 + 本地发送。
// 弹幕源实现定案（2026-11-24 实测）：
// - 弹弹play 官方 API（api.dandanplay.net）全部接口都要 X-AppId / X-Timestamp /
//   X-Signature 签名，需向作者申请 appid/appsecret，App 里接不了；
// - 开源 danmu_api（huangxd-/danmu_api，3.6k stars）兼容弹弹play的搜索、详情、
//   弹幕获取接口规范，支持爱优腾芒哔咪等平台弹幕，可一键部署到 Vercel / Docker，
//   演示站 danmuapi.vercel.app 已上鉴权（401）用不了；
// - 所以 App 内置弹幕引擎 + 可配置的 danmu_api 地址（设置页签里填，附部署说明）。
//   没配地址时不显示远程弹幕（本地发送的弹幕照常用），拉不到时写清原因，
//   不静默无弹幕、不编造弹幕。
// 协议：GET {base}/api/v2/search/episodes?anime={片名}
//      GET {base}/api/v2/comment/{episodeId}?from=0&withRelated=true
// 弹幕格式与弹弹play一致：comments: [{ p: "时间,模式,颜色,uid", m: "文本" }]，
// 模式 1=滚动、4=底部、5=顶部；颜色为十进制整数。

export interface DanmakuItem {
  /** 出现时间（秒，相对本集开始；直播为相对打开播放器的时间） */
  time: number
  text: string
  /** 1 滚动 / 4 底部 / 5 顶部 */
  mode: 1 | 4 | 5
  color: string
  /** 本地发送的弹幕（只存本机，不上传） */
  local?: boolean
}

export interface DanmakuEpisodeCandidate {
  animeId: number
  animeTitle: string
  episodeId: number
  episodeTitle: string
}

export type DanmakuLoadResult =
  | { status: 'ok'; items: DanmakuItem[]; matched: string }
  | { status: 'noconfig' }
  | { status: 'nomatch'; reason: string }
  | { status: 'empty' }
  | { status: 'error'; reason: string }

/** 弹幕源地址（danmu_api 部署地址，如 https://xxx.vercel.app），只存本机 */
export const DANMU_API_KEY = 'acm.watch.danmuApi.v1'
/** 弹幕总开关（默认开），只存本机 */
export const DANMU_ON_KEY = 'acm.watch.danmuOn.v1'
/** 本地发送的弹幕（只存本机，不上传），按片名+集号分 key */
export const DANMU_LOCAL_KEY = 'acm.watch.danmuLocal.v1'

export const DANMU_MAX_ITEMS = 2000
export const DANMU_FETCH_TIMEOUT_MS = 12000

export function loadDanmuApiBase(): string {
  try { return normalizeDanmuApiBase(localStorage.getItem(DANMU_API_KEY) ?? '') } catch { return '' }
}

export function saveDanmuApiBase(raw: string): string {
  const base = normalizeDanmuApiBase(raw)
  try { localStorage.setItem(DANMU_API_KEY, base) } catch { /* 忽略 */ }
  return base
}

/** 归一化弹幕源地址：去空白/尾斜杠；接受根地址或带 /api/v2 的地址；非法返回 '' */
export function normalizeDanmuApiBase(raw: string): string {
  let s = (raw ?? '').trim()
  if (!s) return ''
  s = s.replace(/\/+$/, '')
  if (s.endsWith('/api/v2')) s = s.slice(0, -'/api/v2'.length)
  if (!/^https?:\/\/[^/]+/.test(s)) return ''
  return s
}

export function loadDanmuOn(): boolean {
  try { return localStorage.getItem(DANMU_ON_KEY) !== '0' } catch { return true }
}

export function saveDanmuOn(v: boolean): void {
  try { localStorage.setItem(DANMU_ON_KEY, v ? '1' : '0') } catch { /* 忽略 */ }
}

export function danmuKey(title: string, episodeNo: number | null): string {
  return `${title.trim()}#${episodeNo ?? 0}`
}

export function loadLocalDanmu(key: string): DanmakuItem[] {
  try {
    const all = JSON.parse(localStorage.getItem(DANMU_LOCAL_KEY) ?? '{}') as Record<string, DanmakuItem[]>
    const list = Array.isArray(all[key]) ? all[key] : []
    return list.filter(i => i && Number.isFinite(i.time) && typeof i.text === 'string').slice(0, 200)
  } catch { return [] }
}

export function addLocalDanmu(key: string, item: DanmakuItem): void {
  try {
    const all = JSON.parse(localStorage.getItem(DANMU_LOCAL_KEY) ?? '{}') as Record<string, DanmakuItem[]>
    const list = Array.isArray(all[key]) ? all[key] : []
    list.push({ ...item, local: true })
    all[key] = list.slice(-200)
    localStorage.setItem(DANMU_LOCAL_KEY, JSON.stringify(all))
  } catch { /* 忽略 */ }
}

/** 颜色：弹弹play 用十进制整数，转 #rrggbb；非法回白色 */
export function danmakuColor(n: number): string {
  if (!Number.isFinite(n)) return '#ffffff'
  const v = Math.trunc(n) >>> 0
  return `#${v.toString(16).padStart(6, '0').slice(-6)}`
}

function normalizeMode(n: number): 1 | 4 | 5 {
  return n === 4 ? 4 : n === 5 ? 5 : 1
}

/** 解析弹弹play / danmu_api 的 comment 返回体；非法条目跳过，去重、按时间排序、上限采样 */
export function parseDanDanPlayComments(data: unknown): DanmakuItem[] {
  const raw = (data as { comments?: unknown } | null)?.comments
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: DanmakuItem[] = []
  for (const c of raw) {
    const p = (c as { p?: unknown; m?: unknown } | null)?.p
    const m = (c as { p?: unknown; m?: unknown } | null)?.m
    if (typeof p !== 'string' || typeof m !== 'string') continue
    const text = m.trim().slice(0, 100)
    if (!text) continue
    const parts = p.split(',')
    const time = parseFloat(parts[0] ?? '')
    if (!Number.isFinite(time) || time < 0) continue
    const mode = normalizeMode(parseInt(parts[1] ?? '1', 10))
    const color = danmakuColor(parseInt(parts[2] ?? '', 10))
    const key = `${time.toFixed(2)}|${text}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ time, text, mode, color })
  }
  out.sort((a, b) => a.time - b.time)
  if (out.length <= DANMU_MAX_ITEMS) return out
  // 超上限等距采样，避免只剩前几分钟
  const step = out.length / DANMU_MAX_ITEMS
  const sampled: DanmakuItem[] = []
  for (let i = 0; i < DANMU_MAX_ITEMS; i++) sampled.push(out[Math.floor(i * step)])
  return sampled
}

/** 解析 search/episodes 返回体（animes[].episodes[]） */
export function parseSearchEpisodes(data: unknown): DanmakuEpisodeCandidate[] {
  const animes = (data as { animes?: unknown } | null)?.animes
  if (!Array.isArray(animes)) return []
  const out: DanmakuEpisodeCandidate[] = []
  for (const a of animes) {
    const anime = a as { animeId?: unknown; animeTitle?: unknown; episodes?: unknown }
    const animeId = typeof anime.animeId === 'number' ? anime.animeId : 0
    const animeTitle = typeof anime.animeTitle === 'string' ? anime.animeTitle : ''
    if (!animeTitle || !Array.isArray(anime.episodes)) continue
    for (const e of anime.episodes as { episodeId?: unknown; episodeTitle?: unknown }[]) {
      const episodeId = typeof e?.episodeId === 'number' ? e.episodeId : 0
      const episodeTitle = typeof e?.episodeTitle === 'string' ? e.episodeTitle : ''
      if (!episodeId) continue
      out.push({ animeId, animeTitle, episodeId, episodeTitle })
    }
  }
  return out
}

function normalizeTitle(s: string): string {
  return (s ?? '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/第[一二三四五六七八九十\d]+季/g, '')
    .replace(/S\d+/gi, '')
    .replace(/[\s\-_·•.]+/g, '')
    .toLowerCase()
}

/** 从集标题里抠集号：第3集 / S01E03 / EP03 / 末尾数字 */
export function extractEpisodeNo(episodeTitle: string): number | null {
  const t = (episodeTitle ?? '').trim()
  let m = /第\s*(\d+)\s*[集话回]/.exec(t)
  if (m) return parseInt(m[1], 10)
  m = /[Ss]\d+[Ee](\d+)/.exec(t)
  if (m) return parseInt(m[1], 10)
  m = /(?:^|[\s\-_])(?:[Ee][Pp]?)(\d+)\s*$/.exec(t)
  if (m) return parseInt(m[1], 10)
  return null
}

/** 匹配打分：标题必须沾边（精确 100 / 包含 70），集号对上 +50、集号未知 +10、集号错直接否决 */
export function scoreEpisodeMatch(title: string, episodeNo: number | null, cand: DanmakuEpisodeCandidate): number {
  const want = normalizeTitle(title)
  const got = normalizeTitle(cand.animeTitle)
  if (!want || !got) return -1
  let titleScore = 0
  if (want === got) titleScore = 100
  else if (want.includes(got) || got.includes(want)) titleScore = 70
  else return -1
  const epNo = extractEpisodeNo(cand.episodeTitle)
  let epScore = 10
  if (episodeNo != null) {
    if (epNo == null) epScore = 10
    else if (epNo === episodeNo) epScore = 50
    else return -1
  }
  return titleScore + epScore
}

export function pickBestEpisode(
  title: string,
  episodeNo: number | null,
  list: DanmakuEpisodeCandidate[],
): DanmakuEpisodeCandidate | null {
  let best: DanmakuEpisodeCandidate | null = null
  let bestScore = 99
  for (const c of list) {
    const s = scoreEpisodeMatch(title, episodeNo, c)
    if (s > bestScore) { bestScore = s; best = c }
  }
  return best
}

async function fetchJson(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) {
      const err = new Error(`HTTP_${res.status}`) as Error & { httpStatus?: number }
      err.httpStatus = res.status
      throw err
    }
    return (await res.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

function fetchErrorReason(e: unknown): string {
  const err = e as { httpStatus?: number; name?: string; message?: string }
  if (err?.httpStatus === 401) return '弹幕源要鉴权（HTTP 401）：地址里可能要带 token，如 https://你的地址/87654321（自部署默认 token）'
  if (err?.httpStatus) return `弹幕源返回 HTTP ${err.httpStatus}：地址可能不对，或该实例已停用`
  if (err?.name === 'AbortError') return '弹幕源响应超时（12 秒）：地址可能不对，或网络到不了该实例'
  if (err instanceof TypeError) return '连不上弹幕源：地址可能不对，或被网络拦截（换个节点再试）'
  return `弹幕源请求失败：${err?.message ?? '未知错误'}`
}

/** 按片名+集号拉弹幕：搜索 → 匹配 → 取弹幕。失败原因写清，不静默。 */
export async function fetchDanmakuFor(
  title: string,
  episodeNo: number | null,
  opts: { base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<DanmakuLoadResult> {
  const base = opts.base ?? loadDanmuApiBase()
  if (!base) return { status: 'noconfig' }
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? DANMU_FETCH_TIMEOUT_MS
  let search: unknown
  try {
    search = await fetchJson(`${base}/api/v2/search/episodes?anime=${encodeURIComponent(title)}`, fetchImpl, timeoutMs)
  } catch (e) {
    return { status: 'error', reason: fetchErrorReason(e) }
  }
  const candidates = parseSearchEpisodes(search)
  const best = pickBestEpisode(title, episodeNo, candidates)
  if (!best) {
    return { status: 'nomatch', reason: `弹幕库里没找到「${title}」${episodeNo != null ? `第 ${episodeNo} 集` : ''}的匹配：换个片名写法，或该片在弹幕库里确实没有` }
  }
  let comments: unknown
  try {
    comments = await fetchJson(`${base}/api/v2/comment/${best.episodeId}?from=0&withRelated=true`, fetchImpl, timeoutMs)
  } catch (e) {
    return { status: 'error', reason: fetchErrorReason(e) }
  }
  const items = parseDanDanPlayComments(comments)
  if (items.length === 0) return { status: 'empty' }
  return { status: 'ok', items, matched: `${best.animeTitle} ${best.episodeTitle}` }
}

/** 设置页的「测试弹幕源」：只调一次搜索，通了就说明地址可用（搜不到片名也算通） */
export async function testDanmuApi(
  rawBase: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; text: string }> {
  const base = normalizeDanmuApiBase(rawBase)
  if (!base) return { ok: false, text: '地址格式不对：要填 http(s):// 开头的地址，如 https://xxx.vercel.app' }
  try {
    const data = await fetchJson(`${base}/api/v2/search/episodes?anime=${encodeURIComponent('测试')}`, fetchImpl, DANMU_FETCH_TIMEOUT_MS)
    const n = parseSearchEpisodes(data).length
    return { ok: true, text: `弹幕源通了（搜到 ${n} 条相关结果，搜不到片名也算通）` }
  } catch (e) {
    return { ok: false, text: fetchErrorReason(e) }
  }
}
