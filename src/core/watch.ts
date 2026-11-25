// 工坊 · 看剧（v0.1.386）：AI 找剧 + 热门推荐（TMDB）+ 直播 + 点播 + 追剧日历 + 片单。
// 直播只用合法公开源：iptv-org（公开免费频道目录）与 Free-TV；绝不内置
// vbskycn/lilei6900s/fanmingming/Guovin 等聚合央视/卫视的第三方转播源。
// 自定义源由用户自己粘贴 m3u 订阅链接（像 VLC 里粘地址），输入框留空不预填。
// 源体检（v0.1.391）：直播页手动「开始体检」，逐台测连通性（通/不通、耗时），
// 死台标出、可过滤，快的排前面；结果缓存 30 分钟。
// v0.1.411 真验流：391 探针只测连通性（响应头一到就算通），404 的播放列表、
// 空文件、坏流都会算通；升级后拉播放列表验分片才算通（见 probeStreamUrl）。
// 分组口径（Ethan 定）：外国只按国家 + 内容两维；中国按央视/卫视/其他 + 内容
// 两维；General/Undefined 统一归“其他”。全部数据只存本机，不进云同步/备份。
// 来源标注（v0.1.387，Ethan 2026-11-24 拍板：保持现状、界面标注）：实测
// iptv-org/Free-TV 的中国切片并不干净——央视流大量指向第三方转播服务器
// （裸 IP 直连，如 74.91.26.218）。这些流不拦截、不过滤，只打「未授权转播」
// 标记：频道卡片角标 + 播放器内提示 + 直播分区顶部说明。

import { encryptSecret, decryptSecret } from './crypto'
import { isNativeApp } from './openExternal'

export interface LiveChannel {
  /** 归一化台名（去分辨率后缀、小写） */
  key: string
  name: string
  logo?: string
  /** 内容分类键（news/movies/sports/kids/music/documentary/…/other） */
  content: string
  /** 所属国家码：CN/US/GB/JP/KR… */
  country: string
  /** 多套源的播放地址（按优先级：自定义源 > iptv-org > Free-TV） */
  urls: string[]
  /** 出现过的源集合 id */
  sourceIds: string[]
  /** 主源（urls[0]）是否为第三方转播（未授权）：解析时按 URL 打标记 */
  unofficial?: boolean
}

// ---------------- 来源标记：第三方转播（未授权） ----------------
// 实测坐实（v0.1.386）：iptv-org cn.m3u 与 Free-TV 中国组里央视流大量指向
// 裸 IP 直连的第三方转播服务器，与被拒仓库同一批源。正版来源（如 CCTV+
// 走 cctvplus.com、省台官方 CDN）是域名，不标记。判断只看 URL 本身，与
// 内置源/自定义源无关——用户自己粘的源同样按此规则打标记。

/** 实测见过的第三方转播 host（均为裸 IP；通用 IPv4 规则已覆盖，此处留作显式记录、可扩展域名） */
export const UNOFFICIAL_STREAM_HOSTS = new Set([
  '74.91.26.218',
  '69.30.245.50',
  '38.75.136.137',
])

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** 某条流地址是否为第三方转播（未授权）：host 是裸 IP 字面量（v4/v6，含端口）或已知转播 host */
export function isUnofficialStreamUrl(url: string): boolean {
  let host = ''
  try { host = new URL(url).hostname } catch { return false }
  if (!host) return false
  if (UNOFFICIAL_STREAM_HOSTS.has(host)) return true
  if (IPV4_RE.test(host)) return true
  if (host.includes(':')) return true // IPv6 字面量（new URL 去掉方括号后含冒号）
  return false
}

/** 某频道当前主源（urls[0]）是否为第三方转播；旧缓存缺 unofficial 字段时同样适用 */
export function isChannelUnofficial(ch: LiveChannel): boolean {
  if (ch.unofficial === true) return true
  return ch.urls.length > 0 && isUnofficialStreamUrl(ch.urls[0])
}

export interface SourceSetResult {
  setId: string
  label: string
  ok: boolean
  count: number
  error?: string
  /** 本次结果是否来自 24 小时缓存（是则不发请求） */
  cached?: boolean
  cachedAt?: number
}

export interface SourceSet {
  id: string
  label: string
  url: string
  /** 该套源归属的国家；Free-TV 为 world（按条目 tvg-country/group-title 再分） */
  country: string
}

export const IPTV_ORG_BASE = 'https://iptv-org.github.io/iptv'
export const FREE_TV_URL = 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8'

/** 内置源集合（只含 iptv-org 与 Free-TV；绝不含第三方转播源） */
export const BUILTIN_SETS: SourceSet[] = [
  { id: 'iptv-cn', label: 'iptv-org · 中国', url: `${IPTV_ORG_BASE}/countries/cn.m3u`, country: 'CN' },
  { id: 'iptv-us', label: 'iptv-org · 美国', url: `${IPTV_ORG_BASE}/countries/us.m3u`, country: 'US' },
  { id: 'iptv-uk', label: 'iptv-org · 英国', url: `${IPTV_ORG_BASE}/countries/uk.m3u`, country: 'GB' },
  { id: 'iptv-jp', label: 'iptv-org · 日本', url: `${IPTV_ORG_BASE}/countries/jp.m3u`, country: 'JP' },
  { id: 'iptv-kr', label: 'iptv-org · 韩国', url: `${IPTV_ORG_BASE}/countries/kr.m3u`, country: 'KR' },
  { id: 'freetv', label: 'Free-TV', url: FREE_TV_URL, country: 'WORLD' },
]
// 注意：分类切片（如 categories/news.m3u）不单独拉——内容分组直接用各条目
// 的 group-title 元数据；index.m3u 总表（2.6MB、11,505 台）绝不拉。

export const COUNTRIES: { code: string; label: string; setId: string }[] = [
  { code: 'CN', label: '中国', setId: 'iptv-cn' },
  { code: 'US', label: '美国', setId: 'iptv-us' },
  { code: 'GB', label: '英国', setId: 'iptv-uk' },
  { code: 'JP', label: '日本', setId: 'iptv-jp' },
  { code: 'KR', label: '韩国', setId: 'iptv-kr' },
]

/** 内容分类：group-title 英文 → 中文标签（未列出的与 General/Undefined 归“其他”） */
export const CONTENT_LABELS: Record<string, string> = {
  news: '新闻', movies: '电影', sports: '体育', kids: '少儿', music: '音乐',
  documentary: '纪录片', entertainment: '娱乐', series: '剧集', lifestyle: '生活',
  education: '教育', business: '财经', religious: '宗教', culture: '文化',
  weather: '天气', travel: '旅游', science: '科教', legislative: '时政',
  shop: '购物', classic: '经典', comedy: '喜剧', animation: '动画', other: '其他',
}
export const CONTENT_ORDER = ['news', 'movies', 'sports', 'kids', 'music', 'documentary', 'entertainment', 'series', 'lifestyle', 'education', 'business', 'culture', 'other']

/** Free-TV 的 group-title 是国家名：映射到国家码（未列出的归 WORLD） */
const FREE_TV_COUNTRY_MAP: Record<string, string> = {
  China: 'CN', 'United States': 'US', USA: 'US', US: 'US',
  'United Kingdom': 'GB', UK: 'GB', Japan: 'JP', 'South Korea': 'KR', Korea: 'KR',
}

/** 省级卫视英文名（iptv-org 的中国区多用英文台名，如 Anhui TV） */
const PROVINCIAL_TV_EN = [
  'Hunan', 'Zhejiang', 'Jiangsu', 'Anhui', 'Beijing', 'Dragon', 'Guangdong',
  'Shandong', 'Sichuan', 'Hubei', 'Henan', 'Fujian', 'Liaoning', 'Jilin',
  'Heilongjiang', 'Hebei', 'Shanxi', 'Shaanxi', 'Yunnan', 'Guizhou', 'Guangxi',
  'Jiangxi', 'Tianjin', 'Chongqing', 'Shenzhen', 'Hainan', 'Ningxia', 'Qinghai',
  'Gansu', 'Inner Mongolia', 'Xizang', 'Xinjiang',
]

export type StationOrigin = 'cctv' | 'satellite' | 'other'

/** 台属：中国才分——央视（CCTV 开头）/ 卫视（以“卫视”结尾或省级卫视英文名）/ 其他 */
export function stationOrigin(name: string): StationOrigin {
  const n = name.trim()
  if (/^cctv/i.test(n)) return 'cctv'
  if (/卫视$/.test(n)) return 'satellite'
  const lower = n.toLowerCase()
  if (/ tv$/.test(lower) && PROVINCIAL_TV_EN.some(p => lower.startsWith(p.toLowerCase() + ' '))) return 'satellite'
  return 'other'
}

export const ORIGIN_LABELS: Record<StationOrigin, string> = { cctv: '央视', satellite: '卫视', other: '其他' }

/** 内容归一化：取 group-title 首个分段；General/Undefined/未知 → other */
export function contentKeyOf(groupTitle: string): string {
  const first = (groupTitle || '').split(/[;,/]/)[0]?.trim().toLowerCase() ?? ''
  if (!first || first === 'general' || first === 'undefined') return 'other'
  const key = first.replace(/[^a-z]/g, '')
  return CONTENT_LABELS[key] ? key : 'other'
}

/** 台名归一化：去分辨率后缀、去多余空格，供跨源去重 */
export function normalizeChannelName(name: string): string {
  return name
    .replace(/\s*\((?:720p|1080p|4k|2160p|sd|hd|fhd|uhd)\)\s*/gi, '')
    .replace(/\s+(720p|1080p|4k|2160p|sd|hd|fhd|uhd)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

interface M3uEntry {
  name: string
  logo?: string
  groupTitle: string
  tvgCountry?: string
  url: string
}

/** 解析 m3u/m3u8 文本：#EXTINF 行 + 下一行地址 */
export function parseM3u(text: string): M3uEntry[] {
  const lines = text.split(/\r?\n/)
  const out: M3uEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('#EXTINF')) continue
    const attr = (key: string): string => {
      const m = new RegExp(`${key}="([^"]*)"`).exec(line)
      return m?.[1] ?? ''
    }
    const name = line.slice(line.lastIndexOf(',') + 1).trim()
    let url = ''
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim()
      if (!next) continue
      if (next.startsWith('#')) continue
      url = next
      break
    }
    if (!name || !url || !/^https?:\/\//.test(url)) continue
    out.push({
      name,
      logo: attr('tvg-logo') || undefined,
      groupTitle: attr('group-title'),
      tvgCountry: attr('tvg-country') || undefined,
      url,
    })
  }
  return out
}

/** 分片解析 m3u：每 500 行让出一次主线程，大列表解析不卡界面 */
export async function parseM3uAsync(text: string): Promise<M3uEntry[]> {
  const lines = text.split(/\r?\n/)
  const out: M3uEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % 500 === 0) await new Promise(r => globalThis.setTimeout(r, 0))
    const line = lines[i].trim()
    if (!line.startsWith('#EXTINF')) continue
    const attr = (key: string): string => {
      const m = new RegExp(`${key}="([^"]*)"`).exec(line)
      return m?.[1] ?? ''
    }
    const name = line.slice(line.lastIndexOf(',') + 1).trim()
    let url = ''
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim()
      if (!next) continue
      if (next.startsWith('#')) continue
      url = next
      break
    }
    if (!name || !url || !/^https?:\/\//.test(url)) continue
    out.push({
      name,
      logo: attr('tvg-logo') || undefined,
      groupTitle: attr('group-title'),
      tvgCountry: attr('tvg-country') || undefined,
      url,
    })
  }
  return out
}

/** 解析 txt 直播源（v0.1.425）：每行「频道名,地址」，`分组名,#genre#` 当分组。
 * 与 m3u 共用 M3uEntry：groupTitle 取当前分组（无分组时为空），后续走同一套
 * 国家/内容归一、频道合并与直播点播拆分。跳过：空行、裸标题行（无逗号）、
 * 地址为空、地址不是 http(s) 开头（mitv:// 等专有协议播不了）；源文件里
 * 偶有名字被换行截断的脏行，只认「逗号 + http(s) 地址」的行，不猜不断行。 */
export function parseTxt(text: string): M3uEntry[] {
  const lines = text.split(/\r?\n/)
  const out: M3uEntry[] = []
  let group = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.includes('#genre#')) {
      // 分组行：`分组名,#genre#`；裸 `#genre#` 没有名字，沿用上一个分组
      const name = line.split(',')[0]?.trim() ?? ''
      if (name && name !== '#genre#') group = name
      continue
    }
    if (line.startsWith('#')) continue
    const idx = line.indexOf(',')
    if (idx < 0) continue
    const name = line.slice(0, idx).trim()
    const url = line.slice(idx + 1).trim()
    if (!name || !url || !/^https?:\/\//.test(url)) continue
    out.push({ name, groupTitle: group, url })
  }
  return out
}

/** 分片解析 txt：每 500 行让出一次主线程，大列表解析不卡界面 */
export async function parseTxtAsync(text: string): Promise<M3uEntry[]> {
  const lines = text.split(/\r?\n/)
  const out: M3uEntry[] = []
  let group = ''
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % 500 === 0) await new Promise(r => globalThis.setTimeout(r, 0))
    const line = lines[i].trim()
    if (!line) continue
    if (line.includes('#genre#')) {
      const name = line.split(',')[0]?.trim() ?? ''
      if (name && name !== '#genre#') group = name
      continue
    }
    if (line.startsWith('#')) continue
    const idx = line.indexOf(',')
    if (idx < 0) continue
    const name = line.slice(0, idx).trim()
    const url = line.slice(idx + 1).trim()
    if (!name || !url || !/^https?:\/\//.test(url)) continue
    out.push({ name, groupTitle: group, url })
  }
  return out
}

