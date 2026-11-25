import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  parseM3u, parseM3uAsync, parseTxt, parseTxtAsync, parsePlaylistFormat, parsePlaylistAsync,
  normalizeChannelName, contentKeyOf, stationOrigin,
  mergeChannels, groupChannels, filterOriginChannels, fetchSourceSet, loadCountryChannels,
  isUnofficialStreamUrl, isChannelUnofficial, isVodUrl, isFlvUrl,
  splitEpisode, channelsToVod, vodContinueId, parseVodContinueId,
  fetchTmdbTrending, loadRecPrefs, saveRecPrefs, REC_PREFS_KEY,
  shouldAutoLoadTrending,
  probeStreamUrl, probeChannel, probeChannels, loadHealthCache, saveHealthCache,
  healthOf, healthCounts, applyHealthView, parseM3u8Segments, probeConnectivity,
  probeVodTitle, probeVodTitles, vodHealthOf, vodHealthCounts, applyVodHealthView,
  loadShowDead, saveShowDead, loadShowDeadVod, saveShowDeadVod,
  loadShowDeadSites, saveShowDeadSites,
  probeTvboxSite, probeTvboxSites, siteHealthKey, siteHealthOf, siteHealthCounts,
  loadVodTvboxCollapsed, saveVodTvboxCollapsed, loadVodFiltersCollapsed, saveVodFiltersCollapsed,
  parseTvboxConfig, isTvboxConfigText, isAdultTvboxSite,
  loadTvboxConfigs, saveTvboxConfigs, fetchTvboxConfig,
  loadShowAdult, saveShowAdult, SHOW_ADULT_KEY,
  loadPlayerFloat, savePlayerFloat, clampPlayerFloat, PLAYER_FLOAT_KEY,
  cmsListUrl, cmsPlayUrlToEpisodes, cmsItemToVodTitle,
  parseCmsJsonList, parseCmsXmlList, fetchCmsVodList, mergeVodTitles,
  type TvboxSite, type TvboxConfig,
  type HealthMap,
  normalizeTitleKey, regionLabelOfCountry, mapGenreNames,
  fetchTmdbGenres, searchTmdbTitle, fetchTmdbDetails,
  buildVodWallItems, filterVodWall, sortVodWall, vodWallBadge,
  type VodTitle, type TmdbTitle,
  PLAYLIST_CACHE_KEY, CUSTOM_SOURCES_KEY,
  type LiveChannel, type SourceSet,
} from './watch'

// node 环境没有 localStorage：watch.ts 的缓存/自定义源读写需要它（与 freeGames 测试同款 mock）
if (!(globalThis as unknown as Record<string, unknown>).localStorage) {
  const m = new Map<string, string>()
  ;(globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
  }
}
const ls = () => (globalThis as unknown as { localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void; clear(): void } }).localStorage

beforeEach(() => { ls().clear() })

const CN_FIXTURE = `#EXTM3U
#EXTINF:-1 tvg-id="CCTV1.cn" tvg-logo="https://x/logo.png" group-title="General",CCTV-1 (720p)
http://example.com/cctv1.m3u8
#EXTINF:-1 tvg-id="HunanTV.cn" group-title="Entertainment",湖南卫视
http://example.com/hunan.m3u8
#EXTINF:-1 tvg-id="News1" group-title="News",Test News
http://example.com/news.m3u8
#EXTINF:-1 tvg-id="Bad" group-title="News",坏台
not-a-url
`

const FREETV_FIXTURE = `#EXTM3U
#EXTINF:-1 tvg-name="CCTV-1" tvg-country="CN" group-title="China",CCTV-1
http://example.com/cctv1-alt.m3u8
#EXTINF:-1 tvg-name="BBC One" tvg-country="GB" group-title="UK",BBC One
http://example.com/bbc1.m3u8
`

afterEach(() => { vi.unstubAllGlobals() })

describe('watch.parseM3u', () => {
  it('解析条目、去掉坏地址行', () => {
    const entries = parseM3u(CN_FIXTURE)
    expect(entries).toHaveLength(3)
    expect(entries[0].name).toBe('CCTV-1 (720p)')
    expect(entries[0].logo).toBe('https://x/logo.png')
    expect(entries[0].groupTitle).toBe('General')
    expect(entries[0].url).toBe('http://example.com/cctv1.m3u8')
  })
  it('parseM3uAsync（分片解析）与同步版结果一致', async () => {
    expect(await parseM3uAsync(CN_FIXTURE)).toEqual(parseM3u(CN_FIXTURE))
  })
})

// txt 直播源（v0.1.425）：VMA 样本同款格式——`分组名,#genre#` 分组、
// 「频道名,地址」每行一条；另含源文件里的脏行（名字被换行截断、空地址、
// 缺字母的 ttp://、mitv:// 专有协议），解析时一律跳过不猜不断行。
const TXT_FIXTURE = `网友提供频道
央视,#genre#
CCTV1,http://example.com/cctv1.m3u8
CCTV2,https://example.com/cctv2.m3u8
电影01,#genre#
异形浩劫1971上（美国恐怖片）,https://example.com/movie1.m3u8
异形浩劫1971下（美国恐
怖片）,https://example.com/movie2.m3u8
CCTV15,
吉林卫视,
凤凰中文,ttp://example.com/bad.m3u8
民视,mitv://example.com/tv
卫视,#genre#
浙江卫视,http://example.com/zj.m3u8
湖南卫视,http://example.com/hn.m3u8
`

describe('watch.parseTxt（v0.1.425 txt 直播源）', () => {
  it('按行认“频道名,地址”，#genre# 当分组', () => {
    const entries = parseTxt(TXT_FIXTURE)
    expect(entries).toHaveLength(6)
    expect(entries.map(e => e.name)).toEqual([
      'CCTV1', 'CCTV2', '异形浩劫1971上（美国恐怖片）', '怖片）', '浙江卫视', '湖南卫视',
    ])
    expect(entries[0].groupTitle).toBe('央视')
    expect(entries[1].groupTitle).toBe('央视')
    expect(entries[2].groupTitle).toBe('电影01')
    expect(entries[4].groupTitle).toBe('卫视')
    expect(entries[0].url).toBe('http://example.com/cctv1.m3u8')
  })
  it('跳过裸标题行、空地址、非 http(s) 地址', () => {
    const names = parseTxt(TXT_FIXTURE).map(e => e.name)
    expect(names).not.toContain('网友提供频道')
    expect(names).not.toContain('CCTV15')
    expect(names).not.toContain('吉林卫视')
    expect(names).not.toContain('凤凰中文')
    expect(names).not.toContain('民视')
  })
  it('parseTxtAsync（分片解析）与同步版结果一致', async () => {
    expect(await parseTxtAsync(TXT_FIXTURE)).toEqual(parseTxt(TXT_FIXTURE))
  })
  it('parsePlaylistFormat 按内容自动识别：含 #EXTINF 走 m3u，否则按 txt 试', () => {
    expect(parsePlaylistFormat(CN_FIXTURE)).toBe('m3u')
    expect(parsePlaylistFormat(TXT_FIXTURE)).toBe('txt')
    expect(parsePlaylistFormat('#EXTM3U\n')).toBe('txt')
  })
  it('parsePlaylistAsync：m3u 与 txt 同一入口', async () => {
    expect(await parsePlaylistAsync(CN_FIXTURE)).toEqual(parseM3u(CN_FIXTURE))
    expect(await parsePlaylistAsync(TXT_FIXTURE)).toEqual(parseTxt(TXT_FIXTURE))
  })
  it('fetchSourceSet：txt 源拉到台，ok:true；解析不到台报中文原因，不静默 0 台', async () => {
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url)
      if (u.includes('my.txt')) return { ok: true, text: async () => TXT_FIXTURE }
      return { ok: true, text: async () => '这不是直播源\nhello world\n' }
    })
    const txt = await fetchSourceSet({ id: 'custom-txt', label: '自定义 · txt 源', url: 'https://example.com/my.txt', country: 'WORLD' })
    expect(txt.result.ok).toBe(true)
    expect(txt.result.count).toBe(6)
    expect(txt.channels.some(c => c.name === 'CCTV1')).toBe(true)
    const bad = await fetchSourceSet({ id: 'custom-bad', label: '自定义 · 垃圾源', url: 'https://example.com/bad.txt', country: 'WORLD' })
    expect(bad.channels).toEqual([])
    expect(bad.result.ok).toBe(false)
    expect(bad.result.error ?? '').toContain('没有解析到任何频道')
    expect(bad.result.error ?? '').toContain('m3u')
  })
  it('loadCountryChannels：txt 自定义源的台与 m3u 内置源合并进直播列表', async () => {
    ls().setItem(CUSTOM_SOURCES_KEY, JSON.stringify([{ id: 'txt1', label: 'VMA', url: 'https://example.com/vma.txt', addedAt: 1 }]))
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url)
      if (u.includes('countries/cn.m3u')) return { ok: true, text: async () => CN_FIXTURE }
      if (u.includes('Free-TV')) return { ok: true, text: async () => FREETV_FIXTURE }
      if (u.includes('vma.txt')) return { ok: true, text: async () => TXT_FIXTURE }
      return { ok: false, status: 404, text: async () => '' }
    })
    const { channels, sets } = await loadCountryChannels('CN')
    expect(channels.some(c => c.name === 'CCTV1')).toBe(true)
    expect(channels.some(c => c.name === '浙江卫视')).toBe(true)
    expect(channels.some(c => c.name === 'CCTV-1')).toBe(true)
    expect(sets.find(s => s.setId === 'custom-txt1')?.ok).toBe(true)
    expect(sets.find(s => s.setId === 'custom-txt1')?.count).toBe(6)
  })
})

describe('watch.normalizeChannelName', () => {
  it('去分辨率后缀、统一小写', () => {
    expect(normalizeChannelName('CCTV-1 (720p)')).toBe('cctv-1')
    expect(normalizeChannelName('BBC One HD')).toBe('bbc one')
    expect(normalizeChannelName('湖南卫视')).toBe('湖南卫视')
  })
})

describe('watch.contentKeyOf', () => {
  it('News→news；General/Undefined/未知→other；多值取首个', () => {
    expect(contentKeyOf('News')).toBe('news')
    expect(contentKeyOf('General')).toBe('other')
    expect(contentKeyOf('Undefined')).toBe('other')
    expect(contentKeyOf('')).toBe('other')
    expect(contentKeyOf('Animation;Kids')).toBe('animation')
    expect(contentKeyOf('Movies')).toBe('movies')
    expect(contentKeyOf('WhateverWeird')).toBe('other')
  })
})

describe('watch.isUnofficialStreamUrl（v0.1.387 来源标注）', () => {
  it('裸 IP 直连（http/https、带端口）→ 未授权转播', () => {
    expect(isUnofficialStreamUrl('http://74.91.26.218:82/live/cctv1hd.m3u8')).toBe(true)
    expect(isUnofficialStreamUrl('https://69.30.245.50/live/x.m3u8')).toBe(true)
    expect(isUnofficialStreamUrl('http://38.75.136.137:98/live/cctv.m3u8')).toBe(true)
    expect(isUnofficialStreamUrl('http://1.2.3.4/a.m3u8')).toBe(true)
  })
  it('官方域名 → 不是未授权转播', () => {
    expect(isUnofficialStreamUrl('https://cd-live-stream.news.cctvplus.com/live/cctv.m3u8')).toBe(false)
    expect(isUnofficialStreamUrl('http://example.com/cctv1.m3u8')).toBe(false)
    expect(isUnofficialStreamUrl('https://live.jxgdw.com/hd.m3u8')).toBe(false)
  })
  it('IPv6 字面量 → 未授权转播；非法地址/空串 → false', () => {
    expect(isUnofficialStreamUrl('https://[2001:db8::1]/x.m3u8')).toBe(true)
    expect(isUnofficialStreamUrl('not-a-url')).toBe(false)
    expect(isUnofficialStreamUrl('')).toBe(false)
  })
})

describe('watch 来源标记：解析与合并时按主源打标记', () => {
  const IP_FIXTURE = `#EXTM3U
#EXTINF:-1 tvg-id="CCTV1" group-title="General",CCTV-1
http://74.91.26.218:82/live/cctv1hd.m3u8
#EXTINF:-1 tvg-id="CCTVPlus" group-title="News",CCTV+
https://cd-live-stream.news.cctvplus.com/live/cctvplus.m3u8
`
  it('解析时：IP 流打标记，官方域名不打', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => IP_FIXTURE }))
    const set: SourceSet = { id: 'iptv-cn', label: 'iptv-org · 中国', url: 'https://example.com/cn.m3u', country: 'CN' }
    const { channels } = await fetchSourceSet(set)
    const cctv1 = channels.find(c => c.key === 'cctv-1')
    const plus = channels.find(c => c.key === 'cctv+')
    expect(cctv1?.unofficial).toBe(true)
    expect(plus?.unofficial).toBe(false)
  })
  it('合并后：标记跟合并后的主源走；自定义源同样按规则打标记', async () => {
    ls().setItem(CUSTOM_SOURCES_KEY, JSON.stringify([{ id: 'my1', label: '我的源', url: 'https://example.com/my.m3u', addedAt: 1 }]))
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url)
      if (u.includes('countries/cn.m3u')) return { ok: true, text: async () => IP_FIXTURE }
      if (u.includes('Free-TV')) return { ok: true, text: async () => FREETV_FIXTURE }
      if (u.includes('my.m3u')) return { ok: true, text: async () => '#EXTM3U\n#EXTINF:-1 group-title="News",我的收藏台\nhttp://69.30.245.50/live/my.m3u8\n' }
      return { ok: false, status: 404, text: async () => '' }
    })
    const { channels } = await loadCountryChannels('CN')
    // CCTV-1：iptv-org 给 IP 地址、Free-TV 给域名——主源是 iptv-org 的 IP，仍标记
    expect(channels.find(c => c.key === 'cctv-1')?.unofficial).toBe(true)
    expect(isChannelUnofficial(channels.find(c => c.key === 'cctv-1')!)).toBe(true)
    // 自定义源粘的 IP 流同样标记
    const mine = channels.find(c => c.name === '我的收藏台')
    expect(mine?.unofficial).toBe(true)
    // 旧缓存缺 unofficial 字段时按 urls[0] 兜底判定
    expect(isChannelUnofficial({ key: 'x', name: 'X', content: 'other', country: 'CN', urls: ['http://74.91.26.218:82/live/x.m3u8'], sourceIds: ['iptv-cn'] })).toBe(true)
    expect(isChannelUnofficial({ key: 'y', name: 'Y', content: 'other', country: 'CN', urls: ['https://cd-live-stream.news.cctvplus.com/live/y.m3u8'], sourceIds: ['iptv-cn'] })).toBe(false)
  })
})

