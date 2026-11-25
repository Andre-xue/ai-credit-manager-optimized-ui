// AI 翻译核心：翻译引擎抽象（用户账户模型 / 免费公共 API）、文件分类、文本切块、
// 双语布局渲染（3 种）、导出内容生成（TXT/MD/HTML）。
// 第一阶段：文档类文本翻译 + 三种双语布局 + 三种导出格式；图片 OCR / DOCX 导出留待第二阶段。

import { callChat, callLocalChat } from './providerCall'
import { decryptSecret, getBiometricPassword } from './crypto'
import { freeAiChat, type FreeAiOption } from './freeAi'
import type { Account } from './types'

export type TranslateEngine = 'account' | 'free' | 'local' | 'freeai'
/** 免费公共翻译引擎 */
export type FreeEngine = 'mymemory' | 'google'

/** 免费引擎配置与说明（界面下拉展示） */
export const FREE_ENGINES: { id: FreeEngine; name: string; desc: string }[] = [
  { id: 'google', name: 'Google 翻译（推荐）', desc: '翻译质量好、语种全、无每日额度限制；使用非官方公开端点，稳定性取决于网络，无需 Key。' },
  { id: 'mymemory', name: 'MyMemory', desc: '欧盟资助的公共翻译记忆库，官方免费接口；单次约 500 字符、匿名约 5000 字符/天，质量一般。' },
]
export type FileCategory = 'document' | 'image' | 'archive' | 'other'
export type BilingualLayout = 'side-by-side' | 'interleaved' | 'stacked'
export type ExportFormat = 'txt' | 'md' | 'html'

export interface TranslateFile {
  id: string
  name: string
  category: FileCategory
  text: string          // 文档类的纯文本内容
  source?: string       // 图片 data URL（第二阶段 OCR 用）
}

export interface TranslatePair {
  source: string        // 原文段落
  target: string        // 译文段落
}

export const TARGET_LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' },
] as const

/** 源语言：自动检测 + 目标语言列表（两种免费引擎都支持 auto） */
export const SOURCE_LANGUAGES = [
  { code: 'auto', name: '自动检测' },
  ...TARGET_LANGUAGES,
] as const

/** 文件扩展名 → 分类 */
export function categorizeFile(name: string): FileCategory {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (['txt', 'md', 'markdown', 'csv', 'json', 'log', 'text', 'xml', 'yaml', 'yml', 'html', 'htm'].includes(ext)) return 'document'
  if (['doc', 'docx', 'pdf', 'rtf', 'odt', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext)) return 'document'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return 'image'
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'archive'
  return 'other'
}

/** 按段落切块，单块不超过 maxChars（尽量在换行/句号处断开） */
export function chunkForTranslate(text: string, maxChars = 450): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim())
  const chunks: string[] = []
  let cur = ''
  const append = (piece: string) => {
    if (!piece) return
    if (cur && (cur + '\n\n' + piece).length > maxChars) { chunks.push(cur); cur = piece }
    else cur += (cur ? '\n\n' : '') + piece
  }
  const flush = () => { if (cur.trim()) { chunks.push(cur.trim()); cur = '' } }
  for (const p of paragraphs) {
    if (p.length > maxChars) {
      flush() // 先结束当前块
      // 长段落按句号/分号再切成句子，逐句 append（可能跨多块）
      const sentences = p.split(/(?<=[。！？.!?;；])\s*/).filter(Boolean)
      let buf = ''
      for (const s of sentences) {
        if ((buf + s).length > maxChars) { if (buf) { chunks.push(buf); buf = '' } }
        buf += s
      }
      if (buf) cur = buf
    } else {
      append(p)
    }
  }
  flush()
  return chunks.length ? chunks : (text.trim() ? [text.trim()] : [])
}

/** 构造免费翻译请求 URL（纯函数，便于测试与说明） */
export function freeTranslateUrl(text: string, target: string, source: string, freeEngine: FreeEngine): string {
  const src = source || 'auto'
  if (freeEngine === 'google') {
    return `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(src)}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`
  }
  const langpair = `${src === 'auto' ? 'en' : src}|${target}`
  return `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`
}