/** 按内容自动识别播放列表格式：含 #EXTINF 走 m3u，否则按 txt 试（频道名,地址） */
export function parsePlaylistFormat(text: string): 'm3u' | 'txt' {
  return text.includes('#EXTINF') ? 'm3u' : 'txt'
}

/** 按内容自动识别并分片解析播放列表：m3u 与 txt 同一入口 */
export async function parsePlaylistAsync(text: string): Promise<M3uEntry[]> {
  return parsePlaylistFormat(text) === 'm3u' ? parseM3uAsync(text) : parseTxtAsync(text)
}

function countryOfEntry(e: M3uEntry, setCountry: string): string {
  if (e.tvgCountry) return e.tvgCountry.toUpperCase()
  if (setCountry !== 'WORLD') return setCountry
  return FREE_TV_COUNTRY_MAP[e.groupTitle] ?? 'WORLD'
}

function entriesToChannels(entries: M3uEntry[], setCountry: string, setId: string): LiveChannel[] {
  return entries.map(e => {
    // 保留原始显示名（仅去掉分辨率后缀）
    const display = e.name.replace(/\s*\((?:720p|1080p|4k|2160p|sd|hd|fhd|uhd)\)\s*/gi, '').replace(/\s+/g, ' ').trim()
    return {
      key: normalizeChannelName(e.name),
      name: display,
      logo: e.logo,
      content: contentKeyOf(e.groupTitle),
      country: countryOfEntry(e, setCountry),
      urls: [e.url],
      sourceIds: [setId],
      unofficial: isUnofficialStreamUrl(e.url),
    }
  })
}

/** 合并多套源的频道：同名（归一化后）合并播放地址，自定义源优先 */
export function mergeChannels(lists: LiveChannel[][]): LiveChannel[] {
  const map = new Map<string, LiveChannel>()
  for (const list of lists) {
    for (const ch of list) {
      const prev = map.get(ch.key)
      if (!prev) { map.set(ch.key, { ...ch, urls: [...ch.urls], sourceIds: [...ch.sourceIds] }); continue }
      for (const u of ch.urls) if (!prev.urls.includes(u)) prev.urls.push(u)
      for (const s of ch.sourceIds) if (!prev.sourceIds.includes(s)) prev.sourceIds.push(s)
      if (!prev.logo && ch.logo) prev.logo = ch.logo
      if (prev.content === 'other' && ch.content !== 'other') prev.content = ch.content
    }
  }
  // 合并后主源可能变化：按合并后的 urls[0] 重新打标记
  for (const ch of map.values()) ch.unofficial = isUnofficialStreamUrl(ch.urls[0] ?? '')
  return [...map.values()]
}

// ---------------- 视频点播（v0.1.390） ----------------
// m3u 里的点播条目与直播分开：电影/剧集文件（mp4/mkv/mov/avi/webm），
// 或内容为电影/剧集（group-title Movies/Series）且地址不是直播流的条目。
// m3u8 与 .ts 永远算直播（哪怕 group-title 是 Movies，如 CCTV-6 电影频道）；
// .flv 不算点播文件后缀：FLV over HTTP 是常见直播流格式（如东莞综合新闻频道的
// stream.sun0769.com/dgrtv1/mp4tv1_1500.flv），按后缀判点播会把新闻直播台错分
// 进点播区；Movies/Series 分组的 .flv 仍按点播算（走下面 content 规则）。
// 无后缀的电影/剧集地址按点播算（直播流一般都带 m3u8/.ts 后缀）。

export interface VodEpisode {
  /** 集标签：电影为“正片”，剧集为“第 N 集” */
  label: string
  /** 同一集的多套源（播不了自动换下一个，与直播同款） */
  urls: string[]
  /** 集号（0 = 无明确集号，如电影正片） */
  episodeNo: number
  unofficial: boolean
}

export interface VodTitle {
  key: string
  title: string
  kind: 'movie' | 'series'
  episodes: VodEpisode[]
  logo?: string
  sourceIds: string[]
  /** 任一集是第三方转播 */
  unofficial: boolean
}

const VOD_FILE_RE = /\.(mp4|mkv|mov|avi|webm)(\?.*)?$/i

/** 某条流地址是否为 FLV 流：浏览器 <video> 与 hls.js 都播不了，需 flv.js（MSE） */
export function isFlvUrl(url: string): boolean {
  return /\.flv(\?.*)?$/i.test(url.split('?')[0])
}

/** 某条流地址是否为点播：文件后缀是点播格式，或内容为电影/剧集且不是直播流 */
export function isVodUrl(url: string, content?: string): boolean {
  const path = url.split('?')[0]
  if (/\.m3u8$/i.test(path)) return false
  if (VOD_FILE_RE.test(path)) return true
  if ((content === 'movies' || content === 'series') && !/\.ts$/i.test(path)) return true
  return false
}

/** 某频道是否含点播地址（合并后的频道可能同时含直播与点播地址） */
export function isVodChannel(ch: LiveChannel): boolean {
  return ch.urls.some(u => isVodUrl(u, ch.content))
}

/** 从条目名拆出（去集数标记后的干净标题，集号|null）：只认明确标记
 * （第N集 / S01E03 / 末尾 E05），末尾孤数字不认——“流浪地球 2”是电影不是第 2 集。 */
export function splitEpisode(name: string): { title: string; episodeNo: number | null } {
  const clean = (t: string): string => t
    .replace(/\s*\((?:720p|1080p|4k|2160p|sd|hd|fhd|uhd)\)\s*/gi, '')
    .replace(/[\s\-_·•]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const t = name.replace(/\s+/g, ' ').trim()
  let m = /第\s*(\d+)\s*[集话回]/.exec(t)
  if (m) return { title: clean(t.replace(m[0], '')), episodeNo: parseInt(m[1], 10) }
  m = /[Ss]\d+[Ee](\d+)/.exec(t)
  if (m) return { title: clean(t.replace(m[0], '')), episodeNo: parseInt(m[1], 10) }
  m = /(?:^|[\s\-_])(?:[Ee][Pp]?|第)(\d+)\s*$/.exec(t)
  if (m) return { title: clean(t.slice(0, m.index).trim()), episodeNo: parseInt(m[1], 10) }
  return { title: clean(t), episodeNo: null }
}

/** 从频道列表抽点播：同名剧集多条合并为一部带选集；单条无集号的为电影。 */
export function channelsToVod(channels: LiveChannel[]): VodTitle[] {
  interface Group { title: string; logo?: string; sourceIds: string[]; eps: VodEpisode[]; hasStrongEp: boolean }
  const groups = new Map<string, Group>()
  for (const ch of channels) {
    const vodUrls = ch.urls.filter(u => isVodUrl(u, ch.content))
    if (!vodUrls.length) continue
    const { title, episodeNo } = splitEpisode(ch.name)
    const key = title.toLowerCase()
    const g = groups.get(key) ?? { title, logo: ch.logo, sourceIds: [], eps: [], hasStrongEp: false }
    if (!g.logo && ch.logo) g.logo = ch.logo
    for (const s of ch.sourceIds) if (!g.sourceIds.includes(s)) g.sourceIds.push(s)
    // 同一集多套源合并到同一集；无集号的（电影正片）同样合并，不拆成多集
    const epNo = episodeNo ?? 0
    let ep = g.eps.find(e => e.episodeNo === epNo)
    if (!ep) { ep = { label: '', urls: [], episodeNo: epNo, unofficial: false }; g.eps.push(ep) }
    for (const u of vodUrls) if (!ep.urls.includes(u)) ep.urls.push(u)
    ep.unofficial = ep.urls.some(u => isUnofficialStreamUrl(u))
    if (episodeNo !== null) g.hasStrongEp = true
    groups.set(key, g)
  }
  const out: VodTitle[] = []
  for (const g of groups.values()) {
    const eps = [...g.eps].sort((a, b) => {
      if (a.episodeNo && b.episodeNo) return a.episodeNo - b.episodeNo
      if (a.episodeNo) return -1
      if (b.episodeNo) return 1
      return 0
    })
    const isSeries = g.hasStrongEp || eps.length > 1
    eps.forEach((e, i) => { e.label = isSeries ? `第 ${e.episodeNo || i + 1} 集` : '正片' })
    out.push({
      key: g.title.toLowerCase(), title: g.title, kind: isSeries ? 'series' : 'movie',
      episodes: eps, logo: g.logo, sourceIds: g.sourceIds,
      unofficial: eps.some(e => e.unofficial),
    })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
}

/** 点播继续观看 id：vod:<标题 key>:<集下标>（标题 key 含冒号时按最后一个冒号切） */
export function vodContinueId(vodKey: string, episodeIndex: number): string {
  return `vod:${vodKey}:${episodeIndex}`
}

export function parseVodContinueId(id: string): { vodKey: string; episodeIndex: number } | null {
  const m = /^vod:(.+):(\d+)$/.exec(id)
  if (!m) return null
  return { vodKey: m[1], episodeIndex: parseInt(m[2], 10) }
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController()
  const t = globalThis.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: '*/*' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    globalThis.clearTimeout(t)
  }
}

// ---------------- 播放列表缓存（性能，v0.1.386 追加） ----------------
// 直播源禁止全量加载：默认只拉国家切片（中国 cn.m3u 156 台），绝不拉
// index.m3u 总表（2.6MB、11,505 台）；外国按国家切片按需拉（点哪个国家
// 再拉哪个）；分类切片不单独拉（内容分组直接用 group-title 元数据）。
// 解析结果按源缓存本机 24 小时：24 小时内直接读缓存，不重新拉、不重新解析。
export const PLAYLIST_CACHE_KEY = 'acm.watch.playlistCache.v1'
export const PLAYLIST_CACHE_TTL_MS = 24 * 3600_000

interface PlaylistCacheEntry { url: string; at: number; channels: LiveChannel[] }
type PlaylistCache = Record<string, PlaylistCacheEntry>

function loadPlaylistCache(): PlaylistCache {
  try {
    const v = JSON.parse(localStorage.getItem(PLAYLIST_CACHE_KEY) ?? '{}') as PlaylistCache
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

function savePlaylistCache(cache: PlaylistCache): void {
  try {
    // 每套源最多存 2000 条，防 localStorage 爆掉
    for (const k of Object.keys(cache)) cache[k].channels = cache[k].channels.slice(0, 2000)
    localStorage.setItem(PLAYLIST_CACHE_KEY, JSON.stringify(cache))
  } catch { /* 忽略（存不下时下次重新拉） */ }
}

/** 缓存键：国家切片按源 id；Free-TV 按国家过滤后分开存；自定义源按 id */
function playlistCacheKey(set: SourceSet, countryFilter?: string): string {
  return countryFilter ? `${set.id}:${countryFilter}` : set.id
}

export function clearPlaylistCache(): void {
  try { localStorage.removeItem(PLAYLIST_CACHE_KEY) } catch { /* 忽略 */ }
}

export interface FetchSourceSetOptions { force?: boolean; countryFilter?: string }

/**
 * 拉一套源：先读 24 小时缓存（force 时跳过），缓存失效才拉取并分片解析；
 * 失败返回 error（中文），不抛错，供多套自动切换。
 */
export async function fetchSourceSet(set: SourceSet, opts: FetchSourceSetOptions = {}): Promise<{ channels: LiveChannel[]; result: SourceSetResult }> {
  const cacheKey = playlistCacheKey(set, opts.countryFilter)
  if (!opts.force) {
    const hit = loadPlaylistCache()[cacheKey]
    if (hit && hit.url === set.url && Date.now() - hit.at < PLAYLIST_CACHE_TTL_MS && Array.isArray(hit.channels)) {
      return { channels: hit.channels, result: { setId: set.id, label: set.label, ok: true, count: hit.channels.length, cached: true, cachedAt: hit.at } }
    }
  }
  try {
    const text = await fetchTextWithTimeout(set.url, 20000)
    // v0.1.425：按内容自动识别 m3u / txt；一个台都解析不到时报中文原因，
    // 不要静默 0 个台（之前 ok:true count:0，源坏了也看不出来）
    const entries = await parsePlaylistAsync(text)
    if (!entries.length) {
      return { channels: [], result: { setId: set.id, label: set.label, ok: false, count: 0, error: '没有解析到任何频道：不是有效的 m3u 或 txt 直播源' } }
    }
    let channels = entriesToChannels(entries, set.country, set.id)
    if (opts.countryFilter) channels = channels.filter(c => c.country === opts.countryFilter)
    const cache = loadPlaylistCache()
    cache[cacheKey] = { url: set.url, at: Date.now(), channels }
    savePlaylistCache(cache)
    return { channels, result: { setId: set.id, label: set.label, ok: true, count: channels.length } }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const reason = /abort|timeout|timed out/i.test(msg)
      ? '拉取超时（20 秒无响应）'
      : /load failed|failed to fetch|networkerror/i.test(msg)
        ? '网络请求失败，可能被代理/网络拦截，请换个节点再试'
        : `拉取失败（${msg.slice(0, 60)}）`
    return { channels: [], result: { setId: set.id, label: set.label, ok: false, count: 0, error: reason } }
  }
}

// ---------------- 自定义源（用户自己粘贴 m3u 订阅链接） ----------------

export interface CustomSource { id: string; label: string; url: string; addedAt: number }
export const CUSTOM_SOURCES_KEY = 'acm.watch.customSources.v1'

export function loadCustomSources(): CustomSource[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_SOURCES_KEY) ?? '[]')
    return Array.isArray(v) ? (v as CustomSource[]).filter(s => s?.url) : []
  } catch { return [] }
}

export function saveCustomSources(list: CustomSource[]): void {
  try { localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(list)) } catch { /* 忽略 */ }
}