describe('watch.stationOrigin', () => {
  it('CCTV 开头→央视；卫视结尾或省级英文名→卫视；其余→其他', () => {
    expect(stationOrigin('CCTV-1')).toBe('cctv')
    expect(stationOrigin('cctv-5+')).toBe('cctv')
    expect(stationOrigin('湖南卫视')).toBe('satellite')
    expect(stationOrigin('Hunan TV')).toBe('satellite')
    expect(stationOrigin('Anhui TV')).toBe('satellite')
    expect(stationOrigin('Dragon TV')).toBe('satellite')
    expect(stationOrigin('BBC One')).toBe('other')
    expect(stationOrigin('ABN China')).toBe('other')
  })
})

describe('watch.mergeChannels', () => {
  it('同名合并播放地址并去重', () => {
    const a: LiveChannel = { key: 'cctv-1', name: 'CCTV-1', content: 'other', country: 'CN', urls: ['http://a/1.m3u8'], sourceIds: ['iptv-cn'] }
    const b: LiveChannel = { key: 'cctv-1', name: 'CCTV-1', content: 'news', country: 'CN', urls: ['http://b/1.m3u8', 'http://a/1.m3u8'], sourceIds: ['freetv'] }
    const merged = mergeChannels([[a], [b]])
    expect(merged).toHaveLength(1)
    expect(merged[0].urls).toEqual(['http://a/1.m3u8', 'http://b/1.m3u8'])
    expect(merged[0].sourceIds).toEqual(['iptv-cn', 'freetv'])
    expect(merged[0].content).toBe('news')
  })
})

describe('watch.groupChannels', () => {
  it('中国按央视/卫视/其他分；外国只有“全部”一组', () => {
    const channels: LiveChannel[] = [
      { key: 'cctv-1', name: 'CCTV-1', content: 'news', country: 'CN', urls: ['http://a'], sourceIds: ['iptv-cn'] },
      { key: '湖南卫视', name: '湖南卫视', content: 'entertainment', country: 'CN', urls: ['http://b'], sourceIds: ['iptv-cn'] },
      { key: 'test', name: 'Test News', content: 'news', country: 'CN', urls: ['http://c'], sourceIds: ['iptv-cn'] },
    ]
    const cn = groupChannels(channels, 'CN')
    expect(cn.origins.map(g => g.key)).toEqual(['cctv', 'satellite', 'other'])
    expect(cn.origins[0].channels).toHaveLength(1)
    expect(cn.contents).toContain('news')
    const us = groupChannels(channels, 'US')
    expect(us.origins).toHaveLength(1)
    expect(us.origins[0].key).toBe('other')
  })
})

// v0.1.420：直播分组改横向 chips——按分组取台（与 groupChannels 同一套 stationOrigin 判定）
describe('watch.filterOriginChannels', () => {
  const channels: LiveChannel[] = [
    { key: 'cctv-1', name: 'CCTV-1', content: 'news', country: 'CN', urls: ['http://a'], sourceIds: ['iptv-cn'] },
    { key: 'cctv-2', name: 'CCTV-2', content: 'news', country: 'CN', urls: ['http://a2'], sourceIds: ['iptv-cn'] },
    { key: '湖南卫视', name: '湖南卫视', content: 'entertainment', country: 'CN', urls: ['http://b'], sourceIds: ['iptv-cn'] },
    { key: 'test', name: 'Test News', content: 'news', country: 'CN', urls: ['http://c'], sourceIds: ['iptv-cn'] },
  ]
  it('all 不筛选、原顺序返回', () => {
    expect(filterOriginChannels(channels, 'all')).toEqual(channels)
  })
  it('cctv 只返回 CCTV 开头的台', () => {
    expect(filterOriginChannels(channels, 'cctv').map(c => c.name)).toEqual(['CCTV-1', 'CCTV-2'])
  })
  it('satellite 只返回卫视', () => {
    expect(filterOriginChannels(channels, 'satellite').map(c => c.name)).toEqual(['湖南卫视'])
  })
  it('other 只返回其余台', () => {
    expect(filterOriginChannels(channels, 'other').map(c => c.name)).toEqual(['Test News'])
  })
  it('与 groupChannels 的分组计数一致', () => {
    const groups = groupChannels(channels, 'CN')
    for (const g of groups.origins) {
      expect(filterOriginChannels(channels, g.key)).toHaveLength(g.channels.length)
    }
  })
})

describe('watch.fetchSourceSet', () => {
  it('网络失败返回 ok:false 与中文原因，不抛错、不含 Load failed', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Load failed') })
    const set: SourceSet = { id: 'iptv-cn', label: 'iptv-org · 中国', url: 'https://example.com/cn.m3u', country: 'CN' }
    const { channels, result } = await fetchSourceSet(set)
    expect(channels).toEqual([])
    expect(result.ok).toBe(false)
    expect(result.error ?? '').toContain('换个节点')
    expect(result.error ?? '').not.toContain('Load failed')
  })
  it('非 200 返回中文原因', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 403, text: async () => '' }))
    const set: SourceSet = { id: 'iptv-cn', label: 'iptv-org · 中国', url: 'https://example.com/cn.m3u', country: 'CN' }
    const { result } = await fetchSourceSet(set)
    expect(result.ok).toBe(false)
    expect(result.error ?? '').toContain('403')
  })
})

describe('watch.loadCountryChannels', () => {
  it('多套源并行拉取：同名频道合并地址，失败的套不阻塞其他套', async () => {
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url)
      if (u.includes('countries/cn.m3u')) return { ok: true, text: async () => CN_FIXTURE }
      if (u.includes('Free-TV')) return { ok: true, text: async () => FREETV_FIXTURE }
      return { ok: false, status: 404, text: async () => '' }
    })
    const { channels, sets } = await loadCountryChannels('CN')
    const cctv = channels.find(c => c.key === 'cctv-1')
    expect(cctv).toBeDefined()
    // iptv-org 与 Free-TV 两套都给了 CCTV-1：自动合并成 2 个备用地址
    expect(cctv!.urls).toHaveLength(2)
    expect(cctv!.urls).toContain('http://example.com/cctv1.m3u8')
    expect(cctv!.urls).toContain('http://example.com/cctv1-alt.m3u8')
    // Free-TV 的 BBC One 不属于中国组，不应混进来
    expect(channels.find(c => c.key === 'bbc one')).toBeUndefined()
    // 湖南卫视在列
    expect(channels.find(c => c.name === '湖南卫视')).toBeDefined()
    expect(sets.find(s => s.setId === 'iptv-cn')?.ok).toBe(true)
    expect(sets.find(s => s.setId === 'freetv')?.ok).toBe(true)
  })
  it('自定义源里没写 tvg-country 的台也归入当前国家', async () => {
    ls().setItem(CUSTOM_SOURCES_KEY, JSON.stringify([{ id: 'my1', label: '我的源', url: 'https://example.com/my.m3u', addedAt: 1 }]))
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url)
      if (u.includes('countries/cn.m3u')) return { ok: true, text: async () => CN_FIXTURE }
      if (u.includes('Free-TV')) return { ok: true, text: async () => FREETV_FIXTURE }
      if (u.includes('my.m3u')) return { ok: true, text: async () => '#EXTM3U\n#EXTINF:-1 group-title="News",我的收藏台\nhttp://example.com/my1.m3u8\n' }
      return { ok: false, status: 404, text: async () => '' }
    })
    const { channels } = await loadCountryChannels('CN')
    expect(channels.find(c => c.name === '我的收藏台')).toBeDefined()
  })
})

// 性能（v0.1.386 追加）：播放列表缓存 24 小时，24 小时内不重新拉
describe('watch.fetchSourceSet 缓存', () => {
  const SET: SourceSet = { id: 'iptv-cn', label: 'iptv-org · 中国', url: 'https://example.com/cn.m3u', country: 'CN' }
  it('24 小时内第二次直接读缓存，不再发请求', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; return { ok: true, text: async () => CN_FIXTURE } })
    const first = await fetchSourceSet(SET)
    expect(first.result.ok).toBe(true)
    expect(calls).toBe(1)
    const second = await fetchSourceSet(SET)
    expect(calls).toBe(1)
    expect(second.result.cached).toBe(true)
    expect(second.channels).toHaveLength(3)
  })
  it('缓存超过 24 小时重新拉；force 同样重新拉', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; return { ok: true, text: async () => CN_FIXTURE } })
    await fetchSourceSet(SET)
    const raw = JSON.parse(ls().getItem(PLAYLIST_CACHE_KEY)!) as Record<string, { at: number }>
    raw['iptv-cn'].at = Date.now() - 25 * 3600_000
    ls().setItem(PLAYLIST_CACHE_KEY, JSON.stringify(raw))
    await fetchSourceSet(SET)
    expect(calls).toBe(2)
    await fetchSourceSet(SET, { force: true })
    expect(calls).toBe(3)
  })
})

// 视频点播（v0.1.390）：m3u 点播条目单独成区，同名剧集多条合并带选集，看到一半记进度续播
describe('watch.splitEpisode', () => {
  it('第N集 / S01E03 / 末尾 E05 都能拆出集号与干净标题', () => {
    expect(splitEpisode('庆余年 第01集')).toEqual({ title: '庆余年', episodeNo: 1 })
    expect(splitEpisode('庆余年 第12集 (1080p)')).toEqual({ title: '庆余年', episodeNo: 12 })
    expect(splitEpisode('庆余年 S01E03')).toEqual({ title: '庆余年', episodeNo: 3 })
    expect(splitEpisode('Show Name E05')).toEqual({ title: 'Show Name', episodeNo: 5 })
  })
  it('无集号标记 → episodeNo null；末尾孤数字不认（“流浪地球 2”是电影不是第 2 集）', () => {
    expect(splitEpisode('流浪地球2')).toEqual({ title: '流浪地球2', episodeNo: null })
    expect(splitEpisode('流浪地球 2')).toEqual({ title: '流浪地球 2', episodeNo: null })
    expect(splitEpisode('速度与激情 9')).toEqual({ title: '速度与激情 9', episodeNo: null })
  })
})

const VOD_FIXTURE = `#EXTM3U
#EXTINF:-1 group-title="Movies",流浪地球2
https://cdn.example.com/movies/liulang2.mp4
#EXTINF:-1 group-title="Series",庆余年 第01集
https://cdn.example.com/series/qyn01.mp4
#EXTINF:-1 group-title="Series",庆余年 第02集
https://cdn.example.com/series/qyn02.mp4
#EXTINF:-1 group-title="Series",庆余年 S01E03
https://cdn.example.com/series/qyn03.mkv
#EXTINF:-1 group-title="Movies",CCTV-6 电影
http://example.com/cctv6.m3u8
#EXTINF:-1 group-title="Movies",盗版电影
http://74.91.26.218:82/vod/pirate.mp4
#EXTINF:-1 group-title="News",新闻台
http://example.com/news.m3u8
`

describe('watch.channelsToVod（v0.1.390 点播识别/选集）', () => {
  it('mp4/mkv 按点播算；同名剧集多条合并、集号排序；单条无集号为电影', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => VOD_FIXTURE }))
    const set: SourceSet = { id: 'custom-vod', label: '测试点播源', url: 'https://example.com/vod.m3u', country: 'WORLD' }
    const { channels } = await fetchSourceSet(set)
    const vod = channelsToVod(channels)
    expect(vod.map(v => v.title)).toEqual(['盗版电影', '流浪地球2', '庆余年'])
    const qyn = vod.find(v => v.title === '庆余年')!
    expect(qyn.kind).toBe('series')
    expect(qyn.episodes.map(e => e.label)).toEqual(['第 1 集', '第 2 集', '第 3 集'])
    expect(qyn.episodes.map(e => e.episodeNo)).toEqual([1, 2, 3])
    const movie = vod.find(v => v.title === '流浪地球2')!
    expect(movie.kind).toBe('movie')
    expect(movie.episodes).toHaveLength(1)
    expect(movie.episodes[0].label).toBe('正片')
  })
  it('m3u8 永远算直播：CCTV-6 电影（group-title Movies + m3u8）不进点播；新闻台不进点播', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => VOD_FIXTURE }))
    const set: SourceSet = { id: 'custom-vod', label: '测试点播源', url: 'https://example.com/vod.m3u', country: 'WORLD' }
    const { channels } = await fetchSourceSet(set)
    const vod = channelsToVod(channels)
    expect(vod.find(v => v.title.includes('CCTV-6'))).toBeUndefined()
    expect(vod.find(v => v.title === '新闻台')).toBeUndefined()
  })
  it('点播同样打「未授权转播」标记：裸 IP 的 mp4 标 unofficial，域名不标', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => VOD_FIXTURE }))
    const set: SourceSet = { id: 'custom-vod', label: '测试点播源', url: 'https://example.com/vod.m3u', country: 'WORLD' }
    const { channels } = await fetchSourceSet(set)
    const vod = channelsToVod(channels)
    expect(vod.find(v => v.title === '盗版电影')?.unofficial).toBe(true)
    expect(vod.find(v => v.title === '流浪地球2')?.unofficial).toBe(false)
  })
})

describe('watch.loadCountryChannels 点播与直播拆分', () => {
  it('自定义源里的点播进 vod、直播列表里不再出现；内置直播台不受影响', async () => {
    ls().setItem(CUSTOM_SOURCES_KEY, JSON.stringify([{ id: 'vod1', label: '测试点播源', url: 'https://example.com/vod.m3u', addedAt: 1 }]))
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url)
      if (u.includes('countries/cn.m3u')) return { ok: true, text: async () => CN_FIXTURE }
      if (u.includes('Free-TV')) return { ok: true, text: async () => FREETV_FIXTURE }
      if (u.includes('vod.m3u')) return { ok: true, text: async () => VOD_FIXTURE }
      return { ok: false, status: 404, text: async () => '' }
    })
    const { channels, vod } = await loadCountryChannels('CN')
    expect(vod.map(v => v.title)).toEqual(['盗版电影', '流浪地球2', '庆余年'])
    // 点播条目不留在直播列表里（否则直播播放器播 mp4 会失败）
    expect(channels.find(c => c.name === '流浪地球2')).toBeUndefined()
    expect(channels.find(c => c.name.startsWith('庆余年'))).toBeUndefined()
    // CCTV-6 电影是 m3u8 直播，留在直播列表
    expect(channels.find(c => c.name === 'CCTV-6 电影')).toBeDefined()
    // 内置直播台照常
    expect(channels.find(c => c.key === 'cctv-1')).toBeDefined()
  })
  it('无点播源时 vod 为空数组', async () => {
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url)
      if (u.includes('countries/cn.m3u')) return { ok: true, text: async () => CN_FIXTURE }
      if (u.includes('Free-TV')) return { ok: true, text: async () => FREETV_FIXTURE }
      return { ok: false, status: 404, text: async () => '' }
    })
    const { vod } = await loadCountryChannels('CN')
    expect(vod).toEqual([])
  })
})

