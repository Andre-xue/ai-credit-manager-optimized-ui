import { describe, it, expect } from 'vitest'
import {
  categorizeFile, chunkForTranslate, alignPairs, renderPairHtml,
  buildHtml, buildPlain, buildPrintHtml, layoutName, layoutSuffix, freeTranslateUrl, FREE_ENGINES, SOURCE_LANGUAGES, translateText, type TranslatePair,
} from './translate'

const pairs: TranslatePair[] = [
  { source: '你好世界', target: 'Hello world' },
  { source: '第二段落', target: 'Second paragraph' },
]

describe('AI翻译文件分类', () => {
  it('文档类', () => {
    for (const n of ['a.txt', 'b.md', 'c.docx', 'd.pdf', 'e.csv', 'f.xlsx']) {
      expect(categorizeFile(n), n).toBe('document')
    }
  })
  it('图片类', () => {
    for (const n of ['a.png', 'b.jpg', 'c.webp', 'd.HEIC']) {
      expect(categorizeFile(n), n).toBe('image')
    }
  })
  it('压缩类', () => {
    for (const n of ['a.zip', 'b.rar', 'c.7z', 'd.tar.gz']) {
      expect(categorizeFile(n), n).toBe('archive')
    }
  })
  it('未知类', () => {
    expect(categorizeFile('a.exe')).toBe('other')
  })
})

describe('文本切块', () => {
  it('短段落在限额内合并为一块', () => {
    const chunks = chunkForTranslate('段落一内容\n\n段落二内容', 450)
    expect(chunks).toEqual(['段落一内容\n\n段落二内容'])
  })
  it('段落累计超限时分成多块', () => {
    const a = '甲'.repeat(60), b = '乙'.repeat(60)
    const chunks = chunkForTranslate(`${a}\n\n${b}`, 80)
    expect(chunks).toEqual([a, b])
  })
  it('长段落按句号再切', () => {
    const long = Array.from({ length: 30 }, (_, i) => `第${i}句话。`).join('')
    const chunks = chunkForTranslate(long, 100)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => c.length <= 110)).toBe(true)
  })
  it('空文本返回空', () => {
    expect(chunkForTranslate('   ')).toEqual([])
  })
})

describe('双语对齐与布局渲染', () => {
  it('按段落对齐，数量不等补空', () => {
    const r = alignPairs('A\n\nB\n\nC', '甲')
    expect(r.length).toBe(3)
    expect(r[1].target).toBe('')
  })
  it('逐句布局生成下划线 class', () => {
    expect(renderPairHtml(pairs[0], 'interleaved')).toContain('tr-underline')
  })
  it('渲染内容转义 HTML', () => {
    expect(renderPairHtml({ source: '<script>x</script>', target: 'ok' }, 'interleaved')).toContain('&lt;script&gt;')
  })
  it('整篇上下布局：全部原文在前，全部译文在后，非逐句交替', () => {
    const html = buildHtml('测试', pairs, ['stacked'])
    expect(html).toContain('tr-whole-stack')
    expect(html).toContain('【原文 · 全文】'.replace('【原文 · 全文】','原文')) // html 用 tr-col-label 原文
    const srcIdx = html.indexOf('你好世界')
    const dstIdx = html.indexOf('Hello world')
    const secondSrc = html.indexOf('第二段落')
    expect(srcIdx).toBeGreaterThan(-1)
    expect(secondSrc).toBeGreaterThan(-1)
    expect(dstIdx).toBeGreaterThan(-1)
    // 两段原文都出现在译文之前 => 整篇结构，不是逐句交替
    expect(secondSrc).toBeLessThan(dstIdx)
  })
  it('整篇左右布局：左栏整篇原文、右栏整篇译文', () => {
    const html = buildHtml('测试', pairs, ['side-by-side'])
    expect(html).toContain('tr-whole-side')
    expect(html.indexOf('你好世界')).toBeLessThan(html.indexOf('Hello world'))
    expect(html.indexOf('第二段落')).toBeLessThan(html.indexOf('Hello world'))
  })
  it('布局名称', () => {
    expect(layoutName('side-by-side')).toContain('左右')
    expect(layoutName('interleaved')).toContain('下划线')
    expect(layoutName('stacked')).toContain('上下')
  })
})

