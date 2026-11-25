// 二进制文档解析：docx（mammoth）/ pdf（pdfjs-dist）→ 纯文本。
// 全部动态 import：只在真正导入二进制文档时加载，不拖慢首屏。
// 纯本地解析，文档不上传。

export interface ParsedDoc {
  text: string
  pages?: number
}

/** 是否是需要二进制解析的文档 */
export function needsBinaryParse(name: string): boolean {
  return /\.(docx|pdf)$/i.test(name)
}

/** 解析 docx（mammoth 提取正文，保留段落换行） */
async function parseDocx(data: ArrayBuffer): Promise<ParsedDoc> {
  const mammoth = await import('mammoth/mammoth.browser')
  const result = await mammoth.extractRawText({ arrayBuffer: data })
  return { text: (result.value ?? '').replace(/\r\n/g, '\n').trim() }
}

/** 解析 pdf（pdfjs-dist 逐页提取文字） */
async function parsePdf(data: ArrayBuffer): Promise<ParsedDoc> {
  const pdfjs = await import('pdfjs-dist')
  // worker 必须本地打包：CDN 在 Tauri WebView 下加载 ESM 模块会失败（Importing a module script failed）
  // 用 ?url 让 Vite 把 worker 作为本地资源产出，随应用分发，无需联网
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
  const texts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const items = content.items as { str?: string }[]
    texts.push(items.map(it => it.str ?? '').join(' '))
  }
  return { text: texts.join('\n\n').trim(), pages: pdf.numPages }
}

/** 按扩展名解析二进制文档；不支持的类型抛错 */
export async function parseBinaryDocument(name: string, data: ArrayBuffer): Promise<ParsedDoc> {
  if (/\.docx$/i.test(name)) return parseDocx(data)
  if (/\.pdf$/i.test(name)) return parsePdf(data)
  throw new Error(`不支持的文档类型：${name}`)
}
