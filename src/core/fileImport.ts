// 统一文件导入：兼容 Tauri 桌面原生拖放（会被 WebView 拦截 DOM drop）、
// Web/手机 DOM 拖放与粘贴。纯文本直接读 text；图片读 dataUrl；docx/pdf 读 arrayBuffer 交由解析模块。

import { isDesktopApp } from './openExternal'

export interface ImportedFile {
  name: string
  text: string
  dataUrl?: string        // 图片：data:image/...;base64,...
  arrayBuffer?: ArrayBuffer // docx/pdf：二进制内容
}

/** 纯文本类扩展名（可直接读为字符串） */
const TEXT_EXTS = /\.(txt|md|markdown|csv|json|log|text|xml|yaml|yml|html?)$/i
/** 图片类扩展名 */
const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp|bmp|heic)$/i
/** 二进制文档扩展名 */
const BINARY_EXTS = /\.(docx|pdf)$/i

/** bytes → base64 data URL（按扩展名推断 mime） */
function bytesToDataUrl(bytes: Uint8Array, name: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:${mime};base64,${btoa(bin)}`
}

/** 桌面端：从 Tauri 原生拖放/剪贴板拿到的本地路径读取文件内容 */
export async function readFilesFromPaths(paths: string[]): Promise<{ files: ImportedFile[]; skipped: string[] }> {
  const files: ImportedFile[] = []
  const skipped: string[] = []
  if (!isDesktopApp()) return { files, skipped: paths }
  const { readFile } = await import('@tauri-apps/plugin-fs')
  for (const path of paths) {
    const name = path.split(/[\\/]/).pop() ?? '文件'
    const supported = TEXT_EXTS.test(name) || IMAGE_EXTS.test(name) || BINARY_EXTS.test(name)
    if (!supported) { skipped.push(name); continue }
    try {
      const bytes = await readFile(path)
      if (IMAGE_EXTS.test(name)) {
        files.push({ name, text: '', dataUrl: bytesToDataUrl(bytes, name) })
      } else if (BINARY_EXTS.test(name)) {
        files.push({ name, text: '', arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer })
      } else {
        files.push({ name, text: new TextDecoder('utf-8').decode(bytes) })
      }
    } catch {
      skipped.push(name)
    }
  }
  return { files, skipped }
}

/** 读取单个 File 为 ImportedFile（图片→dataUrl，docx/pdf→arrayBuffer，其余→text） */
export async function readOneFile(f: File): Promise<ImportedFile> {
  if (IMAGE_EXTS.test(f.name)) {
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f)
    })
    return { name: f.name, text: '', dataUrl }
  }
  if (BINARY_EXTS.test(f.name)) return { name: f.name, text: '', arrayBuffer: await f.arrayBuffer() }
  return { name: f.name, text: await f.text() }
}

/** Web/手机：从 DOM DataTransfer（drop 或 paste 事件的 clipboardData）读取文件 */
export async function readFilesFromDataTransfer(dt: DataTransfer | null): Promise<{ files: ImportedFile[]; skipped: string[] }> {
  const files: ImportedFile[] = []
  const skipped: string[] = []
  if (!dt) return { files, skipped }
  for (const f of Array.from(dt.files)) {
    const supported = TEXT_EXTS.test(f.name) || IMAGE_EXTS.test(f.name) || BINARY_EXTS.test(f.name)
    if (!supported) { skipped.push(f.name); continue }
    try {
      files.push(await readOneFile(f))
    } catch {
      skipped.push(f.name)
    }
  }
  return { files, skipped }
}

/**
 * 注册 Tauri 原生窗口文件拖放监听。
 * Tauri 默认拦截系统文件拖入，DOM 的 drop 事件收不到文件，必须走此 API。
 * 返回取消监听函数；非桌面端返回 noop。
 */
export async function onTauriFileDrop(handler: (paths: string[]) => void): Promise<() => void> {
  if (!isDesktopApp()) return () => {}
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return await getCurrentWindow().onDragDropEvent(event => {
      if (event.payload.type === 'drop') handler(event.payload.paths)
    })
  } catch {
    return () => {}
  }
}