function customSourcesAsSets(): SourceSet[] {
  return loadCustomSources().map(s => ({ id: `custom-${s.id}`, label: `自定义 · ${s.label}`, url: s.url, country: 'WORLD' }))
}

/**
 * 拉取某国家（或 WORLD 全部）的频道：多套源并行拉，单套失败自动由其他套顶上；
 * 同名频道合并播放地址（一个播不了播另一个）。返回直播频道、点播与每套源的状态。
 * 直播与点播按地址拆分：同一频道既有直播地址又有 mp4 点播地址时，两边各留各的。
 * 性能：默认只拉该国家切片 + Free-TV（按国家过滤后缓存），绝不拉总表；
 * 24 小时内读缓存不重新拉；force=true 时强制重新拉（「重新加载」按钮）。
 */
export async function loadCountryChannels(country: string, opts: { force?: boolean } = {}): Promise<{ channels: LiveChannel[]; vod: VodTitle[]; sets: SourceSetResult[] }> {
  const sets: SourceSet[] = []
  const countrySet = BUILTIN_SETS.find(s => s.country === country && s.id.startsWith('iptv-'))
  if (countrySet) sets.push(countrySet)
  // Free-TV 按条目国家过滤后参与合并（backup），只存本国条目
  sets.push(BUILTIN_SETS.find(s => s.id === 'freetv')!)
  sets.push(...customSourcesAsSets())
  const settled = await Promise.all(sets.map(async s => {
    const countryFilter = s.id === 'freetv' && country !== 'WORLD' ? country : undefined
    const r = await fetchSourceSet(s, { force: opts.force, countryFilter })
    return { channels: r.channels, result: r.result }
  }))
  const lists = settled.map(s => s.channels)
  const merged = mergeChannels(lists)
    // 未标国家的自定义源条目（country WORLD）归入当前国家（用户自己粘的源，没写 tvg-country 也要能看）
    .filter(c => country === 'WORLD' || c.country === country || (c.country === 'WORLD' && c.sourceIds.some(id => id.startsWith('custom-'))))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  // 直播与点播按地址拆分：点播地址进点播区，不留在直播列表里（否则直播播放器播 mp4 会失败）
  const live: LiveChannel[] = []
  const vodChannels: LiveChannel[] = []
  for (const ch of merged) {
    const liveUrls = ch.urls.filter(u => !isVodUrl(u, ch.content))
    const vodUrls = ch.urls.filter(u => isVodUrl(u, ch.content))
    if (liveUrls.length) live.push({ ...ch, urls: liveUrls, unofficial: isUnofficialStreamUrl(liveUrls[0]) })
    if (vodUrls.length) vodChannels.push({ ...ch, urls: vodUrls, unofficial: isUnofficialStreamUrl(vodUrls[0]) })
  }
  return { channels: live, vod: channelsToVod(vodChannels), sets: settled.map(s => s.result) }
}

// ---------------- 源体检（v0.1.391 测连通性 → v0.1.411 真验流） ----------------
// 真验流：拉取 m3u8 播放列表并验证其中有有效分片才算通——404、空列表、
// 无有效分片、坏流、分片拉不到都不再算通。主播放列表（#EXT-X-STREAM-INF）
// 再拉一层变体列表验证；直链文件（mp4/flv/ts 等）用 Range 取头 1KB 验
// 状态与非空。取正文的通道：桌面走 Rust plugin_http_media（公网 http(s)
// 都放行，302 由本侧手动跟、每跳重新过 SSRF 校验）、安卓走 CapacitorHttp、
// 网页走 CORS fetch；正文封顶 256KB。网页上 CORS 读不到正文时才退回旧的
// 连通性探测（响应头一到就算通），并标记 verified: false、原因写清
// 「仅测连通（浏览器跨域限制，未验流）」，不冒充验过。失败原因如实存进
// reason，界面角标直接显示，不静默兜底。
// 限速：真验流每台要拉 1–3 次请求，并行从 8 路降到 4 路；单次请求 6 秒
// 超时，变体/分片 4 秒；手动入口（不自动跑、不在启动时全量测），结果
// 缓存 30 分钟，后台跑、不堵列表渲染，进度 done/total 实时回推。

export interface ChannelHealth {
  ok: boolean
  /** 通时的耗时（毫秒，发出请求 → 验完） */
  ms?: number
  /** 测得的时间戳 */
  at: number
  /** 测通的那条地址；全不通时为试过的第一条地址（供缓存校验：须是当前频道的某条地址） */
  url: string
  /** 点播体检专用：测通的那一集标签（直播没有） */
  episode?: string
  /** 失败原因（中文短句，如 HTTP 404 / 空列表 / 无有效分片 / 分片拉不到）；通时为空 */
  reason?: string
  /** 是否真验过流：false = 网页 CORS 读不到正文、只测了连通性；旧缓存条目无此字段，按 false 计 */
  verified?: boolean
}

export type HealthMap = Record<string, ChannelHealth>

export const HEALTH_CACHE_KEY = 'acm.watch.health.v1'
export const HEALTH_CACHE_TTL_MS = 30 * 60_000
export const HEALTH_PROBE_TIMEOUT_MS = 6000
export const HEALTH_PROBE_SUB_TIMEOUT_MS = 4000
export const HEALTH_PROBE_CONCURRENCY = 4
/** 取正文封顶：播放列表很小，256KB 足够；防误指大文件 */
export const HEALTH_PROBE_BODY_CAP = 256 * 1024
/** 直链文件/分片只验头：读到 1KB 即够 */
export const HEALTH_PROBE_HEAD_BYTES = 1024
/** 手动跟重定向最多跳数（桌面原生通道不自动跟 302） */
export const HEALTH_PROBE_MAX_REDIRECTS = 3

/** 探针请求头：浏览器 UA（部分流服务器会拦非浏览器 UA）；浏览器 fetch
 * 设置 User-Agent 会被静默忽略，无害。 */
const PROBE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export function loadHealthCache(): HealthMap {
  try {
    const v = JSON.parse(localStorage.getItem(HEALTH_CACHE_KEY) ?? '{}') as HealthMap
    if (!v || typeof v !== 'object') return {}
    const now = Date.now()
    const out: HealthMap = {}
    for (const [k, e] of Object.entries(v)) {
      if (e && typeof e === 'object' && typeof e.ok === 'boolean' && typeof e.at === 'number' && typeof e.url === 'string' && now - e.at < HEALTH_CACHE_TTL_MS) out[k] = e
    }
    return out
  } catch { return {} }
}

export function saveHealthCache(map: HealthMap): void {
  try {
    const entries = Object.entries(map).slice(0, 2000)
    localStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* 忽略 */ }
}

interface ProbeBody { status: number; text: string; contentType: string }

function tauriInvoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<string>) | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<string> } }
  return w.__TAURI_INTERNALS__?.invoke
}

interface FetchProbeBodyOptions { timeoutMs: number; signal?: AbortSignal; range?: string; maxBytes?: number }

/** 取一条地址的正文（带状态码与 Content-Type），读不到返回 null。
 * 桌面：Rust plugin_http_media（invoke 不可 abort，超时竞速后忽略迟到结果）；
 * 安卓：CapacitorHttp（原生栈，无 CORS 限制）；网页：CORS fetch，正文分块
 * 读、到 maxBytes 即取消，防大文件拖垮。302 由本侧手动跟（原生通道不自动
 * 跟重定向），最多 HEALTH_PROBE_MAX_REDIRECTS 跳，每跳重新过服务端校验。 */
export async function fetchProbeBody(url: string, opts: FetchProbeBodyOptions): Promise<ProbeBody | null> {
  const headers: Record<string, string> = { Accept: '*/*', 'User-Agent': PROBE_UA }
  if (opts.range) headers['Range'] = opts.range
  let current = url
  for (let hop = 0; hop <= HEALTH_PROBE_MAX_REDIRECTS; hop++) {
    const r = await fetchProbeBodyOnce(current, { ...opts, headers })
    if (!r) return null
    if (r.status >= 300 && r.status < 400) {
      const loc = r.location
      if (loc && hop < HEALTH_PROBE_MAX_REDIRECTS) {
        try { current = new URL(loc, current).toString() } catch { return r }
        continue
      }
    }
    return r
  }
  return null
}

async function fetchProbeBodyOnce(url: string, opts: FetchProbeBodyOptions & { headers: Record<string, string> }): Promise<(ProbeBody & { location?: string }) | null> {
  const invoke = tauriInvoke()
  if (invoke) {
    try {
      const raw = await Promise.race([
        invoke('plugin_http_media', { url, headersJson: JSON.stringify(opts.headers) }),
        new Promise<null>(res => globalThis.setTimeout(() => res(null), opts.timeoutMs)),
      ])
      if (raw != null) {
        const parsed = JSON.parse(raw) as { status: number; body: string; headers?: Record<string, string> }
        const headers = parsed.headers ?? {}
        const locKey = Object.keys(headers).find(k => k.toLowerCase() === 'location')
        return { status: parsed.status, text: parsed.body ?? '', contentType: headers['content-type'] ?? headers['Content-Type'] ?? '', location: locKey ? headers[locKey] : undefined }
      }
      // 原生通道超时：往下走 CORS fetch（原生请求可能仍在后台跑，忽略迟到结果）
    } catch { /* 原生通道失败 → 往下走 CORS fetch */ }
  }
  if (isNativeApp()) {
    try {
      const { CapacitorHttp } = await import('@capacitor/core')
      const res = await CapacitorHttp.request({ url, method: 'GET', headers: opts.headers, responseType: 'text' })
      const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
      const headers = (res.headers ?? {}) as Record<string, string>
      const locKey = Object.keys(headers).find(k => k.toLowerCase() === 'location')
      return { status: res.status, text: text.slice(0, HEALTH_PROBE_BODY_CAP), contentType: headers['content-type'] ?? headers['Content-Type'] ?? '', location: locKey ? headers[locKey] : undefined }
    } catch { /* 往下走 CORS fetch */ }
  }
  try {
    return await fetchProbeBodyWeb(url, opts)
  } catch {
    return null
  }
}

async function fetchProbeBodyWeb(url: string, opts: FetchProbeBodyOptions & { headers: Record<string, string> }): Promise<(ProbeBody & { location?: string }) | null> {
  const ctrl = new AbortController()
  const timer = globalThis.setTimeout(() => ctrl.abort(), opts.timeoutMs)
  const onAbort = () => ctrl.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    // 网页 fetch 不发 Range（会触发 CORS 预分配预检、多数流服务器不放行）：
    // 直链文件改用分块读、读到 maxBytes 即取消，同样只验头。
    const res = await fetch(url, { headers: { Accept: '*/*' }, signal: ctrl.signal })
    if (typeof res.status !== 'number') throw new TypeError('响应异常')
    const contentType = res.headers?.get?.('content-type') ?? ''
    const maxBytes = opts.maxBytes ?? HEALTH_PROBE_BODY_CAP
    if (typeof res.text === 'function' && !res.body) {
      return { status: res.status, text: (await res.text()).slice(0, maxBytes), contentType }
    }
    const reader = res.body?.getReader()
    if (!reader) return { status: res.status, text: '', contentType }
    const chunks: Uint8Array[] = []
    let received = 0
    try {
      for (;;) {
        if (received >= maxBytes) break
        const { done, value } = await reader.read()
        if (done) break
        if (value) { chunks.push(value); received += value.length }
      }
    } finally {
      try { await reader.cancel() } catch { /* 忽略 */ }
    }
    let total = 0
    for (const c of chunks) total += c.length
    const buf = new Uint8Array(Math.min(total, maxBytes))
    let off = 0
    for (const c of chunks) {
      const take = Math.min(c.length, buf.length - off)
      if (take <= 0) break
      buf.set(c.subarray(0, take), off)
      off += take
    }
    return { status: res.status, text: new TextDecoder().decode(buf), contentType }
  } finally {
    globalThis.clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/** 旧连通性探测（v0.1.391 原样保留，只作网页 CORS 读不到正文时的退路）：
 * fetch(mode: 'no-cors') 发一个 GET，响应头一到就算通，不等正文。 */
export async function probeConnectivity(url: string, timeoutMs = HEALTH_PROBE_TIMEOUT_MS, signal?: AbortSignal): Promise<{ ok: boolean; ms: number; reason?: string }> {
  if (!/^https?:\/\//.test(url)) return { ok: false, ms: 0, reason: '地址不是 http(s)' }
  if (signal?.aborted) return { ok: false, ms: 0, reason: '已取消' }
  const ctrl = new AbortController()
  const timer = globalThis.setTimeout(() => ctrl.abort(), timeoutMs)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const t0 = Date.now()
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
    return { ok: true, ms: Math.max(1, Date.now() - t0) }
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return { ok: false, ms: Date.now() - t0, reason: '超时' }
    return { ok: false, ms: Date.now() - t0, reason: '网络错误' }
  } finally {
    globalThis.clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    try { ctrl.abort() } catch { /* 忽略 */ }
  }
}

function resolveUrl(rel: string, base: string): string {
  try { return new URL(rel, base).toString() } catch { return rel }
}

/** 解析 m3u8 文本：主列表（#EXT-X-STREAM-INF → 变体地址）与分片（非 # 的裸行） */
export function parseM3u8Segments(text: string): { isMaster: boolean; variants: string[]; segments: string[] } {
  const lines = text.split(/\r?\n/).map(l => l.trim())
  let isMaster = false
  const variants: string[] = []
  const segments: string[] = []
  const variantLines = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      isMaster = true
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j]) continue
        if (!lines[j].startsWith('#')) { variants.push(lines[j]); variantLines.add(j) }
        break
      }
    } else if (!line.startsWith('#') && !variantLines.has(i)) {
      segments.push(line)
    }
  }
  return { isMaster, variants, segments }
}

