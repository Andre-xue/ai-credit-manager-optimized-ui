import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseDanDanPlayComments,
  parseSearchEpisodes,
  extractEpisodeNo,
  scoreEpisodeMatch,
  pickBestEpisode,
  normalizeDanmuApiBase,
  danmakuColor,
  fetchDanmakuFor,
  testDanmuApi,
  loadDanmuApiBase,
  saveDanmuApiBase,
  loadLocalDanmu,
  addLocalDanmu,
  danmuKey,
  type DanmakuEpisodeCandidate,
} from './danmaku'

// node 环境没有 localStorage：与 watch.test.ts 同款 mock
if (!(globalThis as unknown as Record<string, unknown>).localStorage) {
  const m = new Map<string, string>()
  ;(globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
  }
}

const SEARCH_OK = {
  errorCode: 0,
  success: true,
  animes: [
    {
      animeId: 1, animeTitle: '庆余年', type: 'tvseries',
      episodes: [
        { episodeId: 11, episodeTitle: '第1集' },
        { episodeId: 12, episodeTitle: '第2集' },
      ],
    },
    {
      animeId: 2, animeTitle: '庆余年 第二季', type: 'tvseries',
      episodes: [{ episodeId: 21, episodeTitle: '第1集' }],
    },
  ],
}

const COMMENTS_OK = {
  count: 3,
  comments: [
    { cid: 1, p: '5.2,1,16777215,1001', m: '前方高能' },
    { cid: 2, p: '12.0,5,16711680,1002', m: '顶置弹幕' },
    { cid: 3, p: '30.5,4,255,1003', m: '底部弹幕' },
  ],
}

function mockFetch(routes: Record<string, unknown>) {
  return (async (url: string) => {
    for (const [k, v] of Object.entries(routes)) {
      if (url.includes(k)) {
        return { ok: true, status: 200, json: async () => v } as unknown as Response
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
  }) as unknown as typeof fetch
}

describe('parseDanDanPlayComments', () => {
  it('解析 p 字段：时间/模式/颜色/文本', () => {
    const items = parseDanDanPlayComments(COMMENTS_OK)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ time: 5.2, text: '前方高能', mode: 1, color: '#ffffff' })
    expect(items[1]).toMatchObject({ time: 12, mode: 5, color: '#ff0000' })
    expect(items[2]).toMatchObject({ time: 30.5, mode: 4, color: '#0000ff' })
  })
  it('非法条目跳过：坏时间、空文本、非 comments 数组', () => {
    const items = parseDanDanPlayComments({
      comments: [
        { p: 'abc,1,16777215,1', m: '坏时间' },
        { p: '3,1,16777215,1', m: '   ' },
        { p: '3,1,16777215,1', m: '好弹幕' },
        { m: '没 p' },
      ],
    })
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe('好弹幕')
    expect(parseDanDanPlayComments({})).toEqual([])
    expect(parseDanDanPlayComments(null)).toEqual([])
  })
  it('去重 + 按时间排序', () => {
    const items = parseDanDanPlayComments({
      comments: [
        { p: '9,1,16777215,1', m: '后' },
        { p: '1,1,16777215,1', m: '先' },
        { p: '1,1,16777215,1', m: '先' },
      ],
    })
    expect(items.map(i => i.text)).toEqual(['先', '后'])
  })
})

describe('danmakuColor', () => {
  it('十进制转 #rrggbb，非法回白', () => {
    expect(danmakuColor(16777215)).toBe('#ffffff')
    expect(danmakuColor(255)).toBe('#0000ff')
    expect(danmakuColor(NaN)).toBe('#ffffff')
  })
})

describe('parseSearchEpisodes', () => {
  it('解析 animes[].episodes[]', () => {
    const list = parseSearchEpisodes(SEARCH_OK)
    expect(list).toHaveLength(3)
    expect(list[0]).toMatchObject({ animeId: 1, animeTitle: '庆余年', episodeId: 11, episodeTitle: '第1集' })
  })
  it('非法结构返回空', () => {
    expect(parseSearchEpisodes({})).toEqual([])
    expect(parseSearchEpisodes(null)).toEqual([])
  })
})

describe('extractEpisodeNo', () => {
  it('第N集 / S01E03 / EP03', () => {
    expect(extractEpisodeNo('第3集')).toBe(3)
    expect(extractEpisodeNo('S01E03')).toBe(3)
    expect(extractEpisodeNo('EP12')).toBe(12)
    expect(extractEpisodeNo('正片')).toBeNull()
    expect(extractEpisodeNo('')).toBeNull()
  })
})