describe('watch 点播续播 id（v0.1.390）', () => {
  it('vodContinueId / parseVodContinueId 往返；标题 key 含冒号时按最后一个冒号切', () => {
    expect(vodContinueId('庆余年', 1)).toBe('vod:庆余年:1')
    expect(parseVodContinueId('vod:庆余年:1')).toEqual({ vodKey: '庆余年', episodeIndex: 1 })
    expect(parseVodContinueId('vod:star wars: episode i:0')).toEqual({ vodKey: 'star wars: episode i', episodeIndex: 0 })
    expect(parseVodContinueId('live:cctv-1')).toBeNull()
    expect(parseVodContinueId('vod:bad')).toBeNull()
  })
})

describe('watch 短剧专区已移除（v0.1.390）', () => {
  it('WatchTool.tsx 里不再有 SHORT_PLATFORMS 与“短剧专区”', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../components/WatchTool.tsx', import.meta.url), 'utf8')
    expect(src).not.toContain('SHORT_PLATFORMS')
    expect(src).not.toContain('短剧专区')
    expect(src).not.toContain('hongguoduanju.com')
    expect(src).not.toContain('microsite/wetheater')
    // 删的是专区不是全部短剧：AI 找剧仍可搜短剧、片单仍有短剧类型、央视 iframe 入口还在
    expect(src).toContain('tv.cctv.com/live/')
    expect(src).toContain("option value=\"short\"")
  })
})

// 横向标题（v0.1.394）：TMDB 热门范围 + 推荐偏好存取；内容页签不再放设置输入框
describe('watch.fetchTmdbTrending 范围（v0.1.394）', () => {
  const tmdbPage = (items: unknown[]) => ({ ok: true, json: async () => ({ results: items }) })
  const tvItem = { id: 1, media_type: 'tv', name: '示例剧集', overview: '', vote_average: 8.4 }
  const movieItem = { id: 2, media_type: 'movie', title: '示例电影', overview: '', vote_average: 8.1 }
  it('默认走 trending/week（老行为不变）', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (u: unknown) => { urls.push(String(u)); return tmdbPage([tvItem, movieItem]) })
    const list = await fetchTmdbTrending('KEY')
    expect(list).toHaveLength(4)
    expect(urls.some(u => u.includes('/trending/tv/week'))).toBe(true)
    expect(urls.some(u => u.includes('/trending/movie/week'))).toBe(true)
  })
  it("'day' 走 trending/day", async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (u: unknown) => { urls.push(String(u)); return tmdbPage([tvItem]) })
    await fetchTmdbTrending('KEY', 'day')
    expect(urls.some(u => u.includes('/trending/tv/day'))).toBe(true)
    expect(urls.some(u => u.includes('/trending/movie/day'))).toBe(true)
  })
  it("'top' 走 discover 按评分倒序（vote_count ≥ 300），无 media_type 时按端点补类型", async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (u: unknown) => {
      urls.push(String(u))
      return tmdbPage([{ id: 3, title: '高分片', overview: '', vote_average: 9.2 }])
    })
    const list = await fetchTmdbTrending('KEY', 'top')
    expect(urls.some(u => u.includes('/discover/tv?sort_by=vote_average.desc&vote_count.gte=300'))).toBe(true)
    expect(urls.some(u => u.includes('/discover/movie?sort_by=vote_average.desc&vote_count.gte=300'))).toBe(true)
    expect(list[0].mediaType).toBe('tv')
    expect(list[1].mediaType).toBe('movie')
    expect(list[0].vote).toBe(9.2)
  })
  it('非 200 抛中文错', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({}) }))
    await expect(fetchTmdbTrending('BAD')).rejects.toThrow('401')
  })
})

describe('watch.shouldAutoLoadTrending（v0.1.406 点播墙自己拉热门榜单）', () => {
  const base = { activeTab: 'vod', tmdbKeySet: true, trendingCount: 0, loading: false }
  it('打开点播页签、榜单为空、有 Key、不在拉取中 → 拉一次', () => {
    expect(shouldAutoLoadTrending(base)).toBe(true)
  })
  it('不在点播页签（热门/直播/设置）→ 不拉', () => {
    expect(shouldAutoLoadTrending({ ...base, activeTab: 'trending' })).toBe(false)
    expect(shouldAutoLoadTrending({ ...base, activeTab: 'live' })).toBe(false)
    expect(shouldAutoLoadTrending({ ...base, activeTab: 'settings' })).toBe(false)
  })
  it('无 Key → 不拉（回落只有片名列表，与修前一致）', () => {
    expect(shouldAutoLoadTrending({ ...base, tmdbKeySet: false })).toBe(false)
  })
  it('榜单已有 → 不重复拉', () => {
    expect(shouldAutoLoadTrending({ ...base, trendingCount: 40 })).toBe(false)
  })
  it('正在拉取中 → 不重复拉', () => {
    expect(shouldAutoLoadTrending({ ...base, loading: true })).toBe(false)
  })
})

describe('watch 推荐偏好（v0.1.394）', () => {
  it('默认 本周热门 + 剧集电影；非法值回落默认', () => {
    expect(loadRecPrefs()).toEqual({ range: 'week', type: 'all' })
    ls().setItem(REC_PREFS_KEY, JSON.stringify({ range: 'nope', type: 'short' }))
    expect(loadRecPrefs()).toEqual({ range: 'week', type: 'all' })
  })
  it('保存后读回一致', () => {
    saveRecPrefs({ range: 'top', type: 'tv' })
    expect(loadRecPrefs()).toEqual({ range: 'top', type: 'tv' })
    saveRecPrefs({ range: 'day', type: 'movie' })
    expect(loadRecPrefs()).toEqual({ range: 'day', type: 'movie' })
  })
})

describe('watch 看剧横向标题（v0.1.394）', () => {
  it('WatchTool.tsx：七个页签在、AI 找剧收进搜索图标、设置输入框只在设置页签', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../components/WatchTool.tsx', import.meta.url), 'utf8')
    // 页签：七个标题 + 切换入口都在
    const tabs: [string, string][] = [
      ['trending', '热门推荐'], ['continue', '继续观看'], ['live', '直播'],
      ['vod', '点播'], ['calendar', '追剧日历'], ['watchlist', '我的片单'], ['settings', '设置'],
    ]
    for (const [id, title] of tabs) {
      expect(src).toContain(`setActiveTab('${id}')`)
      expect(src).toContain(`>${title}`)
    }
    expect(src).toContain("activeTab === 'settings'")
    // AI 找剧不再是分区标题：无 Section id="ai"，搜索图标 + 面板 + Esc 收起
    expect(src).not.toContain('id="ai"')
    expect(src).toContain("title=\"AI 找剧\"")
    expect(src).toContain("key === 'Escape'")
    // 热门页签不再放 TMDB Key 输入框，只有去设置页签的链接按钮
    expect(src).toContain('去「设置」页签填 Key')
    // 设置页签四段齐全
    for (const s of ['自定义直播源', '自定义点播源', 'TMDB API Key', '推荐设置']) {
      expect(src).toContain(s)
    }
    // 推荐设置三组控件齐全
    for (const s of ['本周热门', '今日热门', '高分精选', '剧集 + 电影', '只看剧集', '只看电影', '找剧模型']) {
      expect(src).toContain(s)
    }
  })
  it('styles.css：--accent 已定义（否则 .wt-chip.on 选中态白字透明底、看不见选中项）', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/--accent:\s*#[0-9a-f]{6}/i)
  })
})

describe('watch.normalizeTitleKey（v0.1.395 海报墙片名匹配）', () => {
  it('去空格标点、转小写', () => {
    expect(normalizeTitleKey('庆余年 第 2 集')).toBe('庆余年第2集')
    expect(normalizeTitleKey('Dune: Part Two')).toBe('duneparttwo')
    expect(normalizeTitleKey('流浪地球 2')).toBe('流浪地球2')
  })
})

describe('watch.mapGenreNames（v0.1.395 类型映射到墙上 16 类）', () => {
  it('直接映射 + 家庭/历史归剧情 + 西部归动作', () => {
    expect(mapGenreNames(['科幻', '冒险'])).toEqual(['科幻', '冒险'])
    expect(mapGenreNames(['家庭', '历史', '音乐', '电视电影'])).toEqual(['剧情'])
    expect(mapGenreNames(['西部'])).toEqual(['动作'])
  })
  it('中文原声动作片多一个「武侠」', () => {
    expect(mapGenreNames(['动作'], 'zh')).toContain('武侠')
    expect(mapGenreNames(['动作'], 'en')).not.toContain('武侠')
    expect(mapGenreNames(['剧情'], 'zh')).not.toContain('武侠')
  })
  it('未知类型名直接丢掉，不编造', () => {
    expect(mapGenreNames(['不存在的类型'])).toEqual([])
  })
})

describe('watch.regionLabelOfCountry（v0.1.395 地区）', () => {
  it('CN/HK/TW/US/JP/KR/GB 映射，其余 undefined', () => {
    expect(regionLabelOfCountry('CN')).toBe('大陆')
    expect(regionLabelOfCountry('HK')).toBe('香港')
    expect(regionLabelOfCountry('TW')).toBe('台湾')
    expect(regionLabelOfCountry('US')).toBe('美国')
    expect(regionLabelOfCountry('JP')).toBe('日本')
    expect(regionLabelOfCountry('KR')).toBe('韩国')
    expect(regionLabelOfCountry('GB')).toBe('英国')
    expect(regionLabelOfCountry('FR')).toBeUndefined()
    expect(regionLabelOfCountry(undefined)).toBeUndefined()
  })
})

const VOD_WALL_VOD: VodTitle[] = [
  { key: '流浪地球2', title: '流浪地球2', kind: 'movie', episodes: [{ label: '正片', urls: ['https://x/a.mp4', 'https://x/b.mp4'], episodeNo: 0, unofficial: false }], sourceIds: ['custom-1'], unofficial: false },
  { key: '庆余年', title: '庆余年', kind: 'series', episodes: [
    { label: '第 1 集', urls: ['https://x/q1.mp4'], episodeNo: 1, unofficial: false },
    { label: '第 2 集', urls: ['https://x/q2.mp4'], episodeNo: 2, unofficial: false },
  ], sourceIds: ['custom-1'], unofficial: false },
]
const VOD_WALL_TRENDING: TmdbTitle[] = [
  { id: 1, mediaType: 'movie', title: '流浪地球2', originalTitle: 'The Wandering Earth II', overview: '太阳即将毁灭', poster: 'https://img/w.jpg', firstDate: '2023-01-22', vote: 7.9, genreIds: [878, 12], originalLanguage: 'zh', popularity: 90 },
  { id: 2, mediaType: 'movie', title: '奥本海默', originalTitle: 'Oppenheimer', overview: '原子弹之父', poster: 'https://img/o.jpg', firstDate: '2023-07-21', vote: 8.3, genreIds: [18], originalLanguage: 'en', popularity: 80 },
  { id: 3, mediaType: 'tv', title: '繁花', originalTitle: 'Blossoms Shanghai', overview: '九十年代上海', poster: 'https://img/f.jpg', firstDate: '2023-12-27', vote: 8.7, genreIds: [18], originCountry: ['CN'], originalLanguage: 'zh', popularity: 70 },
]
const VOD_WALL_GENRES = { movie: { 878: '科幻', 12: '冒险', 18: '剧情' }, tv: { 18: '剧情' } }

describe('watch.buildVodWallItems（v0.1.395 拼墙）', () => {
  it('点播全进墙（有源可播），热门里没匹配上的也进墙（仅展示），同名只留一部', () => {
    const items = buildVodWallItems(VOD_WALL_VOD, VOD_WALL_TRENDING, {}, VOD_WALL_GENRES)
    expect(items).toHaveLength(4) // 流浪地球2、庆余年、奥本海默、繁花
    const wle = items.find(i => i.title === '流浪地球2')!
    expect(wle.playable).toBe(true)
    expect(wle.sourceCount).toBe(2)
    expect(wle.tmdb?.vote).toBe(7.9)
    expect(wle.genres).toEqual(['科幻', '冒险'])
    const opp = items.find(i => i.title === '奥本海默')!
    expect(opp.playable).toBe(false)
    expect(opp.sourceCount).toBe(0)
    expect(opp.genres).toEqual(['剧情'])
    const qyn = items.find(i => i.title === '庆余年')!
    expect(qyn.playable).toBe(true)
    expect(qyn.kind).toBe('series')
    expect(qyn.totalEps).toBe(2)
    const fh = items.find(i => i.title === '繁花')!
    expect(fh.region).toBe('大陆')
  })
  it('没 TMDB 元数据的点播只显示片名卡片，不编造海报评分', () => {
    const items = buildVodWallItems(VOD_WALL_VOD, [], {}, null)
    const qyn = items.find(i => i.title === '庆余年')!
    expect(qyn.poster).toBeUndefined()
    expect(qyn.vote).toBeUndefined()
    expect(qyn.genres).toEqual([])
    expect(qyn.status).toBe('unknown')
  })
  it('详情补上状态与集数：更新中给更新至N集，已完结给全N集', () => {
    const enrich = {
      '庆余年': { tmdb: { id: 9, mediaType: 'tv' as const, title: '庆余年', originalTitle: '', overview: '', firstDate: '2024-05-16', vote: 7.6 }, details: { genres: ['剧情'], region: '大陆', status: 'up' as const, episodes: 36, lastDate: '2024-06-03' } },
    }
    const items = buildVodWallItems(VOD_WALL_VOD, [], enrich, VOD_WALL_GENRES)
    const qyn = items.find(i => i.title === '庆余年')!
    expect(qyn.status).toBe('up')
    expect(qyn.curEp).toBe(36)
    expect(qyn.totalEps).toBe(36)
    expect(qyn.region).toBe('大陆')
  })
})