/** 验第一个分片：Range 取头 1KB，200/206 且非空即算通；个别服务器拒 Range
 * （403/405/416）时不带 Range 重试一次；正文读不到（跨域）时不判死，
 * 只记“仅验到播放列表”，由调用方标 verified: false。 */
async function verifyFirstSegment(segUrl: string, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; reason?: string; unverified?: boolean }> {
  const rangeBody = await fetchProbeBody(segUrl, { timeoutMs, signal, range: 'bytes=0-1023', maxBytes: HEALTH_PROBE_HEAD_BYTES })
  if (!rangeBody) return { ok: true, unverified: true }
  if (rangeBody.status === 403 || rangeBody.status === 405 || rangeBody.status === 416) {
    const plain = await fetchProbeBody(segUrl, { timeoutMs, signal, maxBytes: HEALTH_PROBE_HEAD_BYTES })
    if (!plain) return { ok: true, unverified: true }
    if (plain.status >= 200 && plain.status < 300 && plain.text.length > 0) return { ok: true }
    return { ok: false, reason: `分片拉不到（HTTP ${plain.status}）` }
  }
  if (rangeBody.status < 200 || rangeBody.status >= 300) return { ok: false, reason: `分片拉不到（HTTP ${rangeBody.status}）` }
  if (rangeBody.text.length === 0) return { ok: false, reason: '分片是空的' }
  return { ok: true }
}

/** 验一段已取到的播放列表正文：主列表先拉变体；媒体列表须有分片且第一分片拉得到 */
async function verifyPlaylist(url: string, text: string, signal?: AbortSignal): Promise<{ ok: boolean; reason?: string; unverified?: boolean }> {
  const parsed = parseM3u8Segments(text)
  let playlistText = text
  let baseUrl = url
  if (parsed.isMaster) {
    if (!parsed.variants.length) return { ok: false, reason: '无有效分片' }
    const variantUrl = resolveUrl(parsed.variants[0], url)
    const vb = await fetchProbeBody(variantUrl, { timeoutMs: HEALTH_PROBE_SUB_TIMEOUT_MS, signal, maxBytes: HEALTH_PROBE_BODY_CAP })
    if (!vb) return { ok: true, unverified: true }
    if (vb.status < 200 || vb.status >= 300) return { ok: false, reason: `子播放列表拉不到（HTTP ${vb.status}）` }
    if (!vb.text.includes('#EXTM3U')) return { ok: false, reason: '子播放列表不是播放列表' }
    playlistText = vb.text
    baseUrl = variantUrl
  }
  const segs = parseM3u8Segments(playlistText).segments
  if (!segs.length) return { ok: false, reason: '无有效分片' }
  const first = segs[0]
  if (/\.m3u8?(\?|#|$)/i.test(first)) {
    // 嵌套子列表：再拉一层（只一层）
    const subUrl = resolveUrl(first, baseUrl)
    const sb = await fetchProbeBody(subUrl, { timeoutMs: HEALTH_PROBE_SUB_TIMEOUT_MS, signal, maxBytes: HEALTH_PROBE_BODY_CAP })
    if (!sb) return { ok: true, unverified: true }
    if (sb.status < 200 || sb.status >= 300 || !sb.text.includes('#EXTM3U') || !parseM3u8Segments(sb.text).segments.length) {
      return { ok: false, reason: '分片拉不到' }
    }
    return { ok: true }
  }
  return verifyFirstSegment(resolveUrl(first, baseUrl), HEALTH_PROBE_SUB_TIMEOUT_MS, signal)
}

export interface ProbeResult { ok: boolean; ms: number; reason?: string; verified?: boolean }

/** 真验流探针（v0.1.411）：拉取播放列表并验证其中有有效分片才算通。
 * 直链文件用 Range 取头验状态与非空。网页 CORS 读不到正文时退回连通性
 * 探测并标记 verified: false，不冒充验过。 */
export async function probeStreamUrl(url: string, timeoutMs = HEALTH_PROBE_TIMEOUT_MS, signal?: AbortSignal): Promise<ProbeResult> {
  if (!/^https?:\/\//.test(url)) return { ok: false, ms: 0, reason: '地址不是 http(s)', verified: true }
  if (signal?.aborted) return { ok: false, ms: 0, reason: '已取消', verified: false }
  const t0 = Date.now()
  const ms = () => Math.max(1, Date.now() - t0)
  const isFile = /\.(mp4|mkv|webm|mov|avi|flv|ts)(\?|#|$)/i.test(url)
  const body = await fetchProbeBody(url, {
    timeoutMs, signal,
    range: isFile ? 'bytes=0-1023' : undefined,
    maxBytes: isFile ? HEALTH_PROBE_HEAD_BYTES : HEALTH_PROBE_BODY_CAP,
  })
  if (!body) {
    // 读不到正文（浏览器跨域限制）：退回连通性探测，如实标记未验流
    const conn = await probeConnectivity(url, timeoutMs, signal)
    if (conn.ok) return { ok: true, ms: conn.ms, verified: false, reason: '仅测连通（浏览器跨域限制，未验流）' }
    return { ok: false, ms: conn.ms, verified: false, reason: conn.reason ?? '网络错误' }
  }
  if (body.status < 200 || body.status >= 300) return { ok: false, ms: ms(), verified: true, reason: `HTTP ${body.status}` }
  const ct = (body.contentType ?? '').toLowerCase()
  if (ct.includes('text/html')) return { ok: false, ms: ms(), verified: true, reason: '不是播放列表（返回了网页）' }
  const playlistLike = /\.m3u8?(\?|#|$)/i.test(url) || ct.includes('mpegurl')
  const text = body.text
  if (playlistLike || text.includes('#EXTM3U')) {
    if (text.trim().length === 0) return { ok: false, ms: ms(), verified: true, reason: '空列表' }
    if (!text.includes('#EXTM3U')) return { ok: false, ms: ms(), verified: true, reason: '不是播放列表' }
    const v = await verifyPlaylist(url, text, signal)
    if (!v.ok) return { ok: false, ms: ms(), verified: true, reason: v.reason ?? '无有效分片' }
    return { ok: true, ms: ms(), verified: !v.unverified, reason: v.unverified ? '仅验到播放列表' : undefined }
  }
  if (text.length === 0) return { ok: false, ms: ms(), verified: true, reason: '空文件' }
  return { ok: true, ms: ms(), verified: true }
}

/** 测一个台：按播放顺序逐条试地址，第一条通的即算通（播放器也是这个顺序换源）；
 * 全不通时 reason 记最后一条的失败原因 */
export async function probeChannel(ch: LiveChannel, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ChannelHealth> {
  let lastReason: string | undefined
  let lastVerified = false
  for (const u of ch.urls) {
    if (opts.signal?.aborted) break
    const r = await probeStreamUrl(u, opts.timeoutMs, opts.signal)
    if (r.ok) return { ok: true, ms: r.ms, at: Date.now(), url: u, verified: r.verified, reason: r.reason }
    lastReason = r.reason
    lastVerified = r.verified ?? false
  }
  return { ok: false, at: Date.now(), url: ch.urls[0] ?? '', reason: lastReason, verified: lastVerified }
}

export interface ProbeChannelsOptions {
  concurrency?: number
  timeoutMs?: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number, key: string, result: ChannelHealth) => void
}

/** 测一批台：限定并行数后台跑；中途取消时返回已测到的部分结果 */
export async function probeChannels(channels: LiveChannel[], opts: ProbeChannelsOptions = {}): Promise<HealthMap> {
  const concurrency = Math.max(1, opts.concurrency ?? HEALTH_PROBE_CONCURRENCY)
  const out: HealthMap = {}
  let next = 0
  let done = 0
  const workers = Array.from({ length: Math.min(concurrency, channels.length) }, async () => {
    for (;;) {
      if (opts.signal?.aborted) return
      const i = next++
      if (i >= channels.length) return
      const ch = channels[i]
      const r = await probeChannel(ch, { timeoutMs: opts.timeoutMs, signal: opts.signal })
      out[ch.key] = r
      done++
      opts.onProgress?.(done, channels.length, ch.key, r)
    }
  })
  await Promise.all(workers)
  return out
}

/** 某台的体检结果：缓存条目须对应当前频道的某条地址，否则是别的国家
 * 同名台的旧结果，不用（频道 key 只归一化了台名，不同国家可能重名）。 */
export function healthOf(health: HealthMap, ch: LiveChannel): ChannelHealth | undefined {
  const h = health[ch.key]
  if (!h) return undefined
  if (h.url && !ch.urls.includes(h.url)) return undefined
  return h
}

export function healthCounts(channels: LiveChannel[], health: HealthMap): { tested: number; ok: number; bad: number; unverified: number } {
  let tested = 0
  let ok = 0
  let unverified = 0
  for (const ch of channels) {
    const h = healthOf(health, ch)
    if (!h) continue
    tested++
    if (h.ok) ok++
    if (h.verified !== true) unverified++
  }
  return { tested, ok, bad: tested - ok, unverified }
}

/** 体检视图：只看已测通的（过滤）+ 快的排前面（通的按耗时升序，未测的
 * 居中，死的沉底；同组内保持原顺序，不二次打乱）。
 * v0.1.407 hideDead：体检后已测不通的台默认隐藏——只隐藏已测不通的，
 * 未测的台不受影响；设置页签「显示已测不通的台」开关可恢复显示。 */
export function applyHealthView(channels: LiveChannel[], health: HealthMap, opts: { onlyHealthy?: boolean; sortBySpeed?: boolean; hideDead?: boolean } = {}): LiveChannel[] {
  let list = channels
  if (opts.hideDead) list = list.filter(ch => healthOf(health, ch)?.ok !== false)
  if (opts.onlyHealthy) list = list.filter(ch => healthOf(health, ch)?.ok === true)
  if (opts.sortBySpeed) {
    const rank = (ch: LiveChannel): number => {
      const h = healthOf(health, ch)
      if (!h) return 1
      return h.ok ? 0 : 2
    }
    list = [...list].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      if (ra === 0) return (healthOf(health, a)?.ms ?? 0) - (healthOf(health, b)?.ms ?? 0)
      return 0
    })
  }
  return list
}

// ---------------- 点播体检（v0.1.407）：与直播体检同款探针（v0.1.411 起真验流） ----------------
// 一部点播可能多集、每集多线路：按集顺序、每集按线路顺序逐条试，第一条通的即算通
// （播放器也是这个顺序换源）。结果与直播共用同一缓存 acm.watch.health.v1，
// 键加 `vod:` 前缀，与直播台的键（归一化台名）不冲突。
export function vodHealthKey(v: VodTitle): string {
  return `vod:${v.key}`
}

/** 测一部点播：第一条通的线路即算通，记通的地址；全不通时 reason 记最后一条的失败原因 */
export async function probeVodTitle(v: VodTitle, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ChannelHealth> {
  let lastReason: string | undefined
  let lastVerified = false
  for (const ep of v.episodes) {
    for (const u of ep.urls) {
      if (opts.signal?.aborted) break
      const r = await probeStreamUrl(u, opts.timeoutMs, opts.signal)
      if (r.ok) return { ok: true, ms: r.ms, at: Date.now(), url: u, episode: ep.label, verified: r.verified, reason: r.reason }
      lastReason = r.reason
      lastVerified = r.verified ?? false
    }
    if (opts.signal?.aborted) break
  }
  return { ok: false, at: Date.now(), url: v.episodes[0]?.urls[0] ?? '', reason: lastReason, verified: lastVerified }
}

export interface ProbeVodTitlesOptions {
  concurrency?: number
  timeoutMs?: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number, key: string, result: ChannelHealth) => void
}

/** 测一批点播：限定并行数后台跑；中途取消时返回已测到的部分结果 */
export async function probeVodTitles(titles: VodTitle[], opts: ProbeVodTitlesOptions = {}): Promise<HealthMap> {
  const concurrency = Math.max(1, opts.concurrency ?? HEALTH_PROBE_CONCURRENCY)
  const out: HealthMap = {}
  let next = 0
  let done = 0
  const workers = Array.from({ length: Math.min(concurrency, titles.length) }, async () => {
    for (;;) {
      if (opts.signal?.aborted) return
      const i = next++
      if (i >= titles.length) return
      const v = titles[i]
      const r = await probeVodTitle(v, { timeoutMs: opts.timeoutMs, signal: opts.signal })
      out[vodHealthKey(v)] = r
      done++
      opts.onProgress?.(done, titles.length, vodHealthKey(v), r)
    }
  })
  await Promise.all(workers)
  return out
}

/** 某部点播的体检结果：缓存条目须是当前这部的某条线路地址，否则不用 */
export function vodHealthOf(health: HealthMap, v: VodTitle): ChannelHealth | undefined {
  const h = health[vodHealthKey(v)]
  if (!h) return undefined
  const urls = v.episodes.flatMap(e => e.urls)
  if (h.url && !urls.includes(h.url)) return undefined
  return h
}

export function vodHealthCounts(titles: VodTitle[], health: HealthMap): { tested: number; ok: number; bad: number; unverified: number } {
  let tested = 0
  let ok = 0
  let unverified = 0
  for (const v of titles) {
    const h = vodHealthOf(health, v)
    if (!h) continue
    tested++
    if (h.ok) ok++
    if (h.verified !== true) unverified++
  }
  return { tested, ok, bad: tested - ok, unverified }
}

/** 点播体检视图：默认隐藏已测不通的（hideDead，与直播 407 同款；只藏有源且
 * 已测不通的，未测的与没源只展示的都留着）+ 只看能播的（过滤）+ 快的排前面
 * （通的按耗时升序，未测的居中，死的沉底；同组内保持原顺序）。入参是海报墙
 * 条目（带可选 vod），没源只展示的条目按“未测”处理。 */
export function applyVodHealthView<T extends { vod?: VodTitle }>(items: T[], health: HealthMap, opts: { onlyHealthy?: boolean; sortBySpeed?: boolean; hideDead?: boolean } = {}): T[] {
  let list = items
  if (opts.hideDead) list = list.filter(it => !(it.vod && vodHealthOf(health, it.vod)?.ok === false))
  if (opts.onlyHealthy) list = list.filter(it => it.vod && vodHealthOf(health, it.vod)?.ok === true)
  if (opts.sortBySpeed) {
    const rank = (it: T): number => {
      if (!it.vod) return 1
      const h = vodHealthOf(health, it.vod)
      if (!h) return 1
      return h.ok ? 0 : 2
    }
    list = [...list].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      if (ra === 0 && a.vod && b.vod) return (vodHealthOf(health, a.vod)?.ms ?? 0) - (vodHealthOf(health, b.vod)?.ms ?? 0)
      return 0
    })
  }
  return list
}