describe('scoreEpisodeMatch / pickBestEpisode', () => {
  const list = parseSearchEpisodes(SEARCH_OK)
  it('标题精确 + 集号对上才中', () => {
    const best = pickBestEpisode('庆余年', 2, list)
    expect(best?.episodeId).toBe(12)
  })
  it('集号错直接否决，不串到别的集', () => {
    expect(pickBestEpisode('庆余年', 9, list)).toBeNull()
  })
  it('标题沾不上边直接否决', () => {
    expect(pickBestEpisode('流浪地球', 1, list)).toBeNull()
  })
  it('电影（无集号）标题精确即可', () => {
    const c: DanmakuEpisodeCandidate = { animeId: 9, animeTitle: '流浪地球2', episodeId: 99, episodeTitle: '正片' }
    expect(scoreEpisodeMatch('流浪地球2', null, c)).toBeGreaterThanOrEqual(100)
  })
})

describe('normalizeDanmuApiBase', () => {
  it('去空白/尾斜杠/去 /api/v2，非法回空', () => {
    expect(normalizeDanmuApiBase(' https://x.vercel.app/ ')).toBe('https://x.vercel.app')
    expect(normalizeDanmuApiBase('https://x.vercel.app/api/v2')).toBe('https://x.vercel.app')
    expect(normalizeDanmuApiBase('x.vercel.app')).toBe('')
    expect(normalizeDanmuApiBase('')).toBe('')
  })
})

describe('fetchDanmakuFor', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  it('全流程：搜索→匹配第2集→取弹幕', async () => {
    const r = await fetchDanmakuFor('庆余年', 2, {
      base: 'https://dm.example.com',
      fetchImpl: mockFetch({ 'search/episodes': SEARCH_OK, '/comment/12': COMMENTS_OK }),
    })
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.items).toHaveLength(3)
      expect(r.matched).toContain('庆余年')
    }
  })
  it('没配地址返回 noconfig，不发请求', async () => {
    const r = await fetchDanmakuFor('庆余年', 1, { base: '' })
    expect(r.status).toBe('noconfig')
  })
  it('搜不到匹配返回 nomatch，写清片名', async () => {
    const r = await fetchDanmakuFor('不存在的片', 1, {
      base: 'https://dm.example.com',
      fetchImpl: mockFetch({ 'search/episodes': SEARCH_OK }),
    })
    expect(r.status).toBe('nomatch')
    if (r.status === 'nomatch') expect(r.reason).toContain('不存在的片')
  })
  it('弹幕为空返回 empty', async () => {
    const r = await fetchDanmakuFor('庆余年', 1, {
      base: 'https://dm.example.com',
      fetchImpl: mockFetch({ 'search/episodes': SEARCH_OK, '/comment/11': { count: 0, comments: [] } }),
    })
    expect(r.status).toBe('empty')
  })
  it('HTTP 401 给出带 token 的中文原因', async () => {
    const fetch401 = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch
    const r = await fetchDanmakuFor('庆余年', 1, { base: 'https://dm.example.com', fetchImpl: fetch401 })
    expect(r.status).toBe('error')
    if (r.status === 'error') expect(r.reason).toContain('401')
  })
  it('网络不通给出中文原因', async () => {
    const fetchDown = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    const r = await fetchDanmakuFor('庆余年', 1, { base: 'https://dm.example.com', fetchImpl: fetchDown })
    expect(r.status).toBe('error')
    if (r.status === 'error') expect(r.reason).toContain('连不上弹幕源')
  })
})

describe('testDanmuApi', () => {
  it('地址非法直接报格式问题', async () => {
    const r = await testDanmuApi('not-a-url')
    expect(r.ok).toBe(false)
    expect(r.text).toContain('地址格式不对')
  })
  it('搜到结果即算通', async () => {
    const r = await testDanmuApi('https://dm.example.com', mockFetch({ 'search/episodes': SEARCH_OK }))
    expect(r.ok).toBe(true)
    expect(r.text).toContain('弹幕源通了')
  })
})

describe('本地弹幕存取', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  it('按片名+集号存取，发送后能读回', () => {
    const key = danmuKey('庆余年', 2)
    expect(loadLocalDanmu(key)).toEqual([])
    addLocalDanmu(key, { time: 3.5, text: '本地一条', mode: 1, color: '#ffd166', local: true })
    const list = loadLocalDanmu(key)
    expect(list).toHaveLength(1)
    expect(list[0].text).toBe('本地一条')
    expect(loadLocalDanmu(danmuKey('庆余年', 1))).toEqual([])
  })
  it('弹幕源地址存取归一化', () => {
    expect(saveDanmuApiBase('https://x.vercel.app/api/v2/')).toBe('https://x.vercel.app')
    expect(loadDanmuApiBase()).toBe('https://x.vercel.app')
  })
})