describe('watch.filterVodWall / sortVodWall（v0.1.395 筛选排序）', () => {
  const items = buildVodWallItems(VOD_WALL_VOD, VOD_WALL_TRENDING, {}, VOD_WALL_GENRES)
  it('类型筛：科幻只剩流浪地球2；没元数据的庆余年只在「全部」出现', () => {
    expect(filterVodWall(items, { genre: '科幻', year: '全部', region: '全部', status: 'all' }).map(i => i.title)).toEqual(['流浪地球2'])
    expect(filterVodWall(items, { genre: '剧情', year: '全部', region: '全部', status: 'all' }).map(i => i.title)).toEqual(['奥本海默', '繁花'])
  })
  it('年份筛：2023 只剩有日期的；更早为空', () => {
    expect(filterVodWall(items, { genre: '全部', year: '2023', region: '全部', status: 'all' }).map(i => i.title)).toEqual(['流浪地球2', '奥本海默', '繁花'])
    expect(filterVodWall(items, { genre: '全部', year: '更早', region: '全部', status: 'all' })).toHaveLength(0)
  })
  it('地区筛：大陆只剩繁花（剧集 origin_country），电影没详情时不进地区筛', () => {
    expect(filterVodWall(items, { genre: '全部', year: '全部', region: '大陆', status: 'all' }).map(i => i.title)).toEqual(['繁花'])
  })
  it('状态筛：有源可播 2 部，仅展示 2 部', () => {
    expect(filterVodWall(items, { genre: '全部', year: '全部', region: '全部', status: 'play' })).toHaveLength(2)
    expect(filterVodWall(items, { genre: '全部', year: '全部', region: '全部', status: 'none' })).toHaveLength(2)
    expect(filterVodWall(items, { genre: '全部', year: '全部', region: '全部', status: 'up' })).toHaveLength(0)
  })
  it('排序：评分最高按 vote 倒序（没评分沉底）；年份最新按年倒序', () => {
    expect(sortVodWall(items, 'rating').map(i => i.title)).toEqual(['繁花', '奥本海默', '流浪地球2', '庆余年'])
    expect(sortVodWall(items, 'year')[0].title).toBe('繁花')
    expect(sortVodWall(items, 'updated')[0].title).toBe('繁花')
  })
})

describe('watch.vodWallBadge（v0.1.395 卡片角标）', () => {
  it('电影永远「更新HD」；没状态的剧集只写「共N集」，不谎称完结', () => {
    const items = buildVodWallItems(VOD_WALL_VOD, VOD_WALL_TRENDING, {}, VOD_WALL_GENRES)
    expect(vodWallBadge(items.find(i => i.title === '流浪地球2')!)).toEqual({ cls: 'hd', text: '更新HD' })
    expect(vodWallBadge(items.find(i => i.title === '奥本海默')!)).toEqual({ cls: 'hd', text: '更新HD' })
    expect(vodWallBadge(items.find(i => i.title === '庆余年')!)).toEqual({ cls: 'plain', text: '共2集' })
  })
  it('更新中「更新至N集」，已完结「全N集·完结」', () => {
    const up = buildVodWallItems(VOD_WALL_VOD, [], { '庆余年': { details: { genres: [], status: 'up', episodes: 18 } } }, VOD_WALL_GENRES)
    expect(vodWallBadge(up.find(i => i.title === '庆余年')!)).toEqual({ cls: 'up', text: '更新至18集' })
    const done = buildVodWallItems(VOD_WALL_VOD, [], { '庆余年': { details: { genres: [], status: 'done', episodes: 36 } } }, VOD_WALL_GENRES)
    expect(vodWallBadge(done.find(i => i.title === '庆余年')!)).toEqual({ cls: 'done', text: '全36集 · 完结' })
  })
})

describe('watch.fetchTmdbGenres / searchTmdbTitle / fetchTmdbDetails（v0.1.395 TMDB 补全）', () => {
  it('类型列表拉一次后缓存，第二次不请求', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async (u: unknown) => {
      calls++
      const url = String(u)
      if (url.includes('/genre/movie/list')) return { ok: true, json: async () => ({ genres: [{ id: 28, name: '动作' }] }) }
      if (url.includes('/genre/tv/list')) return { ok: true, json: async () => ({ genres: [{ id: 18, name: '剧情' }] }) }
      throw new Error('unexpected ' + url)
    })
    const first = await fetchTmdbGenres('KEY')
    expect(first.movie[28]).toBe('动作')
    expect(first.tv[18]).toBe('剧情')
    const second = await fetchTmdbGenres('KEY')
    expect(second).toEqual(first)
    expect(calls).toBe(2)
  })
  it('按片名搜：标题完全一致的优先，否则按热度；搜不到缓存 null 不再问', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async (u: unknown) => {
      calls++
      const url = String(u)
      if (url.includes('/search/movie')) return { ok: true, json: async () => ({ results: [
        { id: 11, media_type: 'movie', title: '流浪地球', vote_average: 7.0, popularity: 50, genre_ids: [878], original_language: 'zh', release_date: '2019-02-05' },
        { id: 12, media_type: 'movie', title: '流浪地球2', vote_average: 7.9, popularity: 30, genre_ids: [878], original_language: 'zh', release_date: '2023-01-22' },
      ] }) }
      if (url.includes('/search/tv')) return { ok: true, json: async () => ({ results: [] }) }
      throw new Error('unexpected ' + url)
    })
    const found = await searchTmdbTitle('KEY', '流浪地球2')
    expect(found?.id).toBe(12) // 完全一致优先，哪怕热度更低
    expect(found?.vote).toBe(7.9)
    const again = await searchTmdbTitle('KEY', '流浪地球2')
    expect(again?.id).toBe(12)
    expect(calls).toBe(2) // 第二次走缓存，不请求
  })
  it('搜不到返回 null 且缓存 null，不编造海报（v0.1.431 AI 找剧推荐卡）', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async (u: unknown) => {
      calls++
      const url = String(u)
      if (url.includes('/search/movie') || url.includes('/search/tv')) return { ok: true, json: async () => ({ results: [] }) }
      throw new Error('unexpected ' + url)
    })
    const found = await searchTmdbTitle('KEY', '不存在的剧名XYZ')
    expect(found).toBeNull()
    const again = await searchTmdbTitle('KEY', '不存在的剧名XYZ')
    expect(again).toBeNull()
    expect(calls).toBe(2) // 第二次走缓存，不请求
  })
  it('详情：电影给地区+导演+主演；剧集给状态+集数；缓存 24 小时', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async (u: unknown) => {
      calls++
      const url = String(u)
      if (url.includes('/movie/123')) return { ok: true, json: async () => ({
        genres: [{ name: '科幻' }], production_countries: [{ iso_3166_1: 'CN' }],
        credits: { crew: [{ job: 'Director', name: '郭帆' }], cast: [{ name: '吴京' }, { name: '刘德华' }, { name: '李雪健' }, { name: '其他' }] },
      }) }
      if (url.includes('/tv/456')) return { ok: true, json: async () => ({
        genres: [{ name: '剧情' }], production_countries: [{ iso_3166_1: 'CN' }], status: 'Returning Series',
        number_of_episodes: 21, last_air_date: '2024-08-30',
        credits: { crew: [], cast: [{ name: '郭麒麟' }, { name: '吴镇宇' }] },
      }) }
      throw new Error('unexpected ' + url)
    })
    const m = await fetchTmdbDetails('KEY', 'movie', 123)
    expect(m.region).toBe('大陆')
    expect(m.director).toBe('郭帆')
    expect(m.cast).toBe('吴京、刘德华、李雪健')
    expect(m.status).toBeUndefined()
    const t = await fetchTmdbDetails('KEY', 'tv', 456)
    expect(t.status).toBe('up')
    expect(t.episodes).toBe(21)
    expect(t.lastDate).toBe('2024-08-30')
    await fetchTmdbDetails('KEY', 'movie', 123)
    expect(calls).toBe(2) // 第三次走缓存
  })
  it('详情接口失败不缓存、不抛错到墙（调用方 catch），401 直接抛', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({}) }))
    await expect(fetchTmdbDetails('BAD', 'movie', 1)).rejects.toThrow('401')
  })
})

describe('watch 海报墙结构（v0.1.395：WatchTool.tsx + styles.css）', () => {
  it('点播页签是海报墙：四排筛选 + 计数行 + 12 部一页 + 详情弹层（选集/线路/加片单/播放）', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../components/WatchTool.tsx', import.meta.url), 'utf8')
    for (const s of ['wt-wall-filters', 'wt-wall', 'wt-countbar', 'wt-sortbox', 'WALL_GENRES', 'WALL_YEARS', 'WALL_REGIONS', 'WALL_STATUS_FILTERS']) {
      expect(src).toContain(s)
    }
    // v0.1.408：墙网格抽成 WallGrid（点播与 18+ 共用），12 部一页的行为不变
    expect(src).toContain('pageSlice(items, page, 12)')
    expect(src).toContain('pageCount(items.length, 12)')
    // v0.1.424：点播墙分页栏贴底——stickyPager 只在点播墙用，18+ 墙不贴底
    expect(src).toContain('<WallGrid items={wallShown} page={vodPage} onPage={setVodPage} stickyPager />')
    expect(src).toContain('stickyPager?: boolean')
    expect(src).toContain('wt-pager-sticky')
    const css424 = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    expect(css424).toContain('.wt-pager-sticky { position: sticky; bottom: 14px;')
    expect(src).toContain('<WallGrid items={adultWallItems} page={adultWallPage} onPage={setAdultWallPage} />')
    for (const s of ['VodDetailSheet', 'wt-sheet-backdrop', 'wt-eps', 'wt-src-chips', 'wt-playbar', '暂无片源 · 仅展示', '＋ 加入片单']) {
      expect(src).toContain(s)
    }
    // 详情里选线路：播放用选中的集与线路
    expect(src).toContain('openVod(v, vodDetailEp, 0, vodDetailLine)')
    // 热门推荐带名次、继续观看带海报
    expect(src).toContain('wt-rank')
    expect(src).toContain('wt-cont-thumb')
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    for (const s of ['.wt-wall {', '.wt-wall-card', '.wt-wall-poster', '.wt-wall-badge', '.wt-wall-rate', '.wt-wall-veil', '.wt-sheet {', '.wt-play-btn', '.wt-rank']) {
      expect(css).toContain(s)
    }
    expect(css).toMatch(/\.wt-wall \{[^}]*grid-template-columns: repeat\(6, 1fr\)/s)
  })
})

const VALID_PLAYLIST = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.000000,\nhttp://example.com/seg0.ts\n#EXT-X-ENDLIST\n'
const MASTER_PLAYLIST = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nvar.m3u8\n'

/** fetch 桩：返回带 body.getReader() 的 Response 形对象（探针走分块读、到上限取消） */
function mockResp(status: number, body: string, contentType = 'application/vnd.apple.mpegurl') {
  const bytes = new TextEncoder().encode(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? contentType : null) },
    body: {
      getReader: () => {
        let done = false
        return {
          read: async () => {
            if (done) return { done: true, value: undefined }
            done = true
            return { done: false, value: bytes }
          },
          cancel: async () => {},
        }
      },
    },
    text: async () => body,
  }
}

/** 按 URL 分流的探针桩：dead → 两路都抛错；.ts 分片 → 206；主列表/变体/普通列表 → 200 有效列表 */
function probeFetchStub() {
  return vi.stubGlobal('fetch', async (u: unknown, init?: { mode?: string }) => {
    const s = String(u)
    if (s.includes('dead')) throw new TypeError('Load failed')
    if (init?.mode === 'no-cors') return {}
    if (s.endsWith('.ts')) return mockResp(206, 'x'.repeat(188), 'video/mp2t')
    if (s.includes('master')) return mockResp(200, MASTER_PLAYLIST)
    if (s.includes('var.m3u8')) return mockResp(200, VALID_PLAYLIST)
    return mockResp(200, VALID_PLAYLIST)
  })
}