// ---------------- 显示已测不通的台（v0.1.407）：设置开关，只存本机 ----------------
export const SHOW_DEAD_KEY = 'acm.watch.showDead.v1'

/** 默认关：体检后已测不通的台默认隐藏 */
export function loadShowDead(): boolean {
  try { return localStorage.getItem(SHOW_DEAD_KEY) === '1' } catch { return false }
}

export function saveShowDead(v: boolean): void {
  try { localStorage.setItem(SHOW_DEAD_KEY, v ? '1' : '0') } catch { /* 忽略 */ }
}

// ---------------- 显示已测不通的点播（v0.1.416）：与直播同款，只存本机 ----------------
export const SHOW_DEAD_VOD_KEY = 'acm.watch.showDeadVod.v1'

/** 默认关：体检后已测不通的点播默认从墙上隐藏 */
export function loadShowDeadVod(): boolean {
  try { return localStorage.getItem(SHOW_DEAD_VOD_KEY) === '1' } catch { return false }
}

export function saveShowDeadVod(v: boolean): void {
  try { localStorage.setItem(SHOW_DEAD_VOD_KEY, v ? '1' : '0') } catch { /* 忽略 */ }
}

// ---------------- 显示已测不通的资源站（v0.1.418）：与点播同款，只存本机 ----------------
export const SHOW_DEAD_SITES_KEY = 'acm.watch.showDeadSites.v1'

/** 默认关：测活后已测不通的站默认从站点列表隐藏 */
export function loadShowDeadSites(): boolean {
  try { return localStorage.getItem(SHOW_DEAD_SITES_KEY) === '1' } catch { return false }
}

export function saveShowDeadSites(v: boolean): void {
  try { localStorage.setItem(SHOW_DEAD_SITES_KEY, v ? '1' : '0') } catch { /* 忽略 */ }
}

// ---------------- 点播页可折叠区（v0.1.417）：TVBox 资源站 chips 行 + 筛选区，默认展开，只存本机 ----------------
export const VOD_TVBOX_COLLAPSED_KEY = 'acm.watch.vodTvboxCollapsed.v1'
export const VOD_FILTERS_COLLAPSED_KEY = 'acm.watch.vodFiltersCollapsed.v1'

/** 默认展开（false = 展开） */
export function loadVodTvboxCollapsed(): boolean {
  try { return localStorage.getItem(VOD_TVBOX_COLLAPSED_KEY) === '1' } catch { return false }
}

export function saveVodTvboxCollapsed(v: boolean): void {
  try { localStorage.setItem(VOD_TVBOX_COLLAPSED_KEY, v ? '1' : '0') } catch { /* 忽略 */ }
}

/** 默认展开（false = 展开） */
export function loadVodFiltersCollapsed(): boolean {
  try { return localStorage.getItem(VOD_FILTERS_COLLAPSED_KEY) === '1' } catch { return false }
}

export function saveVodFiltersCollapsed(v: boolean): void {
  try { localStorage.setItem(VOD_FILTERS_COLLAPSED_KEY, v ? '1' : '0') } catch { /* 忽略 */ }
}

// ---------------- 分组 ----------------

export interface LiveGroups {
  /** 中国：央视 / 卫视 / 其他；外国：按内容直接分组 */
  origins: { key: StationOrigin; label: string; channels: LiveChannel[] }[]
  /** 该国家/地区下出现过的内容分类（按 CONTENT_ORDER 排序） */
  contents: string[]
}

export function groupChannels(channels: LiveChannel[], country: string): LiveGroups {
  const contents = [...new Set(channels.map(c => c.content))]
    .sort((a, b) => (CONTENT_ORDER.indexOf(a) === -1 ? 99 : CONTENT_ORDER.indexOf(a)) - (CONTENT_ORDER.indexOf(b) === -1 ? 99 : CONTENT_ORDER.indexOf(b)))
  if (country === 'CN') {
    const byOrigin = (key: StationOrigin) => channels.filter(c => stationOrigin(c.name) === key)
    return {
      origins: (['cctv', 'satellite', 'other'] as StationOrigin[])
        .map(key => ({ key, label: ORIGIN_LABELS[key], channels: byOrigin(key) }))
        .filter(g => g.channels.length > 0),
      contents,
    }
  }
  return { origins: [{ key: 'other', label: '全部', channels }], contents }
}

/** v0.1.420：直播分组改横向 chips——按分组取台；'all' 不筛选、原顺序返回 */
export function filterOriginChannels(channels: LiveChannel[], key: 'all' | StationOrigin): LiveChannel[] {
  if (key === 'all') return channels
  return channels.filter(c => stationOrigin(c.name) === key)
}

// ---------------- 本机存储：片单 / 继续观看 ----------------

export type WatchType = 'tv' | 'movie' | 'short'
export interface WatchItem {
  id: string
  title: string
  type: WatchType
  platform: string
  platformUrl?: string
  poster?: string
  overview?: string
  /** 当前看到第几集（短剧/剧集） */
  episode?: number
  totalEpisodes?: number
  /** 下次更新/提醒日期 YYYY-MM-DD */
  nextDate?: string
  status: 'todo' | 'watching' | 'done'
  addedAt: number
}

export interface ContinueItem {
  id: string
  title: string
  platform: string
  kind: 'hls' | 'iframe' | 'vod'
  url: string
  episode?: string
  /** 0–1 播放进度（HLS/点播才有；iframe 记 0） */
  progress: number
  updatedAt: number
}

export const WATCHLIST_KEY = 'acm.watch.watchlist.v1'
export const CONTINUE_KEY = 'acm.watch.continue.v1'
export const TMDB_KEY = 'acm.watch.tmdb.v1'

export function loadWatchlist(): WatchItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? '[]')
    return Array.isArray(v) ? (v as WatchItem[]) : []
  } catch { return [] }
}

export function saveWatchlist(list: WatchItem[]): void {
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list.slice(0, 500))) } catch { /* 忽略 */ }
}

export function loadContinue(): ContinueItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(CONTINUE_KEY) ?? '[]')
    return Array.isArray(v) ? (v as ContinueItem[]) : []
  } catch { return [] }
}

export function saveContinue(list: ContinueItem[]): void {
  try { localStorage.setItem(CONTINUE_KEY, JSON.stringify(list.slice(0, 100))) } catch { /* 忽略 */ }
}

export function upsertContinue(item: ContinueItem): ContinueItem[] {
  const list = loadContinue().filter(x => x.id !== item.id)
  const next = [item, ...list].slice(0, 100)
  saveContinue(next)
  return next
}

// ---------------- TMDB（热门推荐）：Key 免费注册，加密存本机 ----------------

export async function saveTmdbKey(key: string, pwd: string): Promise<void> {
  const clean = key.trim()
  if (!clean) throw new Error('请先粘贴 TMDB API Key')
  if (!pwd) throw new Error('请先解锁保险箱，Key 要加密保存')
  const cipher = await encryptSecret(clean, pwd)
  try { localStorage.setItem(TMDB_KEY, JSON.stringify({ cipher })) } catch { /* 忽略 */ }
}

export function hasTmdbKey(): boolean {
  try { return !!JSON.parse(localStorage.getItem(TMDB_KEY) ?? 'null')?.cipher } catch { return false }
}

export async function loadTmdbKey(pwd: string): Promise<string | null> {
  try {
    const raw = JSON.parse(localStorage.getItem(TMDB_KEY) ?? 'null') as { cipher?: string } | null
    if (!raw?.cipher || !pwd) return null
    return await decryptSecret(raw.cipher, pwd)
  } catch { return null }
}

export function clearTmdbKey(): void {
  try { localStorage.removeItem(TMDB_KEY) } catch { /* 忽略 */ }
}

export interface TmdbTitle {
  id: number
  mediaType: 'tv' | 'movie'
  title: string
  originalTitle: string
  overview: string
  poster?: string
  firstDate?: string
  vote?: number
  /** v0.1.395 海报墙：搜索结果自带的分类/地区/热度（详情接口再补全） */
  genreIds?: number[]
  originCountry?: string[]
  originalLanguage?: string
  popularity?: number
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500'

interface TmdbApiItem {
  id?: number
  media_type?: string
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  overview?: string
  poster_path?: string | null
  first_air_date?: string
  release_date?: string
  vote_average?: number
  genre_ids?: number[]
  origin_country?: string[]
  original_language?: string
  popularity?: number
}

function toTmdbTitle(item: TmdbApiItem, fallbackType: 'tv' | 'movie'): TmdbTitle | null {
  if (!item?.id) return null
  const mediaType = item.media_type === 'movie' ? 'movie' : item.media_type === 'tv' ? 'tv' : fallbackType
  const title = item.title ?? item.name ?? ''
  if (!title) return null
  return {
    id: item.id,
    mediaType,
    title,
    originalTitle: item.original_title ?? item.original_name ?? '',
    overview: item.overview ?? '',
    poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : undefined,
    firstDate: item.first_air_date ?? item.release_date ?? undefined,
    vote: typeof item.vote_average === 'number' ? Math.round(item.vote_average * 10) / 10 : undefined,
    genreIds: Array.isArray(item.genre_ids) ? item.genre_ids : undefined,
    originCountry: Array.isArray(item.origin_country) ? item.origin_country : undefined,
    originalLanguage: item.original_language ?? undefined,
    popularity: typeof item.popularity === 'number' ? item.popularity : undefined,
  }
}

async function tmdbGet(key: string, path: string): Promise<unknown> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`https://api.themoviedb.org/3${path}${sep}api_key=${encodeURIComponent(key)}&language=zh-CN`)
  if (!res.ok) throw new Error(`TMDB 接口返回 ${res.status}（Key 无效或被限流时会出现）`)
  return res.json()
}

/** 热门范围（v0.1.394 推荐设置）：本周热门 / 今日热门 / 高分精选 */
export type TrendRange = 'week' | 'day' | 'top'

/** 热门榜单：剧集 + 电影各 20 条（需 Key；无 Key 时调用方直接不请求）
 *  range 省略时默认 'week'（老行为不变）；'day' 走 trending/day；
 *  'top' 走 discover 按评分倒序（vote_count ≥ 300，避免冷门高分刷榜） */
export async function fetchTmdbTrending(key: string, range: TrendRange = 'week'): Promise<TmdbTitle[]> {
  const [tv, movie] = await Promise.all(
    range === 'top'
      ? [tmdbGet(key, '/discover/tv?sort_by=vote_average.desc&vote_count.gte=300'), tmdbGet(key, '/discover/movie?sort_by=vote_average.desc&vote_count.gte=300')]
      : [tmdbGet(key, `/trending/tv/${range}`), tmdbGet(key, `/trending/movie/${range}`)],
  )
  const items = [
    ...(((tv as { results?: TmdbApiItem[] }).results ?? []).map(i => toTmdbTitle(i, 'tv'))),
    ...(((movie as { results?: TmdbApiItem[] }).results ?? []).map(i => toTmdbTitle(i, 'movie'))),
  ]
  return items.filter((x): x is TmdbTitle => !!x).slice(0, 40)
}

/** v0.1.406：点播墙是否需要自己拉 TMDB 热门榜单——打开点播页签、榜单为空、
 *  有 Key 且不在拉取中时拉一次；否则不拉（无 Key 时回落只有片名列表，与修前
 *  一致；榜单已有时不重复拉）。以前墙拼热门依赖热门推荐页签已加载的榜单数据，
 *  先开点播时 trending 为空，墙上 0 部仅展示。 */
export function shouldAutoLoadTrending(args: { activeTab: string; tmdbKeySet: boolean; trendingCount: number; loading: boolean }): boolean {
  return args.activeTab === 'vod' && args.tmdbKeySet && args.trendingCount === 0 && !args.loading
}

/** 推荐偏好（v0.1.394 设置页签「推荐设置」：热门范围 + 推荐类型），仅本机 */
export interface RecPrefs { range: TrendRange; type: 'all' | 'tv' | 'movie' }
export const REC_PREFS_KEY = 'acm.watch.recPrefs.v1'

export function loadRecPrefs(): RecPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(REC_PREFS_KEY) ?? 'null') as Partial<RecPrefs> | null
    return {
      range: v?.range === 'day' || v?.range === 'top' ? v.range : 'week',
      type: v?.type === 'tv' || v?.type === 'movie' ? v.type : 'all',
    }
  } catch { return { range: 'week', type: 'all' } }
}

export function saveRecPrefs(p: RecPrefs): void {
  try { localStorage.setItem(REC_PREFS_KEY, JSON.stringify(p)) } catch { /* 忽略 */ }
}

