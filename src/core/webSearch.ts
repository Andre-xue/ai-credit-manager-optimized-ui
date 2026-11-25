// 联网搜索（v0.1.318）：AI 聊天开启「联网搜索」后，回答前先真实搜索并抓取原文，
// 把资料附进 system 提示，要求模型依据资料作答、标注来源、不许猜。
// 搜索走公开搜索页（必应优先，DuckDuckGo 兜底，免 Key）；抓取按端分流：
// 桌面经 Rust 代理（绕 CORS）、手机走原生网络层、网页直连 fetch。
import { isDesktopShell, pluginHttpDesktop} from './plugins'
import { isNativeApp} from './openExternal'

const PREF_KEY = 'acm_ai_web_search'

export function loadWebSearchEnabled(): boolean {
try { return localStorage.getItem(PREF_KEY) === '1'} catch { return false}
}
export function saveWebSearchEnabled(v: boolean): void {
try { localStorage.setItem(PREF_KEY, v? '1': '0')} catch { /* 忽略 */}
}

export interface WebSearchResult { title: string; url: string; snippet: string}
export interface SearchContext { block: string; sources: { title: string; url: string}[]}

function decodeEntities(s: string): string {
return s
.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
.replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

/** HTML → 纯文本（去脚本/样式/标签，合并空白） */
export function stripHtmlToText(html: string): string {
return decodeEntities(
html
.replace(/<script[\s\S]*?<\/script>/gi, ' ')
.replace(/<style[\s\S]*?<\/style>/gi, ' ')
.replace(/<!--[\s\S]*?-->/g, ' ')
.replace(/<[^>]+>/g, ' '),
).replace(/\s+/g, ' ').trim()
}

/**
 * 修复 UTF-8 被按 Latin-1 误读的乱码串（v0.1.320）：atob/旧式解码会把 UTF-8 字节
 * 当单字节字符，中文 URL 变成 å¼ç½ 这类乱码。把每个字符还原回字节再按 UTF-8 解码；
 * 解出替换字符（�）说明原本没坏，原样返回。
 */
export function repairMojibake(s: string): string {
  if (!/[\u0080-\u00ff]/.test(s)) return s
  try {
    const bytes = Uint8Array.from(s, c => c.charCodeAt(0) & 0xff)
    const fixed = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    return fixed.includes('\uFFFD') ? s : fixed
  } catch { return s }
}

/** 必应结果链接是自家跳转地址（/ck/a?…&u=a1<base64>），解出真实目标地址 */
export function decodeBingRedirect(url: string): string {
  if (!/bing\.com\/ck\//.test(url)) return url
  const m = url.match(/[?&]u=a1([^&]+)/)
  if (!m) return url
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
    // atob 给的是字节串（每字符一个字节），必须再按 UTF-8 解码，否则中文地址变乱码
    const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), c => c.charCodeAt(0))
    const decoded = new TextDecoder('utf-8').decode(bytes)
    return /^https?:\/\//.test(decoded) ? decoded : url
  } catch { return url }
}

/** 结果去重：同 URL 或同标题（维基多语言镜像等）只留第一条（v0.1.320） */
export function dedupeResults(results: WebSearchResult[]): WebSearchResult[] {
const seenUrl = new Set<string>()
const seenTitle = new Set<string>()
const out: WebSearchResult[] = []
for (const r of results) {
const titleKey = r.title.trim().toLowerCase()
if (seenUrl.has(r.url) || (titleKey && seenTitle.has(titleKey))) continue
seenUrl.add(r.url)
if (titleKey) seenTitle.add(titleKey)
out.push(r)
}
return out
}