// 源体检（v0.1.391 测连通性 → v0.1.411 真验流）：拉播放列表验分片才算通；
// 404/空列表/无有效分片/坏流/分片拉不到都判不通，失败原因如实返回
describe('watch.probeStreamUrl（v0.1.411 真验流探针）', () => {
  it('正常 m3u8（列表含分片、分片 206）→ 通，verified: true', async () => {
    probeFetchStub()
    const r = await probeStreamUrl('http://example.com/a.m3u8', 1000)
    expect(r.ok).toBe(true)
    expect(r.verified).toBe(true)
    expect(r.ms).toBeGreaterThanOrEqual(1)
  })
  it('404 → 不通，原因 HTTP 404', async () => {
    vi.stubGlobal('fetch', async (_u: unknown, init?: { mode?: string }) => {
      if (init?.mode === 'no-cors') return {}
      return mockResp(404, 'not found', 'text/plain')
    })
    const r = await probeStreamUrl('http://example.com/a.m3u8', 1000)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('HTTP 404')
    expect(r.verified).toBe(true)
  })
  it('空列表 → 不通，原因 空列表；返回网页 → 不通，原因含“网页”', async () => {
    vi.stubGlobal('fetch', async (u: unknown, init?: { mode?: string }) => {
      if (init?.mode === 'no-cors') return {}
      if (String(u).includes('empty')) return mockResp(200, '')
      return mockResp(200, '<!DOCTYPE html><html><body>oops</body></html>', 'text/html')
    })
    expect((await probeStreamUrl('http://example.com/empty.m3u8', 1000)).reason).toBe('空列表')
    const page = await probeStreamUrl('http://example.com/page.m3u8', 1000)
    expect(page.ok).toBe(false)
    expect(page.reason).toContain('网页')
  })
  it('列表无分片 → 不通，原因 无有效分片', async () => {
    vi.stubGlobal('fetch', async (_u: unknown, init?: { mode?: string }) => {
      if (init?.mode === 'no-cors') return {}
      return mockResp(200, '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n')
    })
    const r = await probeStreamUrl('http://example.com/a.m3u8', 1000)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('无有效分片')
  })
  it('主列表 + 好变体 → 通；主列表 + 死变体（404）→ 不通，原因含“子播放列表”', async () => {
    vi.stubGlobal('fetch', async (u: unknown, init?: { mode?: string }) => {
      const s = String(u)
      if (init?.mode === 'no-cors') return {}
      if (s.includes('deadvar')) return mockResp(404, 'not found', 'text/plain')
      if (s.endsWith('.ts')) return mockResp(206, 'x'.repeat(188), 'video/mp2t')
      if (s.includes('var.m3u8')) return mockResp(200, VALID_PLAYLIST)
      return mockResp(200, MASTER_PLAYLIST)
    })
    // 桩按 URL 含 master 分流：master.m3u8 → 主列表；masterdead.m3u8 的变体是 deadvar
    const good = await probeStreamUrl('http://example.com/master.m3u8', 1000)
    expect(good.ok).toBe(true)
    expect(good.verified).toBe(true)
    vi.stubGlobal('fetch', async (u: unknown, init?: { mode?: string }) => {
      const s = String(u)
      if (init?.mode === 'no-cors') return {}
      if (s.includes('deadvar')) return mockResp(404, 'not found', 'text/plain')
      if (s.endsWith('.ts')) return mockResp(206, 'x'.repeat(188), 'video/mp2t')
      return mockResp(200, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\ndeadvar.m3u8\n')
    })
    const bad = await probeStreamUrl('http://example.com/masterdead.m3u8', 1000)
    expect(bad.ok).toBe(false)
    expect(bad.reason).toContain('子播放列表')
  })
  it('分片 404 → 不通，原因含“分片拉不到”', async () => {
    vi.stubGlobal('fetch', async (u: unknown, init?: { mode?: string }) => {
      const s = String(u)
      if (init?.mode === 'no-cors') return {}
      if (s.endsWith('.ts')) return mockResp(404, 'not found', 'text/plain')
      return mockResp(200, VALID_PLAYLIST)
    })
    const r = await probeStreamUrl('http://example.com/a.m3u8', 1000)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('分片拉不到')
  })
  it('直链 mp4：Range 206 且非空 → 通；404 → 不通，原因 HTTP 404', async () => {
    vi.stubGlobal('fetch', async (u: unknown, init?: { mode?: string }) => {
      if (init?.mode === 'no-cors') return {}
      if (String(u).includes('dead')) return mockResp(404, 'not found', 'text/plain')
      return mockResp(206, 'x'.repeat(1024), 'video/mp4')
    })
    const good = await probeStreamUrl('http://example.com/a.mp4', 1000)
    expect(good.ok).toBe(true)
    expect(good.verified).toBe(true)
    const bad = await probeStreamUrl('http://example.com/dead.mp4', 1000)
    expect(bad.ok).toBe(false)
    expect(bad.reason).toBe('HTTP 404')
  })
  it('CORS 读不到正文（抛错）→ 退回连通性探测：通但 verified: false、原因含“仅测连通”；连通性也失败 → 不通', async () => {
    vi.stubGlobal('fetch', async (_u: unknown, init?: { mode?: string }) => {
      if (init?.mode === 'no-cors') return {}
      throw new TypeError('Load failed')
    })
    const r = await probeStreamUrl('http://example.com/a.m3u8', 1000)
    expect(r.ok).toBe(true)
    expect(r.verified).toBe(false)
    expect(r.reason).toContain('仅测连通')
    vi.stubGlobal('fetch', async () => { throw new TypeError('Load failed') })
    const r2 = await probeStreamUrl('http://example.com/a.m3u8', 1000)
    expect(r2.ok).toBe(false)
    expect(r2.verified).toBe(false)
  })
  it('非 http(s) 地址直接不通，不发请求；已取消的 signal 直接不通', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; return mockResp(200, VALID_PLAYLIST) })
    expect((await probeStreamUrl('not-a-url', 1000)).ok).toBe(false)
    expect((await probeStreamUrl('ftp://example.com/a.m3u8', 1000)).ok).toBe(false)
    const ctrl = new AbortController()
    ctrl.abort()
    expect((await probeStreamUrl('http://example.com/a.m3u8', 1000, ctrl.signal)).ok).toBe(false)
    expect(calls).toBe(0)
  })
  it('超时无响应 → 不通（不等无限久）', async () => {
    // 桩要像真 fetch 一样响应 abort 信号，否则超时后 await 永远不返回
    vi.stubGlobal('fetch', (_u: unknown, init?: { signal?: AbortSignal }) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const t0 = Date.now()
    const r = await probeStreamUrl('http://example.com/slow.m3u8', 30)
    expect(r.ok).toBe(false)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
  it('parseM3u8Segments：主列表提变体、媒体列表提分片，#EXT-X-KEY 的 URI 不算分片', () => {
    const p = parseM3u8Segments('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvar.m3u8\n')
    expect(p.isMaster).toBe(true)
    expect(p.variants).toEqual(['var.m3u8'])
    expect(p.segments).toEqual([])
    const m = parseM3u8Segments('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://example.com/key"\n#EXTINF:6,\nseg0.ts\n#EXTINF:6,\nseg1.ts\n')
    expect(m.isMaster).toBe(false)
    expect(m.segments).toEqual(['seg0.ts', 'seg1.ts'])
  })
  it('probeConnectivity：no-cors 响应头到了 → 通；抛错 → 不通', async () => {
    vi.stubGlobal('fetch', async () => ({}))
    expect((await probeConnectivity('http://example.com/a.m3u8', 1000)).ok).toBe(true)
    vi.stubGlobal('fetch', async () => { throw new TypeError('Load failed') })
    expect((await probeConnectivity('http://example.com/a.m3u8', 1000)).ok).toBe(false)
  })
})

describe('watch.probeStreamUrl 桌面通道（v0.1.411：plugin_http_media）', () => {
  const envelope = (status: number, body: string, headers: Record<string, string> = { 'content-type': 'application/vnd.apple.mpegurl' }) =>
    JSON.stringify({ status, body, headers })
  it('桌面走 plugin_http_media 取正文，fetch 不被调用；分片也走同一通道', async () => {
    let fetchCalls = 0
    vi.stubGlobal('fetch', async () => { fetchCalls++; return mockResp(200, VALID_PLAYLIST) })
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args: Record<string, unknown>) => {
          calls.push({ cmd, args })
          const url = String(args['url'] ?? '')
          if (url.endsWith('.ts')) return envelope(206, 'x'.repeat(188), { 'content-type': 'video/mp2t' })
          return envelope(200, VALID_PLAYLIST)
        },
      },
    })
    const r = await probeStreamUrl('http://example.com/a.m3u8', 1000)
    expect(r.ok).toBe(true)
    expect(r.verified).toBe(true)
    expect(fetchCalls).toBe(0)
    expect(calls.length).toBe(2)
    expect(calls[0].cmd).toBe('plugin_http_media')
    expect(calls[1].cmd).toBe('plugin_http_media')
    vi.unstubAllGlobals()
  })
  it('302 手动跟跳转：先 302 到变体地址，再 200 验通；超过 3 跳判不通', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('no fetch') })
    let n = 0
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {
        invoke: async (_cmd: string, args: Record<string, unknown>) => {
          n++
          const url = String(args['url'] ?? '')
          if (url.endsWith('.ts')) return envelope(206, 'x'.repeat(188), { 'content-type': 'video/mp2t' })
          if (n === 1) return envelope(302, '', { location: 'http://example.com/real.m3u8' })
          return envelope(200, VALID_PLAYLIST)
        },
      },
    })
    const r = await probeStreamUrl('http://example.com/a.m3u8', 1000)
    expect(r.ok).toBe(true)
    expect(n).toBe(3) // 列表 302 → 列表 200 → 分片 206
    vi.unstubAllGlobals()
  })
})

const HEALTH_CH = (key: string, urls: string[]): LiveChannel => ({ key, name: key, content: 'other', country: 'CN', urls, sourceIds: ['iptv-cn'] })

describe('watch.probeChannel / probeChannels（v0.1.411）', () => {
  it('第一条不通自动试下一条：通的那条即算通，记通的地址；失败带原因', async () => {
    probeFetchStub()
    const r = await probeChannel(HEALTH_CH('备用台', ['http://example.com/dead/a.m3u8', 'http://example.com/fast/b.m3u8']))
    expect(r.ok).toBe(true)
    expect(r.url).toBe('http://example.com/fast/b.m3u8')
    expect(r.verified).toBe(true)
    expect(typeof r.ms).toBe('number')
  })
  it('全部地址都不通 → 不通，url 记第一条，reason 记最后一条的失败原因', async () => {
    vi.stubGlobal('fetch', async (u: unknown, init?: { mode?: string }) => {
      if (init?.mode === 'no-cors') throw new TypeError('Load failed')
      if (String(u).includes('a.m3u8')) return mockResp(404, 'not found', 'text/plain')
      throw new TypeError('Load failed')
    })
    const r = await probeChannel(HEALTH_CH('死台', ['http://example.com/dead/a.m3u8', 'http://example.com/dead/b.m3u8']))
    expect(r.ok).toBe(false)
    expect(r.url).toBe('http://example.com/dead/a.m3u8')
    expect(r.reason).toBe('网络错误')
    expect(r.ms).toBeUndefined()
  })
  it('并行跑：onProgress 按完成数递增；并发数不超过上限', async () => {
    let live = 0
    let maxLive = 0
    vi.stubGlobal('fetch', async (u: unknown, init?: { mode?: string }) => {
      if (String(u).includes('dead')) throw new TypeError('Load failed')
      if (init?.mode === 'no-cors') return {}
      live++; maxLive = Math.max(maxLive, live)
      await new Promise(r => setTimeout(r, 15))
      live--
      if (String(u).endsWith('.ts')) return mockResp(206, 'x'.repeat(188), 'video/mp2t')
      return mockResp(200, VALID_PLAYLIST)
    })
    const chans = [
      HEALTH_CH('a', ['http://example.com/fast/a.m3u8']),
      HEALTH_CH('b', ['http://example.com/dead/b.m3u8']),
      HEALTH_CH('c', ['http://example.com/fast/c.m3u8']),
      HEALTH_CH('d', ['http://example.com/fast/d.m3u8']),
      HEALTH_CH('e', ['http://example.com/dead/e.m3u8']),
      HEALTH_CH('f', ['http://example.com/fast/f.m3u8']),
    ]
    const seen: number[] = []
    const out = await probeChannels(chans, { concurrency: 2, onProgress: (done) => { seen.push(done) } })
    expect(Object.keys(out)).toHaveLength(6)
    expect(out['a'].ok).toBe(true)
    expect(out['b'].ok).toBe(false)
    expect(seen).toEqual([1, 2, 3, 4, 5, 6])
    expect(maxLive).toBeLessThanOrEqual(2)
  })
  it('取消后停在已测的部分：返回部分结果，不再测剩下的', async () => {
    let playlistCalls = 0
    vi.stubGlobal('fetch', async (u: unknown, init?: { mode?: string }) => {
      if (init?.mode === 'no-cors') return {}
      if (String(u).endsWith('.m3u8')) playlistCalls++
      await new Promise(r => setTimeout(r, 10))
      if (String(u).endsWith('.ts')) return mockResp(206, 'x'.repeat(188), 'video/mp2t')
      return mockResp(200, VALID_PLAYLIST)
    })
    const ctrl = new AbortController()
    const chans = [1, 2, 3, 4, 5, 6].map(i => HEALTH_CH(`ch${i}`, [`http://example.com/fast/${i}.m3u8`]))
    const out = await probeChannels(chans, {
      concurrency: 1, signal: ctrl.signal,
      onProgress: (done) => { if (done === 2) ctrl.abort() },
    })
    expect(Object.keys(out).length).toBeLessThanOrEqual(2)
    expect(playlistCalls).toBeLessThanOrEqual(2)
  })
})

describe('watch 体检缓存（v0.1.391：30 分钟）', () => {
  it('保存后读回一致；超过 30 分钟的条目被丢掉', () => {
    saveHealthCache({
      'cctv-1': { ok: true, ms: 120, at: Date.now(), url: 'http://example.com/cctv1.m3u8' },
      'old-one': { ok: true, ms: 300, at: Date.now() - 31 * 60_000, url: 'http://example.com/old.m3u8' },
    })
    const back = loadHealthCache()
    expect(back['cctv-1']?.ok).toBe(true)
    expect(back['cctv-1']?.ms).toBe(120)
    expect(back['old-one']).toBeUndefined()
  })
  it('healthOf：缓存条目须是当前频道的某条地址，否则不用（防不同国家同名台串结果）', () => {
    const health: HealthMap = {
      'news': { ok: true, ms: 50, at: Date.now(), url: 'http://example.com/cn-news.m3u8' },
    }
    expect(healthOf(health, HEALTH_CH('news', ['http://example.com/cn-news.m3u8']))?.ok).toBe(true)
    expect(healthOf(health, HEALTH_CH('news', ['http://example.com/us-news.m3u8']))).toBeUndefined()
    expect(healthOf(health, HEALTH_CH('other', ['http://example.com/cn-news.m3u8']))).toBeUndefined()
  })
})

describe('watch.applyHealthView / healthCounts（v0.1.391 过滤排序）', () => {
  const chans = [
    HEALTH_CH('fast', ['http://example.com/fast.m3u8']),
    HEALTH_CH('slow', ['http://example.com/slow.m3u8']),
    HEALTH_CH('dead', ['http://example.com/dead.m3u8']),
    HEALTH_CH('untested', ['http://example.com/u.m3u8']),
  ]
  const health: HealthMap = {
    'fast': { ok: true, ms: 80, at: Date.now(), url: 'http://example.com/fast.m3u8' },
    'slow': { ok: true, ms: 900, at: Date.now(), url: 'http://example.com/slow.m3u8' },
    'dead': { ok: false, at: Date.now(), url: 'http://example.com/dead.m3u8' },
  }
  it('healthCounts：已测 3 · 通 2 · 不通 1；未验流的计入 unverified', () => {
    expect(healthCounts(chans, health)).toEqual({ tested: 3, ok: 2, bad: 1, unverified: 3 })
    expect(healthCounts(chans, {})).toEqual({ tested: 0, ok: 0, bad: 0, unverified: 0 })
    const verifiedHealth: HealthMap = {
      'fast': { ok: true, ms: 80, at: Date.now(), url: 'http://example.com/fast.m3u8', verified: true },
      'slow': { ok: true, ms: 900, at: Date.now(), url: 'http://example.com/slow.m3u8', verified: false, reason: '仅测连通（浏览器跨域限制，未验流）' },
      'dead': { ok: false, at: Date.now(), url: 'http://example.com/dead.m3u8', verified: true, reason: 'HTTP 404' },
    }
    expect(healthCounts(chans, verifiedHealth)).toEqual({ tested: 3, ok: 2, bad: 1, unverified: 1 })
  })
  it('只看已测通的：只剩通的台', () => {
    expect(applyHealthView(chans, health, { onlyHealthy: true }).map(c => c.key)).toEqual(['fast', 'slow'])
  })
  it('快的排前面：通的按耗时升序，未测的居中，死的沉底；原顺序不打乱', () => {
    expect(applyHealthView(chans, health, { sortBySpeed: true }).map(c => c.key))
      .toEqual(['fast', 'slow', 'untested', 'dead'])
    // 列表顺序打乱时仍按耗时排：慢台在前、快台在后 → 快台提到前面
    const shuffled = [chans[1], chans[0], chans[2]]
    expect(applyHealthView(shuffled, health, { sortBySpeed: true }).map(c => c.key))
      .toEqual(['fast', 'slow', 'dead'])
  })
  it('不开启过滤/排序时原样返回', () => {
    expect(applyHealthView(chans, health)).toEqual(chans)
    expect(applyHealthView(chans, {})).toEqual(chans)
  })
})