/** 某部剧/电影在中国区的正版播出平台（TMDB watch/providers） */
export async function fetchTmdbProviders(key: string, mediaType: 'tv' | 'movie', id: number): Promise<{ name: string; link: string }[]> {
  const data = await tmdbGet(key, `/${mediaType}/${id}/watch/providers`)
  const cn = (data as { results?: Record<string, { link?: string; flatrate?: { provider_name?: string }[]; rent?: { provider_name?: string }[]; buy?: { provider_name?: string }[] }> }).results?.CN
  if (!cn) return []
  const names = [...(cn.flatrate ?? []), ...(cn.rent ?? []), ...(cn.buy ?? [])]
    .map(p => p.provider_name ?? '')
    .filter(Boolean)
  return [...new Set(names)].map(name => ({ name, link: cn.link ?? `https://www.themoviedb.org/${mediaType}/${id}/watch?locale=CN` }))
}

// ---------------- 点播海报墙（v0.1.395） ----------------
// 墙 = 用户点播源里的片名（有源可播）+ TMDB 热门榜单里没匹配上片源的
// 影片（仅展示）：海报/标题/评分/简介走 TMDB，播放永远走他自己的点播源
// （m3u），没源的片子只展示不能播。TMDB 没有的片名（如自制 m3u 里的
// 冷门条目）只显示片名卡片，不编造海报与评分。

/** 片名归一化：去空格与标点、转小写，供点播标题与 TMDB 标题匹配 */
export function normalizeTitleKey(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[\s\-_·•・:：，,。.!！?？'"'""''()（）\[\]【】]/g, '')
}

/** TMDB 国家码 → 墙上的地区（production_countries / origin_country 都用这张表） */
export function regionLabelOfCountry(code?: string): string | undefined {
  switch ((code ?? '').toUpperCase()) {
    case 'CN': return '大陆'
    case 'HK': return '香港'
    case 'TW': return '台湾'
    case 'US': return '美国'
    case 'JP': return '日本'
    case 'KR': return '韩国'
    case 'GB': return '英国'
    default: return undefined
  }
}

export const WALL_GENRES = ['全部', '动作', '喜剧', '爱情', '科幻', '恐怖', '剧情', '战争', '惊悚', '犯罪', '冒险', '动画', '悬疑', '武侠', '奇幻', '纪录片']
export const WALL_YEARS = ['全部', '2024', '2023', '2022', '2021', '更早']
export const WALL_REGIONS = ['全部', '大陆', '香港', '台湾', '美国', '日本', '韩国', '英国', '其他']
export const WALL_STATUS_FILTERS = [
  { k: 'all', t: '全部' },
  { k: 'play', t: '有源可播' },
  { k: 'up', t: '更新中' },
  { k: 'done', t: '已完结' },
  { k: 'none', t: '仅展示' },
] as const
export type VodWallStatusFilter = (typeof WALL_STATUS_FILTERS)[number]['k']
export type VodWallSort = 'updated' | 'rating' | 'year'

/** TMDB 类型名（zh-CN）→ 墙上的 16 类。TMDB 没有「武侠」这个类型：
 * 家庭/历史/音乐/电视电影归剧情，西部归动作；武侠另算（见 mapGenreNames）。 */
const WALL_GENRE_MAP: Record<string, string> = {
  '动作': '动作', '冒险': '冒险', '动画': '动画', '喜剧': '喜剧', '犯罪': '犯罪',
  '纪录片': '纪录片', '剧情': '剧情', '奇幻': '奇幻', '恐怖': '恐怖', '悬疑': '悬疑',
  '爱情': '爱情', '科幻': '科幻', '惊悚': '惊悚', '战争': '战争',
  '家庭': '剧情', '历史': '剧情', '音乐': '剧情', '电视电影': '剧情', '西部': '动作',
}

/** TMDB 类型名列表 → 墙上的类型（按 WALL_GENRES 顺序排）；
 * 中文原声的动作片多一个「武侠」（TMDB 不分武侠，华语动作片多为武侠/功夫片，
 * 只是启发式，筛「武侠」时相当于“华语动作”）。 */
export function mapGenreNames(names: string[], originalLanguage?: string): string[] {
  const out = new Set<string>()
  for (const n of names) {
    const m = WALL_GENRE_MAP[n]
    if (m) out.add(m)
  }
  if (originalLanguage === 'zh' && out.has('动作')) out.add('武侠')
  return WALL_GENRES.filter(g => g !== '全部' && out.has(g))
}

// ---------------- TMDB 类型列表（缓存永久，类型表基本不变） ----------------

export interface TmdbGenreMap { movie: Record<number, string>; tv: Record<number, string> }
export const TMDB_GENRES_KEY = 'acm.watch.tmdbGenres.v1'

export async function fetchTmdbGenres(key: string): Promise<TmdbGenreMap> {
  try {
    const raw = JSON.parse(localStorage.getItem(TMDB_GENRES_KEY) ?? 'null') as { data?: TmdbGenreMap } | null
    if (raw?.data?.movie && raw?.data?.tv) return raw.data
  } catch { /* 缓存坏了就重新拉 */ }
  const [movie, tv] = await Promise.all([
    tmdbGet(key, '/genre/movie/list'),
    tmdbGet(key, '/genre/tv/list'),
  ])
  const toMap = (d: unknown): Record<number, string> => {
    const out: Record<number, string> = {}
    for (const g of ((d as { genres?: { id?: number; name?: string }[] }).genres ?? [])) {
      if (typeof g.id === 'number' && g.name) out[g.id] = g.name
    }
    return out
  }
  const data: TmdbGenreMap = { movie: toMap(movie), tv: toMap(tv) }
  try { localStorage.setItem(TMDB_GENRES_KEY, JSON.stringify({ at: Date.now(), data })) } catch { /* 忽略 */ }
  return data
}

// ---------------- TMDB 按片名搜索（点播标题 → TMDB 元数据，缓存 7 天） ----------------

export const TMDB_TITLE_SEARCH_KEY = 'acm.watch.tmdbTitleSearch.v1'
const TMDB_TITLE_SEARCH_TTL_MS = 7 * 24 * 3600_000

interface TitleSearchCacheEntry { at: number; tmdb: TmdbTitle | null }
type TitleSearchCache = Record<string, TitleSearchCacheEntry>

