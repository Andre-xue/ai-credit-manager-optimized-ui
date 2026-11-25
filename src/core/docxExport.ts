// DOCX 导出：用 docx 库生成真正的 .docx，三种双语布局。
// 动态 import docx，只在导出时加载，不拖慢首屏。
// 返回 Uint8Array（二进制），调用方写入文件或触发下载。

import { alignPairs, layoutName, type TranslatePair, type BilingualLayout } from './translate'

/** 生成 DOCX 二进制（三种布局各一份，调用方每次传一种 layout） */
export async function buildDocxBlob(title: string, pairs: TranslatePair[], layout: BilingualLayout): Promise<ArrayBuffer> {
  const {
    Document, Paragraph, TextRun, Table, TableRow, TableCell,
    Packer, HeadingLevel, WidthType,
  } = await import('docx')

  const heading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1 })
  const subHeading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2 })
  const textPara = (text: string, color?: string, underline?: boolean) => new Paragraph({
    children: [new TextRun({ text, color, underline: underline ? {} : undefined })],
    spacing: { after: 120 },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any[]
  if (layout === 'side-by-side') {
    // 整篇原文在左栏、整篇译文在右栏
    const src = pairs.map(p => p.source).filter(Boolean).join('\n')
    const dst = pairs.map(p => p.target).filter(Boolean).join('\n')
    const cell = (label: string, text: string, color: string) => new TableCell({
      children: [
        new Paragraph({ children: [new TextRun({ text: label, bold: true, color })] }),
        ...text.split('\n').map(line => new Paragraph({ children: [new TextRun({ text: line, color })] })),
      ],
      width: { size: 50, type: WidthType.PERCENTAGE },
    })
    body = [
      subHeading(layoutName(layout)),
      new Table({
        rows: [new TableRow({ children: [cell('原文', src, '333333'), cell('译文', dst, '1A56DB')] })],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }),
    ]
  } else if (layout === 'stacked') {
    // 上方整篇原文、下方整篇译文
    body = [
      subHeading(layoutName(layout)),
      new Paragraph({ children: [new TextRun({ text: '原文 · 全文', bold: true })] }),
      ...pairs.map(p => p.source).filter(Boolean).map(s => textPara(s)),
      new Paragraph({ children: [new TextRun({ text: '译文 · 全文', bold: true, color: '1A56DB' })] }),
      ...pairs.map(p => p.target).filter(Boolean).map(t => textPara(t, '1A56DB')),
    ]
  } else {
    // 逐句交替：一句原文，译文在下方带下划线
    body = [subHeading(layoutName(layout))]
    for (const p of pairs) {
      if (p.source) body.push(textPara(p.source))
      if (p.target) body.push(textPara(p.target, '1A56DB', true))
      body.push(new Paragraph({ text: '' }))
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: [heading(title), ...body],
    }],
  })
  // 用 toArrayBuffer 而非 toBuffer：后者在浏览器/WebView 会触发 "nodebuffer is not supported"
  return Packer.toArrayBuffer(doc)
}

/** DOCX 的 MIME 类型 */
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** 重新导出布局名与对齐，方便调用方少 import */
export { alignPairs }