describe('watch 源体检结构（v0.1.391：WatchTool.tsx + styles.css）', () => {
  it('直播页签有体检入口、状态行、过滤/排序开关；频道卡片按结果打角标', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../components/WatchTool.tsx', import.meta.url), 'utf8')
    for (const s of ['开始体检', '体检中', '停止', '上次体检', '显示已测不通的台', '快的排前面', '重新体检', 'startHealth', 'probeChannels', 'applyHealthView', 'healthCounts', 'loadHealthCache', 'wt-health-bar', 'wt-health-ok', 'wt-health-bad', 'wt-channel-dead', '仅测连通']) {
      expect(src).toContain(s)
    }
    // 死台变淡、不通角标；通的角标带耗时
    expect(src).toContain('✗ 不通')
    expect(src).toContain('✓ {h.ms}ms')
    // 体检不自动跑：没有在打开直播/切换国家时自动调用 startHealth
    expect(src).not.toMatch(/useEffect\(\(\) => \{[^}]*startHealth/s)
    // 394 横向页签与 395 海报墙未动
    expect(src).toContain("activeTab === 'live'")
    expect(src).toContain('wt-wall')
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    for (const s of ['.wt-health-ok {', '.wt-health-bad {', '.wt-channel-dead {', '.wt-health-bar {']) {
      expect(css).toContain(s)
    }
  })
})

describe('watch FLV 分类（v0.1.407：Dongguan 台）', () => {
  const DONGGUAN_FLV = 'http://stream.sun0769.com/dgrtv1/mp4tv1_1500.flv'
  it('isFlvUrl：.flv 认出来（带 query 也认），m3u8/mp4 不是', () => {
    expect(isFlvUrl(DONGGUAN_FLV)).toBe(true)
    expect(isFlvUrl('http://example.com/a.flv?token=1')).toBe(true)
    expect(isFlvUrl('http://example.com/a.m3u8')).toBe(false)
    expect(isFlvUrl('http://example.com/a.mp4')).toBe(false)
  })
  it('Dongguan 台：新闻分组的 .flv 不再判成点播；电影/剧集分组的 .flv 仍是点播', () => {
    expect(isVodUrl(DONGGUAN_FLV, 'news')).toBe(false)
    expect(isVodUrl(DONGGUAN_FLV)).toBe(false)
    expect(isVodUrl(DONGGUAN_FLV, 'movies')).toBe(true)
    expect(isVodUrl(DONGGUAN_FLV, 'series')).toBe(true)
  })
  it('真实条目：Dongguan 台留在直播、不进点播；mp4 电影仍进点播', async () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="DongguanComprehensiveNewsChannel.cn@SD" group-title="News",Dongguan Comprehensive News Channel
${DONGGUAN_FLV}
#EXTINF:-1 tvg-id="Movie1" group-title="Movies",Test Movie
http://example.com/movie.mp4
`
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => m3u }))
    const set: SourceSet = { id: 'custom-vod', label: '测试点播源', url: 'https://example.com/vod.m3u', country: 'WORLD' }
    const { channels } = await fetchSourceSet(set)
    expect(channels.some(c => c.name.includes('Dongguan'))).toBe(true)
    const vod = channelsToVod(channels)
    expect(vod.some(v => v.title.includes('Dongguan'))).toBe(false)
    expect(vod.some(v => v.title === 'Test Movie')).toBe(true)
  })
})

const VOD_A: VodTitle = {
  key: 'movie-a', title: 'Movie A', kind: 'movie',
  episodes: [{ label: '正片', urls: ['http://example.com/fast/a.mp4', 'http://example.com/dead/a2.mp4'], episodeNo: 0, unofficial: false }],
  sourceIds: ['custom-vod'], unofficial: false,
}
const VOD_B: VodTitle = {
  key: 'series-b', title: 'Series B', kind: 'series',
  episodes: [
    { label: '第 1 集', urls: ['http://example.com/dead/b1.mp4'], episodeNo: 1, unofficial: false },
    { label: '第 2 集', urls: ['http://example.com/fast/b2.mp4'], episodeNo: 2, unofficial: false },
  ],
  sourceIds: ['custom-vod'], unofficial: false,
}
const VOD_DEAD: VodTitle = {
  key: 'movie-dead', title: 'Dead Movie', kind: 'movie',
  episodes: [{ label: '正片', urls: ['http://example.com/dead/d.mp4'], episodeNo: 0, unofficial: false }],
  sourceIds: ['custom-vod'], unofficial: false,
}

describe('watch 点播体检（v0.1.407：probeVodTitle / vodHealthOf / vodHealthCounts / applyVodHealthView）', () => {
  // 点播 mp4 桩：dead → 两路都抛错；其余 → Range 206 非空
  const vodFetchStub = () => vi.stubGlobal('fetch', async (u: unknown) => {
    if (String(u).includes('dead')) throw new TypeError('Load failed')
    return mockResp(206, 'x'.repeat(1024), 'video/mp4')
  })
  it('按集顺序、每集按线路顺序逐条试：第一条通的即算通，记通的地址与集', async () => {
    vodFetchStub()
    const r = await probeVodTitle(VOD_A)
    expect(r.ok).toBe(true)
    expect(r.url).toBe('http://example.com/fast/a.mp4')
    expect(r.episode).toBe('正片')
    expect(r.verified).toBe(true)
    expect(typeof r.ms).toBe('number')
  })
  it('第一集死、第二集通 → 整部算通，记第二集', async () => {
    vodFetchStub()
    const r = await probeVodTitle(VOD_B)
    expect(r.ok).toBe(true)
    expect(r.episode).toBe('第 2 集')
  })
  it('全部线路都不通 → 不通，url 记第一集第一条，reason 有值', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Load failed') })
    const r = await probeVodTitle(VOD_DEAD)
    expect(r.ok).toBe(false)
    expect(r.url).toBe('http://example.com/dead/d.mp4')
    expect(r.reason).toBe('网络错误')
  })
  it('vodHealthOf：键带 vod: 前缀，缓存条目须是该片某条地址；直播键不串进来', () => {
    const health: HealthMap = {
      'vod:movie-a': { ok: true, ms: 90, at: Date.now(), url: 'http://example.com/fast/a.mp4' },
    }
    expect(vodHealthOf(health, VOD_A)?.ok).toBe(true)
    expect(vodHealthOf(health, VOD_A)?.ms).toBe(90)
    expect(vodHealthOf({ 'movie-a': { ok: true, ms: 90, at: Date.now(), url: 'http://example.com/fast/a.mp4' } }, VOD_A)).toBeUndefined()
    const other: HealthMap = { 'vod:movie-a': { ok: true, ms: 90, at: Date.now(), url: 'http://example.com/other.mp4' } }
    expect(vodHealthOf(other, VOD_A)).toBeUndefined()
  })
  it('vodHealthCounts / applyVodHealthView：只看能播的 + 快的排前面', () => {
    const health: HealthMap = {
      'vod:movie-a': { ok: true, ms: 90, at: Date.now(), url: 'http://example.com/fast/a.mp4' },
      'vod:movie-dead': { ok: false, at: Date.now(), url: 'http://example.com/dead/d.mp4' },
    }
    const titles = [VOD_DEAD, VOD_A, VOD_B]
    expect(vodHealthCounts(titles, health)).toEqual({ tested: 2, ok: 1, bad: 1, unverified: 2 })
    // 墙条目形（{ vod }）：点播体检视图作用在墙条目上
    const wall = [{ vod: VOD_DEAD }, { vod: VOD_A }, { vod: VOD_B }]
    expect(applyVodHealthView(wall, health, { onlyHealthy: true }).map(i => i.vod!.key)).toEqual(['movie-a'])
    expect(applyVodHealthView(wall, health, { sortBySpeed: true }).map(i => i.vod!.key))
      .toEqual(['movie-a', 'series-b', 'movie-dead'])
    expect(applyVodHealthView(wall, health)).toEqual(wall)
  })
  it('v0.1.416 hideDead：只藏已测不通的，通的、未测的、没源只展示的都留着', () => {
    const health: HealthMap = {
      'vod:movie-a': { ok: true, ms: 90, at: Date.now(), url: 'http://example.com/fast/a.mp4' },
      'vod:movie-dead': { ok: false, at: Date.now(), url: 'http://example.com/dead/d.mp4' },
    }
    // 墙条目：死的、通的、未测的、没源只展示的（无 vod）
    const wall = [{ vod: VOD_DEAD }, { vod: VOD_A }, { vod: VOD_B }, {}]
    const keys = (items: { vod?: VodTitle }[]) => items.map(i => i.vod?.key ?? 'show-only')
    expect(keys(applyVodHealthView(wall, health, { hideDead: true }))).toEqual(['movie-a', 'series-b', 'show-only'])
    expect(keys(applyVodHealthView(wall, health, { hideDead: false }))).toEqual(['movie-dead', 'movie-a', 'series-b', 'show-only'])
    expect(keys(applyVodHealthView(wall, health, { hideDead: true, onlyHealthy: true }))).toEqual(['movie-a'])
    expect(keys(applyVodHealthView(wall, health, { hideDead: true, sortBySpeed: true }))).toEqual(['movie-a', 'series-b', 'show-only'])
  })
  it('probeVodTitles：批量跑，键带 vod: 前缀', async () => {
    vodFetchStub()
    const out = await probeVodTitles([VOD_A, VOD_DEAD])
    expect(out['vod:movie-a'].ok).toBe(true)
    expect(out['vod:movie-a'].verified).toBe(true)
    expect(out['vod:movie-dead'].ok).toBe(false)
    expect(out['vod:movie-dead'].reason).toBe('网络错误')
  })
})

describe('watch 已测不通的台默认隐藏（v0.1.407）', () => {
  const chans = [
    HEALTH_CH('fast', ['http://example.com/fast.m3u8']),
    HEALTH_CH('dead', ['http://example.com/dead.m3u8']),
    HEALTH_CH('untested', ['http://example.com/u.m3u8']),
  ]
  const health: HealthMap = {
    'fast': { ok: true, ms: 80, at: Date.now(), url: 'http://example.com/fast.m3u8' },
    'dead': { ok: false, at: Date.now(), url: 'http://example.com/dead.m3u8' },
  }
  it('hideDead：只藏已测不通的，通的与未测的都留着', () => {
    expect(applyHealthView(chans, health, { hideDead: true }).map(c => c.key)).toEqual(['fast', 'untested'])
    expect(applyHealthView(chans, health, { hideDead: false }).map(c => c.key)).toEqual(['fast', 'dead', 'untested'])
  })
  it('hideDead 与快的排前面可叠加', () => {
    expect(applyHealthView(chans, health, { hideDead: true, sortBySpeed: true }).map(c => c.key)).toEqual(['fast', 'untested'])
  })
  it('开关默认关；存取往返', () => {
    expect(loadShowDead()).toBe(false)
    saveShowDead(true)
    expect(loadShowDead()).toBe(true)
    saveShowDead(false)
    expect(loadShowDead()).toBe(false)
  })
})

describe('watch 已测不通的点播默认隐藏（v0.1.416）', () => {
  it('点播开关默认关；存取往返；与直播开关各存各的键', () => {
    expect(loadShowDeadVod()).toBe(false)
    saveShowDeadVod(true)
    expect(loadShowDeadVod()).toBe(true)
    expect(loadShowDead()).toBe(false)
    saveShowDeadVod(false)
    expect(loadShowDeadVod()).toBe(false)
  })
})

describe('watch 点播页可折叠（v0.1.417）', () => {
  it('两处折叠默认展开；存取往返；各存各的键', () => {
    expect(loadVodTvboxCollapsed()).toBe(false)
    expect(loadVodFiltersCollapsed()).toBe(false)
    saveVodTvboxCollapsed(true)
    expect(loadVodTvboxCollapsed()).toBe(true)
    expect(loadVodFiltersCollapsed()).toBe(false)
    saveVodFiltersCollapsed(true)
    expect(loadVodFiltersCollapsed()).toBe(true)
    saveVodTvboxCollapsed(false)
    saveVodFiltersCollapsed(false)
    expect(loadVodTvboxCollapsed()).toBe(false)
    expect(loadVodFiltersCollapsed()).toBe(false)
  })
})

describe('watch TVBox 资源站测活（v0.1.418：probeTvboxSite / probeTvboxSites）', () => {
  const jsonSite: TvboxSite = { key: 'cfg:官源蓝光', name: '官源蓝光', type: 1, api: 'https://example.com/api.php/provide/vod/' }
  const xmlSite: TvboxSite = { key: 'cfg:大地资源', name: '大地资源', type: 0, api: 'https://dadiapi.com/api.php' }
  const JSON_ALIVE = JSON.stringify({ code: 1, page: 1, pagecount: 1, total: 1, list: [{ vod_name: '流浪地球2', vod_play_url: '正片$https://cdn/a.mp4' }] })
  const JSON_EMPTY = JSON.stringify({ code: 1, page: 1, pagecount: 0, total: 0, list: [] })
  const JSON_REFUSED = JSON.stringify({ code: 0, msg: 'key错误', list: [] })
  const XML_ALIVE = '<rss><list page="1" pagecount="1" recordcount="1"><video><name>流浪地球2</name><dl><dd flag="线路1">正片$https://cdn/a.mp4</dd></dl></video></list></rss>'
  const XML_EMPTY = '<rss><list page="1" pagecount="0" recordcount="0"></list></rss>'

  it('活站：code=1 且有数据算活；请求地址带 ac=videolist&pg=1', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: unknown) => {
      seen.push(String(url))
      return { ok: true, text: async () => (String(url).includes('dadiapi') ? XML_ALIVE : JSON_ALIVE) }
    })
    const j = await probeTvboxSite(jsonSite)
    expect(j.ok).toBe(true)
    expect(j.url).toBe(jsonSite.api)
    expect(typeof j.ms).toBe('number')
    const x = await probeTvboxSite(xmlSite)
    expect(x.ok).toBe(true)
    expect(seen.every(u => u.includes('ac=videolist&pg=1'))).toBe(true)
  })
  it('死站：空列表 / code 非 1 / 非 CMS 文本 / HTTP 403 / 网络失败都算死并带中文原因', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => JSON_EMPTY }))
    expect(await probeTvboxSite(jsonSite)).toMatchObject({ ok: false, reason: '站返回空片单（0 条）' })
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => JSON_REFUSED }))
    expect((await probeTvboxSite(jsonSite)).reason).toContain('资源站拒绝了请求')
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '<html>hello</html>' }))
    expect((await probeTvboxSite(jsonSite)).reason).toContain('不是标准苹果 CMS 数据')
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 403, text: async () => '' }))
    expect((await probeTvboxSite(jsonSite)).reason).toContain('HTTP 403')
    vi.stubGlobal('fetch', async () => { throw new TypeError('Load failed') })
    expect((await probeTvboxSite(jsonSite)).reason).toContain('网络请求失败')
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => XML_EMPTY }))
    expect(await probeTvboxSite(xmlSite)).toMatchObject({ ok: false, reason: '站返回空片单（0 条）' })
  })
  it('siteHealthKey / siteHealthOf / siteHealthCounts：键带 site: 前缀；api 对不上算旧残留不用', () => {
    const health: HealthMap = {
      [siteHealthKey(jsonSite)]: { ok: true, ms: 120, at: Date.now(), url: jsonSite.api },
      [siteHealthKey(xmlSite)]: { ok: false, at: Date.now(), url: 'https://other.example.com/api.php', reason: 'HTTP 403' },
    }
    expect(siteHealthKey(jsonSite)).toBe('site:cfg:官源蓝光')
    expect(siteHealthOf(health, jsonSite)?.ok).toBe(true)
    // xml 站的缓存条目 url 与当前 api 不符 → 不用
    expect(siteHealthOf(health, xmlSite)).toBeUndefined()
    expect(siteHealthCounts([jsonSite, xmlSite], health)).toEqual({ tested: 1, ok: 1, bad: 0 })
    expect(siteHealthCounts([jsonSite, xmlSite], {})).toEqual({ tested: 0, ok: 0, bad: 0 })
  })
  it('probeTvboxSites：一批站 4 路并行、进度回调逐个回推、结果键带 site: 前缀', async () => {
    const sites: TvboxSite[] = [1, 2, 3].map(i => ({ key: `cfg:站${i}`, name: `站${i}`, type: 1, api: `https://s${i}.example.com/api.php` }))
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url)
      if (u.includes('s2.example.com')) return { ok: false, status: 403, text: async () => '' }
      return { ok: true, text: async () => JSON_ALIVE }
    })
    const progress: Array<[number, number]> = []
    const out = await probeTvboxSites(sites, { onProgress: (done, total) => { progress.push([done, total]) } })
    expect(Object.keys(out).sort()).toEqual(['site:cfg:站1', 'site:cfg:站2', 'site:cfg:站3'])
    expect(out['site:cfg:站1'].ok).toBe(true)
    expect(out['site:cfg:站2'].ok).toBe(false)
    expect(out['site:cfg:站3'].ok).toBe(true)
    expect(progress).toHaveLength(3)
    expect(progress[2]).toEqual([3, 3])
  })
  it('probeTvboxSites：开始前已取消 → 一个不测、不调 fetch、返回空结果', async () => {
    const sites: TvboxSite[] = [{ key: 'cfg:站1', name: '站1', type: 1, api: 'https://s1.example.com/api.php' }]
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => JSON_ALIVE }))
    vi.stubGlobal('fetch', fetchMock)
    const ctrl = new AbortController()
    ctrl.abort()
    const out = await probeTvboxSites(sites, { signal: ctrl.signal })
    expect(out).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('站点隐藏开关默认关；存取往返；与点播开关各存各的键', () => {
    expect(loadShowDeadSites()).toBe(false)
    saveShowDeadSites(true)
    expect(loadShowDeadSites()).toBe(true)
    expect(loadShowDeadVod()).toBe(false)
    saveShowDeadSites(false)
    expect(loadShowDeadSites()).toBe(false)
  })
})