/** 免费公共翻译 API：Google（非官方端点）或 MyMemory，均无需 Key */
async function translateFree(text: string, target: string, source: string, freeEngine: FreeEngine): Promise<string> {
  const url = freeTranslateUrl(text, target, source, freeEngine)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${freeEngine} 翻译请求失败（${res.status}）`)
  const json = await res.json()
  if (freeEngine === 'google') {
    // Google 返回 [[["译文","原文",...]],...]
    const out = (json?.[0] ?? []).map((seg: unknown[]) => seg?.[0] ?? '').join('')
    if (!out) throw new Error('Google 翻译未返回译文')
    return out as string
  }
  const out = json?.responseData?.translatedText
  if (!out) throw new Error(json?.responseDetails || 'MyMemory 未返回译文')
  return out as string
}

/** 用用户账户模型翻译 */
async function translateByAccount(account: Account, pwd: string, text: string, target: string, engineId?: string): Promise<string> {
  const key = await decryptSecret(account.encryptedKey!, pwd)
  const system = `你是一个专业翻译引擎。把用户输入的文本翻译成${target}。只输出译文，不要解释、不要加引号、不要加任何前缀。保留原文的段落结构与换行。`
  const r = await callChat(account, key, [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ], engineId)
  if (!r.ok) throw new Error(r.error ?? '模型翻译失败')
  return r.text.trim()
}

/** 用本机 Ollama 模型翻译（无需 API Key，地址+端口本地直连） */
async function translateByLocal(base: string, model: string, text: string, target: string): Promise<string> {
  const system = `你是一个专业翻译引擎。把用户输入的文本翻译成${target}。只输出译文，不要解释、不要加引号、不要加任何前缀。保留原文的段落结构与换行。`
  const r = await callLocalChat(base, model, [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ])
  if (!r.ok) throw new Error(r.error ?? '本地模型翻译失败')
  return r.text.trim()
}

export interface TranslateOptions {
  engine: TranslateEngine
  account?: Account
  target: string
  source?: string          // 源语言，auto = 自动检测
  freeEngine?: FreeEngine  // 免费引擎选择，默认 google
  engineId?: string        // 账户模型的引擎（model 参数），不填则用账户默认
  localBase?: string       // 本地服务地址（如 http://127.0.0.1:11434）
  localModel?: string      // 本地翻译模型名
  freeAi?: FreeAiOption    // 免费 AI 模型（engine='freeai' 时使用）
  onProgress?: (done: number, total: number) => void
}

/** 用免费 AI 模型翻译（云端免费 / Zen / Kilo 通道，提示词与本地引擎同款） */
async function translateByFreeAi(opt: FreeAiOption, text: string, target: string): Promise<string> {
  const system = `你是一个专业翻译引擎。把用户输入的文本翻译成${target}。只输出译文，不要解释、不要加引号、不要加任何前缀。保留原文的段落结构与换行。`
  const out = await freeAiChat(opt, system, text)
  return out.trim()
}

/** 翻译整段文本：切块后逐块翻译，部分失败的块保留原文；
 *  但若全部块都失败则抛错——否则会把原文当作「译文」返回，出现译文与原文一模一样的假成功
 *  （如 Zen 免费池限额、账户 Key 失效时）。调用方均有 try/catch + 提示。 */
export async function translateText(text: string, opts: TranslateOptions): Promise<string> {
  const chunks = chunkForTranslate(text)
  if (!chunks.length) return ''
  const pwd = getBiometricPassword()
  const results: string[] = []
  let okCount = 0
  let lastError: unknown = null
  for (let i = 0; i < chunks.length; i++) {
    try {
      if (opts.engine === 'free') results.push(await translateFree(chunks[i], opts.target, opts.source ?? 'auto', opts.freeEngine ?? 'google'))
      else if (opts.engine === 'freeai') {
        if (!opts.freeAi) throw new Error('请先选择一个免费 AI 模型')
        results.push(await translateByFreeAi(opts.freeAi, chunks[i], opts.target))
      }
      else if (opts.engine === 'local') {
        if (!opts.localBase || !opts.localModel) throw new Error('请先在本地服务中设置地址与翻译模型')
        results.push(await translateByLocal(opts.localBase, opts.localModel, chunks[i], opts.target))
      } else {
        if (!opts.account?.encryptedKey) throw new Error('请先在 API Key 管理添加模型账户')
        if (!pwd) throw new Error('请先解锁主密码（生物识别或会话密码）')
        results.push(await translateByAccount(opts.account, pwd, chunks[i], opts.target, opts.engineId))
      }
      okCount++
    } catch (e) {
      lastError = e
      results.push(chunks[i]) // 失败块保留原文，不中断整体
    }
    opts.onProgress?.(i + 1, chunks.length)
  }
  if (okCount === 0) {
    throw lastError instanceof Error ? lastError : new Error('翻译失败，请稍后重试')
  }
  return results.join('\n\n')
}

/** 把原文/译文按段落对齐成 pair（按空行分段，数量不等时按较长者补空） */
export function alignPairs(source: string, target: string): TranslatePair[] {
  const a = source.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  const b = target.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  const n = Math.max(a.length, b.length)
  return Array.from({ length: n }, (_, i) => ({ source: a[i] ?? '', target: b[i] ?? '' }))
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>')

/** 按布局渲染一个段落对（HTML 片段） */
export function renderPairHtml(pair: TranslatePair, layout: BilingualLayout): string {
  const src = nl2br(pair.source)
  const dst = nl2br(pair.target)
  switch (layout) {
    case 'side-by-side':
      return `<div class="tr-row tr-side"><div class="tr-src">${src}</div><div class="tr-dst">${dst}</div></div>`
    case 'interleaved':
      return `<div class="tr-row tr-interleave"><div class="tr-src">${src}</div><div class="tr-dst tr-underline">${dst}</div></div>`
    case 'stacked':
      return `<div class="tr-row tr-stack"><div class="tr-src">${src}</div><div class="tr-dst">${dst}</div></div>`
  }
}

/** 布局对应的 CSS（导出 HTML 内嵌，保证离线打开排版一致） */
export function bilingualCss(): string {
  return `body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:1000px;margin:32px auto;padding:0 20px;color:#222;line-height:1.7}
.tr-col-label{font-size:12px;color:#888;margin:0 0 8px;font-weight:600;letter-spacing:.5px}
.tr-whole-side{display:flex;gap:28px;align-items:stretch}
.tr-whole-side>div{flex:1;min-width:0;white-space:pre-wrap}
.tr-whole-stack{display:flex;flex-direction:column;gap:24px}
.tr-whole-stack>div{white-space:pre-wrap}
.tr-src{color:#333}.tr-dst{color:#1a56db}
.tr-row{margin:0 0 18px;padding:12px 0;border-bottom:1px solid #eee}
.tr-interleave .tr-src{margin-bottom:4px}.tr-underline{border-bottom:1px solid #93c5fd;padding-bottom:8px}
@media print{.tr-row{break-inside:avoid}}`
}

/** 整篇原文（合并所有段落） */
function wholeSource(pairs: TranslatePair[]): string {
  return pairs.map(p => p.source).filter(Boolean).join('\n\n')
}
/** 整篇译文（合并所有段落） */
function wholeTarget(pairs: TranslatePair[]): string {
  return pairs.map(p => p.target).filter(Boolean).join('\n\n')
}

/** 生成完整 HTML 文档（每次只传一种布局，导出为独立文件） */
export function buildHtml(title: string, pairs: TranslatePair[], layouts: BilingualLayout[]): string {
  const sections = layouts.map(layout => {
    let body: string
    if (layout === 'side-by-side') {
      // 整篇原文在左栏、整篇译文在右栏
      body = `<div class="tr-whole-side">
<div class="tr-col"><p class="tr-col-label">原文</p><div class="tr-src">${nl2br(wholeSource(pairs))}</div></div>
<div class="tr-col"><p class="tr-col-label">译文</p><div class="tr-dst">${nl2br(wholeTarget(pairs))}</div></div>
</div>`
    } else if (layout === 'stacked') {
      // 整篇原文在上、整篇译文在下
      body = `<div class="tr-whole-stack">
<div><p class="tr-col-label">原文</p><div class="tr-src">${nl2br(wholeSource(pairs))}</div></div>
<div><p class="tr-col-label">译文</p><div class="tr-dst">${nl2br(wholeTarget(pairs))}</div></div>
</div>`
    } else {
      // 逐句交替：一句原文、其译文在下方带下划线
      body = pairs.map(p => renderPairHtml(p, 'interleaved')).join('\n')
    }
    return `<section class="tr-section" data-layout="${layout}">
<h2>${layoutName(layout)}</h2>
${body}
</section>`
  }).join('\n')
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${bilingualCss()}</style></head><body><h1>${esc(title)}</h1>${sections}</body></html>`
}

/** 生成 TXT / MD 内容（每份只含一种布局，导出为独立文件） */
export function buildPlain(title: string, pairs: TranslatePair[], layouts: BilingualLayout[], format: 'txt' | 'md'): string {
  const parts: string[] = [`# ${title}`]
  for (const layout of layouts) {
    parts.push('', `## ${layoutName(layout)}`, '')
    if (format === 'md' && layout === 'side-by-side') {
      // 整篇左右：两列各放整篇
      parts.push('| 原文（整篇） | 译文（整篇） |', '| --- | --- |')
      parts.push(`| ${wholeSource(pairs).replace(/\n/g, '<br>')} | ${wholeTarget(pairs).replace(/\n/g, '<br>')} |`)
    } else if (layout === 'side-by-side') {
      parts.push('【原文】', wholeSource(pairs), '', '【译文】', wholeTarget(pairs), '')
    } else if (layout === 'stacked') {
      // 上方整篇原文、下方整篇译文
      parts.push('【原文 · 全文】', wholeSource(pairs), '', '【译文 · 全文】', wholeTarget(pairs), '')
    } else {
      // 逐句交替
      pairs.forEach(p => { parts.push(p.source, `　→ ${p.target}`, '') })
    }
  }
  return parts.join('\n')
}

/** 生成用于打印的完整 HTML 文档：多文档 × 多布局，每项独立分页 */
export function buildPrintHtml(docs: { name: string; pairs: TranslatePair[] }[], layouts: BilingualLayout[]): string {
  const sections = docs.flatMap(d => layouts.map(layout => {
    const body = layout === 'side-by-side'
      ? `<div class="tr-whole-side"><div class="tr-col"><p class="tr-col-label">原文</p><div class="tr-src">${nl2br(wholeSource(d.pairs))}</div></div><div class="tr-col"><p class="tr-col-label">译文</p><div class="tr-dst">${nl2br(wholeTarget(d.pairs))}</div></div></div>`
      : layout === 'stacked'
        ? `<div class="tr-whole-stack"><div><p class="tr-col-label">原文</p><div class="tr-src">${nl2br(wholeSource(d.pairs))}</div></div><div><p class="tr-col-label">译文</p><div class="tr-dst">${nl2br(wholeTarget(d.pairs))}</div></div></div>`
        : d.pairs.map(p => renderPairHtml(p, 'interleaved')).join('\n')
    return `<section class="tr-section" data-layout="${layout}"><h2>${esc(d.name)} · ${layoutName(layout)}</h2>${body}</section>`
  })).join('<div style="page-break-after:always"></div>')
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>译文打印</title><style>${bilingualCss()}</style></head><body>${sections}</body></html>`
}

export function layoutName(layout: BilingualLayout): string {
  switch (layout) {
    case 'side-by-side': return '左右对照（左原文 · 右译文）'
    case 'interleaved': return '逐句对照（译文在下方并加下划线提示）'
    case 'stacked': return '上下结构（上原文 · 下译文）'
  }
}

/** 布局对应的文件名短后缀（多布局导出多个文件时使用） */
export function layoutSuffix(layout: BilingualLayout): string {
  switch (layout) {
    case 'side-by-side': return '左右对照'
    case 'interleaved': return '逐句对照'
    case 'stacked': return '上下结构'
  }
}
