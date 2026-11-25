import { describe, expect, it } from 'vitest'
import { decodeBingRedirect, dedupeResults, deriveSearchQueries, filterRelevantResults, parseBingResults, parseDdgResults, repairMojibake, stripHtmlToText } from './webSearch'

describe('stripHtmlToText', () => {
  it('去脚本/样式/标签并解实体', () => {
    const html = '<style>.a{}</style><p>你好 &amp; 世界</p><script>var x=1</script><div>第二段</div>'
    expect(stripHtmlToText(html)).toBe('你好 & 世界 第二段')
  })
})

describe('parseBingResults', () => {
  it('解析 b_algo 结果块的标题/链接/摘要', () => {
    const html = `<ol><li class="b_algo"><h2><a href="https://example.com/a" target="_blank">标题<b>一</b></a></h2><p>这是摘要内容</p></li>
    <li class="b_algo"><h2><a href="https://example.org/b">标题二</a></h2><p>摘要二</p></li></ol>`
    const r = parseBingResults(html)
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ title: '标题 一', url: 'https://example.com/a', snippet: '这是摘要内容' })
    expect(r[1].url).toBe('https://example.org/b')
  })

  it('必应跳转链接解出真实地址（2026-11-23 实抓页面样本）', () => {
    const redir = 'https://www.bing.com/ck/a?!&&p=c5b9b89f13b36c69d3956d76d10f66ccef2b7a5ef3052ab8d4020f55e446e607JmltdHM9MTc5NTMwNTYwMA&ptn=3&ver=2&hsh=4&fclid=25d62923-5b97-67bd-3323-313a5a996614&u=a1aHR0cHM6Ly93d3cuemhpaHUuY29tL3F1ZXN0aW9uLzU0ODU2ODM5&ntb=1'
    expect(decodeBingRedirect(redir)).toBe('https://www.zhihu.com/question/54856839')
    expect(decodeBingRedirect('https://example.com/direct')).toBe('https://example.com/direct')
  })

  it('无结果时返回空数组', () => {
    expect(parseBingResults('<html><body>没有</body></html>')).toEqual([])
  })
})

describe('deriveSearchQueries（v0.1.319）', () => {
  const today = new Date(2026, 10, 23)
  it('一次粘贴两个问题 → 拆成两条搜索词，各自补日期', () => {
    const qs = deriveSearchQueries('1. 昨天的国内外科技新闻？\n2. 今天美元兑人民币汇率是多少？', today)
    expect(qs).toHaveLength(2)
    expect(qs[0]).toContain('科技新闻')
    expect(qs[0]).toContain('2026年11月23日')
    expect(qs[1]).toContain('美元兑人民币汇率')
  })

  it('单个问题原样（无时效词不补日期）', () => {
    expect(deriveSearchQueries('英伟达是做什么的', today)).toEqual(['英伟达是做什么的'])
    expect(deriveSearchQueries('今天天气怎么样', today)[0]).toContain('2026年11月23日')
  })

  it('粘贴带「」引号的句子 → 引号剥掉再搜（Ethan 实测）', () => {
    const qs = deriveSearchQueries('「facebook/react 这个项目的状态管理是怎么做的」？', today)
    expect(qs).toHaveLength(1)
    expect(qs[0]).not.toContain('「')
    expect(qs[0]).toContain('facebook/react')
  })

  it('已带日期的不重复补', () => {
    expect(deriveSearchQueries('2026年11月20日的新闻', today)).toEqual(['2026年11月20日的新闻'])
  })
})

describe('filterRelevantResults（v0.1.319）', () => {
  it('丢弃与问题零重合的 SEO 垃圾结果（复刻 X站 实测）', () => {
    const spam = { title: 'X站', url: 'https://x-zhana.com.cn/', snippet: 'X站 X平台官方入口，点此进入' }
    const good1 = { title: '新浪科技_新浪网', url: 'https://tech.sina.com.cn/', snippet: '24小时滚动报道科技行业新闻头条' }
    const good2 = { title: 'IT之家', url: 'https://www.ithome.com/', snippet: '前沿科技新闻网站，快速播报科技行业新闻' }
    const out = filterRelevantResults(['昨天的国内外科技新闻 2026年11月23日'], [spam, good1, good2])
    expect(out.map(r => r.url).sort()).toEqual(['https://tech.sina.com.cn/', 'https://www.ithome.com/'].sort())
    expect(out.some(r => r.url.includes('x-zhana'))).toBe(false)
  })

  it('全部零重合时兜底保留 2 条，不返回空', () => {
    const a = { title: '甲', url: 'https://a.example/', snippet: '无关内容' }
    const b = { title: '乙', url: 'https://b.example/', snippet: '也无关' }
    expect(filterRelevantResults(['量子纠缠实验'], [a, b])).toHaveLength(2)
  })
})

describe('乱码修复与去重（v0.1.320）', () => {
  it('repairMojibake 把 Latin-1 误读的 UTF-8 还原成中文', () => {
    const original = 'https://global.hk01.com/地區/60409650/日本72歲保安'
    const mojibake = [...new TextEncoder().encode(original)].map(b => String.fromCharCode(b)).join('')
    expect(mojibake).not.toBe(original) // 确实先坏掉
    expect(repairMojibake(mojibake)).toBe(original)
    expect(repairMojibake(original)).toBe(original) // 没坏的不动
    expect(repairMojibake('https://example.com/plain')).toBe('https://example.com/plain')
  })

  it('必应跳转里含中文的真实地址解码不乱码', () => {
    const target = 'https://global.hk01.com/地區/60409650/日本72歲保安'
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(target))).replace(/=+$/, '')
    const redir = `https://www.bing.com/ck/a?!&&p=xx&u=a1${b64}&ntb=1`
    expect(decodeBingRedirect(redir)).toBe(target)
  })

  it('同标题结果去重（维基多语言镜像）', () => {
    const a = { title: '佐藤修悦 - 维基百科', url: 'https://zh.wikipedia.org/zh-cn/x', snippet: '甲' }
    const b = { title: '佐藤修悦 - 维基百科', url: 'https://zh.wikipedia.org/zh-my/x', snippet: '乙' }
    const c = { title: '别的', url: 'https://e.example/', snippet: '丙' }
    expect(dedupeResults([a, b, c]).map(r => r.url)).toEqual([a.url, c.url])
  })
})

describe('parseDdgResults', () => {
  it('解析结果并解开 uddg 跳转链接', () => {
    const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite.example%2Fpage&amp;rut=abc">页面标题</a>
    <a class="result__snippet" href="#">这是一段摘要</a></div>`
    const r = parseDdgResults(html)
    expect(r).toHaveLength(1)
    expect(r[0].url).toBe('https://site.example/page')
    expect(r[0].title).toBe('页面标题')
    expect(r[0].snippet).toBe('这是一段摘要')
  })
})