describe('watch v0.1.418 结构（WatchTool.tsx）', () => {
  it('测站点入口、死站 ✗ 与默认隐藏、体检按钮常驻都在', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../components/WatchTool.tsx', import.meta.url), 'utf8')
    for (const s of [
      '测站点', '测站中', 'startSiteHealth', 'stopSiteHealth', 'siteHealthCountsNow',
      '上次测站', '死的站已默认隐藏', 'probeTvboxSites', 'siteHealthOf', 'siteHealthCounts',
      'visibleTvboxSites', '显示已测不通的站点', 'loadShowDeadSites', 'saveShowDeadSites', 'showDeadSites',
      'site: 前缀',
      // v0.1.418 ②：体检按钮不再包在 allVodTitles.length > 0 里，灰掉 + 写清原因
      '墙上没片子，先选一个能拉出片单的站', '拉取失败，墙上没片子可测', '正在拉取片单…',
    ]) {
      expect(src).toContain(s)
    }
    // 点播体检按钮行不再整个被 allVodTitles.length > 0 包住：该条件只剩健康栏一处
    const gated = src.match(/\{allVodTitles\.length > 0 && \(/g) ?? []
    expect(gated).toHaveLength(1)
  })
})

describe('watch v0.1.407 结构（WatchTool.tsx + styles.css）', () => {
  it('播放器失败态在视频区内、加载态、FLV、点播体检、死台隐藏开关都在', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../components/WatchTool.tsx', import.meta.url), 'utf8')
    for (const s of [
      'wt-vload', 'wt-vfail', '正在加载…', '再试一次',
      'FlvJs', 'isFlvUrl', 'flv.js',
      'startVodHealth', 'stopVodHealth', 'vodHealthCountsNow', '只看能播的',
      '显示已测不通的台', 'loadShowDead', 'saveShowDead', 'hideDead',
      // v0.1.416：点播默认隐藏 + 开关 + 计数行 + TVBox 同样进体检
      '显示已测不通的点播', 'loadShowDeadVod', 'saveShowDeadVod', 'showDeadVod',
      '已隐藏', '点播体检', 'allVodTitles',
      // v0.1.417：点播页两处可折叠——TVBox 资源站 chips 行 + 筛选区
      'loadVodTvboxCollapsed', 'saveVodTvboxCollapsed', 'loadVodFiltersCollapsed', 'saveVodFiltersCollapsed',
      'tvboxSitesCollapsed', 'vodFiltersCollapsed', 'wt-filters-toggle',
      'wt-wall-card-dead', '✓ {vh.ms}ms', '✗ 不通',
    ]) {
      expect(src).toContain(s)
    }
    // v0.1.410：播放器改悬浮后 407 的 scrollIntoView 已无用——fixed 面板本来就在视口内
    expect(src).not.toContain('scrollIntoView')
    expect(src).not.toContain('playerWrapRef')
    // （BlockedPlayer 的有意提示仍用 wt-player-fail，不算在内）
    expect(src).not.toContain('<div className="wt-player-fail">\n          <CircleAlert size={18} />\n          <div>这个台试了')
    expect(src).not.toContain('<div className="wt-player-fail">\n          <CircleAlert size={18} />\n          <div>这集试了')
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    for (const s of ['.wt-vload {', '.wt-vfail {', '.wt-wall-card-dead {', 'min-width: 0;']) {
      expect(css).toContain(s)
    }
    // 视频区定高在 wrap 上（16:9），video 本身绝对定位铺满，不再靠自身撑高
    expect(css).toContain('.wt-video-wrap { position: relative; background: #000; aspect-ratio: 16 / 9; }')
    expect(css).toContain('.wt-video { position: absolute; inset: 0; width: 100%; height: 100%;')
  })
})

describe('watch TVBox 配置解析（v0.1.408：parseTvboxConfig）', () => {
  // test1.json 的缩小版：type 0/1 各 1 个、type 3 两个、type 4 一个、重复 key 一个、api 带前导空格一个
  const TVBOX_FIXTURE = JSON.stringify({
    wallpaper: 'https://example.com/wallpaper',
    spider: 'https://example.com/jar.jpg;md5;abc',
    sites: [
      { key: '官源蓝光', name: '💥官源蓝光💥', type: 1, api: 'http://154.219.117.232:9981/jacloudapi.php/provide/vod/from/qq/?ac=list' },
      { key: '大地资源', name: '💞大地资源💞', type: 0, api: 'https://dadiapi.com/api.php' },
      { key: '91AV', name: '👭91AV👭', type: 1, api: 'https://91av.cyou/api.php/provide/vod/' },
      { key: '豆瓣', name: '💥豆瓣💥', type: 3, api: 'https://example.com/drpy2.min.js', ext: 'https://example.com/douban.js' },
      { key: 'pornhub163', name: '💥pornhub163💥', type: 3, api: 'https://example.com/pornhub163.py' },
      { key: 'py聚合', name: '👭py聚合👭', type: 4, api: 'http://example.com/py.php' },
      { key: '龙马', name: '💞龙马💞', type: 1, api: ' http://jhysj.jiaheyy.top/api.php/provide/vod/?ac=list' },
      { key: '龙马', name: '💞龙马（重复）💞', type: 1, api: 'http://jhysj.jiaheyy.top/api.php/provide/vod/' },
    ],
    parses: [{ name: '解析1', type: 1, url: 'https://example.com/jx/?url=' }],
    lives: [{ name: '直播合集', type: 0, url: 'https://example.com/live.txt' }],
  })

  it('解析：type 0/1 可接、type 3 爬虫站与 type 4 聚合跳过、重复 key 去重', () => {
    const r = parseTvboxConfig(TVBOX_FIXTURE)
    expect(r.error).toBeUndefined()
    expect(r.total).toBe(7)
    expect(r.usable.map(s => s.key)).toEqual(['官源蓝光', '大地资源', '91AV', '龙马'])
    expect(r.usable.find(s => s.key === '龙马')?.api).toBe('http://jhysj.jiaheyy.top/api.php/provide/vod/?ac=list')
    expect(r.skippedSpider).toBe(2)
    expect(r.skippedOther).toBe(1)
  })
  it('裸数组也能解析；空串 / 非 JSON / 无 sites 时报错写清原因', () => {
    expect(parseTvboxConfig('[{"key":"a","name":"a","type":1,"api":"https://example.com/api.php"}]').usable).toHaveLength(1)
    expect(parseTvboxConfig('').error).toContain('空')
    expect(parseTvboxConfig('not json').error).toContain('JSON 解析失败')
    expect(parseTvboxConfig('{"foo":1}').error).toContain('没有 sites')
    expect(parseTvboxConfig('#EXTM3U\n#EXTINF:-1,台\nhttp://example.com/x.m3u8').error).toContain('JSON 解析失败')
  })
  it('isTvboxConfigText：JSON 配置认得，m3u 不认', () => {
    expect(isTvboxConfigText(TVBOX_FIXTURE)).toBe(true)
    expect(isTvboxConfigText('#EXTM3U\n#EXTINF:-1,台\nhttp://example.com/x.m3u8')).toBe(false)
    expect(isTvboxConfigText('')).toBe(false)
  })
})

describe('watch 18+ 站名判断（v0.1.408：isAdultTvboxSite）', () => {
  const site = (name: string, type = 1): TvboxSite => ({ key: name, name, type, api: 'https://example.com/api.php' })
  it('成人站：91AV、pornhub163、missav、madou、成人短剧、18x 都认', () => {
    for (const n of ['👭91AV👭', '💥pornhub163💥', '💥missav免翻全分类版💥', '💥madou8💥', '💥2048成人短剧💥', '💥Korean18x💥', '💥SexKBJ💥', '💥禁果短剧💥', '💥精仙阁💥', '💥绅士影视💥', '💥茄子精品💥', '💥搜AV资源💥']) {
      expect(isAdultTvboxSite(site(n))).toBe(true)
    }
  })
  it('普通站：官源蓝光、爱蛋影视、豆瓣、片库、龙马不认', () => {
    for (const n of ['💥官源蓝光💥', '💞爱蛋影视💞', '💥豆瓣💥', '💥片库💥', '💞龙马💞', '💥88影视💥']) {
      expect(isAdultTvboxSite(site(n))).toBe(false)
    }
  })
})

describe('watch 苹果 CMS（v0.1.408：cmsListUrl / cmsPlayUrlToEpisodes / cmsItemToVodTitle）', () => {
  it('片单地址：去掉原有查询串，.php 结尾直接拼、目录结尾先补 /', () => {
    expect(cmsListUrl('https://lovedan.net/api.php/provide/vod/', 2)).toBe('https://lovedan.net/api.php/provide/vod/?ac=videolist&pg=2')
    expect(cmsListUrl('http://154.219.117.232:9981/jacloudapi.php/provide/vod/from/qq/?ac=list', 1)).toBe('http://154.219.117.232:9981/jacloudapi.php/provide/vod/from/qq/?ac=videolist&pg=1')
    expect(cmsListUrl('https://dadiapi.com/api.php', 1)).toBe('https://dadiapi.com/api.php?ac=videolist&pg=1')
  })
  it('选集：电影正片单源多线路合并；剧集按集号分集、同集多源合并；无标签整段即地址', () => {
    const eps = cmsPlayUrlToEpisodes('正片$https://cdn/a.mp4$$$正片$https://cdn/b.mp4')
    expect(eps).toHaveLength(1)
    expect(eps[0].label).toBe('')
    expect(eps[0].episodeNo).toBe(0)
    expect(eps[0].urls).toEqual(['https://cdn/a.mp4', 'https://cdn/b.mp4'])
    const eps2 = cmsPlayUrlToEpisodes('第01集$https://cdn/q1.mp4#第02集$https://cdn/q2.mp4#第02集$https://cdn/q2b.mp4')
    expect(eps2).toHaveLength(2)
    expect(eps2[0].episodeNo).toBe(1)
    expect(eps2[1].episodeNo).toBe(2)
    expect(eps2[1].urls).toEqual(['https://cdn/q2.mp4', 'https://cdn/q2b.mp4'])
    const eps3 = cmsPlayUrlToEpisodes('https://cdn/only.mp4')
    expect(eps3).toHaveLength(1)
    expect(eps3[0].episodeNo).toBe(0)
    expect(eps3[0].urls).toEqual(['https://cdn/only.mp4'])
    const eps4 = cmsPlayUrlToEpisodes('HD$https://cdn/hd.mp4#BD$https://cdn/bd.mp4')
    expect(eps4).toHaveLength(1)
    expect(eps4[0].episodeNo).toBe(0)
  })
  it('影片：多集算剧集、单集算电影；无片名或无可用线路返回 null', () => {
    const series = cmsItemToVodTitle({ vod_name: '庆余年', vod_play_from: '线路1', vod_play_url: '第01集$https://cdn/q1.mp4#第02集$https://cdn/q2.mp4' }, 'tvbox:x')
    expect(series?.kind).toBe('series')
    expect(series?.episodes.map(e => e.label)).toEqual(['第 1 集', '第 2 集'])
    const movie = cmsItemToVodTitle({ vod_name: '流浪地球2', vod_play_url: '正片$https://cdn/a.mp4' }, 'tvbox:x')
    expect(movie?.kind).toBe('movie')
    expect(movie?.episodes[0].label).toBe('正片')
    expect(cmsItemToVodTitle({ vod_name: '', vod_play_url: '正片$https://cdn/a.mp4' }, 'tvbox:x')).toBeNull()
    expect(cmsItemToVodTitle({ vod_name: '空片', vod_play_url: '' }, 'tvbox:x')).toBeNull()
    expect(cmsItemToVodTitle({ vod_name: '坏片', vod_play_url: '正片$not-a-url' }, 'tvbox:x')).toBeNull()
  })
})