function loadTitleSearchCache(): TitleSearchCache {
  try {
    const v = JSON.parse(localStorage.getItem(TMDB_TITLE_SEARCH_KEY) ?? '{}') as TitleSearchCache
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

/** 按片名在 TMDB 搜电影 + 剧集：先认标题完全一致的，再按热度取最高；
 * 搜不到也缓存（7 天内不再重复问 TMDB）。 */
export async function searchTmdbTitle(key: string, title: string): Promise<TmdbTitle | null> {
  const q = (title ?? '').trim()
  if (!q) return null
  const cacheKey = normalizeTitleKey(q)
  const hit = loadTitleSearchCache()[cacheKey]
  if (hit && Date.now() - hit.at < TMDB_TITLE_SEARCH_TTL_MS) return hit.tmdb
  const [movie, tv] = await Promise.all([
    tmdbGet(key, `/search/movie?query=${encodeURIComponent(q)}`),
    tmdbGet(key, `/search/tv?query=${encodeURIComponent(q)}`),
  ])
  const cands = [
    ...(((movie as { results?: TmdbApiItem[] }).results ?? []).map(i => toTmdbTitle(i, 'movie'))),
    ...(((tv as { results?: TmdbApiItem[] }).results ?? []).map(i => toTmdbTitle(i, 'tv'))),
  ].filter((x): x is TmdbTitle => !!x)
  const exact = cands.find(c => normalizeTitleKey(c.title) === cacheKey || normalizeTitleKey(c.originalTitle) === cacheKey)
  const best = exact ?? cands.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0] ?? null
  const cache = loadTitleSearchCache()
  cache[cacheKey] = { at: Date.now(), tmdb: best }
  try { localStorage.setItem(TMDB_TITLE_SEARCH_KEY, JSON.stringify(cache)) } catch { /* 忽略 */ }
  return best
}

// ---------------- TMDB 详情（类型/地区/状态/导演主演，缓存 24 小时） ----------------

export interface TmdbDetails {
  genres: string[]
  region?: string
  /** 剧集才有：up 更新中 / done 已完结；电影不填 */
  status?: 'up' | 'done'
  /** 剧集总集数（TMDB 口径）；更新中时即当前已播集数 */
  episodes?: number
  /** 最近播出日期（剧集 last_air_date，电影上映日），供「最近更新」排序 */
  lastDate?: string
  director?: string
  cast?: string
}

export const TMDB_DETAILS_KEY = 'acm.watch.tmdbDetails.v1'
const TMDB_DETAILS_TTL_MS = 24 * 3600_000

interface TmdbDetailsCacheEntry { at: number; details: TmdbDetails }
type TmdbDetailsCache = Record<string, TmdbDetailsCacheEntry>

function loadDetailsCache(): TmdbDetailsCache {
  try {
    const v = JSON.parse(localStorage.getItem(TMDB_DETAILS_KEY) ?? '{}') as TmdbDetailsCache
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

/** 一部影片的详情：类型、地区（production_countries 首个，剧集回落 origin_country）、
 * 剧集状态与集数、导演与前三主演（append_to_response=credits，一次调用）。 */
export async function fetchTmdbDetails(key: string, mediaType: 'tv' | 'movie', id: number): Promise<TmdbDetails> {
  const cacheKey = `${mediaType}:${id}`
  const hit = loadDetailsCache()[cacheKey]
  if (hit && Date.now() - hit.at < TMDB_DETAILS_TTL_MS) return hit.details
  const d = await tmdbGet(key, `/${mediaType}/${id}?append_to_response=credits`) as {
    genres?: { name?: string }[]
    production_countries?: { iso_3166_1?: string }[]
    origin_country?: string[]
    status?: string
    number_of_episodes?: number
    last_air_date?: string
    release_date?: string
    credits?: { crew?: { job?: string; name?: string }[]; cast?: { name?: string }[] }
  }
  const genres = (d.genres ?? []).map(g => g.name ?? '').filter(Boolean)
  const region = regionLabelOfCountry(d.production_countries?.[0]?.iso_3166_1)
    ?? regionLabelOfCountry(d.origin_country?.[0])
    ?? (d.production_countries?.length || d.origin_country?.length ? '其他' : undefined)
  const details: TmdbDetails = {
    genres,
    region,
    status: mediaType === 'tv'
      ? d.status === 'Ended' || d.status === 'Canceled' ? 'done'
        : d.status === 'Returning Series' || d.status === 'In Production' ? 'up' : undefined
      : undefined,
    episodes: typeof d.number_of_episodes === 'number' ? d.number_of_episodes : undefined,
    lastDate: d.last_air_date ?? d.release_date ?? undefined,
    director: d.credits?.crew?.find(c => c.job === 'Director')?.name ?? undefined,
    cast: (d.credits?.cast ?? []).slice(0, 3).map(c => c.name ?? '').filter(Boolean).join('、') || undefined,
  }
  const cache = loadDetailsCache()
  cache[cacheKey] = { at: Date.now(), details }
  try { localStorage.setItem(TMDB_DETAILS_KEY, JSON.stringify(cache)) } catch { /* 忽略 */ }
  return details
}

// ---------------- 海报墙：拼墙 / 筛选 / 排序 / 角标 ----------------

export interface VodEnrichEntry {
  tmdb?: TmdbTitle
  details?: TmdbDetails
  /** 该标题已按片名搜过 TMDB（搜不到也算，避免对冷门片名反复搜、提示常驻） */
  searched?: boolean
  /** 该片的详情已拉过（失败也算，避免反复拉、提示常驻） */
  detailsTried?: boolean
}

export interface VodWallItem {
  id: string
  title: string
  kind: 'movie' | 'series'
  playable: boolean
  /** 有源时：全部集的播放地址总数（卡片上写“有源 · N 条线路可播”） */
  sourceCount: number
  vod?: VodTitle
  tmdb?: TmdbTitle
  details?: TmdbDetails
  year?: number
  genres: string[]
  region?: string
  vote?: number
  overview?: string
  poster?: string
  /** 电影永远 'hd'；剧集有 TMDB 状态才分 up/done，否则 'unknown'（不谎称完结） */
  status: 'hd' | 'up' | 'done' | 'unknown'
  totalEps?: number
  curEp?: number
  lastDate?: string
}

/** 拼墙：点播标题全进墙（有源可播），热门榜单里没匹配上片源的也进墙
 * （仅展示）；同名（归一化后）只留一部，点播优先。 */
export function buildVodWallItems(
  vod: VodTitle[],
  trending: TmdbTitle[],
  enrich: Record<string, VodEnrichEntry>,
  genreMap: TmdbGenreMap | null,
): VodWallItem[] {
  const items: VodWallItem[] = []
  const seen = new Set<string>()
  const trendingByKey = new Map(trending.map(t => [normalizeTitleKey(t.title), t]))
  const wallGenres = (tmdb: TmdbTitle | undefined, details: TmdbDetails | undefined): string[] => {
    if (details) return mapGenreNames(details.genres, tmdb?.originalLanguage)
    if (!tmdb?.genreIds?.length || !genreMap) return []
    const names = tmdb.genreIds
      .map(id => (tmdb.mediaType === 'tv' ? genreMap.tv[id] : genreMap.movie[id]) ?? '')
      .filter(Boolean)
    return mapGenreNames(names, tmdb.originalLanguage)
  }
  const fromTmdb = (tmdb: TmdbTitle, vodTitle?: VodTitle): VodWallItem => {
    const details = enrich[normalizeTitleKey(vodTitle?.title ?? tmdb.title)]?.details
    const isSeries = vodTitle ? vodTitle.kind === 'series' : tmdb.mediaType === 'tv'
    const year = tmdb.firstDate ? parseInt(tmdb.firstDate.slice(0, 4), 10) : undefined
    return {
      id: `tmdb:${tmdb.mediaType}:${tmdb.id}`,
      title: vodTitle?.title ?? tmdb.title,
      kind: isSeries ? 'series' : 'movie',
      playable: !!vodTitle,
      sourceCount: vodTitle ? vodTitle.episodes.reduce((n, e) => n + e.urls.length, 0) : 0,
      vod: vodTitle,
      tmdb,
      details,
      year: Number.isFinite(year) ? year : undefined,
      genres: wallGenres(tmdb, details),
      region: details?.region ?? (tmdb.mediaType === 'tv' ? regionLabelOfCountry(tmdb.originCountry?.[0]) : undefined),
      vote: tmdb.vote,
      overview: tmdb.overview || undefined,
      poster: tmdb.poster,
      status: !isSeries ? 'hd' : details?.status ?? 'unknown',
      totalEps: details?.episodes ?? (vodTitle && isSeries ? vodTitle.episodes.length : undefined),
      curEp: details?.status === 'up' ? details.episodes : undefined,
      lastDate: details?.lastDate ?? tmdb.firstDate,
    }
  }
  const fromVodOnly = (v: VodTitle, details?: TmdbDetails): VodWallItem => ({
    id: `vod:${v.key}`,
    title: v.title,
    kind: v.kind,
    playable: true,
    sourceCount: v.episodes.reduce((n, e) => n + e.urls.length, 0),
    vod: v,
    details,
    genres: details ? mapGenreNames(details.genres) : [],
    region: details?.region,
    status: v.kind === 'movie' ? 'hd' : details?.status ?? 'unknown',
    totalEps: details?.episodes ?? (v.kind === 'series' ? v.episodes.length : undefined),
    curEp: details?.status === 'up' ? details.episodes : undefined,
    lastDate: details?.lastDate,
  })
  for (const v of vod) {
    const key = normalizeTitleKey(v.title)
    const entry = enrich[key]
    // 点播标题的 TMDB 元数据：先用按片名搜到的，再用热门榜单里同名的
    const tmdb = entry?.tmdb ?? trendingByKey.get(key)
    items.push(tmdb ? fromTmdb(tmdb, v) : fromVodOnly(v, entry?.details))
    seen.add(key)
  }
  for (const t of trending) {
    const k = normalizeTitleKey(t.title)
    if (seen.has(k)) continue
    seen.add(k)
    items.push(fromTmdb(t))
  }
  return items
}

export interface VodWallFilters { genre: string; year: string; region: string; status: VodWallStatusFilter }

/** 筛选：没 TMDB 元数据的影片（类型/年份/地区未知）只在对应项为「全部」时出现，
 * 不因缺数据被筛掉；状态筛只看有源/更新状态，与元数据无关。 */
export function filterVodWall(items: VodWallItem[], f: VodWallFilters): VodWallItem[] {
  return items.filter(it => {
    if (f.genre !== '全部' && !it.genres.includes(f.genre)) return false
    if (f.year !== '全部') {
      if (!it.year) return false
      if (f.year === '更早') { if (it.year >= 2021) return false }
      else if (String(it.year) !== f.year) return false
    }
    if (f.region !== '全部') {
      if (!it.region) return false
      if (f.region === '其他') { if (it.region !== '其他') return false }
      else if (it.region !== f.region) return false
    }
    if (f.status === 'play' && !it.playable) return false
    if (f.status === 'none' && it.playable) return false
    if (f.status === 'up' && !(it.kind === 'series' && it.status === 'up')) return false
    if (f.status === 'done' && !(it.kind === 'series' && it.status === 'done')) return false
    return true
  })
}

/** 排序：最近更新按最近播出/上映日倒序（没日期的沉底）；评分最高；年份最新。 */
export function sortVodWall(items: VodWallItem[], sort: VodWallSort): VodWallItem[] {
  const list = [...items]
  if (sort === 'rating') list.sort((a, b) => (b.vote ?? -1) - (a.vote ?? -1))
  else if (sort === 'year') list.sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || (b.vote ?? -1) - (a.vote ?? -1))
  else list.sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || (b.vote ?? -1) - (a.vote ?? -1))
  return list
}

/** 卡片左上角标：电影「更新HD」；剧集更新中「更新至N集」/已完结「全N集·完结」；
 * 没 TMDB 状态的剧集只写「共N集」，不谎称完结；没集数的剧集不打标。 */
export function vodWallBadge(item: VodWallItem): { cls: 'hd' | 'up' | 'done' | 'plain'; text: string } | null {
  if (item.kind === 'movie') return { cls: 'hd', text: '更新HD' }
  if (item.status === 'up') return { cls: 'up', text: item.curEp ? `更新至${item.curEp}集` : '更新中' }
  if (item.status === 'done') return { cls: 'done', text: item.totalEps ? `全${item.totalEps}集 · 完结` : '已完结' }
  if (item.totalEps) return { cls: 'plain', text: `共${item.totalEps}集` }
  return null
}

// ---------------- TVBox 点播源（v0.1.408） ----------------
// TVBox 配置（影视仓 / OK影视用的 .json）里是站点接口列表，不是 m3u：
// 自定义源框按 m3u 解析读不到任何条目（Ethan 从 ngo5/IPTV 仓库拿的点播
// 源就是这种，粘进去墙里只剩热门推荐）。408 解析它：
//   type 0/1 = 苹果 CMS 资源站（api.php/provide/vod），直接接，拉
//     ?ac=videolist&pg=N 的片单进点播墙；
//   type 3 = 爬虫站（drpy JS / Python 规则）：要跑代码，App 没有爬虫
//     引擎，接不了——解析时跳过，并告诉用户跳了多少个及原因；
//   type 4 = 聚合站（api 是自定义聚合接口，不是 CMS）：同样接不了，跳过。
// 这类源本身不稳定易失效：拉不到/解析失败都明确写中文原因，不静默兜底。
// parses（解析接口）与 lives（直播源）不在 408 范围内，不动。

export interface TvboxSite {
  key: string
  name: string
  /** 0 = XML CMS，1 = JSON CMS，3 = 爬虫站，4 = 聚合站 */
  type: number
  api: string
  ext?: string
}

export interface TvboxParseResult {
  /** 去重后的站点总数 */
  total: number
  /** 可直接接的资源站（type 0/1 且 api 为 http(s)） */
  usable: TvboxSite[]
  /** 跳过的爬虫站（type 3）数 */
  skippedSpider: number
  /** 跳过的其他类型（type 4、缺 api、未知 type 等）数 */
  skippedOther: number
  error?: string
}

const TVBOX_MAX_SITES = 1000

/** 解析 TVBox 配置文本：接受 { sites: [...] } 或裸数组；按 key 去重 */
export function parseTvboxConfig(text: string): TvboxParseResult {
  const empty: TvboxParseResult = { total: 0, usable: [], skippedSpider: 0, skippedOther: 0 }
  const t = (text ?? '').trim()
  if (!t) return { ...empty, error: '配置是空的' }
  let data: unknown
  try { data = JSON.parse(t) } catch { return { ...empty, error: '这不是 TVBox 配置：JSON 解析失败' } }
  const rawSites = Array.isArray(data) ? data : (data as { sites?: unknown })?.sites
  if (!Array.isArray(rawSites)) return { ...empty, error: '这不是 TVBox 配置：里面没有 sites 站点列表' }
  const seen = new Set<string>()
  const usable: TvboxSite[] = []
  let skippedSpider = 0
  let skippedOther = 0
  for (const raw of rawSites) {
    if (!raw || typeof raw !== 'object') { skippedOther++; continue }
    const r = raw as Record<string, unknown>
    const key = String(r.key ?? r.name ?? '').trim()
    const name = String(r.name ?? r.key ?? '').trim() || key || '未命名'
    const type = Number(r.type)
    const api = String(r.api ?? '').trim()
    if (!key || seen.has(key)) { if (!key) skippedOther++; continue } // 重复 key 静默去重，不算跳过
    seen.add(key)
    if (type === 3) { skippedSpider++; continue }
    if ((type !== 0 && type !== 1) || !/^https?:\/\//.test(api)) { skippedOther++; continue }
    if (usable.length >= TVBOX_MAX_SITES) { skippedOther++; continue }
    usable.push({ key, name, type, api, ext: typeof r.ext === 'string' && r.ext ? r.ext : undefined })
  }
  return { total: seen.size, usable, skippedSpider, skippedOther }
}

/** 一段文本是不是 TVBox 配置（供 m3u 输入框守门：粘了 .json 配置时提示
 * 去 TVBox 区，别当 m3u 存了又拉不到） */
export function isTvboxConfigText(text: string): boolean {
  try {
    const data = JSON.parse((text ?? '').trim())
    const sites = Array.isArray(data) ? data : (data as { sites?: unknown })?.sites
    return Array.isArray(sites) && sites.length > 0
  } catch { return false }
}

// ---------------- 18+ 专区：成人站按站名归类（v0.1.408） ----------------
// TVBox JSON 本身没有 isAdult 标记，只能按站名关键词判断：名字起得隐晦
// 的会漏进普通区（Ethan 已知，先按这个做法）。不做成人过滤——不隐藏
// 单个成人站，成人站只是单独归到「18+」页签；页签显隐另由开关控制。
export const ADULT_SITE_KEYWORDS = [
  'porn', 'missav', 'madou', 'sex', 'avjoy', 'fourkav', 'korean', 'effedup',
  '成人', '禁果', '精仙', '绅士', '茄子', 'av', 'bj', '18', '2048', 'ko4',
  '93合1', '九合一', 'avbebe',
]

/** 站名是否像成人站：关键词按小写子串匹配（'av' 会命中 91AV、搜AV资源；
 * 名字里带 '18' 的（如 Korean18x）也算——这份名单里带 18 的站都是成人站） */
export function isAdultTvboxSite(site: TvboxSite): boolean {
  const name = (site.name ?? '').toLowerCase()
  return ADULT_SITE_KEYWORDS.some(k => name.includes(k.toLowerCase()))
}

// ---------------- TVBox 配置存储（只存本机） ----------------

export interface TvboxConfig {
  id: string
  label: string
  url: string
  addedAt: number
  /** 去重后的站点总数 */
  total: number
  /** 可直接接的资源站数 */
  usable: number
  skippedSpider: number
  skippedOther: number
  /** 可接资源站里的成人站数（归入 18+） */
  adultCount: number
  /** 可直接接的资源站列表（type 0/1） */
  sites: TvboxSite[]
}
export const TVBOX_CONFIGS_KEY = 'acm.watch.tvboxConfigs.v1'

export function loadTvboxConfigs(): TvboxConfig[] {
  try {
    const v = JSON.parse(localStorage.getItem(TVBOX_CONFIGS_KEY) ?? '[]')
    return Array.isArray(v) ? (v as TvboxConfig[]).filter(c => c?.url && Array.isArray(c.sites)) : []
  } catch { return [] }
}

export function saveTvboxConfigs(list: TvboxConfig[]): void {
  try { localStorage.setItem(TVBOX_CONFIGS_KEY, JSON.stringify(list)) } catch { /* 忽略 */ }
}

export interface TvboxConfigFetch {
  sites: TvboxSite[]
  total: number
  usable: number
  skippedSpider: number
  skippedOther: number
  adultCount: number
  error?: string
}

/** 拉一个 TVBox 配置地址并解析：只返回可接的资源站列表与统计 */
export async function fetchTvboxConfig(url: string): Promise<TvboxConfigFetch> {
  const fail = (error: string): TvboxConfigFetch => ({ sites: [], total: 0, usable: 0, skippedSpider: 0, skippedOther: 0, adultCount: 0, error })
  try {
    const text = await fetchTextWithTimeout(url, 20000)
    const r = parseTvboxConfig(text)
    if (r.error) return fail(r.error)
    return {
      sites: r.usable,
      total: r.total,
      usable: r.usable.length,
      skippedSpider: r.skippedSpider,
      skippedOther: r.skippedOther,
      adultCount: r.usable.filter(isAdultTvboxSite).length,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort|timeout|timed out/i.test(msg)) return fail('拉取超时（20 秒无响应）')
    if (/load failed|failed to fetch|networkerror/i.test(msg)) return fail('网络请求失败，可能被代理/网络拦截，请换个节点再试')
    if (/^HTTP \d+/.test(msg)) return fail(`配置地址返回 ${msg}（地址可能已失效）`)
    return fail(`拉取失败（${msg.slice(0, 60)}）`)
  }
}

// ---------------- 18+ 页签显隐开关（v0.1.408）：默认关，只存本机 ----------------
export const SHOW_ADULT_KEY = 'acm.watch.showAdult.v1'

/** 默认关：18+ 页签整个隐藏 */
export function loadShowAdult(): boolean {
  try { return localStorage.getItem(SHOW_ADULT_KEY) === '1' } catch { return false }
}

export function saveShowAdult(v: boolean): void {
  try { localStorage.setItem(SHOW_ADULT_KEY, v ? '1' : '0') } catch { /* 忽略 */ }
}

// ---------------- 悬浮播放器位置（v0.1.410）：拖动位置与最小化只存本机 ----------------
export const PLAYER_FLOAT_KEY = 'acm.watch.playerFloat.v1'

export interface PlayerFloatState {
  /** 视口相对的 left/top（px）；null = 没存过位置，用默认右下角 */
  x: number | null
  y: number | null
  minimized: boolean
}

export function loadPlayerFloat(): PlayerFloatState {
  try {
    const raw = localStorage.getItem(PLAYER_FLOAT_KEY)
    if (!raw) return { x: null, y: null, minimized: false }
    const o = JSON.parse(raw) as Partial<PlayerFloatState>
    return {
      x: typeof o.x === 'number' && Number.isFinite(o.x) ? o.x : null,
      y: typeof o.y === 'number' && Number.isFinite(o.y) ? o.y : null,
      minimized: o.minimized === true,
    }
  } catch { return { x: null, y: null, minimized: false } }
}

export function savePlayerFloat(s: PlayerFloatState): void {
  try { localStorage.setItem(PLAYER_FLOAT_KEY, JSON.stringify(s)) } catch { /* 忽略 */ }
}

/** 悬浮播放器限位：至少留 120px 宽与 48px 高的标题栏在视口内，拖不出去、也收不回来 */
export function clampPlayerFloat(x: number, y: number, vw: number, vh: number, w: number): { x: number; y: number } {
  const minX = -Math.max(0, w - 120)
  const maxX = Math.max(minX, vw - 120)
  const minY = 0
  const maxY = Math.max(0, vh - 48)
  return { x: Math.min(Math.max(x, minX), maxX), y: Math.min(Math.max(y, minY), maxY) }
}

// ---------------- 苹果 CMS 资源站（type 0/1） ----------------
// 协议：?ac=videolist&pg=N，type 1 返回 JSON，type 0 返回 XML（RSS）。
// vod_play_url 格式：多源用 $$$ 分隔，每源内多集用 # 分隔，每集
// "标签$地址"（电影常为"正片$地址"或"HD$地址"）；标签无 $ 时整段即地址。

export interface CmsVodItem {
  vod_name?: string
  vod_pic?: string
  vod_play_from?: string
  vod_play_url?: string
  vod_year?: string | number
  vod_area?: string
  vod_class?: string
}

/** 资源站片单地址：去掉原有查询串，补 ac=videolist&pg=N。
 * api 以 .php 结尾时直接拼 ?ac=…，否则先补 /（如 …/provide/vod/）。 */
export function cmsListUrl(api: string, page: number): string {
  const stripped = api.trim().split('?')[0]
  const base = /\.php$/i.test(stripped) ? stripped : `${stripped.replace(/\/+$/, '')}/`
  return `${base}?ac=videolist&pg=${page}`
}

/** play_url → 选集：多源用 $$$ 分隔，每源内多集用 # 分隔，每集
 * "标签$地址"（电影常为"正片$地址"或"HD$地址"）；标签无 $ 时整段即地址。
 * 同集多源合并；标签"第N集"认集号，"HD"/"BD"/"正片"/无标签都算正片
 * （episodeNo 0）。play_from 的源名不参与合并——同一集在不同源的标签
 * 写法可能不同（"第01集" vs "HD"），按集号合并更稳。 */
export function cmsPlayUrlToEpisodes(playUrl: string): VodEpisode[] {
  const groups = (playUrl || '').split('$$$')
  const byNo = new Map<number, VodEpisode>()
  for (const g of groups) {
    if (!g) continue
    for (const part of g.split('#')) {
      if (!part) continue
      const dollar = part.indexOf('$')
      const label = dollar >= 0 ? part.slice(0, dollar).trim() : ''
      const url = (dollar >= 0 ? part.slice(dollar + 1) : part).trim()
      if (!/^https?:\/\//.test(url)) continue
      const epNo = splitEpisode(label).episodeNo ?? 0
      const ep = byNo.get(epNo) ?? { label: '', urls: [], episodeNo: epNo, unofficial: false }
      if (!ep.urls.includes(url)) ep.urls.push(url)
      byNo.set(epNo, ep)
    }
  }
  const eps = [...byNo.values()]
  eps.sort((a, b) => {
    if (a.episodeNo && b.episodeNo) return a.episodeNo - b.episodeNo
    if (a.episodeNo) return -1
    if (b.episodeNo) return 1
    return 0
  })
  for (const e of eps) e.unofficial = e.urls.some(u => isUnofficialStreamUrl(u))
  return eps
}

/** 一条 CMS 影片 → 点播标题：无片名或无可用线路时返回 null；
 * 多集或带集号的算剧集，否则算电影。 */
export function cmsItemToVodTitle(item: CmsVodItem, sourceId: string): VodTitle | null {
  const title = (item.vod_name ?? '').trim()
  if (!title) return null
  const episodes = cmsPlayUrlToEpisodes(item.vod_play_url ?? '')
  if (!episodes.length) return null
  const isSeries = episodes.length > 1 || episodes.some(e => e.episodeNo > 0)
  episodes.forEach((e, i) => { e.label = isSeries ? `第 ${e.episodeNo || i + 1} 集` : '正片' })
  return {
    key: title.toLowerCase(), title, kind: isSeries ? 'series' : 'movie',
    episodes, logo: item.vod_pic || undefined, sourceIds: [sourceId],
    unofficial: episodes.some(e => e.unofficial),
  }
}

export interface CmsListResult { titles: VodTitle[]; total: number; pageCount: number; error?: string }

/** 解析 CMS JSON 片单：code 非 1 时按资源站拒绝处理；list 缺失时报格式错 */
export function parseCmsJsonList(data: unknown, sourceId: string): CmsListResult {
  const d = (data ?? {}) as { code?: number; msg?: string; total?: number; pagecount?: number; list?: unknown[] }
  if (typeof d.code === 'number' && d.code !== 1) {
    return { titles: [], total: 0, pageCount: 0, error: `资源站拒绝了请求${d.msg ? `（${d.msg}）` : ''}` }
  }
  if (!Array.isArray(d.list)) {
    return { titles: [], total: 0, pageCount: 0, error: '资源站返回的不是标准苹果 CMS 数据' }
  }
  const titles = (d.list as CmsVodItem[])
    .map(it => cmsItemToVodTitle(it, sourceId))
    .filter((t): t is VodTitle => !!t)
  return {
    titles,
    total: typeof d.total === 'number' ? d.total : titles.length,
    pageCount: typeof d.pagecount === 'number' && d.pagecount > 0 ? d.pagecount : 1,
  }
}

function xmlTag(block: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
  if (!m) return ''
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

/** 解析 CMS XML 片单（RSS）：<video> 块 + <dd> 线路；CDATA 照常剥掉。
 * 没有 <video> 块时报格式错（空列表的合法 XML 里 list 标签还在，只是无 video）。 */
export function parseCmsXmlList(xml: string, sourceId: string): CmsListResult {
  const listM = /<list[^>]*>/i.exec(xml ?? '')
  const pageCount = listM ? parseInt(/pagecount="(\d+)"/i.exec(listM[0])?.[1] ?? '1', 10) : 1
  const totalAttr = listM ? parseInt(/recordcount="(\d+)"/i.exec(listM[0])?.[1] ?? '', 10) : NaN
  const blocks = [...(xml ?? '').matchAll(/<video>([\s\S]*?)<\/video>/gi)]
  if (!blocks.length && !listM) {
    return { titles: [], total: 0, pageCount: 0, error: '资源站返回的不是标准苹果 CMS 数据' }
  }
  const titles: VodTitle[] = []
  for (const b of blocks) {
    const block = b[1]
    const dds = [...block.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/gi)]
      .map(m => m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim())
      .filter(Boolean)
    const flags = [...block.matchAll(/<dd[^>]*flag="([^"]*)"[^>]*>/gi)].map(m => m[1])
    const item: CmsVodItem = {
      vod_name: xmlTag(block, 'name'),
      vod_pic: xmlTag(block, 'pic'),
      vod_play_from: flags.join('$$$'),
      vod_play_url: dds.join('$$$'),
    }
    const t = cmsItemToVodTitle(item, sourceId)
    if (t) titles.push(t)
  }
  return { titles, total: Number.isFinite(totalAttr) ? totalAttr : titles.length, pageCount: pageCount > 0 ? pageCount : 1 }
}

/** 拉一个资源站的第 N 页片单：type 0 走 XML，type 1 走 JSON */
export async function fetchCmsVodList(site: TvboxSite, page = 1): Promise<CmsListResult> {
  const sourceId = `tvbox:${site.key}`
  const fail = (error: string): CmsListResult => ({ titles: [], total: 0, pageCount: 0, error })
  try {
    const text = await fetchTextWithTimeout(cmsListUrl(site.api, page), 20000)
    if (site.type === 0) return parseCmsXmlList(text, sourceId)
    let data: unknown
    try { data = JSON.parse(text) } catch { return fail('资源站返回的不是标准苹果 CMS 数据') }
    return parseCmsJsonList(data, sourceId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort|timeout|timed out/i.test(msg)) return fail('拉取超时（20 秒无响应）')
    if (/load failed|failed to fetch|networkerror/i.test(msg)) return fail('网络请求失败，可能被代理/网络拦截，请换个节点再试')
    if (/^HTTP (\d+)/.test(msg)) return fail(`资源站返回 HTTP ${/^HTTP (\d+)/.exec(msg)?.[1]}（该站可能已失效）`)
    return fail(`拉取失败（${msg.slice(0, 60)}）`)
  }
}

// ---------------- TVBox 资源站测活（v0.1.418） ----------------
// 站点级：拉一页片单（App 同款 ?ac=videolist&pg=1），code=1 且有数据算活；
// 超时/403/返回网页/空列表/非 JSON 都算死并带具体原因——复用 fetchCmsVodList
// 的中文报错，不另起一套口径。结果进同一缓存 acm.watch.health.v1，
// 键加 `site:` 前缀，与直播台（归一化台名）/点播（vod: 前缀）不冲突。
export function siteHealthKey(site: TvboxSite): string {
  return `site:${site.key}`
}

/** 测一个资源站：拉第 1 页片单，有数据算活；无数据或拉取失败算死并带原因 */
export async function probeTvboxSite(site: TvboxSite, opts: { signal?: AbortSignal } = {}): Promise<ChannelHealth> {
  if (opts.signal?.aborted) return { ok: false, at: Date.now(), url: site.api, reason: '已取消' }
  const t0 = Date.now()
  const r = await fetchCmsVodList(site, 1)
  if (opts.signal?.aborted) return { ok: false, at: Date.now(), url: site.api, reason: '已取消' }
  if (r.error) return { ok: false, ms: Date.now() - t0, at: Date.now(), url: site.api, reason: r.error }
  if (r.titles.length === 0) return { ok: false, ms: Date.now() - t0, at: Date.now(), url: site.api, reason: '站返回空片单（0 条）' }
  return { ok: true, ms: Date.now() - t0, at: Date.now(), url: site.api }
}

/** 某站的测活结果：缓存条目须对应当前站的 api，否则是旧配置的残留，不用 */
export function siteHealthOf(health: HealthMap, site: TvboxSite): ChannelHealth | undefined {
  const h = health[siteHealthKey(site)]
  if (!h) return undefined
  if (h.url && h.url !== site.api) return undefined
  return h
}

export function siteHealthCounts(sites: TvboxSite[], health: HealthMap): { tested: number; ok: number; bad: number } {
  let tested = 0
  let ok = 0
  for (const s of sites) {
    const h = siteHealthOf(health, s)
    if (!h) continue
    tested++
    if (h.ok) ok++
  }
  return { tested, ok, bad: tested - ok }
}

export interface ProbeTvboxSitesOptions {
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number, key: string, result: ChannelHealth) => void
}

/** 测一批资源站：限定并行数后台跑；中途取消时返回已测到的部分结果，
 * 已取消的站不进结果（不把「已取消」写进缓存当成死站）。 */
export async function probeTvboxSites(sites: TvboxSite[], opts: ProbeTvboxSitesOptions = {}): Promise<HealthMap> {
  const concurrency = Math.max(1, opts.concurrency ?? HEALTH_PROBE_CONCURRENCY)
  const out: HealthMap = {}
  let next = 0
  let done = 0
  const workers = Array.from({ length: Math.min(concurrency, sites.length) }, async () => {
    for (;;) {
      if (opts.signal?.aborted) return
      const i = next++
      if (i >= sites.length) return
      const s = sites[i]
      const r = await probeTvboxSite(s, { signal: opts.signal })
      if (opts.signal?.aborted) return
      out[siteHealthKey(s)] = r
      done++
      opts.onProgress?.(done, sites.length, siteHealthKey(s), r)
    }
  })
  await Promise.all(workers)
  return out
}

/** 合并多来源的点播标题：同名（key）合并选集与线路，与 m3u 的
 * channelsToVod 同款口径；多集或带集号的算剧集，否则算电影。 */
export function mergeVodTitles(lists: VodTitle[][]): VodTitle[] {
  const map = new Map<string, VodTitle>()
  for (const list of lists) {
    for (const v of list) {
      const prev = map.get(v.key)
      if (!prev) {
        map.set(v.key, { ...v, episodes: v.episodes.map(e => ({ ...e, urls: [...e.urls] })), sourceIds: [...v.sourceIds] })
        continue
      }
      for (const s of v.sourceIds) if (!prev.sourceIds.includes(s)) prev.sourceIds.push(s)
      if (!prev.logo && v.logo) prev.logo = v.logo
      for (const ep of v.episodes) {
        let target = prev.episodes.find(e => e.episodeNo === ep.episodeNo)
        if (!target) { target = { ...ep, urls: [] }; prev.episodes.push(target) }
        for (const u of ep.urls) if (!target.urls.includes(u)) target.urls.push(u)
        target.unofficial = target.urls.some(u => isUnofficialStreamUrl(u))
      }
      prev.episodes.sort((a, b) => {
        if (a.episodeNo && b.episodeNo) return a.episodeNo - b.episodeNo
        if (a.episodeNo) return -1
        if (b.episodeNo) return 1
        return 0
      })
      const isSeries = prev.episodes.length > 1 || prev.episodes.some(e => e.episodeNo > 0)
      prev.episodes.forEach((e, i) => { e.label = isSeries ? `第 ${e.episodeNo || i + 1} 集` : '正片' })
      prev.kind = isSeries ? 'series' : 'movie'
      prev.unofficial = prev.episodes.some(e => e.unofficial)
    }
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
}