describe('导出内容生成', () => {
  it('HTML 含全部选中布局', () => {
    const html = buildHtml('测试文档', pairs, ['side-by-side', 'stacked'])
    expect(html).toContain('data-layout="side-by-side"')
    expect(html).toContain('data-layout="stacked"')
    expect(html).not.toContain('data-layout="interleaved"')
    expect(html).toContain('你好世界')
  })
  it('TXT 含原文译文', () => {
    const txt = buildPlain('测试', pairs, ['stacked'], 'txt')
    expect(txt).toContain('【原文 · 全文】')
    expect(txt).toContain('Hello world')
  })
  it('MD 左右布局生成表格', () => {
    const md = buildPlain('测试', pairs, ['side-by-side'], 'md')
    expect(md).toContain('| 原文（整篇） | 译文（整篇） |')
    expect(md).toContain('| --- | --- |')
  })
  it('多选布局都出现在导出里', () => {
    const md = buildPlain('测试', pairs, ['side-by-side', 'interleaved', 'stacked'], 'md')
    expect(md).toContain('左右对照')
    expect(md).toContain('逐句对照')
    expect(md).toContain('上下结构')
  })
})

describe('多布局导出为多个文件', () => {
  it('每种布局文件名后缀不同', () => {
    expect(layoutSuffix('side-by-side')).toBe('左右对照')
    expect(layoutSuffix('interleaved')).toBe('逐句对照')
    expect(layoutSuffix('stacked')).toBe('上下结构')
  })
  it('单布局HTML只含该布局，不含其他布局', () => {
    const html = buildHtml('测试', pairs, ['stacked'])
    expect(html).toContain('data-layout="stacked"')
    expect(html).not.toContain('data-layout="side-by-side"')
    expect(html).not.toContain('data-layout="interleaved"')
  })
  it('分别生成的两个HTML各自只含一种布局', () => {
    const a = buildHtml('测试', pairs, ['side-by-side'])
    const b = buildHtml('测试', pairs, ['interleaved'])
    expect(a).toContain('data-layout="side-by-side"')
    expect(a).not.toContain('data-layout="interleaved"')
    expect(b).toContain('data-layout="interleaved"')
    expect(b).not.toContain('data-layout="side-by-side"')
  })
})

describe('免费翻译引擎与源语言', () => {
  it('提供Google与MyMemory两个引擎及说明', () => {
    expect(FREE_ENGINES.map(f => f.id)).toEqual(['google', 'mymemory'])
    expect(FREE_ENGINES.every(f => f.desc.length > 10)).toBe(true)
  })
  it('源语言含自动检测与常见语言', () => {
    expect(SOURCE_LANGUAGES[0].code).toBe('auto')
    expect(SOURCE_LANGUAGES.some(l => l.code === 'ja')).toBe(true)
  })
  it('Google URL 用 sl/tl 且支持 auto', () => {
    const url = freeTranslateUrl('hello', 'zh-CN', 'auto', 'google')
    expect(url).toContain('translate.googleapis.com')
    expect(url).toContain('sl=auto')
    expect(url).toContain('tl=zh-CN')
  })
  it('MyMemory URL 用 langpair，auto 兜底为 en', () => {
    const url = freeTranslateUrl('hello', 'zh-CN', 'auto', 'mymemory')
    expect(url).toContain('api.mymemory.translated.net')
    expect(url).toContain('langpair')
    expect(decodeURIComponent(url)).toContain('en|zh-CN')
  })
  it('MyMemory 指定源语言时不兜底', () => {
    const url = freeTranslateUrl('こんにちは', 'zh-CN', 'ja', 'mymemory')
    expect(decodeURIComponent(url)).toContain('ja|zh-CN')
  })
})

describe('免费翻译引擎与源语言', () => {
  it('提供Google与MyMemory两个引擎及说明', () => {
    expect(FREE_ENGINES.map(f => f.id)).toEqual(['google', 'mymemory'])
    expect(FREE_ENGINES.every(f => f.desc.length > 10)).toBe(true)
  })
  it('源语言含自动检测与常见语言', () => {
    expect(SOURCE_LANGUAGES[0].code).toBe('auto')
    expect(SOURCE_LANGUAGES.some(l => l.code === 'ja')).toBe(true)
  })
  it('Google URL 用 sl/tl 且支持 auto', () => {
    const url = freeTranslateUrl('hello', 'zh-CN', 'auto', 'google')
    expect(url).toContain('translate.googleapis.com')
    expect(url).toContain('sl=auto')
    expect(url).toContain('tl=zh-CN')
  })
  it('MyMemory URL 用 langpair，auto 兜底为 en', () => {
    const url = freeTranslateUrl('hello', 'zh-CN', 'auto', 'mymemory')
    expect(url).toContain('api.mymemory.translated.net')
    expect(url).toContain('langpair')
    expect(decodeURIComponent(url)).toContain('en|zh-CN')
  })
  it('MyMemory 指定源语言时不兜底', () => {
    const url = freeTranslateUrl('こんにちは', 'zh-CN', 'ja', 'mymemory')
    expect(decodeURIComponent(url)).toContain('ja|zh-CN')
  })
})