describe('watch 苹果 CMS 片单解析（v0.1.408：parseCmsJsonList / parseCmsXmlList）', () => {
  const JSON_FIXTURE = {
    code: 1, page: 1, pagecount: 2, total: 3,
    list: [
      { vod_name: '流浪地球2', vod_pic: 'https://x/p.jpg', vod_play_from: '线路1$$$线路2', vod_play_url: '正片$https://cdn/a.mp4$$$正片$https://cdn/b.mp4' },
      { vod_name: '庆余年', vod_play_from: '线路1', vod_play_url: '第01集$https://cdn/q1.mp4#第02集$https://cdn/q2.mp4' },
      { vod_name: '空片', vod_play_url: '' },
    ],
  }
  it('JSON：片单转点播标题、总数与页数照搬；无线路的片跳过', () => {
    const r = parseCmsJsonList(JSON_FIXTURE, 'tvbox:官源蓝光')
    expect(r.error).toBeUndefined()
    expect(r.titles).toHaveLength(2)
    expect(r.total).toBe(3)
    expect(r.pageCount).toBe(2)
    expect(r.titles[0].title).toBe('流浪地球2')
    expect(r.titles[0].episodes[0].urls).toHaveLength(2)
    expect(r.titles[1].kind).toBe('series')
  })
  it('JSON：code 非 1 按资源站拒绝处理；list 缺失报格式错', () => {
    expect(parseCmsJsonList({ code: 0, msg: 'key error' }, 'tvbox:x').error).toContain('资源站拒绝了请求')
    expect(parseCmsJsonList({ code: 1 }, 'tvbox:x').error).toContain('不是标准苹果 CMS 数据')
  })
  const XML_FIXTURE = `<rss><list page="1" pagecount="3" recordcount="2"><video><id>1</id><name><![CDATA[流浪地球2]]></name><pic>https://x/p.jpg</pic><dl><dd flag="线路1">正片$https://cdn/a.mp4</dd><dd flag="线路2">正片$https://cdn/b.mp4</dd></dl></video><video><id>2</id><name>庆余年</name><dl><dd flag="线路1">第01集$https://cdn/q1.mp4#第02集$https://cdn/q2.mp4</dd></dl></video></list></rss>`
  it('XML：CDATA 与多 dd 线路都认，总数与页数从 list 属性读', () => {
    const r = parseCmsXmlList(XML_FIXTURE, 'tvbox:大地资源')
    expect(r.error).toBeUndefined()
    expect(r.titles).toHaveLength(2)
    expect(r.total).toBe(2)
    expect(r.pageCount).toBe(3)
    expect(r.titles[0].title).toBe('流浪地球2')
    expect(r.titles[0].episodes[0].urls).toEqual(['https://cdn/a.mp4', 'https://cdn/b.mp4'])
    expect(r.titles[1].kind).toBe('series')
  })
  it('XML：既无 video 又无 list 时报格式错；合法空列表不报错', () => {
    expect(parseCmsXmlList('<html>not xml</html>', 'tvbox:x').error).toContain('不是标准苹果 CMS 数据')
    expect(parseCmsXmlList('<rss><list page="1" pagecount="0" recordcount="0"></list></rss>', 'tvbox:x').titles).toHaveLength(0)
  })
})

describe('watch 苹果 CMS 拉取（v0.1.408：fetchCmsVodList）', () => {
  const jsonSite: TvboxSite = { key: '官源蓝光', name: '官源蓝光', type: 1, api: 'https://example.com/api.php/provide/vod/' }
  const xmlSite: TvboxSite = { key: '大地资源', name: '大地资源', type: 0, api: 'https://dadiapi.com/api.php' }
  const JSON_BODY = JSON.stringify({ code: 1, page: 1, pagecount: 1, total: 1, list: [{ vod_name: '流浪地球2', vod_play_url: '正片$https://cdn/a.mp4' }] })
  const XML_BODY = '<rss><list page="1" pagecount="1" recordcount="1"><video><name>流浪地球2</name><dl><dd flag="线路1">正片$https://cdn/a.mp4</dd></dl></video></list></rss>'
  it('JSON 站与 XML 站都按各自格式解析；请求地址带 ac=videolist&pg=1', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: unknown) => {
      seen.push(String(url))
      return { ok: true, text: async () => (String(url).includes('dadiapi') ? XML_BODY : JSON_BODY) }
    })
    const j = await fetchCmsVodList(jsonSite, 1)
    expect(j.titles).toHaveLength(1)
    expect(j.titles[0].title).toBe('流浪地球2')
    const x = await fetchCmsVodList(xmlSite, 1)
    expect(x.titles).toHaveLength(1)
    expect(seen.every(u => u.includes('ac=videolist&pg=1'))).toBe(true)
  })
  it('HTTP 404、网络失败、非 CMS 文本都报中文原因，不抛错', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, text: async () => '' }))
    expect((await fetchCmsVodList(jsonSite)).error).toContain('HTTP 404')
    vi.stubGlobal('fetch', async () => { throw new TypeError('Load failed') })
    expect((await fetchCmsVodList(jsonSite)).error).toContain('网络请求失败')
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '<html>hello</html>' }))
    expect((await fetchCmsVodList(jsonSite)).error).toContain('不是标准苹果 CMS 数据')
  })
})

describe('watch TVBox 配置拉取（v0.1.408：fetchTvboxConfig）', () => {
  const FIXTURE = JSON.stringify({
    sites: [
      { key: '官源蓝光', name: '官源蓝光', type: 1, api: 'https://a.example.com/api.php' },
      { key: '91AV', name: '91AV', type: 1, api: 'https://91av.cyou/api.php' },
      { key: '豆瓣', name: '豆瓣', type: 3, api: 'https://example.com/drpy.js' },
      { key: 'py聚合', name: 'py聚合', type: 4, api: 'http://example.com/py.php' },
    ],
  })
  it('拉取并解析：统计与成人站数都对', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => FIXTURE }))
    const r = await fetchTvboxConfig('https://example.com/test1.json')
    expect(r.error).toBeUndefined()
    expect(r.total).toBe(4)
    expect(r.usable).toBe(2)
    expect(r.skippedSpider).toBe(1)
    expect(r.skippedOther).toBe(1)
    expect(r.adultCount).toBe(1)
    expect(r.sites.map(s => s.key)).toEqual(['官源蓝光', '91AV'])
  })
  it('HTTP 500 与非 JSON 都报中文原因，不抛错', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, text: async () => '' }))
    expect((await fetchTvboxConfig('https://example.com/x.json')).error).toContain('HTTP 500')
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => 'not json' }))
    expect((await fetchTvboxConfig('https://example.com/x.json')).error).toContain('JSON 解析失败')
  })
})

describe('watch 点播标题合并（v0.1.408：mergeVodTitles）', () => {
  const mk = (title: string, epNo: number, urls: string[], sourceId: string): VodTitle => ({
    key: title.toLowerCase(), title, kind: epNo > 0 ? 'series' : 'movie',
    episodes: [{ label: epNo > 0 ? `第 ${epNo} 集` : '正片', urls, episodeNo: epNo, unofficial: false }],
    sourceIds: [sourceId], unofficial: false,
  })
  it('同名合并选集与线路、去重；不同名各自保留；合并后按标题排序', () => {
    const out = mergeVodTitles([
      [mk('庆余年', 1, ['https://a/q1.mp4'], 'tvbox:A'), mk('流浪地球2', 0, ['https://a/l.mp4'], 'tvbox:A')],
      [mk('庆余年', 1, ['https://b/q1.mp4'], 'tvbox:B'), mk('庆余年', 2, ['https://b/q2.mp4'], 'tvbox:B')],
    ])
    expect(out).toHaveLength(2)
    const qyn = out.find(v => v.title === '庆余年')!
    expect(qyn.kind).toBe('series')
    expect(qyn.episodes).toHaveLength(2)
    expect(qyn.episodes[0].urls).toEqual(['https://a/q1.mp4', 'https://b/q1.mp4'])
    expect(qyn.sourceIds).toEqual(['tvbox:A', 'tvbox:B'])
    expect(out[0].title).toBe('流浪地球2') // 按标题拼音排序：流（liu）在庆（qing）前
  })
})

describe('watch TVBox 配置与 18+ 开关存储（v0.1.408）', () => {
  it('配置存取往返；18+ 开关默认关', () => {
    const cfg: TvboxConfig = {
      id: 'c1', label: 'test1', url: 'https://example.com/test1.json', addedAt: 1,
      total: 4, usable: 2, skippedSpider: 1, skippedOther: 1, adultCount: 1,
      sites: [{ key: '官源蓝光', name: '官源蓝光', type: 1, api: 'https://a.example.com/api.php' }],
    }
    saveTvboxConfigs([cfg])
    expect(loadTvboxConfigs()).toEqual([cfg])
    expect(loadShowAdult()).toBe(false)
    saveShowAdult(true)
    expect(loadShowAdult()).toBe(true)
    expect(ls().getItem(SHOW_ADULT_KEY)).toBe('1')
    saveShowAdult(false)
    expect(loadShowAdult()).toBe(false)
  })
})

describe('watch v0.1.408 结构（WatchTool.tsx）', () => {
  it('TVBox 输入、18+ 页签与开关、爬虫站跳过说明都在', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../components/WatchTool.tsx', import.meta.url), 'utf8')
    for (const s of [
      'TVBox 点播源', 'fetchTvboxConfig', 'isTvboxConfigText', 'fetchCmsVodList', 'mergeVodTitles',
      'isAdultTvboxSite', 'loadTvboxConfigs', 'saveTvboxConfigs',
      "'adult'", '18+', 'loadShowAdult', 'saveShowAdult', '显示 18+ 页签',
      '爬虫站', '跳过', 'TVBox 资源站',
      'WallGrid', 'adultTitles', 'adultWallItems',
    ]) {
      expect(src).toContain(s)
    }
    // 18+ 页签只在开关开着时出现；关了正在看的 18+ 页签要落回点播
    expect(src).toContain("showAdult &&")
    expect(src).toContain("setActiveTab('vod')")
  })
})

describe('watch 悬浮播放器位置（v0.1.410）', () => {
  it('clampPlayerFloat：视口内不动，超出四边都限位', () => {
    // 桌面 1400x1000，面板 560x460
    expect(clampPlayerFloat(100, 100, 1400, 1000, 560)).toEqual({ x: 100, y: 100 })
    // 左/上出界：至少留 120px 宽、标题栏不顶出
    expect(clampPlayerFloat(-500, -50, 1400, 1000, 560)).toEqual({ x: -440, y: 0 })
    // 右/下出界：至少留 120px 宽、48px 高在视口内
    expect(clampPlayerFloat(1400, 1000, 1400, 1000, 560)).toEqual({ x: 1280, y: 952 })
    // 手机窄屏（390x844，面板宽 366）：左右仍有可拖范围，不会算出空区间
    const m = clampPlayerFloat(500, 900, 390, 844, 366)
    expect(m.x).toBeLessThanOrEqual(270)
    expect(m.x).toBeGreaterThanOrEqual(-246)
    expect(m.y).toBe(796)
  })

  it('load/save 往返：位置与最小化都存本机；坏数据回默认值', () => {
    expect(loadPlayerFloat()).toEqual({ x: null, y: null, minimized: false })
    savePlayerFloat({ x: 120, y: 80, minimized: true })
    expect(loadPlayerFloat()).toEqual({ x: 120, y: 80, minimized: true })
    expect(ls().getItem(PLAYER_FLOAT_KEY)).toBe(JSON.stringify({ x: 120, y: 80, minimized: true }))
    ls().setItem(PLAYER_FLOAT_KEY, 'not-json{')
    expect(loadPlayerFloat()).toEqual({ x: null, y: null, minimized: false })
    ls().setItem(PLAYER_FLOAT_KEY, JSON.stringify({ x: 'a', y: NaN }))
    expect(loadPlayerFloat()).toEqual({ x: null, y: null, minimized: false })
  })
})

describe('watch v0.1.410 结构（WatchTool.tsx）', () => {
  it('悬浮容器、拖动手柄、最小化/关闭、切页签不卸载都在', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../components/WatchTool.tsx', import.meta.url), 'utf8')
    for (const s of [
      'wt-float', 'wt-float-bar', 'wt-float-body', 'onFloatPointerDown', 'onFloatWindowMove', 'onFloatWindowUp',
      'loadPlayerFloat', 'savePlayerFloat', 'clampPlayerFloat', 'toggleFloatMin', 'closeFloat',
      '拖动移动',
    ]) {
      expect(src).toContain(s)
    }
    // 播放器仍挂在页签栏之外（切页签不卸载）；最小化只藏 body，video 元素不卸载
    expect(src).toContain("floatMin ? ' min' : ''")
    expect(src).toContain('role="dialog"')
    // CSS：fixed 挂视口、默认右下角、最小化藏 body
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    expect(css).toContain('.wt-float { position: fixed;')
    expect(css).toContain('right: 16px; bottom: 16px;')
    expect(css).toContain('.wt-float.min .wt-float-body { display: none; }')
  })
})