/** 解析必应搜索结果页（li.b_algo 结构） */
export function parseBingResults(html: string): WebSearchResult[] {
const out: WebSearchResult[] = []
for (const block of html.split(/<li class="b_algo"/).slice(1)) {
const m = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
if (!m) continue
const url = repairMojibake(decodeBingRedirect(decodeEntities(m[1])))
if (!/^https?:\/\//.test(url)) continue
const snippetM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
out.push({ title: stripHtmlToText(m[2]), url, snippet: snippetM? stripHtmlToText(snippetM[1]).slice(0, 220): ''})
if (out.length >= 6) break
}
return out
}

/** 解析 DuckDuckGo HTML 版结果页（result__a / result__snippet 结构，链接需解 uddg 跳转） */
export function parseDdgResults(html: string): WebSearchResult[] {
const out: WebSearchResult[] = []
const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
let m: RegExpExecArray | null
while ((m = re.exec(html))!== null) {
let url = decodeEntities(m[1])
const uddg = url.match(/[?&]uddg=([^&]+)/)
if (uddg) { try { url = decodeURIComponent(uddg[1])} catch { /* 保持原链接 */}}
if (!/^https?:\/\//.test(url)) continue
out.push({ title: stripHtmlToText(m[2]), url: repairMojibake(url), snippet: stripHtmlToText(m[3]).slice(0, 220)})
if (out.length >= 6) break
}
return out
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function httpGetTextOnce(url: string): Promise<string> {
const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml'}
if (isDesktopShell()) {
const r = await pluginHttpDesktop(url, 'GET', headers)
if (r.status >= 400) throw new Error(`HTTP ${r.status}`)
return r.text
}
if (isNativeApp()) {
const { CapacitorHttp} = await import('@capacitor/core')
const res = await CapacitorHttp.request({ url, method: 'GET', headers, responseType: 'text', readTimeout: 12000, connectTimeout: 8000})
if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
return typeof res.data === 'string'? res.data: JSON.stringify(res.data?? '')
}
const res = await fetch(url, { headers})
if (!res.ok) throw new Error(`HTTP ${res.status}`)
return res.text()
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
return Promise.race([p, new Promise<T>((_, rej) => { setTimeout(() => rej(new Error('响应超时')), ms)})])
}

async function httpGetText(url: string): Promise<string> {
return withTimeout(httpGetTextOnce(url), 12000)
}

/** 搜索：必应优先（国内可直达），无结果/失败时 DuckDuckGo 兜底 */
export async function searchWeb(query: string, limit = 5): Promise<WebSearchResult[]> {
const q = encodeURIComponent(query)
try {
const results = parseBingResults(await httpGetText(`https://www.bing.com/search?q=${q}&setlang=zh-CN`))
if (results.length) return results.slice(0, limit)
} catch { /* 落到兜底 */}
const results = parseDdgResults(await httpGetText(`https://html.duckduckgo.com/html/?q=${q}`))
return results.slice(0, limit)
}

/** 抓取一个网页的正文纯文本（截断防上下文爆炸） */
export async function fetchPageText(url: string, maxChars = 3200): Promise<string> {
return stripHtmlToText(await httpGetText(url)).slice(0, maxChars)
}

/**
 * 从用户消息提炼搜索词（v0.1.319）：整段粘贴/一次问多个问题时，原文直搜会被污染
 * （实测粘贴两问 → 搜出 SEO 垃圾站）。做法：去编号/项目符号 → 按问句切分取最多 2 条；
 * 含「今天/昨天/最新/新闻」等时效词且没写日期时，补上今天日期（搜索引擎更给当天的结果）。
 */
export function deriveSearchQueries(text: string, today: Date = new Date()): string[] {
const cleaned = text
.replace(/^\s*(?:\d+[.、．]|[-*•])\s*/gm, '')
.replace(/[*#>`「」『』“”‘’\"]/g, '')
.replace(/\s+/g, ' ')
.trim()
if (!cleaned) return []
const parts = cleaned.split(/[？?！!。；;\n]/).map(x => x.trim()).filter(x => x.length >= 4)
const queries = (parts.length >= 2 ? parts.slice(0, 2) : [cleaned.slice(0, 120)])
const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`
return queries.map(q => (/今天|昨天|今日|最新|新闻|近期|现在|刚刚/.test(q) && !/\d{4}年|\d{1,2}月\d{1,2}日/.test(q) ? `${q} ${dateStr}` : q))
}

/** 查询词切分：空白/标点分词，中文长词再滑 2 字窗（给相关性打分用） */
export function queryTerms(query: string): string[] {
const terms = new Set<string>()
for (const w of query.toLowerCase().split(/[\s\p{P}\p{S}]+/u)) {
if (!w) continue
if (w.length <= 4) { terms.add(w); continue }
for (let i = 0; i + 2 <= w.length; i++) terms.add(w.slice(i, i + 2))
}
return [...terms].filter(t => t.length >= 2)
}

/**
 * 相关性过滤+排序：标题/摘要与查询词零重合的结果多半是 SEO 垃圾（如实测的「X站」），直接丢弃；
 * 剩下的按命中词数排序。过滤后不足 2 条时保留得分最高的 2 条兜底，避免误杀。
 */
export function filterRelevantResults(queries: string[], results: WebSearchResult[]): WebSearchResult[] {
const terms = [...new Set(queries.flatMap(queryTerms))]
if (!terms.length || !results.length) return results
const scored = results.map((r, idx) => {
const hay = `${r.title} ${r.snippet}`.toLowerCase()
const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0)
return { r, idx, score }
})
const kept = scored.filter(x => x.score > 0)
const pool = kept.length >= 2 ? kept : [...scored].sort((a, b) => b.score - a.score).slice(0, 2)
return pool.sort((a, b) => b.score - a.score || a.idx - b.idx).map(x => x.r)
}

/**
* 为一次提问构建搜索资料块：提炼搜索词 → 多路搜索合并去重 → 相关性过滤 →
* 抓前 4 条原文（失败用摘要代替）→ 编号成块。搜不到任何结果返回 null。
*/
export async function buildSearchContext(question: string): Promise<SearchContext | null> {
const queries = deriveSearchQueries(question)
if (!queries.length) return null
const perQuery = await Promise.all(queries.map(q => searchWeb(q, 5).catch(() => [] as WebSearchResult[])))
const merged = dedupeResults(perQuery.flat())
const results = filterRelevantResults(queries, merged).slice(0, 5)
if (!results.length) return null
const pages = await Promise.all(results.slice(0, 4).map(async r => {
try { return await fetchPageText(r.url)} catch { return ''}
}))
const parts = results.map((r, i) => {
const body = (i < pages.length && pages[i])? pages[i]: r.snippet
return `[${i + 1}] ${r.title}\n${r.url}\n${body}`
})
return {
block: `\n${parts.join('\n\n')}`,
sources: results.map(r => ({ title: r.title, url: r.url})),
}
}

// 同一问题 60 秒内复用（多模型对比/失败换 Key 重试会重复调用 getReply，避免重复搜索）
let ctxCache: { q: string; at: number; ctx: SearchContext | null} | null = null
export async function buildSearchContextCached(question: string): Promise<SearchContext | null> {
const q = question.trim().replace(/\s+/g, ' ').slice(0, 120)
if (ctxCache && ctxCache.q === q && Date.now() - ctxCache.at < 60000) return ctxCache.ctx
const ctx = await buildSearchContext(question)
ctxCache = { q, at: Date.now(), ctx}
return ctx
}