describe('打印PDF用HTML', () => {
  it('多文档多布局独立分页', () => {
    const html = buildPrintHtml([
      { name: 'A', pairs },
      { name: 'B', pairs },
    ], ['side-by-side', 'stacked'])
    expect(html).toContain('A · 左右对照')
    expect(html).toContain('B · 上下结构')
    expect(html.split('page-break-after').length - 1).toBeGreaterThanOrEqual(3)
  })
  it('是完整HTML文档', () => {
    const html = buildPrintHtml([{ name: 'A', pairs }], ['interleaved'])
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('</html>')
  })
})

describe('本地翻译模型筛选', () => {
  it('只保留文本对话模型，排除视觉/嵌入/生图/视频/语音模型', async () => {
    const { isChatCapableLocalModel } = await import('./providerCall')
    const textModels = ['qwen2.5:3b', 'llama3.2:3b', 'deepseek-v4-pro:4b', 'hy-mt2:1.8b']
    const nonText = ['nomic-embed-text:latest', 'qwen2.5-vl:7b', 'gemma3:4b', 'gemma3:4b-vision', 'stable-diffusion-xl', 'flux1-schnell', 'whisper-large', 'video-llama', 'bge-reranker', 'llava:7b', 'moondream', 'llama4:scout']
    textModels.forEach(m => expect(isChatCapableLocalModel(m), m).toBe(true))
    nonText.forEach(m => expect(isChatCapableLocalModel(m), m).toBe(false))
  })
})

describe('AI助手本地模型筛选（保留视觉模型）', () => {
  it('保留文本与视觉模型，排除嵌入/生图/视频/语音', async () => {
    const { isAssistantCapableLocalModel } = await import('./providerCall')
    const ok = ['gemma3:4b', 'qwen2.5:3b', 'llama3.2:3b', 'gemma3:4b-vision', 'qwen2.5-vl:7b']
    const no = ['nomic-embed-text:latest', 'bge-reranker', 'stable-diffusion-xl', 'flux1', 'whisper-large', 'video-llama']
    ok.forEach(m => expect(isAssistantCapableLocalModel(m), m).toBe(true))
    no.forEach(m => expect(isAssistantCapableLocalModel(m), m).toBe(false))
  })
})

describe('翻译专用本地模型不进回答列表', () => {
  it('hy-mt2 等翻译模型被识别，通用对话模型不受影响', async () => {
    const pc = await import('./providerCall')
    // 翻译专用 → 排除
    ;['hy-mt2:1.8b', 'hy-mt2', 'nllb-200:latest', 'opus-mt-zh-en', 'm2m100:418m'].forEach(m => {
      expect(pc.isTranslationLocalModel(m)).toBe(true)
      expect(pc.isAssistantCapableLocalModel(m)).toBe(false)
    })
    // 通用对话/视觉模型 → 保留
    ;['qwen2.5:3b', 'llama3.2:3b', 'gemma3:4b', 'deepseek-v4-pro-4b-uncensored:latest'].forEach(m => {
      expect(pc.isTranslationLocalModel(m)).toBe(false)
      expect(pc.isAssistantCapableLocalModel(m)).toBe(true)
    })
  })
})

describe('translateText 失败语义', () => {
  // node 测试环境无 localStorage：getBiometricPassword 会读它，装最小桩
  ;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  ;(globalThis as any).window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} }
  it('全部块失败时抛错，不把原文冒充译文返回', async () => {
    await expect(translateText('你好世界', { engine: 'freeai', target: 'English' }))
      .rejects.toThrow('请先选择一个免费 AI 模型')
  })
  it('账户引擎未配账户时同样抛错', async () => {
    await expect(translateText('hello', { engine: 'account', target: '简体中文' }))
      .rejects.toThrow('请先在 API Key 管理添加模型账户')
  })
  it('空文本直接返回空串', async () => {
    await expect(translateText('   ', { engine: 'freeai', target: 'English' })).resolves.toBe('')
  })
})
