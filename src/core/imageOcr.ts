// 图片 OCR + 纯文字译文图：
// 图片 → data URL → 云端视觉模型（streamChat images）识别文字 → 翻译 → Canvas 生成排版好的译文图。
// OCR 失败由调用方跳过、保留原流程，不阻断其他文件。

import { streamChat } from './ai'
import { layoutName, type TranslatePair, type BilingualLayout } from './translate'

/** File / ArrayBuffer → data URL */
export async function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 用云端视觉模型识别图片中的文字。
 * 返回识别出的纯文本（按行）；失败抛错由调用方跳过。
 */
export async function ocrImage(dataUrl: string, model: string): Promise<string> {
  const system = '你是一个 OCR 文字识别引擎。仔细识别图片中的所有文字，按原有阅读顺序逐行输出。只输出识别到的文字，不要解释、不要加引号、不要漏字，也不要描述图片内容。如果没有文字，输出空字符串。'
  const text = await streamChat(
    model || 'auto',
    [],
    '请识别这张图片上的全部文字。',
    () => {},
    undefined,
    [dataUrl],
    undefined,
    system,
  )
  return text.trim()
}

/** 把识别文本切成段落（按空行或换行） */
export function ocrToParagraphs(text: string): string[] {
  return text.split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean)
}

interface RenderOpts {
  width?: number
  padding?: number
  fontSize?: number
  lineHeight?: number
  bg?: string
  srcColor?: string
  dstColor?: string
}

/** 用 Canvas 把译文对渲染成一张纯文字图片（双语对照），返回 data URL */
export function renderTranslatedImage(pairs: TranslatePair[], layout: BilingualLayout, title: string, opts: RenderOpts = {}): string {
  const width = opts.width ?? 900
  const padding = opts.padding ?? 36
  const fontSize = opts.fontSize ?? 16
  const lineHeight = opts.lineHeight ?? 26
  const bg = opts.bg ?? '#ffffff'
  const srcColor = opts.srcColor ?? '#222222'
  const dstColor = opts.dstColor ?? '#1a56db'

  // 先测量并规划所有文字行（含布局），再定画布高度
  const font = `${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const wrap = (text: string, maxWidth: number): string[] => {
    const out: string[] = []
    for (const para of text.split('\n')) {
      let line = ''
      for (const ch of para) {
        if (measure.measureText(line + ch).width > maxWidth && line) { out.push(line); line = ch }
        else line += ch
      }
      out.push(line)
    }
    return out
  }
  const innerW = width - padding * 2
  type Line = { text: string; color: string; bold?: boolean; underline?: boolean; gapAfter?: number }
  const lines: Line[] = []
  lines.push({ text: title, color: srcColor, bold: true, gapAfter: lineHeight / 2 })
  lines.push({ text: layoutName(layout), color: '#888888', gapAfter: lineHeight / 2 })

  if (layout === 'stacked') {
    lines.push({ text: '原文 · 全文', color: srcColor, bold: true, gapAfter: 8 })
    pairs.forEach(p => p.source && wrap(p.source, innerW).forEach(t => lines.push({ text: t, color: srcColor })))
    lines.push({ text: '', color: srcColor, gapAfter: lineHeight / 2 })
    lines.push({ text: '译文 · 全文', color: dstColor, bold: true, gapAfter: 8 })
    pairs.forEach(p => p.target && wrap(p.target, innerW).forEach(t => lines.push({ text: t, color: dstColor })))
  } else if (layout === 'side-by-side') {
    // 左右栏：把原文/译文交替画成"原文▸ / 译文▸"块，保证纯文字图可读
    lines.push({ text: '左右对照（左原文 · 右译文）', color: '#888888', gapAfter: 8 })
    pairs.forEach(p => {
      if (p.source) wrap('原文：' + p.source, innerW).forEach(t => lines.push({ text: t, color: srcColor }))
      if (p.target) wrap('译文：' + p.target, innerW).forEach(t => lines.push({ text: t, color: dstColor }))
      lines.push({ text: '', color: srcColor, gapAfter: 8 })
    })
  } else {
    pairs.forEach(p => {
      if (p.source) wrap(p.source, innerW).forEach(t => lines.push({ text: t, color: srcColor }))
      if (p.target) wrap(p.target, innerW).forEach(t => lines.push({ text: t, color: dstColor, underline: true }))
      lines.push({ text: '', color: srcColor, gapAfter: 8 })
    })
  }

  const height = padding * 2 + lines.reduce((h, l) => h + lineHeight + (l.gapAfter ?? 0), 0)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.max(height, 200)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = font
  ctx.textBaseline = 'top'
  let y = padding
  for (const l of lines) {
    if (l.text) {
      ctx.fillStyle = l.color
      if (l.bold) ctx.font = `bold ${font}`
      ctx.fillText(l.text, padding, y)
      if (l.underline) {
        const w = ctx.measureText(l.text).width
        ctx.fillRect(padding, y + fontSize + 2, w, 1)
      }
      ctx.font = font
    }
    y += lineHeight + (l.gapAfter ?? 0)
  }
  return canvas.toDataURL('image/png')
}
